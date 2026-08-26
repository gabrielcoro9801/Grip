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

# `shared/` serve anche al frontend: permessi e ruoli sono gli stessi dei due
# lati, e vivono lì apposta per non poter divergere.
COPY vite.config.js jsconfig.json index.html ./
COPY src ./src
COPY shared ./shared

RUN npm run build

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
