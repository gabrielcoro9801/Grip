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

Riceve un file `multipart/form-data` e restituisce `{ file_url }`. In sviluppo salva in
`uploads/` e serve i file da `/uploads/*`; massimo 10 MB, solo PDF e immagini.
Per la produzione va sostituita l'implementazione in `src/routes/uploads.js` con uno
storage S3-compatible: i chiamanti non cambiano.

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

## Punti aperti

Cose consapevolmente lasciate indietro, da affrontare prima di un uso in produzione:

- **Permessi lato server applicati solo in parte.** I ruoli sono verificati sulle modifiche
  (`src/auth/authorize.js`), ma la mappa entità → modulo copre per ora le aree sensibili —
  piano dei conti, causali, finanziamenti, profilo fiscale, fornitori, acquisti, template
  ricevuta, cedolini, account staff. Le altre entità restano scrivibili da qualunque utente
  autenticato dello staff. L'elenco va stretto man mano che ogni area viene verificata.
- **Nessun controllo sulla lettura.** I ruoli limitano cosa si può modificare, non cosa si
  può leggere: un utente autenticato può interrogare qualsiasi entità.
- **Aggiornamenti in tempo reale**: `subscribe()` sul client non fa nulla. L'unico punto
  che lo usa è il calendario corsi del portale soci, che si aggiorna al ricaricamento.
- **CORS aperto** a qualsiasi origine: va ristretto al dominio del frontend.
- **`JWT_SECRET`** ha un default di sviluppo: in produzione è obbligatorio impostarlo
  (il server si rifiuta di partire senza, se `NODE_ENV=production`).
- **Storage file su disco locale**: `src/routes/uploads.js` va sostituito con uno storage
  S3-compatible prima di un deploy su più istanze.
