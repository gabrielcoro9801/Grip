# Portare Grip online

Guida operativa per mettere l'applicazione su un indirizzo pubblico e permettere al team di
lavorarci insieme. Scritta per chi non ha mai fatto un deploy: ogni passo dice *perché*, non
solo *cosa*.

Architettura di destinazione:

```
   browser  ──►  gripcore.it  ──►  Railway  ──►  PostgreSQL
                                (pagine + API)
```

**Un servizio solo serve tutto.** Il server Fastify pubblica sia le pagine dell'applicazione —
la cartella `dist/` prodotta da `npm run build` — sia l'API, sullo stesso indirizzo.

Costa un po' in prestazioni rispetto a una CDN dedicata, irrilevante per un gestionale usato da
qualche persona, e in cambio toglie di mezzo tre cose: il **CORS**, perché non c'è nessuna
chiamata fra domini diversi; un **secondo pannello** da configurare; e un **secondo dominio**
da tenere allineato al primo.

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
| `QR_SECRET` | un'altra stringa lunga e casuale | firma il codice d'accesso che cambia ogni minuto: è ciò che impedisce di ricavare i codici futuri da uno screenshot. Se manca si usa `JWT_SECRET`, quindi l'applicazione parte lo stesso — ma due usi per una chiave sola è una scorciatoia, non una scelta |
| `CORS_ORIGIN` | `https://gripcore.it` | con un servizio solo non serve davvero, ma il server la pretende |
| `PUBLIC_BASE_URL` | `https://gripcore.it` | entra negli indirizzi dei file caricati (documenti, foto) |
| `UPLOAD_DIR` | `/data/uploads` | vedi 2.4 |
| `CHIAVE_SEGRETI` | un'altra stringa lunga e casuale | cifra le credenziali dei canali delle comunicazioni (la password della casella, la chiave di Brevo). Facoltativa: senza, il server parte, ma le credenziali non si possono salvare. **Non cambiarla** dopo averle salvate: quelle cifrate con la vecchia non si leggono più, e vanno reinserite |
| `INVII_REALI` | **non impostarla** finché la palestra non è pronta | la prima serratura delle comunicazioni (vedi 2.8): senza, nessun messaggio esce davvero, comunque sia configurata la palestra |

Il segreto lo generi così:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Se ne dimentichi una, **il server non parte e scrive nei log quale manca e perché**. È voluto:
un avviso nei log nessuno lo legge, e il server resterebbe acceso e insicuro.

### 2.3 Build e avvio

La build è descritta da un [`Dockerfile`](../Dockerfile), e [`railway.json`](../railway.json)
dice a Railway di usarlo.

**Perché un Dockerfile e non il builder automatico.** I builder automatici deducono il tipo di
progetto dalla struttura del repository, e qui la struttura è ambigua: nella radice c'è
un'app Vite, in `server/` un backend Node. Railway concludeva "sito statico", eseguiva la
build e serviva `dist/` con il proprio file server **senza mai avviare il server Node**.

Il sintomo è il peggiore possibile perché sembra funzionare: la home mostra l'applicazione —
le pagine ci sono davvero — ma l'API non esiste, e ogni chiamata restituisce la pagina 404 del
frontend invece di JSON. Con un Dockerfile non c'è niente da dedurre: è scritto. In più non
dipende da un builder che può cambiare o essere dichiarato deprecato, come è successo a
Nixpacks.

`railway.json` contiene anche `healthcheckPath: /health`, che è servita da Fastify: Railway
considera riuscito un rilascio solo se quella rotta risponde, e risponde solo se il database
risponde a sua volta (altrimenti 503). Se il server tornasse a non
avviarsi, il deploy **fallirebbe** invece di andare a buon fine servendo la cosa sbagliata.

Nel pannello, sotto **Settings → Build**, il builder deve risultare **Dockerfile**. Se è
forzato a qualcos'altro, il pannello vince sul file.

**Root Directory deve restare vuoto.** Il backend sta in `server/` ma importa da `shared/`,
che sta un livello sopra, e il frontend si costruisce dalla radice: puntando la root su
`server/` si rompono entrambe le cose.

Le migrazioni girano a ogni rilascio (`npm run db:deploy`). È così che una modifica allo
schema arriva in produzione; se falliscono il deploy si ferma, invece di avviare un server su
uno schema incompleto che risponderebbe con errori incomprensibili.

### 2.4 Il disco dei file caricati

**Questo è il punto che si sbaglia più spesso.** Su Railway il filesystem del container si
azzera a ogni deploy: certificati medici, documenti e foto dei soci già caricati sparirebbero, e nessuno se ne
accorgerebbe finché qualcuno non prova ad aprirne uno vecchio.

Nel servizio backend: **Settings → Volumes → New Volume**, montato su `/data`. Poi la variabile
`UPLOAD_DIR=/data/uploads`.

È una soluzione tampone che funziona con una sola istanza. Con più istanze, o volendo backup
seri, i file vanno su uno storage esterno (Cloudflare R2, già nel vostro perimetro).

### 2.5 Il primo account

> ⚠️ **Mai scrivere una password vera in questo file.** È versionato e finisce su GitHub, dove
> resta nella cronologia anche dopo averla tolta. I valori qui sotto sono segnaposto: quelli
> veri vivono solo nelle variabili del servizio.

Il database appena creato è vuoto: nessun account, nessun piano dei conti. E per crearne uno
bisognerebbe essere autenticati — la schermata degli utenti è dietro il login.

**Non serve fare niente a mano.** Basta impostare queste variabili fra quelle del servizio, dal
pannello Railway:

```
SEED_ADMIN_EMAIL     = tu@gripcore.it
SEED_ADMIN_PASSWORD  = (una password lunga, scelta lì)
SEED_ORGANIZZAZIONE  = Nome dell'associazione        (facoltativa)
```

Al primo avvio, **se e solo se non esiste nessun account**, il server crea l'organizzazione, il
piano dei conti, le causali, i ruoli e l'amministratore, e lo scrive nei log. Dal secondo avvio
non fa più nulla, perché la condizione non è più vera.

Succede dall'interno del container, dove il database è raggiungibile senza aprire niente.
L'alternativa sarebbe stata esporre PostgreSQL su internet o abilitare un accesso SSH alla
macchina solo per creare il primo account: due cose sgradevoli da chiedere a ogni associazione
che installa Grip.

Se le variabili mancano il server parte lo stesso, ma avvisa nei log che nessuno potrà
accedere. La password deve avere almeno 10 caratteri (la regola è in `shared/password.js`): più
corta, l'account non viene creato e il log lo dice.

**Dopo il primo accesso togli `SEED_ADMIN_PASSWORD` dalle variabili del servizio.** Al primo
accesso l'applicazione chiede comunque di sceglierne una nuova — quella nella variabile la vede
chiunque gestisca il deploy — ma lasciarla lì non serve a niente e resta leggibile.

> Esiste anche `npm run db:seed`, che fa la stessa cosa da riga di comando: serve in locale.
> Dal proprio PC **non funziona sulla produzione**, perché `DATABASE_URL` punta alla rete
> privata di Railway (`postgres.railway.internal`), che da fuori non si risolve.

### Come sai se è stato fatto

Prova ad accedere. Attenzione a non farti ingannare dall'API: un login con credenziali
sbagliate risponde `401 Credenziali non valide` **sia** se l'account non esiste **sia** se
esiste e la password è errata. Quel 401 dimostra che il database risponde, non che il seed sia
passato.

### Se resti chiuso fuori

`db:seed` è idempotente: rilanciandolo su un account che esiste già **lascia la password
invariata** e stampa "password invariata". Non serve quindi a rientrare se l'hai sbagliata o
dimenticata — e la schermata da cui si gestiscono gli account è dietro il login.

Per questo c'è uno script apposta:

```bash
RESET_EMAIL=tu@gripcore.it RESET_PASSWORD='nuova-lunga-almeno-12' \
railway run npm --prefix server run db:reset-admin
```

Cambia la password, riporta il ruolo ad `admin` e riattiva l'account se era disattivato:
se si arriva a usarlo è perché serve rientrare, e un account declassato non risolverebbe.
Rifiuta password sotto i dodici caratteri — quell'account può tutto ed è esposto su internet.

### 2.6 Il dominio

**Settings → Networking → Custom Domain** → `gripcore.it`. Railway ti dà il valore da mettere
su Cloudflare (passo 4).

**Non impostare `PORT` fra le variabili.** Railway la assegna da sé e il codice la legge: se la
forzi a un valore diverso da quello su cui Railway instrada — per esempio copiando il
`PORT=3001` del `.env` locale — il dominio risponde *"application failed to respond"*.

### 2.7 Il giro quotidiano (Railway Cron)

Alcune cose il CRM le fa da solo una volta al giorno, anche se nessuno apre GRIP: chiude come
*non raggiungibili* i contatti con troppi tentativi senza risposta, scrive nel diario chi,
contattato perché assente o in calo, è rientrato entro 14 giorni (la misura dell'efficacia dei
contatti), e fa girare i playbook delle comunicazioni (2.8). Le fa
[`server/src/giro.js`](../server/src/giro.js), che è idempotente: lanciato due volte nello
stesso giorno, la seconda non trova nulla da fare. A mano, da `server/`: `npm run giro`.

Su Railway gira come un **servizio a parte**, nello stesso progetto, che parte all'ora
stabilita, fa il giro ed esce:

1. **+ New → GitHub Repo**, lo stesso repository del backend. Chiamalo `giro`.
2. **Settings → Build**: builder **Dockerfile**, Root Directory vuoto, come il backend (2.3).
3. **Settings → Deploy → Custom Start Command**: `node server/src/giro.js`.
4. **Settings → Deploy → Cron Schedule**: `15 8 * * *`. L'ora è in **UTC**: le 8:15 UTC sono le
   10:15 d'estate e le 9:15 d'inverno a Roma. **Non di notte**: dentro la fascia di silenzio
   delle comunicazioni (di base dalle 21 alle 9) il giro fa la manutenzione ma non accoda
   nessun messaggio, e con un cron notturno i playbook non partirebbero mai.
5. **Variables**: `DATABASE_URL`, come riferimento a quella del database
   (`${{Postgres.DATABASE_URL}}`), e le stesse del backend che servono alle comunicazioni:
   `JWT_SECRET` e `QR_SECRET` (firmano i link di disiscrizione, che il backend deve poter
   riconoscere), `CHIAVE_SEGRETI` (per leggere le credenziali dei canali), `PUBLIC_BASE_URL`
   (i link nei messaggi) e, quando sarà il momento, `INVII_REALI`. Mettile come riferimenti a
   quelle del backend (`${{backend.JWT_SECRET}}` e così via), non come copie: una chiave
   diversa fra i due servizi rompe i link senza dare errori.
6. Il giro non apre una porta: se il rilascio resta in attesa del controllo di salute
   (`/health`, che `railway.json` chiede per il backend), svuota **Healthcheck Path** nelle
   impostazioni di questo servizio.

Per sapere se ha girato: **Deployments** del servizio `giro`, una riga al giorno; nei log c'è
il resoconto, per esempio `La mia associazione: 2 lead chiusi come non raggiungibili, 3 soci rientrati dopo un contatto.`
seguito dalla riga delle comunicazioni (`0 simulati, 0 accodati…`). Se il
processo non esce, Railway salta le esecuzioni successive: il giro chiude sempre la
connessione al database ed esce, anche quando fallisce (codice d'uscita 1).

### 2.8 Le comunicazioni ai soci (arrivano spente)

GRIP sa mandare messaggi automatici ai soci — il rinnovo che si avvicina, l'assenza, il
certificato in scadenza, la lezione annullata — nel portale, per email e (in futuro) per SMS.
**Al primo deploy non parte niente**, e niente può partire per sbaglio: servono tre cose
insieme, controllate in un punto solo del codice (`server/src/lib/invii.js`).

1. **`INVII_REALI=true` sul server** (e sul servizio `giro`). Senza, ogni messaggio va a un
   fornitore finto e resta *simulato*: la palestra può configurare tutto e vedere le anteprime.
2. **L'interruttore della palestra**, in Comunicazioni → Stato: si accende solo con la lista di
   controllo completa (un canale pronto, l'informativa privacy aggiornata, i testi riletti, e
   `PUBLIC_BASE_URL` impostata).
3. **Un canale pronto** (configurato e verificato con un invio di prova: il codice ricevuto si
   riscrive in GRIP) e **il playbook in "Attivo"**. Una verifica fatta in simulazione non vale
   per gli invii veri: accesa `INVII_REALI`, l'invio di prova va rifatto.

Le credenziali dei canali (la password della casella, la chiave di Brevo) si salvano solo con
`CHIAVE_SEGRETI` impostata, cifrate, e non si rileggono mai dall'interfaccia.

**Email**: la palestra sceglie in Comunicazioni → Canali fra la sua casella (SMTP: server,
porta, utente e password — per Gmail e Outlook serve una "password per le app") e Brevo
(un account gratuito, il dominio del mittente verificato su Brevo, la chiave API). Non c'è un
server di posta nostro: dagli indirizzi di Railway le email finirebbero nello spam.
**SMS**: per ora c'è solo il fornitore simulato. **Push** sul telefono: non ancora.

Per provare tutto senza mandare niente: `cd server && npm run verifica:fase4` (dopo
`npx vite build` nella radice), con `INVII_REALI` spenta — lo script si rifiuta di partire
altrimenti.

---

## 3. Il frontend (non serve fare niente)

Railway lo costruisce insieme al backend: la prima fase del `Dockerfile` esegue
`npm run build`, che produce `dist/`, e il server la pubblica. Non c'è un secondo servizio da
creare.

**`VITE_API_BASE_URL` non serve.** Il frontend chiama l'API con percorsi relativi, perché è lo
stesso indirizzo. La variabile esiste ancora come scappatoia se un giorno si volessero separare
di nuovo, ma lasciandola vuota va tutto da sé.

Vale comunque la pena saperlo: tutto ciò che comincia per `VITE_` **è visibile a chiunque apra
il sito**, perché Vite lo incorpora nel codice compilato. Lì non vanno mai segreti, solo
indirizzi. Le password stanno nelle variabili del backend, che il browser non vede mai.

---

## 4. Il DNS su Cloudflare

Nella zona `gripcore.it`, sezione **DNS → Records**: serve solo il record che punta a Railway,
e Railway lo indica quando aggiungi il dominio (passo 2.6).

Su Register.it i nameserver devono già puntare a Cloudflare — si verifica dal pannello
Cloudflare, la zona deve risultare **Active**.

### SSL/TLS: mettilo su "Full (strict)"

Cloudflare → **SSL/TLS → Overview**. Se resta su **Flexible**, Cloudflare parla in HTTP con
Railway che si aspetta HTTPS, e il risultato è un **ciclo infinito di redirect**: il sito non
si apre e l'errore non dice perché. È il problema più frequente quando Railway segnala
*"Cloudflare proxy detected"*.

Il certificato lo emettono Cloudflare e Railway da soli. Può volerci qualche minuto.

---

## 5. L'ordine giusto

Le dipendenze contano: fare i passi in ordine sbagliato produce errori che sembrano bug.

1. **Push del codice su GitHub** — Railway costruisce da lì, non dal tuo PC
2. **Database su Railway** e variabile collegata con un riferimento
3. **Variabili del backend** (`NODE_ENV`, `JWT_SECRET`, `CORS_ORIGIN`, `PUBLIC_BASE_URL`)
4. **Volume** su `/data` e `UPLOAD_DIR` — prima di caricare qualunque documento
5. **Deploy** — verifica che `/health` risponda `{"ok":true,"database":true,...}`
6. **Seed**, una volta sola, per creare il primo amministratore
7. **Dominio** `gripcore.it` su Railway + record su Cloudflare + SSL su Full (strict)

Il punto 4 prima del 6 non è un dettaglio: se carichi documenti senza volume, il primo deploy
successivo li cancella.

---

## 6. Se qualcosa non va

**Il backend non parte.** Guarda i log su Railway: se manca una variabile obbligatoria il
messaggio dice quale e perché. È il caso più frequente.

**Il dominio risponde "application failed to respond".** Quasi sempre è la porta: se hai
impostato `PORT` a mano fra le variabili, il server ascolta su quella mentre Railway instrada
altrove. **Non impostare `PORT`**: Railway la assegna e il codice la legge da sé.

**Il sito entra in un ciclo di redirect e non si apre.** Cloudflare è su SSL/TLS *Flexible*:
va messo su **Full (strict)** (passo 4).

**Il dominio mostra un 404 invece dell'applicazione.** La build del frontend non è stata
eseguita, quindi `dist/` non esiste e il server pubblica solo l'API. Controlla nei log del
deploy che `npm run build` sia passato.

**Il sito si apre ma è senza grafica**, come HTML grezzo. Alla build sono mancati
`tailwind.config.js` o `postcss.config.js`: senza, PostCSS non elabora Tailwind e produce un
CSS di un paio di kB invece di ~75. Il modo in cui fallisce è insidioso — **la build riesce e
non scrive niente nei log**, il sito funziona, solo senza stili.

Il `Dockerfile` li copia e verifica la dimensione del CSS prodotto, fermando il deploy se è
troppo piccolo. Se il sintomo ricompare, è lì che si guarda.

**La home si apre ma `/health` mostra la pagina 404 dell'applicazione.** È il caso opposto e
il più insidioso: il server Node non è mai partito, e Railway sta servendo `dist/` con il
proprio file server statico. Sembra tutto a posto perché le pagine ci sono, ma l'API non
esiste e nulla funziona oltre la schermata di accesso.

Si riconosce così: `/health` deve rispondere `{"ok":true,...}` in JSON. Se restituisce HTML,
è questo. La causa è il builder automatico che scambia il progetto per un sito statico: il
Dockerfile lo impedisce, ma va controllato che nel pannello **Settings → Build** il builder
risulti **Dockerfile** e non sia forzato ad altro.

**Ricaricando una pagina interna esce un 404.** Non dovrebbe: il server risponde con
`index.html` su tutte le rotte che non sono API o file. Se succede, `dist/` non c'è (vedi
sopra).

**I documenti vecchi non si aprono più.** È il volume mancante (2.4): i file sono stati
cancellati da un deploy. Da lì in avanti si evita, ma quelli persi vanno ricaricati.

**Il deploy fallisce con un file non trovato, in maiuscolo o minuscolo.** Windows non distingue
`app.jsx` da `App.jsx`, Linux sì: un import che funziona sul tuo PC può fallire in build. Se
succede, il nome del file va corretto con `git mv`.

---

## 7. Quello che questa guida non risolve

- **Non c'è backup del database.** Railway ne fa di suoi, ma vanno verificati e provati: un
  backup mai ripristinato non è un backup. I documenti fiscali vanno conservati dieci anni.
- **Un ambiente solo.** Chi lavora sul proprio ramo non ha un posto dove provarlo online se
  non mandandolo in produzione. Servirebbe un secondo servizio Railway, con un suo database,
  collegato a un ramo diverso da main.
- **I file caricati sono raggiungibili senza autenticazione** da chi ne conosce l'URL: il nome
  è casuale, ma il limite resta (vedi il README principale).
