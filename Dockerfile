# Immagine di Grip: un servizio solo che serve le pagine e l'API.
#
# Perché un Dockerfile invece di lasciar fare alla piattaforma. I builder
# automatici deducono il tipo di progetto dalla struttura del repository, e qui
# la struttura è ambigua: nella radice c'è un'app Vite, in server/ un backend
# Node. Railway concludeva "sito statico", serviva dist/ e non avviava mai il
# server — con il sintomo peggiore possibile, cioè la home che funziona e l'API
# che non esiste. Qui non c'è niente da dedurre: è scritto.
#
# In più questo file descrive la stessa cosa ovunque, e non dipende da un
# builder che può cambiare o essere dichiarato deprecato.

# --- Fase 1: costruire il frontend ------------------------------------------
#
# Le dipendenze del frontend servono solo qui: producono dist/ e non finiscono
# nell'immagine finale, che resta piccola.
FROM node:22-alpine AS frontend

WORKDIR /app

# Prima i manifest, poi il codice: Docker riusa il livello delle dipendenze
# finché package.json non cambia, e `npm install` è la parte lenta.
COPY package.json package-lock.json ./
RUN npm ci

# I gusci sono due, uno per applicazione: `index.html` per il gestionale e
# `member.html` per il portale soci. Questo COPY è un elenco scritto a mano, e
# un guscio dimenticato non fa fallire niente qui: fallisce Vite più sotto,
# oppure — peggio — l'immagine parte e quel lato del sito dà 404. Da qui la
# guardia dopo il build.
#
# `shared/` serve anche al frontend: permessi e ruoli sono gli stessi dei due
# lati, e vivono lì apposta per non poter divergere.
# `tailwind.config.js` e `postcss.config.js` non sono facoltativi: senza, PostCSS
# non elabora Tailwind e la build riesce comunque, ma produce un CSS vuoto. Il
# risultato è un sito che funziona e si presenta come HTML senza stili — un
# errore che non compare in nessun log.
COPY vite.config.js jsconfig.json index.html member.html tailwind.config.js postcss.config.js components.json ./
COPY src ./src
COPY shared ./shared

RUN npm run build

# Il modo in cui questo fallisce è insidioso: senza le config di Tailwind la
# build **riesce**, non scrive niente nei log, e produce un CSS di 2 kB invece
# di 75. Il sito si apre e funziona, solo senza stili. Non basta quindi
# verificare che il file esista: si controlla che sia grande abbastanza da
# contenere davvero le classi generate.
RUN test -n "$(find dist/assets -name '*.css' -size +20k -print -quit)" \
    || (echo "ERRORE: il CSS prodotto è troppo piccolo — Tailwind non ha generato le classi." \
        && echo "Controlla che tailwind.config.js e postcss.config.js siano copiati nell'immagine." \
        && ls -la dist/assets && exit 1)

# Le applicazioni sono due e servono due gusci. Se `member.html` non arriva nella
# fase di build — basta dimenticarlo nel COPY qui sopra — l'immagine si costruisce
# lo stesso e il gestionale funziona: è solo il portale soci a dare 404, e
# nessuno se ne accorge finché non lo apre un socio. Meglio non partire affatto.
RUN for guscio in index.html member.html; do \
      test -f "dist/$guscio" \
        || (echo "ERRORE: manca dist/$guscio — il guscio non è stato compilato." \
            && echo "Controlla che sia elencato nel COPY e in vite.config.js (build.rollupOptions.input)." \
            && ls -la dist && exit 1); \
    done

# --- Fase 2: l'immagine che gira --------------------------------------------
FROM node:22-alpine AS runtime

# Un processo che non serve a niente non gira da amministratore: se un giorno
# venisse compromesso, non avrebbe i permessi per toccare il sistema.
WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json ./server/
# `--omit=dev` esclude drizzle-kit, che è uno strumento di sviluppo: le
# migrazioni in produzione le applica il migratore incluso in drizzle-orm
# (server/src/migrate.js), che è una dipendenza normale.
RUN npm ci --prefix server --omit=dev

COPY server/src ./server/src
# Le migrazioni sono file, non codice: senza questa cartella `db:deploy` non
# saprebbe cosa applicare e il database resterebbe vuoto.
COPY server/drizzle ./server/drizzle
COPY shared ./shared

# Sembra superfluo — le dipendenze del frontend qui non servono e non vengono
# installate — ma non lo è: i file in shared/ sono moduli ES, e Node lo deduce
# dal `"type": "module"` del package.json più vicino. Senza questo file Node li
# tratterebbe come CommonJS e il server morirebbe all'avvio con
# "Unexpected token 'export'". Non toglierlo.
COPY package.json ./package.json

# Il frontend compilato va un livello sopra server/, dove app.js lo cerca.
COPY --from=frontend /app/dist ./dist

# La porta la assegna la piattaforma e il codice la legge da PORT: questa è solo
# documentazione dell'intento.
EXPOSE 3001

# Le migrazioni prima di accettare richieste: se falliscono il container non
# parte, invece di rispondere con errori incomprensibili su uno schema vecchio.
CMD ["sh", "-c", "npm --prefix server run db:deploy && node server/src/index.js"]
