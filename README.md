# Grip — Gestione Palestra

Gestionale per palestre: CRM soci, corsi e prenotazioni, contabilità in partita doppia,
ricevute, personale/PT, schede di allenamento e portale soci.

- **Frontend**: React 18 + Vite 6, Tailwind CSS, Radix UI, React Router (cartella `src/`)
- **Backend**: Fastify + PostgreSQL con Drizzle ORM (cartella `server/`)

## Avvio rapido

Servono due processi: il backend (porta 3001) e il frontend (porta 5173).

**1. Database** — PostgreSQL deve essere in esecuzione. È installato come servizio Windows
(`postgresql-x64-18`) e parte da solo all'avvio del PC.

**2. Backend**
```
cd server
npm install          # solo la prima volta
npm run db:migrate   # solo la prima volta, o dopo modifiche allo schema
npm run db:seed      # solo la prima volta: crea l'account amministratore
npm start
```

**3. Frontend** (in un secondo terminale, dalla radice del progetto)
```
npm install          # solo la prima volta
npm run dev
```

Apri http://localhost:5173.

In VSCode puoi anche premere **F5**: avvia backend e frontend insieme e apre il browser.

## Uso quotidiano (dopo aver spento il PC)

PostgreSQL è un servizio Windows in avvio automatico: riparte da solo, non serve fare
nulla. Database, tabelle e dati restano su disco.

Per far ripartire l'app basta:

- **In VSCode**: premi **F5** — parte tutto (backend + frontend) e si apre il browser.
- **Da terminale**, in due finestre separate:
  ```
  # Terminale 1
  cd server
  npm start

  # Terminale 2 (dalla radice del progetto)
  npm run dev
  ```
  poi apri http://localhost:5173.

Non serve ripetere `npm install`, `db:migrate` né `db:seed` — servono solo la prima volta
o quando cambiano rispettivamente le dipendenze, lo schema del database, o si vuole
ricreare l'account admin.

## Accesso

Ci sono due aree con accessi distinti:
- **Gestionale** (`/`) — per lo staff
- **Portale soci** (`/member-portal`) — richiede un account con ruolo `member` collegato a
  un'anagrafica socio

L'unico account che crea il seed è l'amministratore (`admin@grip.local` / `admin1234`, o
quello che indichi in `SEED_ADMIN_PASSWORD`). **Cambia la password dopo il primo accesso.**
Da **Admin & Utenti** si creano gli altri account, e si definiscono i ruoli.

### Account nel database di sviluppo

Non li crea il seed: esistono solo nel database attuale, e servono a provare l'applicazione
dai diversi punti di vista.

| Email | Password | Ruolo | A cosa serve |
|---|---|---|---|
| `admin@grip.local` | `admin1234` | Admin | Vede tutto |
| `reception@grip.local` | `reception1234` | Reception | Soci e movimenti, non la contabilità avanzata né gli account |
| `tesoriere@grip.local` | `tesoriere1234` | Tesoriere | Ruolo **creato dall'interfaccia**: contabilità e pagamenti, nessun accesso ai soci |
| `giulia@grip.local` | `socio1234` | Socio | Portale soci, con abbonamento e scheda di allenamento |

Il *Tesoriere* è utile per due prove: che il menu si riduca davvero secondo i permessi, e che
un ruolo senza gestione utenti non possa concedersi niente.

## Metterlo online

In produzione **un servizio solo serve tutto**: il server Fastify pubblica sia le pagine
dell'applicazione (`npm run build` → `dist/`) sia l'API, sullo stesso indirizzo. Costa un po'
in prestazioni rispetto a una CDN, irrilevante a questa scala, e in cambio toglie di mezzo il
CORS — non c'è nessuna chiamata fra domini diversi — un secondo pannello e un secondo dominio.

In sviluppo restano due processi separati, come sempre: Vite sulla 5173, il server sulla 3001.

La guida operativa è in **[docs/deploy.md](docs/deploy.md)**: come funzionano commit e push,
Railway, il DNS di `gripcore.it`, l'ordine in cui vanno fatti i passi e cosa guardare quando
qualcosa non funziona.

Tre punti che si sbagliano quasi sempre, spiegati lì per esteso:

- **I file caricati vanno su un volume persistente** (`UPLOAD_DIR`). Su una piattaforma a
  container il disco si azzera a ogni deploy: senza volume, le ricevute già emesse spariscono
  e nessuno se ne accorge finché non prova ad aprirne una.
- **Non impostare `PORT` fra le variabili di Railway.** La assegna la piattaforma; forzandola
  il dominio risponde *"application failed to respond"*.
- **Cloudflare su SSL/TLS "Full (strict)".** Su *Flexible* si ottiene un ciclo infinito di
  redirect, con un errore che non dice perché.

## Stato del progetto

**L'uscita da base44 è completa.** Nessuna sua libreria, nessun riferimento nel codice,
nessun pacchetto: dati, autenticazione e upload passano tutti dal backend in `server/`.

**La roadmap Contabilità & Finance è chiusa**, fasi 0–6, entrambi i traguardi (cliente beta
e vendita ad altre ASD). Il registro dettagliato — cosa è stato fatto, come è stato
verificato e cosa è rimasto fuori — è in [docs/roadmap-contabilita.md](docs/roadmap-contabilita.md).
È il documento da leggere per riprendere il filo: questo elenco ne è solo il riassunto.

### 20 agosto 2026

Una giornata sola, su un filo conduttore: **un valore scritto nel codice è un valore che
nessuno può correggere quando cambia** — e in un gestionale venduto a più associazioni,
prima o poi cambia.

#### Il piano dei conti è dell'ente

Il motore contabile cercava i conti per numero — `"2.1"` la cassa, `"4.1"` i debiti verso
fornitori — in **33 punti**. Per questo i conti che contano erano bloccati nell'interfaccia,
senza matita né cestino: rinumerarli avrebbe rotto il cedolino o, peggio, spostato una
scrittura sul conto sbagliato in silenzio.

Ora il legame passa da un **compito** assegnato al conto (`ruolo_sistema`): il motore chiede
*"il conto che fa da cassa"*, non *"il conto 2.1"*. Codice e nome sono liberi su ogni conto,
e le scritture puntano all'identificativo — rinumerare si riflette ovunque, registro
compreso. Il catalogo dei 18 compiti è in `shared/contiSistema.js`; la schermata *Piano dei
conti* mostra chi svolge cosa e avvisa sui compiti scoperti.

Aggiunti i vincoli che mancavano: un codice non si ripete, un compito appartiene a un conto
solo. L'eliminazione dice *quanti movimenti* la impediscono invece di riportare un errore di
chiave esterna.

Per renderlo verificabile ho estratto la partita doppia in una funzione pura
(`shared/scritture.js`) e l'ho coperta di test. **Lo scandaglio sugli arrotondamenti ha
trovato un difetto reale**: con IVA al 4% il vecchio calcolo sbilanciava la scrittura di un
centesimo su circa 4.000 importi su 200.000. Al 22%, 10% e 5% mai.

#### La fattura elettronica: l'app produce il file, non lo trasmette

`shared/fatturaElettronica.js` costruisce l'XML in formato FatturaPA 1.2.2, scaricabile dalla
scheda **Fatture**. **La trasmissione allo SdI resta fuori dall'applicazione, per scelta**:
collegarsi richiede di accreditare un canale per ogni ente e porta con sé la conservazione a
norma per dieci anni, obbligo distinto dall'invio. È un'evolutiva possibile, non un pezzo
mancante — e l'interfaccia lo dice.

I campi che il tracciato richiede e che il database non aveva sono stati aggiunti: partita
IVA e codice fiscale separati, sede scomposta, codice del regime fiscale, e per il cliente il
**codice destinatario o la PEC**. L'anagrafica copre anche i clienti **Pubblica
Amministrazione** e la **scissione dei pagamenti**. Emerso strada facendo: i clienti non erano
modificabili, esisteva solo la creazione.

#### Via i valori cablati

**Le aliquote hanno una data.** `ALIQUOTA_IRES = 24`, `SOGLIA_ESENZIONE = 15000` e le altre
erano costanti applicate a qualunque data. Ma l'app calcola anche esercizi passati: dopo un
cambio di legge, ricalcolare un anno vecchio avrebbe dato un numero sbagliato con l'aria di
essere giusto. Ora vivono nella tabella `parametri_fiscali` con la loro decorrenza e la
norma che le stabilisce, e i calcoli **si rifiutano di procedere** se per quella data il
valore non è noto.

**I quattordici `ruolo === "admin"` sparsi nell'interfaccia non ci sono più.** La matrice dei
permessi non poteva esprimere la differenza fra un dipendente e un amministratore dentro
"Personale" — hanno gli stessi permessi sul modulo, ma uno vede i propri dati e l'altro
quelli di tutti. Ora ci sono **capacità nominate** (`gestire_personale`,
`chiudere_esercizio`, `rigenerare_documento`, `registrazione_manuale`), in un posto solo.

**La contabilità la crea il server.** Piano dei conti e causali li seminava il browser al
caricamento della pagina: lo scheletro contabile dell'ente lo costruiva chi apriva l'app per
primo. Ora è `npm run db:seed`, o un endpoint riservato all'amministratore. L'aliquota IVA
delle causali predefinite non è più `22` scritto undici volte: si legge dai parametri
fiscali.

**Segreti e ambiente.** Con `NODE_ENV=production` il server si rifiuta di partire senza
`JWT_SECRET` e `CORS_ORIGIN`, e il seed senza `SEED_ADMIN_PASSWORD`, dicendo cosa manca e
perché. In sviluppo tutto parte come prima.

**I ruoli sono dell'ente.** La matrice dei permessi sta ora nella tabella `ruoli` e si
configura da *Admin & Utenti*, dove si possono anche **creare ruoli nuovi** partendo dalla
copia di uno esistente. Tre protezioni restano nel codice e non hanno una schermata che le
allenti — al socio non si assegnano permessi da lì, l'amministratore non può perdere la
gestione utenti (o nessuno rientrerebbe più), e **nessuno può concedere un permesso che non
possiede**, altrimenti delegare la gestione utenti equivarrebbe a delegare tutto.

**Il form del piano dei conti non parla più in contabilese.** Chiede *che cosa registra il
conto* e ricava tipo e natura, invece di chiedere "attivo o passivo" a chi commercialista non
è — e sbagliare quella classificazione non dà errore, produce solo un bilancio storto. La
natura è derivata ma non imposta: i conti rettificativi esistono, e il fondo ammortamento è
già nel piano predefinito.

#### Cose che mancavano

**I piani di allenamento si modificano.** La pagina sapeva solo crearli. Ora ogni scheda ha
matita e cestino: si cambiano nome, note ed esercizi, con serie, ripetizioni, peso e RPE. Il
socio resta bloccato in modifica — riassegnare un piano lascerebbe i suoi allenamenti
agganciati a una scheda intestata a un altro — e l'eliminazione dice quanti allenamenti la
impediscono e di chi.

**I clienti si modificano.** Anche lì esisteva solo la creazione, e senza modifica non ci
sarebbe stato modo di aggiungere i dati per la fattura elettronica alle schede già registrate.

131 test.

### 19 agosto 2026 — permessi e superfici esposte

Il portale soci era aperto sull'intero database. Tre correzioni, tutte lato server:

- **Il socio leggeva tutto.** Un account `member` autenticato riceveva 200 su `Payslip`
  (gli stipendi di tutti), `StaffAccount`, `JournalEntry`, `Invoice`, `Collaboratore` e
  l'anagrafica completa degli altri soci: la separazione esisteva solo nell'interfaccia,
  che nasconde le voci di menu ma non impedisce la stessa richiesta fatta a mano.
  `server/src/auth/memberScope.js` definisce ora le sole entità che il portale ha ragione
  di leggere e la colonna con cui si riconoscono le righe del socio; il filtro è imposto
  dal server sia sulla lista sia sulla lettura per id, così indovinare un identificativo
  non aggira nulla. In scrittura il socio crea solo il proprio QR d'ingresso e i propri
  allenamenti, con il proprietario imposto dal server.
- **Le registrazioni contabili non controllavano il ruolo**, se non per quelle manuali:
  dichiarando una qualsiasi altra origine si poteva scrivere in contabilità.
- **L'upload non chiedeva l'autenticazione**: era un deposito di file aperto sul disco del
  server, con i file poi serviti pubblicamente.

Verificato con un giro del browser su tutte le pagine del portale e sulle 28 pagine staff,
senza errori; il flusso ricevuta completo (scrittura, PDF, upload, emissione) continua a
funzionare. Il confine è ora coperto da un test di regressione — `cd server && npm test` —
così se qualcuno riapre una di queste porte se ne accorge subito.

### Da riprendere

**Un difetto da correggere.** `receiptEngine.js` decide il tipo di ricevuta confrontando
`organization.regime_fiscale === "forfettario"`. Quella stringa non corrisponde a niente: il
campo è `null` e nessun punto dell'applicazione lo scrive: chi compila il profilo fiscale
scrive su un'altra tabella e con un altro vocabolario (`"Legge 398/1991"`), e da oggi esiste
pure `regime_fiscale_codice` con `RF18`. Tre nomi per la stessa cosa, e il confronto è sempre
falso — quindi **ogni ricevuta esce come "RICEVUTA FISCALE"**, anche per un'ASD in 398 senza
gestione IVA, che dovrebbe emetterne una semplice. Va scelto quale campo è la fonte della
verità (il codice del tracciato è il candidato migliore) e fatto guardare a tutti lo stesso.

**Due duplicazioni innocue.** I valori predefiniti `giorni_ferie_anno: 26` e
`soglia_settimanale_ore: 40` sono ripetuti in quattro punti — sono già per collaboratore in
banca dati e modificabili, ma cambiarne il default significa trovarli tutti. E
`const MESI = moment.months()` è la stessa riga in tre pagine.

I punti seguenti invece non bloccano nulla: sono scelte rimaste aperte, non lavori a metà.

**Serve una tua decisione:**

- **Codice del regime fiscale per la L. 398/1991.** Il tracciato non ne ha uno dedicato e si
  usa RF18 ("Altro"): va confermato dal commercialista dell'ente. L'app lo lascia scegliere,
  non lo impone. Da rivedere insieme dopo che il commercialista avrà visto le prime fatture.
- **Riparto dei costi promiscui** fra attività istituzionale e commerciale: serve un
  criterio concordato col commercialista, non è una scelta tecnica.
- **Ore e tariffa oraria di un istruttore interno**: manca il modello (tariffa base,
  maggiorazioni) su cui calcolare il compenso.

**Lavoro definito, solo da fare:**

- **I file caricati restano leggibili senza autenticazione.** L'upload ora è protetto, ma
  `/uploads/*` serve ancora i file a chiunque conosca l'URL. Il nome è un UUID casuale,
  quindi non si indovina — ma un link che finisce in una cronologia resta valido per
  sempre. Diventa un problema vero il giorno in cui si caricheranno documenti dei soci
  (certificati medici, documenti d'identità): vanno serviti passando dal server, con lo
  stesso controllo di proprietà già usato per le entità.
- **Permessi in lettura per lo staff.** Oggi ogni dipendente autenticato legge tutto; le
  restrizioni riguardano solo le modifiche. È stato lasciato aperto di proposito — sono
  persone di fiducia e stringere alla cieca rischia di rompere flussi che funzionano — ma
  resta una scelta da rivedere quando l'organico cresce.
- **IVA sugli acquisti in regime ordinario.** Per un'ASD in 398/1991 l'attuale trattamento
  è corretto (l'IVA non è detraibile e resta un costo), ma un ente in regime ordinario si
  aspetterebbe la separazione sul conto 3.9. Riguarda la vendita ad altre ASD.
- **Aggiornamenti in tempo reale** nel calendario corsi del portale soci: un solo punto di
  consumo, sostituibile con SSE su Postgres `LISTEN/NOTIFY`.
- **Conto dedicato al TFR destinato a previdenza complementare.**
- **Nessun backup, e nessun deployment.** La contabilità sta in PostgreSQL su un PC e i PDF
  in `server/uploads/`: né l'uno né l'altro vengono copiati da nessuna parte, e i documenti
  fiscali vanno conservati dieci anni. L'app inoltre gira in locale con due terminali.
  Finché è un ambiente di prova non si perde nulla; **il giorno in cui un cliente inserisce
  dati veri diventano le due cose più urgenti in assoluto**, prima di qualsiasi funzionalità.

**Evolutive rinviate per scelta, non debito:**

- **Trasmissione allo SdI dall'applicazione.** Oggi l'XML si scarica e lo si invia dal
  proprio canale. Se un giorno servisse automatizzarlo, la scelta è fra intermediario via
  API (che copre anche la conservazione decennale) e invio diretto via SdICoop o PEC; nel
  primo caso va deciso chi tiene il contratto — ogni ASD il proprio, o uno solo per tutti.

## Struttura

```
src/            frontend React
  api/client.js client verso il backend (entities, auth, upload)
  lib/          logica di dominio: contabilità, ricevute, prenotazioni, permessi
  pages/        pagine per modulo
  components/   componenti condivisi e UI
server/         backend Fastify + PostgreSQL (vedi server/README.md)
```

Il frontend parla con il backend solo tramite `src/api/client.js`: le pagine non fanno
richieste HTTP dirette.

## Comandi utili

| Comando | Effetto |
|---|---|
| `npm run dev` | avvia il frontend in sviluppo |
| `npm run build` | build di produzione in `dist/` |
| `npm run lint` | controllo statico del codice |
| `cd server && npm start` | avvia il backend |
| `cd server && npm test` | test dei permessi (serve il database, non il server avviato) |
| `cd server && npm run db:studio` | interfaccia web per esplorare il database |
