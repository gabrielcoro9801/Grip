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

Credenziali iniziali create dal seed:

| Email | Password | Ruolo |
|---|---|---|
| `admin@grip.local` | `admin1234` | admin |

Cambia questa password dopo il primo accesso. Da **Admin & Utenti** puoi creare gli altri
account (reception, istruttore, PT, dipendente) e gli account dei soci per il portale.

Ci sono due aree con accessi distinti:
- **Gestionale** (`/`) — per lo staff, protetto dal login staff
- **Portale soci** (`/member-portal`) — per i soci, richiede un account con ruolo `member`
  collegato a un'anagrafica socio

Nel database di sviluppo esiste anche `giulia@grip.local` / `socio1234`, un socio con
abbonamento e scheda di allenamento, usato per provare il portale. Non lo crea il seed:
esiste solo nel database attuale.

## Stato del progetto

**L'uscita da base44 è completa.** Nessuna sua libreria, nessun riferimento nel codice,
nessun pacchetto: dati, autenticazione e upload passano tutti dal backend in `server/`.

**La roadmap Contabilità & Finance è chiusa**, fasi 0–6, entrambi i traguardi (cliente beta
e vendita ad altre ASD). Il registro dettagliato — cosa è stato fatto, come è stato
verificato e cosa è rimasto fuori — è in [docs/roadmap-contabilita.md](docs/roadmap-contabilita.md).
È il documento da leggere per riprendere il filo: questo elenco ne è solo il riassunto.

### Ultima sessione — 19 agosto 2026: permessi e superfici esposte

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

Verificato con 43 controlli su richieste HTTP reali e un giro del browser su tutte le
pagine del portale e sulle 28 pagine staff, senza errori. Il flusso ricevuta completo
(scrittura, PDF, upload, emissione) continua a funzionare.

### Da riprendere

Nessuno di questi punti blocca l'uso dell'app: sono scelte rimaste aperte, non lavori a metà.

**Serve una tua decisione:**

- **Fatturazione elettronica allo SdI.** Oggi si emette un PDF di cortesia, che non
  sostituisce la fattura elettronica — ed è dichiarato nell'interfaccia. Serve scegliere il
  canale di trasmissione (intermediario o invio diretto) prima di costruire il resto.
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
| `cd server && npm run db:studio` | interfaccia web per esplorare il database |
