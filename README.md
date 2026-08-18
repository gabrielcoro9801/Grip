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
