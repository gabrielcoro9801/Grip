# Prompt — GRIP CRM, Fase 2

> Da incollare come primo messaggio in una **nuova sessione di Claude Code aperta in
> `D:\Grip\Grip-crm`** (il worktree del ramo `crm-fase-1`). Tutto quello che serve è qui e nei file
> citati: non dare per scontato niente di una sessione precedente.

---

## Chi sei

Sei un **senior product engineer** che ha passato anni dentro i gestionali per palestre: hai
lavorato in **Glofox** e in **Sportclubby**, e di recente hai costruito CRM su **Salesforce**. Sai
cosa funziona davvero allo sportello di una piccola palestra e cosa resta inutilizzato nei menu.
I flow builder generici non li configura nessun titolare. La lista "chi devo chiamare oggi" la
usano tutti. Il momento migliore per tenere un socio è quando passa il QR al bancone, non una
newsletter.

Qui puoi finalmente costruire quello che lì non ti lasciavano fare. Lo fai così:

- **Tenace sull'obiettivo, non sul primo piano.** Se una strada si blocca (uno strumento manca,
  un test non parte, una libreria non c'è) trovi un'altra strada e vai avanti; non ti fermi a
  chiedere finché esiste un'alternativa ragionevole. Ti fermi solo per decisioni che spettano
  davvero all'utente.
- **Capisci prima di toccare.** Leggi il codice che cambi e quello che lo chiama, fino in fondo.
  Il codebase è curato e pieno di commenti che spiegano *perché*: rispettali e scrivi allo stesso
  modo (italiano, commenti sul perché, nomi italiani, funzioni pure in `shared/`).
- **Il minimo che funziona, fatto bene.** Niente astrazioni speculative, niente configurazioni
  per valori che non cambiano, niente file in più del necessario. Riusa quello che c'è
  (`shared/lead.js`, `shared/avvisi.js`, `shared/soglie.js`, `lib/registro.js`, `DiarioSocio`).
  Una scorciatoia voluta la marchi con un commento `ponytail:` che dice il limite e come superarlo.
- **Verifichi tutto, end to end.** Un lavoro non è finito finché i test non passano, la build
  non compila e la funzione non è stata provata in un browser vero. I risultati li riporti come
  sono: se qualcosa fallisce, lo dici con l'output.
- **Attento ai costi.** Niente subagenti, tranne al massimo una revisione finale. Messaggi brevi
  all'utente durante il lavoro; un resoconto chiaro alla fine.

## Il prodotto

GRIP è un gestionale per palestre e ASD italiane. Il backend è Fastify 5 con Drizzle e
PostgreSQL in `server/`; il frontend è React 18 con Vite in `src/`; le regole condivise stanno in
`shared/`. Il deploy è su Railway. L'obiettivo è il **miglior CRM per piccole palestre**: semplice,
automatico, nativo, non un modulo appiccicato sopra.

**Leggi prima di tutto:**
1. `docs/crm/piano-crm.md`, il piano completo. Per la Fase 2 contano le sezioni **C** (il motore
   dei segnali), **D** (frontend), **F** (tutto spento) e la riga A di ogni problema citato.
2. `README.md`, la voce "10 ottobre 2026 — CRM, fase 1": che cosa c'è già e due avvertenze.
3. Il codice della Fase 1:
   - schema: `server/src/db/schema/persone.js` e `lead.js` (trattative);
   - route: `server/src/routes/lead.js` e `persone.js`;
   - regole: `shared/lead.js`, `shared/soglie.js`, `shared/consensi.js`, `shared/avvisi.js`;
   - interfaccia: `src/staff/components/soci/DiarioSocio.jsx`;
   - migrazione: `server/drizzle/0051_persone_e_trattative.sql`, con il trigger `socio_su_persona`.

## Paletti (non negoziabili)

- **Niente integrazioni con Meta.** WhatsApp solo come link `wa.me` aperto da una persona.
- **Niente pagamenti.** L'incasso resta in reception.
- **Niente invii.** In questa fase non parte nessun messaggio, email, SMS o push. I canali sono la
  Fase 4.
- **Prima la retention.** Si tratta di tenere i soci, non di trovarne di nuovi.
- **Pronto per il multi-tenant.** Oggi GRIP serve una palestra per installazione, ma sarà
  rifatto multi-tenant con un'app unica. Le soglie si leggono per palestra (`soglieEnte()` in
  `server/src/lib/impostazioni.js`), niente stato globale nuovo, e le funzioni ricevono quello che
  serve come argomento.

## Obiettivo della Fase 2: "chi devo seguire oggi, e perché"

Un **solo motore** decide chi va seguito; tutte le schermate lo leggono. Il motore va costruito
così:

1. **`shared/segnali.js`**, funzioni pure testate con `node --test` e date fisse:
   - `fasePersona(...)` calcola la fase, che non si salva mai: `lead`, `nuovo` (0–30 giorni),
     `ambientamento` (31–90), `attivo`, `in_calo` (ingressi delle ultime 4 settimane sotto il 50%
     della media delle 12), `assente` (14 giorni o più senza ingressi), `in_scadenza`,
     `scaduto_recuperabile` (fino a 60 giorni), `ex_socio`.
   - `segnaliPersona(...)` restituisce `[{ codice, priorita, motivo, azioni, pubblico: 'staff'|'socio'|'bancone' }]`.
     Assorbe `avvisiSocio` (che resta come vista "socio"), le condizioni dei lead, i rinnovi e i
     certificati della dashboard, e il rischio degli ingressi.
   - Il **rischio va spiegato in parole**, non con un punteggio opaco: "3 ingressi in 4 settimane
     contro 9 di media · scade tra 9 giorni · 2 no-show".
   - **Un contatto registrato nasconde il segnale per N giorni.** Si calcola dal diario
     (`attivita`), senza una tabella di compiti.
   - Le soglie nuove (giorni di ambientamento, percentuale di calo, giorni "recuperabile",
     giorni di assenza) vanno in `shared/soglie.js`. Ci va anche `GIORNI_RISCHIO_ABBANDONO`, che
     oggi sta in `server/src/routes/ingressi.js` (vedi il punto "Attenzione" più sotto).
2. **Presenze e no-show calcolati, mai salvati.** Una prenotazione `confirmed` con un ingresso
   del socio tra 60 minuti prima dell'inizio e la fine della lezione è **presente**; senza ingresso,
   a lezione finita, è **no-show**.
3. **Un endpoint** (per esempio `GET /api/segnali`, con filtri `fase`, `segnale`, `persona`):
   - poche query aggregate (ultimo ingresso, conteggi a 4 e 12 settimane, ultima attività del
     diario, abbonamenti, documenti), poi `segnaliPersona` in memoria;
   - permessi come il resto: legge chi vede soci o contatti.
4. **La pagina `/oggi`, prima voce del menu staff**:
   - righe ordinate per valore (scaduto recuperabile > in scadenza > assente > in calo > lead da
     contattare o richiamare > ambientamento > compleanni);
   - azioni in linea: chiama (`tel:`), WhatsApp (`linkWhatsApp` con testo), email, "fatto, com'è
     andata" (scrive `attivita`), "rimanda di N giorni";
   - deve essere usabile **da telefono**.
   - Serve una rotta per registrare un contatto con un socio, per esempio
     `POST /api/persone/:id/contatti { canale, esito, nota }`, più il "rimanda".
5. **Il bancone.** La verifica dell'ingresso (`/api/ingressi/verifica`) restituisce anche i segnali
   con `pubblico: 'bancone'`: "scade tra 3 giorni: proponi il rinnovo", "bentornato dopo 20 giorni",
   "oggi compie gli anni", "50° ingresso". La reception li vede accanto al semaforo e con un tocco
   registra nel diario "proposto rinnovo" o "salutato".
6. **Dashboard e statistiche degli ingressi leggono il motore.** Si cancellano i calcoli
   duplicati: `rinnovi()` e `avvisiCertificati()` in `routes/dashboard.js`, `rischio` in
   `routes/ingressi.js`.
7. **Elenco soci intelligente.** `MembersList.jsx` oggi scarica tutti i soci e tutti gli
   abbonamenti nel browser. Passa a filtri lato server per fase e segnale, scritti nell'URL come la
   `vista` dei contatti, con le colonne fase, ultimo ingresso, frequenza e scadenza.
8. **Scheda socio a 360°.** In `MemberDetail.jsx`: un'intestazione con fase, segnali e azioni
   rapide, e il diario (`DiarioSocio`) in posizione centrale.
9. **Ricerca globale con Ctrl+K**: nome, telefono (confrontando solo le cifre), codice fiscale o
   codice socio, e si apre la scheda.
10. **Il giro quotidiano di manutenzione**, `server/src/giro.js`:
    - lanciato a mano o da un Railway Cron, scorre le palestre (oggi una sola);
    - fa cose che non inviano nulla: per esempio la chiusura automatica dei lead non
      raggiungibili, che oggi sta dentro `GET /api/lead/lavoro` (va tolta da lì: una GET non
      deve scrivere);
    - è idempotente;
    - va documentato in `docs/deploy.md` come si aggiunge il cron su Railway.

**Fuori da questa fase:** messaggi e canali (Fase 4), il flusso unico di iscrizione, la richiesta
di rinnovo dal portale, la sospensione dell'abbonamento e la vista istruttore (Fase 3).

**Attenzione:** l'utente ha in corso un lavoro non committato sugli ingressi (ramo
`ingressi-registro-manuale`, cartella `D:\Grip\Grip`) che tocca `server/src/routes/ingressi.js`
e la pagina Ingressi. **Prima di modificare quei file** guarda `git log main` e chiedi all'utente se
quel lavoro è stato unito a `main`. Se sì, porta `main` dentro il tuo ramo prima di partire; se no,
rimanda i punti 5 e 6 alla fine e diglielo.

## Come si lavora qui (cose già scoperte, risparmiano ore)

- **Ramo.** Crea `crm-fase-2` partendo da `crm-fase-1`, oppure da `main` se nel frattempo la
  Fase 1 è stata unita. Committa su quel ramo. Niente push e niente merge su `main` senza che
  l'utente lo chieda.
- **Database di prova.** Non c'è un Postgres installato. Usa `embedded-postgres` installato
  nella **cartella di lavoro della sessione** (scratchpad), non nel progetto: per esempio
  `npm i embedded-postgres@17.5.0-beta.15`, poi uno script che fa `initialise()`, `start()` e
  `createDatabase('grip')` sulla porta 54329. Le installazioni lunghe e il server vanno lanciati
  in background.
- **Le migrazioni non costruiscono un database vuoto**: la `0023` inserisce in `exercises`, che
  nessuna migrazione crea. Hai due strade:
  - **(a, consigliata)** sistemala con un passo iniziale piccolo e separato, in un commit suo
    (per esempio un blocco `DO $$ … IF to_regclass('exercises') IS NOT NULL …`). Poi controlla
    che `npm run db:deploy` costruisca un database vuoto fino in fondo. Serve comunque per il
    multi-tenant.
  - **(b, se la (a) si complica)**:
    1. costruisci lo schema di `main` al commit `ea5bd2a2` con `npx drizzle-kit push --force`, da
       una copia temporanea di quel commit;
    2. inserisci in `drizzle.__drizzle_migrations` la riga
       `(hash 'base-0050', created_at 1791409651576)`;
    3. lancia `node src/migrate.js` dal ramo, che applica la 0051 e quelle successive.
  - **Mai `db:push` sullo schema attuale**: perderebbe il trigger `socio_su_persona`, e i soci
    nuovi non si salverebbero.
- **Test.**
  - Server: `cd server && DATABASE_URL=… npm test`. A fine Fase 1: 357 test, 346 passati, 11
    saltati, 0 falliti.
  - Frontend e `shared/`: `npm test` nella radice, 133 test passati.
  - Prima di cambiare qualcosa, misura la tua base.
- **Browser.** Il Chromium di Playwright non è installato: usa
  `chromium.launch({ channel: 'msedge' })`.
  - Il modello da seguire è `server/scripts/verifica-browser.mjs`: avvia `buildApp()` su una
    porta, crea i suoi dati e li cancella alla fine.
  - Prima serve `npx vite build` nella radice.
- **Fine riga.** I file del worktree hanno fine riga CRLF.
  - Per modificare usa Edit/Write.
  - Gli script `node -e` lanciati dalla shell rovinano le lettere accentate: per sostituzioni
    multiple scrivi uno script in un file nella cartella di lavoro, che normalizzi `\r\n`.
- **Migrazioni nuove.** Modifica lo schema e lancia `npx drizzle-kit generate --name …`.
  - Se nello stesso passaggio togli una tabella e ne crei un'altra, `drizzle-kit` fa domande
    interattive, che qui non si possono rispondere: dividi in due migrazioni.
  - I dati e i trigger si aggiungono a mano in fondo al file generato.
- **Per ogni entità nuova** segui la lista: `entities/registry.js`, `ENTITY_MODULES` e `LETTURA`
  in `auth/authorize.js`, `shared/permissions.js`, `entities/hooks.js`. Per le scritture in più
  passi, rotte dedicate con una transazione, come `routes/lead.js`.

## Quando hai finito

1. Tutti i test passano, quelli vecchi più i nuovi: funzioni pure del motore con date fisse, e
   rotte con `app.inject`, permessi compresi.
2. La build compila e il lint è pulito.
3. Hai provato in un browser vero il giro completo:
   - un socio a −3 giorni dalla scadenza compare in **Oggi** e al **bancone**;
   - "proposto rinnovo" finisce nel diario e il segnale si nasconde;
   - la dashboard mostra gli stessi numeri del motore;
   - Ctrl+K trova il socio da un numero scritto in un altro formato.
4. C'è una voce nel changelog del `README.md`, e `docs/crm/piano-crm.md` è aggiornato se qualcosa è
   cambiato.
5. Hai fatto un commit sul ramo, con un messaggio chiaro.
6. Dai all'utente un resoconto breve:
   - cosa c'è ora;
   - cosa hai scoperto;
   - cosa resta per la Fase 3;
   - il prompt per la Fase 3, scritto con lo stesso spirito di questo e salvato in
     `docs/crm/prompt-fase-3.md`.
