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

## Punti aperti

Cose consapevolmente lasciate indietro, da affrontare prima di un uso in produzione:

- **Numerazione progressiva** (protocollo registrazioni, codice socio, numero ricevuta):
  calcolata dal frontend leggendo il massimo esistente e sommando 1. Con più utenti in
  contemporanea due operazioni possono ottenere lo stesso numero: va spostata su una
  sequenza del database.
- **Atomicità della partita doppia**: testata e righe di una registrazione contabile sono
  scritte con due chiamate separate, quindi un errore a metà lascia una registrazione
  senza righe. Serve un endpoint transazionale dedicato.
- **Permessi lato server**: l'API distingue autenticato da non autenticato, ma non applica
  i ruoli; il controllo per modulo (`src/lib/permissions.js`) vive solo nel frontend, quindi
  limita cosa si vede, non cosa si può chiedere all'API.
- **Aggiornamenti in tempo reale**: `subscribe()` sul client non fa nulla. L'unico punto
  che lo usa è il calendario corsi del portale soci, che si aggiorna al ricaricamento.
- **CORS aperto** a qualsiasi origine: va ristretto al dominio del frontend.
