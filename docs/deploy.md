# Portare Grip online

Guida operativa per mettere l'applicazione su un indirizzo pubblico e permettere al team di
lavorarci insieme. Scritta per chi non ha mai fatto un deploy: ogni passo dice *perché*, non
solo *cosa*.

Architettura di destinazione:

```
                     gripcore.it  ──►  frontend (React, file statici)
   browser  ──►                                    │
                 api.gripcore.it  ──►  backend (Fastify)  ──►  PostgreSQL
```

Frontend e backend sono due cose separate e vanno pubblicate separatamente: il primo è un
insieme di file che il browser scarica, il secondo un programma che resta acceso.

---

## 1. Come funziona GitHub (no, non è automatico)

Salvare un file in VS Code non lo manda su GitHub. I passaggi sono tre e sono distinti apposta:

| | Cosa fa | Dove arriva |
|---|---|---|
| **Salva** (Ctrl+S) | Scrive il file sul tuo disco | Solo sul tuo PC |
| **Commit** | Fotografa le modifiche con un messaggio | Solo sul tuo PC |
| **Push** | Manda i commit su GitHub | Visibile al team |

Il commit esiste separato dal push perché puoi farne parecchi in locale e mandarli insieme,
e perché un commit è il punto a cui puoi tornare se qualcosa va storto.

### Da VS Code

Nel pannello **Source Control** (l'icona con i rami, o `Ctrl+Shift+G`):

1. I file modificati compaiono sotto *Changes*. Il **+** accanto a ciascuno lo aggiunge al
   commit (*stage*). Il **+** in cima li aggiunge tutti.
2. Scrivi il messaggio nella casella in alto e premi **✓ Commit**.
3. Premi **Sync Changes** (o `...` → *Push*) per mandarlo su GitHub.

### Da terminale

```bash
git status                    # cosa è cambiato
git add -A                    # prepara tutto
git commit -m "Messaggio"     # fotografa
git push                      # manda su GitHub
```

### Lavorare in più persone

Con più di una persona sullo stesso repository, **committare direttamente su `main` è il modo
più rapido per pestarsi i piedi**: due persone che modificano lo stesso file finiscono a
risolvere conflitti a mano, e su `main` c'è anche quello che va in produzione.

La pratica normale è:

```bash
git checkout -b nome-della-modifica    # crei un ramo tuo
# ... lavori, commit ...
git push -u origin nome-della-modifica # lo mandi su GitHub
```

Poi su GitHub apri una **Pull Request**: gli altri vedono cosa hai cambiato, commentano, e si
unisce a `main` quando è pronta. Railway ricostruisce solo quando `main` cambia, quindi finché
lavori sul tuo ramo non tocchi la produzione.

**Prima di iniziare a lavorare**, sempre:

```bash
git pull                      # prendi le modifiche degli altri
```

Saltare questo passaggio è la causa numero uno dei conflitti.

---

## 2. Il backend su Railway

Railway prende il codice da GitHub, lo costruisce e lo tiene acceso.

### 2.1 Il database

Nel progetto Railway: **New → Database → PostgreSQL**. Railway crea il database e la variabile
`DATABASE_URL`.

Nel servizio del backend, sotto **Variables**, collegala con un riferimento invece di
copiarla: `${{Postgres.DATABASE_URL}}`. Copiandola a mano, il giorno in cui Railway cambia la
password il backend smette di collegarsi senza che nessuno capisca perché.

### 2.2 Le variabili del backend

Sempre sotto **Variables** del servizio backend:

| Variabile | Valore | Perché |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | riferimento, non copia |
| `NODE_ENV` | `production` | attiva i controlli: senza, il server parte con le impostazioni di sviluppo |
| `JWT_SECRET` | una stringa lunga e casuale | firma i token: con un segreto noto chiunque può firmarsi un accesso da amministratore |
| `CORS_ORIGIN` | `https://gripcore.it,https://www.gripcore.it` | da quali siti il browser può chiamare l'API |
| `PUBLIC_BASE_URL` | `https://api.gripcore.it` | entra negli URL delle ricevute PDF |
| `UPLOAD_DIR` | `/data/uploads` | vedi 2.4 |

Il segreto lo generi così:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Se ne dimentichi una, **il server non parte e scrive nei log quale manca e perché**. È voluto:
un avviso nei log nessuno lo legge, e il server resterebbe acceso e insicuro.

### 2.3 Build e avvio

Il file [`nixpacks.toml`](../nixpacks.toml) nella radice dice già tutto a Railway. Due cose da
**non** toccare nel pannello:

- **Root Directory deve restare vuoto.** Il backend sta in `server/` ma importa da `shared/`,
  che sta un livello sopra: puntando la root su `server/` quegli import si rompono.
- **Non impostare uno Start Command** nel pannello: sovrascriverebbe quello del file, che
  applica le migrazioni prima di avviare.

Le migrazioni girano a ogni rilascio (`npm run db:deploy`). È così che una modifica allo
schema arriva in produzione; se falliscono il deploy si ferma, invece di avviare un server su
uno schema incompleto che risponderebbe con errori incomprensibili.

### 2.4 Il disco dei file caricati

**Questo è il punto che si sbaglia più spesso.** Su Railway il filesystem del container si
azzera a ogni deploy: le ricevute e le fatture in PDF già emesse sparirebbero, e nessuno se ne
accorgerebbe finché qualcuno non prova ad aprirne una vecchia.

Nel servizio backend: **Settings → Volumes → New Volume**, montato su `/data`. Poi la variabile
`UPLOAD_DIR=/data/uploads`.

È una soluzione tampone che funziona con una sola istanza. Con più istanze, o volendo backup
seri, i file vanno su uno storage esterno (Cloudflare R2, già nel vostro perimetro).

### 2.5 Il primo account

Il database appena creato è vuoto: nessun account, nessun piano dei conti. Una volta sola,
dalla shell di Railway (`railway run` da terminale, o il pannello):

```bash
SEED_ADMIN_EMAIL=tu@gripcore.it SEED_ADMIN_PASSWORD='scegline-una-lunga' \
SEED_ORGANIZZAZIONE='Nome associazione' npm --prefix server run db:seed
```

Crea l'organizzazione, il piano dei conti, le causali, i ruoli e il primo amministratore.
In produzione **pretende** `SEED_ADMIN_PASSWORD`: il primo account non può nascere con una
password scritta nel codice sorgente.

### 2.6 Il dominio

**Settings → Networking → Custom Domain** → `api.gripcore.it`. Railway ti dà un valore CNAME
da mettere su Cloudflare (passo 4).

---

## 3. Il frontend

Il frontend è un insieme di file statici: `npm run build` produce la cartella `dist/`, e
quella va servita. Non serve un server acceso.

Poiché il DNS è già su Cloudflare, **Cloudflare Pages** è la scelta naturale: si collega allo
stesso repository GitHub, ricostruisce a ogni push, e il dominio si configura da solo.

Su Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**, scegli il repository:

| Impostazione | Valore |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(vuoto)* |
| Variabile `VITE_API_BASE_URL` | `https://api.gripcore.it` |

`VITE_API_BASE_URL` dice al frontend dove trovare il backend. **Va impostata prima della
build**: Vite la incorpora nel codice compilato, quindi cambiarla dopo richiede di rifare la
build, non basta riavviare.

Per la stessa ragione: tutto ciò che comincia per `VITE_` **è visibile a chiunque apra il
sito**. Lì non vanno mai segreti, solo indirizzi. Le password stanno nelle variabili del
backend, che il browser non vede mai.

---

## 4. Il DNS su Cloudflare

Nella zona `gripcore.it`, sezione **DNS → Records**:

| Tipo | Nome | Valore | Proxy |
|---|---|---|---|
| CNAME | `api` | l'indirizzo che ti dà Railway | 🟠 attivo |
| CNAME | `@` e `www` | li crea Cloudflare Pages da solo | 🟠 attivo |

Su Register.it i nameserver devono già puntare a Cloudflare — dici che l'avete fatto; si
verifica dal pannello Cloudflare, la zona deve risultare **Active**.

Il certificato HTTPS lo emettono Cloudflare e Railway da soli. Può volerci qualche minuto.

---

## 5. L'ordine giusto

Le dipendenze contano: fare i passi in ordine sbagliato produce errori che sembrano bug.

1. **Push del codice su GitHub** — Railway e Pages costruiscono da lì, non dal tuo PC
2. **Database su Railway** e variabile collegata
3. **Variabili del backend** (`NODE_ENV`, `JWT_SECRET`, `CORS_ORIGIN`, `PUBLIC_BASE_URL`)
4. **Volume** e `UPLOAD_DIR`
5. **Deploy del backend** — verifica che `https://<url-railway>/health` risponda `{"ok":true}`
6. **Seed**, una volta sola
7. **Dominio** `api.gripcore.it` su Railway + record su Cloudflare
8. **Cloudflare Pages** con `VITE_API_BASE_URL` che punta al dominio del punto 7
9. **Dominio** `gripcore.it` su Pages

Il punto 8 dipende dal 7: costruendo il frontend prima che l'API abbia il suo dominio,
punterebbe a un indirizzo che non esiste, e per correggerlo servirebbe una nuova build.

---

## 6. Se qualcosa non va

**Il backend non parte.** Guarda i log su Railway: se manca una variabile obbligatoria il
messaggio dice quale e perché. È il caso più frequente.

**Il sito si apre ma è vuoto, e la console del browser dice `CORS`.** `CORS_ORIGIN` sul backend
non contiene l'indirizzo esatto del frontend. Deve combaciare compreso `https://`, senza barra
finale, e con `www` elencato a parte se lo usate.

**Il sito si apre ma il login non funziona.** `VITE_API_BASE_URL` punta altrove — probabilmente
è rimasta a `localhost`. Si corregge cambiando la variabile su Pages **e rifacendo la build**.

**Le ricevute vecchie non si scaricano più.** È il volume mancante (2.4): i file sono stati
cancellati da un deploy. Da lì in avanti si evita, ma quelli persi vanno rigenerati.

**Il deploy fallisce con un file non trovato, in maiuscolo o minuscolo.** Windows non distingue
`app.jsx` da `App.jsx`, Linux sì: un import che funziona sul tuo PC può fallire in build. Se
succede, il nome del file va corretto con `git mv`.

---

## 7. Quello che questa guida non risolve

- **Non c'è backup del database.** Railway ne fa di suoi, ma vanno verificati e provati: un
  backup mai ripristinato non è un backup. I documenti fiscali vanno conservati dieci anni.
- **Un ambiente solo.** Chi lavora sul proprio ramo non ha un posto dove provarlo online se
  non mandandolo in produzione. Cloudflare Pages costruisce le anteprime dei rami in
  automatico; per il backend servirebbe un secondo servizio Railway con un suo database.
- **I file caricati sono raggiungibili senza autenticazione** da chi ne conosce l'URL: il nome
  è casuale, ma il limite resta (vedi il README principale).
