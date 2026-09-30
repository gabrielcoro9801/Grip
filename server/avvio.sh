#!/bin/sh
# Avvio del container: prima da amministratore il minimo indispensabile, poi mai più.
#
# Il server non deve girare come root: se un giorno venisse compromesso, non avrebbe i
# permessi per toccare il sistema. Ma Railway monta i volumi come root, e la cartella dei
# file caricati sta su un volume: un processo `node` non ci potrebbe scrivere. La soluzione
# di Railway (RAILWAY_RUN_UID=0) è tornare a girare come root, cioè rinunciare.
#
# Qui si fa come le immagini ufficiali di Postgres: si parte come root solo per dare la
# cartella degli upload all'utente `node`, e poi `su-exec` rilancia questo stesso script come
# `node`. Migrazioni e server girano da lì in avanti senza privilegi.
set -e

if [ "$(id -u)" = "0" ]; then
	cartella="${UPLOAD_DIR:-/app/server/uploads}"
	mkdir -p "$cartella"
	# Solo se serve: un volume già sistemato non si riattraversa file per file a ogni avvio.
	if [ "$(stat -c %u "$cartella")" != "$(id -u node)" ]; then
		chown -R node:node "$cartella"
	fi
	# Attraverso `sh`, come nel CMD del Dockerfile: il file arriva da un checkout Windows senza
	# il bit di esecuzione, e `su-exec node "$0"` si fermerebbe su "Permission denied".
	exec su-exec node sh "$0" "$@"
fi

# Le migrazioni prima di accettare richieste: se falliscono il container non parte, invece
# di rispondere con errori incomprensibili su uno schema vecchio.
npm --prefix server run db:deploy
exec node server/src/index.js
