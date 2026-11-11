# GRIP · Gestione corsi: lezioni, sessioni, fisse a periodo

> **Nel piano unico (11/11/2026)** questo è il ramo **C**, `feature/corsi-sessioni`, sul database **`grip_corsi`** (vedi `server/.env` del worktree). Si unisce **per ultimo**, dopo Soci e Da fare.
> Il piano unico aggiunge queste righe K:
> - **K1, numeri delle migrazioni**: le due migrazioni di C sono **`0059_sessione_un_giorno`** e **`0060_fisse_a_periodo`**; la 0058 è di Da fare (`0058_avvisi`). Il SQL scritto a mano (i blocchi `DO $$`) va in **`server/drizzle/_bozze/0059.sql`** e **`_bozze/0060.sql`**, fuori dal journal. Durante il lavoro si prova con una migrazione provvisoria generata in questo ramo, che esce numerata 0058 e 0059. Nel pacchetto C-5, dopo l'unione di Da fare, quella provvisoria si cancella (SQL, snapshot, voci di `meta/_journal.json`), si fa il ribase, si rigenerano 0059 e 0060 e si incollano le bozze.
> - **K2, K3**: niente `grip_dev`. Le verifiche nel browser le lancia la sessione principale; l'agente lancia `npm test`, `npm run lint` e `cd server && npm test`.
> - **K8, ricerca**: `GET /api/soci/cerca` usa **`corrispondeRicerca` di `shared/ricerca.js`** (dal ramo Soci). Legge i soci non archiviati, li filtra con quella funzione e pagina a 15. Si scrive **dopo il ribase su main con Soci** (pacchetto C-3).
> - **K9, paginatore**: `SceltaSocio` usa **`src/ui/Paginazione.jsx`** di Soci (C-3).
> - **K10, portale**: `terminaFissa` prende `dal`, che **vale `oggiIso()` se manca**: il portale (`server/src/routes/member/index.js:488`) la chiama senza. Ci vuole un test.
> - **K11, archiviazione**: per decisione dell'utente, `POST /api/soci/:id/archivia` (`server/src/routes/soci.js`) **chiude le fisse attive del socio**: dopo le disdette chiama `terminaFissa({ fissaId, dal: oggi })` per ognuna e lo aggiunge ai `dettagli` del registro. Riattivando il socio le fisse non ripartono. Test in `server/test/archivio-soci.test.js`.
> - **K12**: il «Rinnova» di Da fare crea un abbonamento e passa da `entities.js:186`. C restringe `applicaFisse` alle fisse senza `al`, come già dice questo piano: nessun codice in più.
> - **K13**: in `server/src/routes/member/index.js` C cambia solo le fisse (:314, :467-488); la richiesta di rinnovo è di Da fare. In `Dashboard.jsx` C cambia solo il link della riga 133; le tessere sono di Da fare.
> - **K14**: il glossario (Sessione, Prenotazione fissa) è **già aggiornato su main**; il README si aggiorna alla fine. **Non toccare né `docs/ux/glossario.md` né `README.md`.**
> - Le date per «per N lezioni» e i limiti di abbonamento si calcolano con le funzioni che ci sono già (`shared/giorni.js`: `spostaGiorni`, `giorniFra`; `shared/abbonamenti.js`). `aggiungiMesi` arriva dal ramo Soci.

11 novembre 2026. Repository Grip, ramo main (`7db6320a`). Calendario, Sessioni (era Prenotazioni) e Categorie. Per chi implementa: cosa cambia, dove, e cosa si rompe intorno.

## Perimetro

**Dentro**
- Pagine: `/calendario`, `/calendario/lezioni/:id` (nuova), `/calendario/sessioni` (era `/prenotazioni`), `/calendario/categorie`.
- Server: `routes/calendario.js`, `prenotazioni.js`, `prenotazioniFisse.js`, `entities/hooks.js`; `lib/prenotazioniFisse.js`, `prenotazioni.js`, `calendario.js`, `dateSettimanali.js`.
- Tabelle: `events`, `sessions`, `bookings`, `prenotazioni_fisse`, `categories`.
- `shared/`: `colore.js` (nuovo), `giorni.js`, `abbonamenti.js`, `corsi.js`.
- Per decisione dell'utente: la scheda del socio crea le fisse con la stessa finestra (`FisseSocio.jsx`).

**Fuori**
- Portale soci: non si ridisegna. Continua a funzionare con una regola di passaggio (vedi «In sospeso»).
- Dashboard, Le mie lezioni, Catalogo corsi, Sale, Istruttori: solo gli adattamenti della cascata.
- Permessi: il modulo `calendar` resta com'è.
- I nomi delle tabelle: `events` e `sessions` non si rinominano.
- Regole di eliminazione di una lezione e termine di disdetta del corso: invariati.

## Le parole

In interfaccia «sessione» è la riga di `events`, non di `sessions`.

| In interfaccia | Nel database | Che cosa è |
|---|---|---|
| Lezione | una riga di `sessions` | Un appuntamento in una data |
| Lezione singola | `events` con `recurrence_type = single` | Una lezione che non si ripete |
| Sessione | `events` con `recurrence_type = weekly` | Una lezione che si ripete, stesso giorno e stessa ora |
| Prenotazione | `bookings` | Un socio a una lezione |
| Prenotazione fissa | `prenotazioni_fisse` | Un socio a una sessione, da una data a un'altra |

«Evento» e «serie» spariscono dall'interfaccia: «Nuovo evento» diventa «Nuova lezione». Nel codice nuovo i nomi delle variabili seguono l'interfaccia (lezione, sessione); le tabelle restano `events` e `sessions`.

## Sintesi: otto modifiche, due migrazioni

- **M1 · Calendario**: via la frase sotto il titolo. «Nuova lezione» crea solo lezioni singole.
- **M2 · Finestra del giorno**: un clic sul giorno apre la giornata a ore, come in Google Calendar.
- **M3 · Pagina della lezione**: `/calendario/lezioni/:id` al posto della finestra: dati, etichette, prenotazioni.
- **M4 · Sessioni**: sostituisce Prenotazioni: una card per corso, con le sue sessioni e le fisse.
- **M5 · Una sessione, un giorno**: `events.giorno` al posto di `days_of_week`. La migrazione divide quelle su più giorni.
- **M6 · Fisse a periodo**: dal/al o per N lezioni, entro abbonamento e sessione. Niente rinnovo automatico.
- **M7 · Colore della categoria**: un campo che accetta `rgb()` e `#hex`, un solo box tinta × luminosità.
- **M8 · Carico dei dati**: ogni vista scarica solo quello che usa; i conflitti li controlla il server.

## M8 · Carico dei dati

| Vista | Prima | Dopo |
|---|---|---|
| Layout della sezione | 8 elenchi interi (`CorsiLayout.jsx:59-68`) | Solo corsi, categorie, istruttori e sale |
| Calendario e giorno | Tutte le lezioni da 92 giorni fa | `GET /api/calendario/lezioni?dal&al`: i 42 giorni della griglia, con i posti già contati |
| Pagina della lezione | Non esisteva | `GET /api/calendario/lezioni/:id`: lezione, sessione e prenotazioni |
| Sessioni | Non esisteva | `GET /api/calendario/sessioni`: quelle in corso e il numero delle finite; le finite solo aprendo «Finite» |
| Scelta del socio | Tutti i soci in memoria | `GET /api/soci/cerca?q&pagina`: 15 per pagina |
| Conflitti di sala e istruttore | Nel browser (`eventUtils.js:95`) | `POST /api/calendario/conflitti`: la stessa regola, sul server |

Misurato sul database locale: 275 byte per prenotazione, 269 per lezione, 656 per socio. Con 300 soci e 25 lezioni a settimana per un anno, oggi si scaricano circa 3,5 MB di prenotazioni e 440 KB di lezioni a ogni apertura.

## M1 · M2 · Calendario
- La casella del giorno e «+N altri» aprono `GiornoDialog`. Oggi «+N altri» non si apre (`CalendarView.jsx:114`) e dal quarto in poi le lezioni non si vedono.
- Una lezione, dal mese o dal giorno, porta a `/calendario/lezioni/:id`. `RiepilogoLezione.jsx` sparisce.
- Via la frase sotto il titolo (`Calendario.jsx:13`). «Nuova lezione» anche nella finestra, con la data già scritta.
- A 390 px: nel mese i nomi restano tagliati; il tocco sulla casella apre la finestra a tutto schermo con nome, orario, sala e posti. La colonna delle ore scorre e parte dalle 7, o dalla prima lezione se è prima. Con due lezioni alla stessa ora la seconda riga del blocco si accorcia: va provato con tre in parallelo.

## M3 · Pagina della lezione
- Etichette: «Sessione» o «Lezione singola»; «Orario diverso dalla sessione» se l'orario della lezione non è quello di `events`.
- Per riga: Nome Cognome, codice socio, stato, «Fissa» se `bookings.prenotazione_fissa_id` è valorizzato. Restano Disdici ed Elimina.
- Modifica ed Elimina toccano solo questa lezione.
- `DettaglioLezione.jsx` sta dentro `CorsiLayout`: la barra delle sezioni resta, con Calendario attiva. I dati stanno in una griglia da tre colonne a una. Ogni riga è un flex che va a capo. «Disdici» è scritto; il cestino resta staccato da un filo, come oggi in `BookingsTab.jsx:327`. La pagina chiede sempre al server: un link a una lezione vecchia si apre comunque.
- **Aggiungi prenotazione**: la lezione non si sceglie più. `SceltaSocio` mostra 15 soci per pagina da `GET /api/soci/cerca`, con data di nascita e codice; chi è già prenotato si vede ma non si sceglie. Un socio alla volta (`role="radio"`), poi «Conferma prenotazione». `SceltaSocio.jsx` si riusa nella finestra della fissa.
- **Modifica della lezione**: `EventFormDialog` prende una prop `modo`, «lezione» o «sessione». In modo lezione scrive solo `sessions` e segna `modified_manually`. Spariscono il passaggio «solo questa lezione / tutta la serie» e la scelta dei giorni (`EventFormDialog.jsx:543`). Sala, orario e capienza di tutta la sessione, e la data fine, si cambiano dalla riga della sessione in Sessioni.

## M1 · Nuova lezione
- Il campo Ricorrenza sparisce dal calendario: `recurrence_type` è sempre `single`.
- Aperta dalla finestra del giorno, la data è già quella del giorno.
- Il server non cambia per questo: accetta ancora `weekly`, che ora arriva solo da Sessioni.

## M4 · Sessioni
- In alto restano la ricerca per nome del corso e il filtro per categoria. `/calendario/prenotazioni` rimanda qui.
- Una card per corso, con il colore della categoria e «Nuova sessione». Una riga per sessione in corso: giorno, orario, sala, posti, periodo. «Prenotazioni fisse · 3» apre la finestra delle fisse; matita e cestino agiscono sulla sessione intera, da oggi. Le prenotazioni delle singole lezioni stanno nella pagina della lezione.
- «Finite (n)» mostra il numero subito e chiede l'elenco al server solo quando la si apre: righe in sola lettura, senza Modifica né Elimina.
- Solo corsi attivi; un corso disattivato compare se ha ancora sessioni.

## M5 · Nuova sessione
- Corso fisso (quello della card), ricorrenza sempre settimanale, sette pulsanti a scelta unica.
- Gli altri campi sono quelli di oggi: sala, orari, capienza, inizio, «fino a una data» o «per N lezioni».
- In modifica giorno e inizio restano bloccati, come oggi. Il server rifiuta un evento `weekly` senza giorno (`hooks.js:485`).

## M6 · Prenotazioni fisse
- Prima in Gestione corsi non c'era: una fissa si creava solo dalla scheda del socio o dal portale, senza date.
- «Per N lezioni» diventa subito una data: si salva solo dal/al. Il limite è il minore fra la fine dell'abbonamento e l'ultima lezione della sessione.
- La scheda del socio (`FisseSocio.jsx`) apre la stessa `FissaFormDialog`.
- Cancellare: la spunta abilita il pulsante. «Dal» va da oggi alla fine della fissa.

Regole:
- **Crea**: prenota le lezioni del periodo. Lezione piena: lista d'attesa.
- **Modifica**: lavora sulla differenza. Prenota i giorni aggiunti, disdice quelli tolti, non tocca quelli in mezzo.
- **Cancella**: disdice solo le prenotazioni con quel `prenotazione_fissa_id`, dalla data scelta. Quelle fatte a mano restano.
- **Sessione senza più lezioni** (eliminata o accorciata): le sue fisse si chiudono nella stessa transazione.
- **Sessione allungata**: le fisse non cambiano.
- **Rinnovo dell'abbonamento**: niente. Prima la fissa ripartiva da sola.
- **Sospensione finita prima**: si prenotano i giorni tornati liberi, solo per le fisse di quel socio.
- **Socio archiviato (K11)**: le sue fisse attive si chiudono da oggi.

## M7 · Colore della categoria
- Oggi è `input type="color"` (`CategoriesTab.jsx:128`): slider, box e i tre campi R, G, B sono di Edge e non si possono cambiare.
- Il campo accetta `rgb(139, 92, 246)`, `139, 92, 246`, `#8b5cf6` e `8b5cf6`. Si salva sempre `#rrggbb`.
- Nel box la saturazione è fissa al 100%: i grigi si ottengono solo scrivendo il codice. È una scelta, non una svista.

## Database

### 0059 (era 0058) · una sessione, un giorno

| Tabella · campo | Tipo | Azione | Dati esistenti |
|---|---|---|---|
| `events.giorno` | varchar(9), da Monday a Sunday | Aggiungi | Sessione su un giorno: il suo giorno. Su più giorni: la riga tiene il primo, per gli altri nasce una sessione nuova |
| `events` (vincoli) | 2 CHECK | Aggiungi | Valore valido; `weekly` richiede il giorno. Si aggiungono dopo aver riempito la colonna |
| `events.days_of_week` | jsonb | Togli | Copiato in `giorno` prima di toglierlo, nella stessa transazione |
| `sessions.event_id` | uuid | Dati | Le lezioni dei giorni spostati puntano alla sessione nuova |
| `categories.color` | varchar(16) | Invariato | Nessuna migrazione: il server ora accetta solo `#rrggbb` |

Schema in `server/src/db/schema/courses.js:84`. Nel database locale ci sono 4 sessioni settimanali, tutte su due giorni, e 28 lezioni. Una sessione «per N lezioni» divisa diventa «fino a una data», quella della sua ultima lezione: il conteggio era su tutti i giorni insieme.

Passi:
1. ADD `events.giorno`.
2. Per ogni `weekly` con più giorni, la riga tiene il primo giorno della settimana e si fa un INSERT di una sessione per ogni altro giorno, con gli stessi corso, sala, orari, capienza e date.
3. UPDATE di `sessions.event_id` per le lezioni di quel giorno (`extract(isodow from date)`).
4. Le fisse: quelle senza `giorni` si duplicano su ogni sessione nuova; quelle con i giorni scelti si spostano su quelli.
5. `by_count` diventa `by_date` con l'ultima lezione.
6. ADD dei due CHECK, DROP di `days_of_week`.

### 0060 (era 0059) · fisse a periodo

| Tabella · campo | Tipo | Azione | Dati esistenti |
|---|---|---|---|
| `prenotazioni_fisse.dal` | date NOT NULL | Aggiungi | Il giorno di `created_date` |
| `prenotazioni_fisse.al` | date, CHECK `al >= dal` | Aggiungi | Vuoto: le fisse di oggi restano senza fine e si comportano come prima |
| `prenotazioni_fisse.giorni` | jsonb | Togli | La 0059 lo legge per dividere le fisse; poi non serve più |
| `bookings.prenotazione_fissa_id` | uuid, FK con ON DELETE SET NULL, indice | Aggiungi | Ricostruito: le prenotazioni del socio sulle lezioni di quella sessione, dalla creazione della fissa in poi |

Schema in `server/src/db/schema/courses.js:126-159`. Nel database locale le fisse sono 0: la ricostruzione non è provata su dati veri. La regola di ricostruzione è un'ipotesi: una prenotazione fatta a mano dopo la fissa viene marcata «Fissa», e cancellando la fissa si disdice anche quella. L'indice unico «una fissa attiva per socio e sessione» resta com'è.

Passi:
1. ADD `prenotazioni_fisse.dal` (riempito da `created_date`) e `al`, con il CHECK.
2. ADD `bookings.prenotazione_fissa_id` con indice, poi l'UPDATE di ricostruzione.
3. DROP `prenotazioni_fisse.giorni`.

L'ordine è obbligato: la 0059 legge `giorni`, che la 0060 toglie. Il file lo genera `drizzle-kit generate`; il blocco `DO $$` si scrive a mano dentro, come nelle 0051 e 0053.

## Codice: rotte nuove

| Rotta | Cosa restituisce | Permesso |
|---|---|---|
| `GET /api/calendario/lezioni?dal&al` oppure `?evento_id&dal` | Lezioni con corso, sessione, confermati e in_attesa | Lettura |
| `GET /api/calendario/lezioni/:id` | Lezione, sessione, prenotazioni con socio e `prenotazione_fissa_id` | Lettura |
| `GET /api/calendario/sessioni?stato&corso_id` | Sessioni in corso o finite, prima e ultima lezione, numero di fisse | Lettura |
| `POST /api/calendario/conflitti` | Conflitti di sala e istruttore per un elenco di date | Scrittura |
| `GET /api/soci/cerca?q&pagina` | 15 soci non archiviati: nome, cognome, nascita, codice; il totale (K8) | Scrittura |
| `PUT /api/prenotazioni-fisse/:id` | Corpo `dal`, `al` o `numero`. Prenotate e disdette | Scrittura |
| `POST /api/prenotazioni-fisse/:id/termina` | Corpo `dal`. Disdette | Scrittura |

**Attenzione**: il preHandler di `routes/calendario.js:37-44` oggi chiede la scrittura per tutto il file. Le GET nuove vanno sotto la lettura, altrimenti chi ha solo «view» sul modulo `calendar` perde il calendario.

## Codice: rotte che cambiano

| Rotta | Cosa cambia |
|---|---|
| `POST /api/calendario/elimina` | Via `giorni`; l'ambito serie accetta `evento_id`; senza più lezioni chiude le fisse (`calendario.js:65`) |
| `POST /api/calendario/eventi/:id/data-fine` | Legge `giorno` (:174); `applicaFisse` solo per le fisse senza `al` (:226) |
| `POST /api/prenotazioni-fisse` | Corpo: `member_id`, `event_id`, `dal`, `al` o `numero`. Via `giorni` (`prenotazioniFisse.js:34`) |
| `GET /api/prenotazioni-fisse` | Aggiunge `dal`, `al`, socio, `codice_socio`, `giorno`; via `giorni` e `giorni_serie` |
| `DELETE /api/prenotazioni-fisse/:id` | Resta, e vale «termina da oggi» |
| `POST` e `PUT /api/entities/Event` | Rifiuta `days_of_week`; `weekly` richiede un giorno valido (`hooks.js:485`) |
| `POST` e `PUT /api/entities/Category` | `color` passa da `leggiColore`; se non è un colore, 400 |
| `GET /api/prenotazioni?dal` | Si toglie: l'unico uso è `CorsiLayout.jsx:67` (`prenotazioni.js:59`) |
| `POST /api/soci/:id/archivia` | **K11**: chiude le fisse attive del socio |

Restano come sono `POST /api/prenotazioni`, `/:id/disdici`, `/:id/stato`, `/:id/posizione` e `DELETE /:id`; le ultime tre azioni non hanno più un pulsante nel gestionale.

## Codice: server

| File (`server/src`) | Funzione | Azione e motivo |
|---|---|---|
| `lib/prenotazioniFisse.js` | `lezioniDellaFissa` | Cambia: filtra per `dal` e `al`, non più per `giorni` (:30) |
| `lib/prenotazioniFisse.js` | `creaFissa` | Cambia: `dal`, `al` o `numero`; rifiuta oltre l'abbonamento o l'ultima lezione (:103) |
| `lib/prenotazioniFisse.js` | `modificaFissa` | Aggiungi: prenota i giorni aggiunti, disdice quelli tolti |
| `lib/prenotazioniFisse.js` | `terminaFissa` | Cambia: prende `dal` (**predefinito `oggiIso()`, K10**); disdice solo le prenotazioni della fissa (:130-146) |
| `lib/prenotazioniFisse.js` | `applicaFisse` | Cambia: passa l'id a `prenota`; i richiami esterni solo se `al` è vuoto (:42) |
| `lib/prenotazioni.js` | `prenota` | Cambia: parametro `prenotazioneFissaId` (:79) |
| `lib/calendario.js` | `conflitti` | Aggiungi: la regola di `checkEventConflicts` portata sul server |
| `lib/dateSettimanali.js` | `dateGiuste` | Cambia: legge `giorno` (:37) |
| `entities/hooks.js` | Event, Category | Cambia: controlli su `giorno` (:485) e sul colore |
| `routes/soci.js` | fine sospensione | Cambia: prenota solo i giorni liberati, per le fisse del socio (:288) |
| `routes/soci.js` | archivia | Cambia (K11): `terminaFissa` per ogni fissa attiva |
| `routes/soci.js` | cerca | Aggiungi (K8, C-3): `GET /api/soci/cerca` con `shared/ricerca.js` |

## Codice: client, file nuovi (nessuna libreria nuova)

| File (`src/staff`, salvo dove indicato) | Cosa fa |
|---|---|
| `pages/corsi/DettaglioLezione.jsx` | La pagina della lezione |
| `pages/corsi/Sessioni.jsx` · `components/courses/SessioniTab.jsx` | La pagina Sessioni e le card per corso |
| `components/courses/GiornoDialog.jsx` · `lib/vistaGiorno.js` | La giornata a ore; `disponiLezioni` e `intervalloOre` |
| `components/courses/PrenotazioniLezione.jsx` | La tabella delle prenotazioni di una lezione |
| `components/courses/SceltaSocio.jsx` | Ricerca e pagine, un socio alla volta (usa `ui/Paginazione.jsx`, K9) |
| `components/courses/AggiungiPrenotazioneDialog.jsx` | `SceltaSocio` più la conferma |
| `components/courses/FisseSessioneDialog.jsx` | Le fisse di una sessione |
| `components/courses/FissaFormDialog.jsx` | Crea e modifica una fissa; la usa anche la scheda del socio |
| `components/courses/CancellaFissaDialog.jsx` | Spunta e data da cui disdire |
| `components/courses/SelettoreColore.jsx` | Campo di testo e box del colore |
| `shared/colore.js` · `src/core/domain/colore.js` | `leggiColore`, `hexAHsl`, `hslAHex` e la riesportazione per il client |

## Codice: client, file che cambiano

| File (`src`) | Cosa cambia |
|---|---|
| `staff/App.jsx:86-93` | Rotte `lezioni/:id` e `sessioni`; `prenotazioni` rimanda a `sessioni` |
| `staff/pages/corsi/CorsiLayout.jsx:24, 59-68` | Voce «Sessioni»; carica quattro elenchi invece di otto |
| `staff/…/CalendarView.jsx` · `Calendario.jsx:13` | Carica il mese; casella e «+N altri» aprono il giorno; via la frase |
| `staff/…/EventFormDialog.jsx` | Prop `modo`; un giorno solo; conflitti dal server; via lezione/serie |
| `staff/…/EliminaEventoDialog.jsx:35, 82, 104` | Via la scelta dei giorni; l'ambito lo decide chi la apre |
| `staff/…/CategoriesTab.jsx:128` | `SelettoreColore` al posto di `input type="color"` |
| `staff/…/CoursesTab.jsx:80` · `RoomsTab.jsx:173` | Non leggono più `events` e `sessions` dal layout |
| `staff/components/soci/FisseSocio.jsx` | Crea con `FissaFormDialog`; via `giorni` e `days_of_week` |
| `staff/lib/modificaEvento.js` · `eventUtils.js` | Leggono `giorno`; via `checkEventConflicts` e i giorni multipli |
| `core/api/client.js:239-284` | Le chiamate alle rotte nuove |
| `staff/pages/Dashboard.jsx:133` | Il link «Tutte» va su `/calendario` (K13: solo questa riga) |

Si tolgono `RiepilogoLezione.jsx`, `BookingsTab.jsx` e `pages/corsi/Prenotazioni.jsx`.

## Test

**Da aggiungere**
- Fisse: crea con `al` e con `numero`; rifiuto oltre l'abbonamento, oltre la sessione e con `dal` passato; modifica che allunga e che accorcia; termina dal giorno X lascia le prenotazioni a mano; **termina senza `dal` vale da oggi (K10)**.
- Calendario: lezioni per intervallo, dettaglio, sessioni in corso e finite, conflitti; le GET con un ruolo di sola lettura; eliminare una sessione chiude le fisse.
- **Archivia chiude le fisse (K11)** in `archivio-soci.test.js`.
- **`/api/soci/cerca`** con «Cognome Nome» e accenti (K8).
- Migrazione 0059: una sessione su due giorni con lezioni e una fissa diventa due.
- `vistaGiorno.test.js`: due sovrapposte, tre a catena, fine uguale a inizio.
- `colore.test.js`: i quattro formati, valori oltre 255, hex → hsl → hex.

**Da cambiare**: `server/test/calendario.test.js:39, 158, 217`; `prenotazioni-fisse.test.js:67, 94, 100, 127`; `date-settimanali.test.js:14-57`; `sale.test.js:239, 341, 450, 460`; `src/staff/lib/eventUtils.test.js:19, 31`; `src/staff/lib/modificaEvento.test.js:13, 69, 143`; `server/test/sospensioni.test.js` (la fine anticipata); `server/scripts/verifica-pagine.mjs:61` (`/calendario/sessioni` e una pagina di lezione).

## Collegamenti

**Si rompono (coperti dal piano)**

| Dove | Perché | Rimedio |
|---|---|---|
| `src/staff/components/soci/FisseSocio.jsx:42-143` | Legge `days_of_week` e `giorni_serie`, manda `giorni` | Riscritta con `FissaFormDialog` |
| `server/src/routes/member/index.js:467, 480, 488` | Legge `f.giorni` e `giorni_serie`, passa `giorni` a `creaFissa`; chiama `terminaFissa` senza `dal` | Manda `giorni: [giorno]` e crea senza `al`; `dal` predefinito (K10). Il client del portale (`fisse.jsx:64`) non cambia |
| `src/staff/components/courses/CoursesTab.jsx:80` | Conta gli `events` del layout, che non li carica più | Decide il server: la FK risponde già «ancora collegato» (`errorHandler.js:51`) |
| `server/src/ripara-date-settimanali.js:32` | Legge `daysOfWeek` | Legge `giorno`; lo script resta |
| `server/scripts/_foto3.mjs:40` · `_foto7.mjs:27` | Inseriscono `daysOfWeek` | Script di lavoro: adattare o togliere |

**Da adattare**: `Dashboard.jsx:133` (link su `/calendario`); `server/src/routes/entities.js:186`, `member/index.js:314`, `calendario.js:226` (`applicaFisse` solo per le fisse senza `al`); `RoomsTab.jsx:173`; `src/staff/lib/sessionValidation.js` (`validateSessionsBulk` sulla risposta di `/api/calendario/conflitti`); `server/scripts/verifica-pagine.mjs:61`.

**Non toccati**: `lib/sale.js:23-27` e `entities/hooks.js:185-190`; `routes/istruttore.js:36, 66` e `routes/dashboard.js:116`; `routes/errorHandler.js:39-53`; `seed.js`; il registro delle azioni; la notifica `fissa_senza_abbonamento`; `shared/permissions.js:197`; `src/member/components/fisse.jsx:64`; i colori nel portale (`CourseSessionCard.jsx:27`, `CoursesByCategory.jsx:56`); `LegendaCorsi.jsx` e `InstructorsTab.jsx`; Le mie lezioni e Dashboard.

## Rischi

| Rischio | Dove | Mitigazione |
|---|---|---|
| Lezioni la cui data non cade in nessun giorno della sessione | 0059 | prima `db:ripara-date-settimanali`; poi a mano quelle che restano |
| Eventi «custom» in produzione | 0059 | restano senza giorno (il CHECK vale solo per `weekly`); in Sessioni in sola lettura |
| La ricostruzione marca «Fissa» prenotazioni fatte a mano | 0060 | controllo a campione; nel dubbio lasciare vuoto |
| DROP di `days_of_week` e di `giorni` | 0059, 0060 | backup e prova generale su una copia della produzione (Fase 4) |
| Due regole per le fisse: dal/al per lo staff, senza fine dal portale | `prenotazioni_fisse.al` vuoto | la riga dice «senza data di fine (dal portale)» |
| Spariscono quattro azioni sulla lista d'attesa | `PrenotazioniLezione.jsx` | le rotte restano |
| Allungare una sessione non allunga le fisse | data-fine | proposta: l'anteprima dice quante fisse finiscono prima |
| Una chiamata a ogni cambio di mese | `CalendarView.jsx` | mesi già visti in memoria |

## In sospeso (alla revisione del portale)
1. Fisse senza fine dal portale: nascono con `al` vuoto, come oggi. Da decidere se il portale chiede le date o smette di crearle.
2. «Vuoi allungare la tua fissa?»: una notifica al socio quando una sessione si allunga. Nessun codice in questo piano.
3. Sospensione finita prima: le prenotazioni disdette dalla sospensione (`soci.js:248-253`) non tornano, perché `applicaFisse` salta le lezioni che hanno già una prenotazione, anche disdetta (`prenotazioniFisse.js:58-64`). Succede già oggi.

## Pacchetti del piano unico
- **C-1**: `shared/colore.js`, `src/core/domain/colore.js`, `colore.test.js`, `SelettoreColore.jsx` in `CategoriesTab.jsx`, controllo del colore in `hooks.js` (M7). Le bozze `_bozze/0059.sql` e `_bozze/0060.sql`, con la migrazione provvisoria provata su `grip_corsi`, e lo schema in `courses.js`.
- **C-2**: il server. Rotte nuove sotto il permesso di lettura giusto, `lib/calendario.js` con `conflitti`, `lib/prenotazioniFisse.js` (K10), `prenota`, `dateSettimanali`, `hooks.js` sul giorno, le rotte che cambiano, `archivia` (K11), fine sospensione, `member/index.js` fisse, `ripara-date-settimanali.js`, `_foto3/_foto7`, i test del server. **Non `/api/soci/cerca`.**
- **C-3**, dopo il ribase su main con Soci: `/api/soci/cerca` (K8) e il client del calendario: M1, M2, M3 (`CalendarView`, `Calendario`, `GiornoDialog` e `vistaGiorno` con i test, `DettaglioLezione`, `PrenotazioniLezione`, `SceltaSocio` con `ui/Paginazione`, `AggiungiPrenotazioneDialog`, `EventFormDialog` modo lezione), `CorsiLayout`, `App.jsx`, `client.js`.
- **C-4**: M4 e M6 nel client: `Sessioni`, `SessioniTab`, `EventFormDialog` modo sessione, le finestre delle fisse, `FisseSocio`, `EliminaEventoDialog`, `CoursesTab`, `RoomsTab`, `sessionValidation`, `modificaEvento`/`eventUtils` e i loro test, `Dashboard.jsx:133`; via i tre file vecchi; `verifica-pagine.mjs`.
- **C-5**, dopo l'unione di Da fare: K1 (migrazioni definitive 0059 e 0060), `grip_corsi` ricreato da zero con la 0058, la 0059 e la 0060 in fila, test della migrazione.
