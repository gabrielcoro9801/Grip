# Grip — backend

API dell'applicazione: Fastify + PostgreSQL con Drizzle ORM.
Fornisce dati, autenticazione e archiviazione file al frontend in `../src`.

## Avvio

```
npm install          # solo la prima volta
npm run db:migrate   # crea/aggiorna le tabelle
npm run db:seed      # crea l'account amministratore iniziale
npm start            # avvia su http://localhost:3001
```

`npm run dev` avvia con ricaricamento automatico alle modifiche.

## Configurazione dell'ambiente

`src/config.js` legge le variabili d'ambiente e **verifica all'avvio** che ci sia quello che
serve. In sviluppo il server parte senza configurare nulla; con `NODE_ENV=production` si
rifiuta di partire finché `JWT_SECRET` e `CORS_ORIGIN` non sono impostate, elencando cosa
manca e perché. Un avviso nei log non basterebbe: nessuno lo legge, e il server resterebbe
in piedi con un segreto noto — cioè con chiunque in grado di firmarsi un token da
amministratore.

Stessa logica per `npm run db:seed`: fuori dallo sviluppo pretende `SEED_ADMIN_PASSWORD`,
perché il primo account non può nascere con una password scritta nel codice sorgente.

| Variabile | In sviluppo | In produzione |
|---|---|---|
| `DATABASE_URL` | obbligatoria | obbligatoria |
| `JWT_SECRET` | default di sviluppo, con avviso | **obbligatoria** |
| `CORS_ORIGIN` | qualunque origine | **obbligatoria** (elenco separato da virgole) |
| `SEED_ADMIN_PASSWORD` | `admin1234` | **obbligatoria** |
| `SEED_ORGANIZZAZIONE` | "La mia associazione" | facoltativa |
| `PORT`, `PUBLIC_BASE_URL`, `JWT_EXPIRES_IN` | facoltative | facoltative |

## Configurazione

Variabili in `.env` (vedi `.env.example`):

| Variabile | Default | Note |
|---|---|---|
| `DATABASE_URL` | `postgres://grip_app:...@localhost:5432/grip_dev` | connessione PostgreSQL |
| `PORT` | `3001` | porta di ascolto |
| `JWT_SECRET` | segreto di sviluppo | **obbligatorio in produzione** |
| `JWT_EXPIRES_IN` | `12h` | durata della sessione |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `admin@grip.local` / `admin1234` | usate solo dal seed |

## API

### Dati — `/api/entities/:name`

Un unico endpoint parametrico copre tutte le 39 entità (`Member`, `JournalEntry`,
`Booking`, …); i nomi validi sono in `src/entities/registry.js`.

| Metodo | Percorso | Uso |
|---|---|---|
| GET | `/api/entities/:name` | elenco; `?_sort=-created_date&_limit=100`, più filtri di uguaglianza (`?member_id=…`) |
| GET | `/api/entities/:name/:id` | singolo record |
| POST | `/api/entities/:name` | creazione |
| POST | `/api/entities/:name/bulk` | creazione multipla |
| PUT | `/api/entities/:name/:id` | modifica |
| DELETE | `/api/entities/:name/:id` | eliminazione |

Richiedono tutte un token valido. I campi viaggiano in `snake_case` in entrambe le
direzioni; la traduzione da/verso i nomi delle colonne è in `src/entities/columnMaps.js`.

### Autenticazione — `/api/auth/*`

`POST /login` (restituisce token + utente), `GET /me`, `POST /logout`,
`POST /change-password`. Le password sono hashate con bcrypt e non escono mai dall'API.
Il token va inviato come `Authorization: Bearer <token>`.

### File — `POST /api/uploads`

Riceve un file `multipart/form-data` e restituisce `{ file_url }`. Richiede un account
dello staff: il portale soci non carica nulla. In sviluppo salva in `uploads/` e serve i
file da `/uploads/*`; massimo 10 MB, solo PDF e immagini.
Per la produzione va sostituita l'implementazione in `src/routes/uploads.js` con uno
storage S3-compatible: i chiamanti non cambiano.

Attenzione: `/uploads/*` serve i file **senza autenticazione**, a chiunque ne conosca
l'URL. Il nome è un UUID casuale, quindi non si indovina, ma un link resta valido per
sempre e non distingue chi lo apre. Va cambiato prima di archiviare documenti dei soci.

## Schema

`src/db/schema/`, un file per dominio (`crm`, `courses`, `accounting`, `hr`, `fitness`,
`fiscal`, `common`). Dopo una modifica:

```
npm run db:generate   # genera la migrazione SQL
npm run db:migrate    # la applica
```

`npm run db:studio` apre un'interfaccia web per esplorare i dati.

## Endpoint dedicati

Alcune operazioni non passano dall'endpoint generico delle entità, perché richiedono una
transazione o un numero progressivo assegnato dal server:

| Endpoint | Perché non è generico |
|---|---|
| `POST /api/journal-entries` | testata e righe insieme, protocollo dal contatore |
| `POST /api/purchase-orders/:id/deliver` | la consegna genera il costo, in transazione col cambio di stato |
| `POST /api/invoices` · `POST /api/receipts` · `PUT /api/receipts/:id/issue` | numerazione fiscale progressiva per esercizio |
| `POST /api/payroll-runs` | scrittura aggregata degli stipendi, previa verifica dei cedolini |
| `POST /api/exercise-closures` | chiusura d'esercizio e destinazione del risultato |

La creazione diretta di `JournalEntry` e `JournalLine` dall'endpoint generico è bloccata:
non potrebbe garantire l'atomicità fra le due tabelle.

Tutte le numerazioni progressive passano da `src/lib/numbering.js`, che le prende dalla
tabella `numbering_counters` con un incremento che blocca la riga. Il vecchio metodo —
leggere il massimo esistente e sommare uno — assegnava lo stesso numero a due operazioni
simultanee.

## Classificazione dei conti

`shared/tipiConto.js` traduce la classificazione contabile in domande di italiano corrente.
Il form del piano dei conti non chiede più "attivo o passivo" e "natura dare o avere" — è il
vocabolario giusto ma non è quello di chi apre quella schermata in un'associazione — chiede
**che cosa registra il conto**, e il tipo lo ricava.

La natura viene derivata dal tipo ma **non imposta**: i conti rettificativi esistono e sono
legittimi (il fondo ammortamento sta fra le attività e le riduce). Invertirla è permesso, con
l'avviso che è quel caso raro.

Sotto le due scelte compare la conseguenza — *"un movimento in avere aumenta questo conto"* —
perché è quello che serve per capire se si è scelto giusto: "natura: avere" non lo dice.

## Ruoli e permessi

La matrice viveva nel codice: sei ruoli uguali per ogni installazione. Ora sta nella tabella
`ruoli`, una riga per ruolo, e l'ente può ridefinirli da **Admin & Utenti**. I valori del
codice (`shared/permissions.js`) restano come punto di partenza e come fallback quando non
c'è nulla di salvato.

Il server carica la matrice **prima di servire qualunque richiesta** (`caricaMatriceIniziale`
in `src/index.js`) e la ricarica a ogni salvataggio; il browser riceve i permessi del proprio
ruolo insieme all'utente, al login.

Tre protezioni, che non hanno una schermata che le allenti:

- **Il socio non riceve permessi da qui.** Quello che vede il portale è deciso da
  `src/auth/memberScope.js` — è il confine che una volta lasciava passare i cedolini di
  tutti. Concederglielo con una spunta significherebbe riaprire quella falla.
- **L'amministratore non perde la gestione utenti.** Senza, un salvataggio sbagliato
  chiuderebbe la porta dall'esterno e nessuno potrebbe più rientrare.
- **Nessuno concede ciò che non ha.** Altrimenti delegare la gestione utenti equivarrebbe a
  delegare ogni altro permesso, perché chi la riceve potrebbe assegnarsi il resto.

Le prime due sono in `applicaLimiti()`, riapplicate **anche in lettura**: fidarsi di ciò che
è già in banca dati significherebbe che una riga scritta a mano scavalca il controllo. La
terza vale su `PUT` e su `POST` — senza il controllo anche in creazione si potrebbe fare un
ruolo con quello che si vuole e poi assegnarselo.

### Ruoli nuovi

Si creano dalla stessa schermata, partendo dalla copia di un ruolo esistente. Il **nome
tecnico** è ricavato dall'etichetta e non cambia più: finisce nel token e nella colonna
`ruolo` degli account, quindi rinominarlo lascerebbe senza permessi chi è già collegato,
fino alla scadenza del token.

L'eliminazione è protetta due volte: i sei ruoli di base non si eliminano mai, gli altri
solo se nessun account li usa — e il messaggio dice quanti sono.

⚠️ La matrice in uso è stato di modulo, quindi vale per tutta l'applicazione: va bene finché
l'installazione serve una sola organizzazione, che è il caso oggi. Servendone più d'una
andrebbe legata alla richiesta.

## Conti di sistema

Il motore contabile deve saper trovare da sé certi conti — la cassa, l'IVA a debito, le
otto voci del cedolino. Prima li cercava per numero, in una trentina di punti: per questo
quei conti erano bloccati nell'interfaccia, perché rinumerarli avrebbe rotto il motore.

Ora ogni conto può portare un **compito** (`chart_of_accounts.ruolo_sistema`) e il motore
chiede quello. Il catalogo dei 18 compiti, con descrizioni, è in `shared/contiSistema.js`;
lato server `src/lib/contiSistema.js` li risolve in identificativi.

Conseguenze pratiche:
- codice e nome di un conto si possono cambiare quando si vuole, compresi i conti di sistema;
- un compito appartiene a un solo conto per organizzazione (indice unico parziale), e i
  codici sono unici per organizzazione;
- quando un compito è scoperto l'errore nomina **il compito**, non il numero: a chi ha
  rinumerato il piano a modo suo, "manca il conto 4.6" non direbbe nulla.

## Test

```
npm test
```

Serve il database in esecuzione, non il server: i test costruiscono l'app in memoria e la
interrogano con `app.inject()`.

`test/scritture.test.js` copre la partita doppia — la logica che, quando sbaglia, non dà
errore: produce una scrittura che quadra e che è sul conto sbagliato. Quasi ogni caso
ricontrolla l'invariante *dare = avere*, e uno scandaglio verifica su 200.000 importi che
imponibile e imposta sommino sempre al lordo (è così che è emerso uno sbilancio da un
centesimo con IVA al 4%). Un test rinumera l'intero piano dei conti e pretende che la
scrittura resti identica.

`test/permessi-portale-soci.test.js` copre il confine fra il portale soci e il resto
dell'applicazione — l'unico punto in cui l'applicazione ha già sbagliato una volta, con i
cedolini e l'intera contabilità leggibili da un socio. Verifica cosa un socio non deve
leggere, che veda solo le proprie righe (anche chiedendo per id), che possa creare solo
codici di accesso e allenamenti intestati a sé, che le rotte contabili e l'upload gli siano
chiusi, e che nulla di tutto questo abbia ristretto lo staff.

Il test si crea i propri soci e i propri account e li cancella alla fine: non dipende da
com'è popolato il database in cui gira.

## Punti aperti

Cose consapevolmente lasciate indietro, da affrontare prima di un uso in produzione:

- **Permessi lato server applicati solo in parte.** I ruoli sono verificati sulle modifiche
  (`src/auth/authorize.js`), ma la mappa entità → modulo copre per ora le aree sensibili —
  piano dei conti, causali, finanziamenti, profilo fiscale, fornitori, acquisti, template
  ricevuta, cedolini, account staff. Le altre entità restano scrivibili da qualunque utente
  autenticato dello staff. L'elenco va stretto man mano che ogni area viene verificata.
- **Controllo sulla lettura solo per i soci.** Un account `member` vede le sole entità che
  il portale ha ragione di leggere, filtrate alle proprie righe (`src/auth/memberScope.js`).
  Per lo staff invece la lettura resta libera: i ruoli limitano cosa si può modificare, non
  cosa si può vedere. È una scelta — sono persone di fiducia e stringere alla cieca rischia
  di rompere flussi funzionanti — ma va rivista quando l'organico cresce.
- **Aggiornamenti in tempo reale**: `subscribe()` sul client non fa nulla. L'unico punto
  che lo usa è il calendario corsi del portale soci, che si aggiorna al ricaricamento.
- **CORS aperto** a qualsiasi origine: va ristretto al dominio del frontend.
- **`JWT_SECRET`** ha un default di sviluppo: in produzione è obbligatorio impostarlo
  (il server si rifiuta di partire senza, se `NODE_ENV=production`).
- **Storage file su disco locale**: `src/routes/uploads.js` va sostituito con uno storage
  S3-compatible prima di un deploy su più istanze.
