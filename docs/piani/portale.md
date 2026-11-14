# GRIP · Portale soci: rifacimento (ramo D)

14 novembre 2026. Ramo `feature/portale`, da `main` a `f8076b5e`, sul database **`grip_locale`**. Per chi implementa: cosa cambia, dove, e cosa si rompe intorno. Il documento d'analisi è il PDF «Portale soci: rifacimento» dell'11/11/2026 (base `4e149439`): è tagliato sul lato destro, e dove manca un dettaglio qui c'è la **decisione presa**, ricavata dal codice. I numeri di riga invecchiano: le funzioni si cercano per nome.

Obiettivo: il socio trova una lezione e la prenota in un tocco; intorno restano solo l'abbonamento, le sue lezioni e le notifiche che dicono che cosa è successo e dove.

## Perimetro

**Dentro**
- Tutto `src/member/` e `src/core/api/portale.js`; `server/src/routes/member/index.js` (`/api/member/v1`).
- Regole: `lib/prenotazioni.js`, `lib/prenotazioniFisse.js`, `lib/notifiche.js`; la fine della sospensione in `routes/soci.js`; la data fine della sessione in `routes/calendario.js`; il rinnovo in `routes/entities.js`.
- `shared/`: `avvisi.js`, `corsi.js`, `anagrafica.js`, `qrDinamico.js`, `segnali.js`, `daFare.js`, `soglie.js`, `consensi.js`, `permissions.js`.
- Gestionale, solo dove si taglia: scheda socio (QR, Documenti, Consensi), Ingressi, Iscrivi, Da fare (la scheda Documenti), Dashboard (la tessera Documenti); più un posto dove scrivere i contatti della palestra.

**Fuori**: Calendario dello staff, Sessioni, Categorie (ramo C); Lead, Listino, Venduti, Istruttore, Utenti e ruoli; push, PWA, tessera NFC, pagamenti, richiesta di rinnovo. **Nessun DROP di tabelle**: `qr_accessi`, `member_documents`, `consensi` restano, con il loro schema Drizzle (togliere lo schema farebbe generare un DROP).

## Le decisioni dell'utente (11/11/2026, non si cambiano senza un nuovo sì)

| Tema | Decisione |
|---|---|
| Fisse dal portale | Con date: «fino al» oppure «per N lezioni». Niente fisse senza fine, niente rinnovo automatico. Massimo: il minore fra la copertura dell'abbonamento e l'ultima lezione della sessione |
| «Allunga la fissa» | Notifica al rinnovo e quando la sessione si allunga. A fine sospensione le lezioni si riprenotano. La disdetta per sospensione si segna con `motivo_disdetta = 'sospensione'` |
| Documenti | Via tutto, dal portale e dal gestionale. Il codice va nel branch `archivio/documenti`, la tabella resta. Via avvisi, segnali, giallo al bancone, la scheda Documenti di Da fare |
| QR | Via dal portale e dal gestionale. Gli ingressi a mano al bancone restano finché non c'è un lettore; `qr_accessi` resta |
| Lista d'attesa | **Rivista il 14/11**: un posto liberato si **offre** al primo in lista, che ha **12 ore** per confermarlo; se non conferma torna in attesa e l'offerta passa al successivo, e così via. Al termine di disdetta **del corso** (si sceglie corso per corso: `disdetta_entro_ore`, 2 ore nei mockup) la lista **si chiude**: niente nuovi in attesa, nessuna offerta nuova, e il posto liberato è di chi lo prende |
| Notifiche | Niente push: solo nel portale. Si ricaricano a ogni `visibilitychange` |
| Barra | Quattro voci: Home · Corsi · Le mie lezioni · Abbonamento. Notifiche e Profilo dall'avatar. Su desktop la barra diventa il menu laterale |
| Risposte del 14/11 | Si riprenotano tutte le disdette per sospensione; pillola «Confermata»; le rotte tolte escono da `v1`; i contatti li scrive l'amministratore; la spunta dei genitori non blocca (il socio ha il portale solo dopo l'iscrizione); i dati locali sono sintetici: si correggono a mano |
| Rotture di D-1 | Tutte **A**: R1 la scheda Documenti di Da fare si toglie ora; R2 Iscrivi senza i due passi dei documenti; R3 in Profilo una riga «Revoca» solo per chi ha un consenso attivo; R4 consenso dei genitori come spunta «firmato» in anagrafica, con un campo su `members` |

## Le parole

Valgono quelle del glossario (`docs/ux/glossario.md`). Il piano ne aggiunge cinque, già scritte lì in D-0: **Le mie lezioni**, **Annulla** (nel messaggio subito dopo «Prenota»), **Esci dalla lista**, **Allunga** (una fissa), **Mattino · Pomeriggio · Sera** (le fasce del giorno).

## Sintesi: cinque pacchetti, una migrazione

| Pacch. | Cosa | Quando | Database |
|---|---|---|---|
| D-0 | Questo piano; ritocchi a `corsi.md` e `da-fare.md`; glossario | Subito | — |
| D-1 | Tagli: QR, documenti, consensi promozionali, «Segnala una modifica»; R1-R4. Chiude con la migrazione | Subito | **0062_portale** (sotto) |
| D-2 | Barra a quattro voci, Home nuova, Abbonamento come scheda, Profilo con i contatti | Dopo D-1 | — (contatti in `organizations.impostazioni`) |
| D-3 | Corsi (striscia dei giorni, card, fogli), categoria a fisarmonica, Le mie lezioni, notifiche con origine e azione, lista d'attesa fino al termine, margine di 10 minuti | Dopo D-2 (C è già in main) | — |
| D-4 | Fisse con date dal portale, anteprima, «Allunga», sospensione finita prima | Dopo D-3 | — |

Un commit per sotto-passo, messaggi «Portale D-n: …». Dopo ogni pacchetto ci si ferma e si riassume. Niente merge in main né push senza il sì dell'utente.

## D-1 · Tagli

### QR
- **Portale**: via `MemberQR.jsx`, la rotta `qr`, la voce del menu, la CTA della Home, `GET /accesso`, `caricaAccesso`.
- **Gestionale**: via la sezione «QR accesso» della scheda (`MemberDetail.jsx`: stato, immagine, Revoca, Genera/Rigenera). Resta la password del portale.
- **Server**: via `routes/qr.js` (e la sua registrazione in `app.js`), `lib/qrDinamico.js`, il ramo `codice` di `POST /api/ingressi/verifica` (resta solo `member_id`: `metodo` è sempre `manuale`). `QRAccesso` esce dal registro delle entità (`entities/registry.js`, `auth/authorize.js`, `auth/memberScope.js`, la lista in `core/api/client.js`).
- **Shared e client**: via `shared/qrDinamico.js`, `src/ui/hooks/useQrDinamico.js`, `src/ui/qr/qrImmagine.js`, `generateQRCode` in `src/staff/lib/qrUtils.js` (il file resta: `generaPasswordTemporanea` la usano Iscrivi e `DialogResetPassword`); la dipendenza `qrcode` se non la usa più nessuno.
- **Resta**: la tabella `qr_accessi`, il CHECK su `ingressi.metodo` (che ammette ancora `qr`), lo storico degli ingressi.

### Documenti
- **Portale**: via `MemberDocuments.jsx`, la rotta e la voce `documenti`, il riquadro della Home, `GET /documenti`, `caricaDocumenti`; da `GET /profilo` esce `documenti`.
- **Gestionale**: via `DocumentiSocio.jsx` e `DialogoCaricaDocumento.jsx`; in Da fare la scheda **Documenti** (R1) e «Carica documento»; in Dashboard la tessera Documenti (restano quattro).
- **Server**: `MemberDocument` esce dal registro delle entità e dai permessi (`crm_documents` in `shared/permissions.js` e `authorize.js`); via la cancellazione del file in `routes/entities.js` (non ci sono più documenti da eliminare). La query dei documenti esce da `lib/segnali.js`, `routes/ingressi.js` (`schedaIngresso`), `routes/member/index.js`.
- **Shared**: via `TIPI_DOCUMENTO`, `tipoAtteso`, `nomeDocumento`, `motivoDocumentoNonValido`, `tipoDocumentoValido`, `infoTipoDocumento`, `conStatoDocumenti`, `etichettaStatoDocumento`, `GIORNI_IN_SCADENZA` (`shared/anagrafica.js`); `documentiDaSistemare` e gli avvisi dei documenti (`shared/avvisi.js`); i segnali `documento_scaduto` e `documento_in_scadenza` (`shared/segnali.js`); il tipo `documento` e l'esito `documento_caricato` (`shared/daFare.js`); la soglia `documentoInScadenzaGiorni` (`shared/soglie.js`) e il suo riquadro nelle Regole.
- **Il bancone** diventa giallo solo per l'abbonamento in scadenza; rosso come prima.
- **Decisione presa**: `manutenzione:file-orfani` (`src/pulisci-file-orfani.js`) continua a contare i `file_url` di `member_documents` come usati: altrimenti cancellerebbe i file dei documenti archiviati. Le righe aperte di tipo `documento` nella tabella `avvisi` le chiude `allinea()` da sola alla prima lettura (non più vere); non si cancellano.
- **Archivio**: prima del primo taglio si crea il branch locale `archivio/documenti` dal commit di D-0 (contiene anche il QR e i consensi dalla reception). Il push su origin, come per `archivio/comunicazioni`, lo decide l'utente.

### Consensi promozionali (R3)
- **Gestionale**: via `ConsensiSocio.jsx` e `POST`/`GET /api/persone/:id/consensi`: senza documenti non c'è più il modulo firmato che li prova.
- **Iscrivi (R2)**: via i due passi «Certificato» e «Consensi» (con il modulo firmato). Restano anagrafica, abbonamento, privacy, portale. `POST /api/iscrivi` rifiuta con 400 `certificato`, `consensi` e `modulo_consensi`.
- **Portale**: via `ConsensiComunicazioni.jsx` dalla Home e dal Profilo. In Profilo, **solo se un consenso è attivo**, una riga «Comunicazioni promozionali: le ricevi per email, SMS. **Revoca**» (R3). `PUT /consensi` accetta solo `valore: false`; `GET /consensi` resta.
- **Resta**: la tabella `consensi` e `lib/consensi.js` (il join su `member_documents` funziona: la tabella c'è ancora). Un consenso dato in reception vale finché il suo modulo resta nella tabella, come prima.

### «Segnala una modifica»
Via il pulsante e la finestra (`MemberProfile.jsx`). Al suo posto, in D-2, la riga «Dati sbagliati? Scrivi o chiama la reception» con i contatti.

### Consenso dei genitori (R4)
- Campo nuovo `members.consenso_genitori_firmato` (boolean, not null, default false), nella 0062. La migrazione lo mette a `true` per chi ha un documento `consenso_genitori`.
- In anagrafica (`CampiAnagrafica.jsx`, quindi anche in Iscrivi) una casella «Consenso dei genitori firmato», **solo per i minorenni**. `anagraficaSocio` la accetta (`consenso_genitori_firmato`), `shared/anagrafica.js` ha `serveConsensoGenitori(socio, oggi)` al posto della riga «minorenni» di `TIPI_DOCUMENTO`.
- **Decisione presa**: la casella non blocca l'iscrizione (prima il documento mancante dava un avviso, non un blocco). La scheda del socio minorenne senza la spunta dice «Consenso dei genitori da firmare» in giallo.

### Test e script di D-1
Via: `qr-accesso.test.js`. Da cambiare (ricontrollati dal codice): `api-member.test.js`, `ingressi.test.js`, `iscrivi.test.js`, `anagrafica-soci.test.js`, `archivio-soci.test.js`, `da-fare.test.js`, `dashboard.test.js`, `file-protetti.test.js`, `segnali.test.js`, `lead.test.js`, `istruttore.test.js`, `password-e-sessioni.test.js`, `permessi-lettura.test.js`, `permessi-scrittura.test.js`, `permessi-portale-soci.test.js`, `vincoli.test.js`; nel client `anagrafica.test.js`, `avvisi.test.js`, `crm.test.js`, `daFare.test.js`, `segnali.test.js`, `sospensioni.test.js`. Script: `verifica-pagine.mjs`, `verifica-da-fare.mjs`, `verifica-oggi.mjs`, `dati-da-fare.mjs` (via il caso Documenti). `verifica-fase3` è già tolto.

## La migrazione 0062_portale

Una sola, generata con `npm run db:generate` alla fine di D-1 (dopo la 0061 di main) e completata a mano: drizzle-kit non scrive né i CHECK con condizione né il blocco `DO $$`. Il SQL a mano si tiene anche in `server/drizzle/_bozze/0062.sql`.

| Tabella · campo | Tipo | Azione | Dati esistenti |
|---|---|---|---|
| `members.consenso_genitori_firmato` | boolean not null default false | Aggiungi (R4) | `true` per chi ha un documento `consenso_genitori` |
| `bookings.motivo_disdetta` | varchar(16) null, CHECK in (`sospensione`) | Aggiungi | NULL ovunque: le disdette di sospensioni già fatte non si riprenotano |
| `bookings.posto_offerto_fino_a` | timestamptz null, CHECK solo su `waitlisted` | Aggiungi | NULL: nessuna offerta aperta |
| `notifiche.lezione_id` | uuid null → `sessions`, on delete set null, indice | Aggiungi | NULL: le notifiche vecchie restano senza azione |
| `notifiche.fissa_id` | uuid null → `prenotazioni_fisse`, on delete set null, indice | Aggiungi | NULL |
| `prenotazioni_fisse.al` | CHECK `attiva = false or al is not null` | Dati + vincolo | Le attive senza fine prendono il minore fra la fine dell'abbonamento che copre oggi e l'ultima lezione della sessione; senza un abbonamento oggi (o con quella data prima dell'inizio) si chiudono (`attiva = false`, `terminata_il = oggi`) |
| `courses.category_id` | uuid → NOT NULL | Cambia | Prima un `DO $$` che si ferma con l'elenco dei corsi senza categoria |
| `organizations.impostazioni` | jsonb (c'è già) | Chiavi | `contatti: { telefono, whatsapp, email, orari }`: nessuna migrazione |
| `ruoli.permessi` | jsonb | Dati | Via la chiave `crm_documents`: salvando un ruolo, un modulo sconosciuto si rifiuta |
| `organizations.impostazioni` | jsonb | Dati | Via `documento_scaduto` e `documento_in_scadenza` da `segnali_spenti`, e `soglie.documentoInScadenzaGiorni` |

- `notifiche.tipo` è varchar(32): i tipi nuovi non chiedono migrazione.
- **Decisione presa**: la fine dell'abbonamento si legge da `subscriptions.end_date` senza lo slittamento delle sospensioni (in SQL non c'è `iscrizioniDelSocio`). È la data più corta: al peggio il socio riceve «Allunga».
- **Decisione presa**: il CHECK sulle fisse attive rende impossibili le fisse senza fine; spariscono `soloSenzaFine` e `senzaFine` dal codice.
- **Provata (14/11)** su una copia di `grip_locale` con quattro fisse senza fine: coperta dall'abbonamento (finisce con lui), coperta oltre l'ultima lezione (finisce con l'ultima lezione), senza abbonamento e con l'inizio dopo la copertura (chiuse). Poi applicata a `grip_locale`.
- **Il codice che segue la 0062** (in D-1): `creaFissa` non ha più `senzaFine`, `applicaFisse` non ha più `soloSenzaFine`; il rinnovo, la sessione allungata e l'agenda del portale non chiamano più `applicaFisse`; la fissa del portale si crea fino a `massimoFissa`. I test che creano corsi si fanno una categoria (`server/test/categoriaDiProva.js`).
- **In locale (14/11)**: `grip_locale` era ferma alla 0057; prima di applicare 0058-0061 se n'è fatta una copia, il database `grip_locale_prima_0058`. Ci sono 0 fisse attive e **un corso senza categoria («Cross Training»)**: dati sintetici, gli si dà una categoria prima della 0062. Prima di toccare la produzione si rifà lo stesso controllo.

## D-2 · La struttura

### Barra e menu (`MemberLayout.jsx`)
- Telefono: barra in basso con **Home · Corsi · Le mie lezioni · Abbonamento**, target da 44 px (la regola `.portale` di `index.css`). In alto: logo, campanella con il numero, avatar con le iniziali che apre il Profilo.
- Desktop (`lg`): le stesse quattro voci più **Notifiche** nel menu laterale; in fondo il nome del socio, che apre il Profilo.
- Tema ed Esci passano dall'intestazione al Profilo.
- Rotte: `/member-portal` (Home), `corsi`, `lezioni` (in D-2 una prima forma: le prossime con Disdici e le fisse; per intero in D-3), `abbonamento`, `notifiche`, `profilo` (era `anagrafica`; `anagrafica` rimanda a `profilo`). `documenti` e `qr` rimandano alla Home.

### Home (`MemberDashboard.jsx`, riscritta)
1. **Banner** in cima per una notifica non letta su una lezione entro 48 ore (`lezione_id`): «Si è liberato un posto: sei prenotata a Pilates · Domani, gio 12 nov alle 18:30 · dalla lista d'attesa». Un tocco apre la notifica. (In D-2 il banner legge le notifiche che ci sono; la `lezione_id` arriva in D-3.)
2. «Ciao, Giulia».
3. **Abbonamento a una riga**: pallino di stato, «Abbonamento valido fino al 15 dic 2026», sotto «Open 6 mesi · mancano 34 giorni»; un tocco apre Abbonamento. Scaduto: in rosso, «Abbonamento scaduto il …».
4. **Prossima lezione, grande**: stato, giorno, orario, sala, istruttore; **Disdici** e **Aggiungi al calendario** (questo in D-3, con `ics.js`); sotto «Puoi disdire fino a domani alle 14:30». Nessuna: «Nessuna lezione prenotata» e «Prenota una lezione».
5. Le due successive, una riga ciascuna, con la pillola dello stato; «Tutte le mie lezioni».
6. **I tuoi corsi**: gli orari prenotati almeno 2 volte negli ultimi 60 giorni e non fissi, con «Prenota» (in D-3, da `GET /corsi/miei-orari`).
- Via: la CTA del QR, la domanda sui consensi, il riquadro dei documenti, «Hai N cose da sistemare» (resta nelle Notifiche).

### Abbonamento (`MemberSubscription.jsx`, come scheda)
- In cima l'abbonamento corrente: tipo, «Dal 31 mag 2026», **Valido fino al 15 dic 2026**, la barra dei giorni passati sul totale, «Mancano 34 giorni · allungato di 15 giorni per una sospensione». Sotto: «Puoi prenotare lezioni fino al 15 dic 2026» (`abbonamentoCopre`/`fineCopertura`).
- «Per rinnovare passa in reception» con gli orari, **Chiama** e **WhatsApp** (da `/palestra`).
- **Sospensioni**: quelle in corso e future, con «ritorno: N giorni aggiunti alla scadenza».
- **Storico**: i vecchi abbonamenti con «Finito» (neutro), non «Scaduto». «Scaduto» in rosso solo per il corrente.
- Via l'importo pagato (non serve al socio per prenotare). *Decisione presa*: il PDF non lo mostra nel dopo.

### Profilo (dall'avatar, `MemberProfile.jsx`)
- «I tuoi dati»: email, telefono, data di nascita, residenza, contatto di emergenza; poi «Dati sbagliati? Scrivi o chiama la reception».
- «La palestra»: indirizzo (link a Google Maps), telefono (`tel:`), WhatsApp (`https://wa.me/…`), orari della reception.
- R3: la riga «Revoca» dei consensi, solo se ce n'è uno attivo.
- «Account»: tema (`SelettoreTema`), Cambia password, Esci.

### I contatti della palestra
- `GET /api/member/v1/palestra` → `{ nome, indirizzo, telefono, whatsapp, email, orari }`: `nome` e `indirizzo` da `organizations`, il resto da `impostazioni.contatti`. Campi vuoti: la riga non si mostra.
- **Decisione presa** (rivista il 14/11: «una piccola pagina, ci penseremo poi a come farla bene»): lo staff li scrive nella pagina **Contatti** (`/admin/contatti`, sotto le impostazioni del menu; solo amministratore, `admin_users` in modifica): `GET`/`PUT /api/impostazioni/palestra`, con indirizzo e i quattro campi; il registro delle azioni lo dice. Il PDF lascia aperta la pagina («da scegliere»).

## D-3 · Corsi, Le mie lezioni, notifiche

### Corsi · Calendario (`MemberCoursesCalendar.jsx` riscritta)
- **Striscia dei giorni** che scorre (oggi + 13), il giorno scelto pieno; un puntino sotto i giorni dove ho una prenotazione.
- **Filtro a chip** per categoria, a scelta multipla, sempre visibile quando è attivo; più «Solo con posti».
- La lista del giorno divisa in **Mattino** (prima delle 13), **Pomeriggio** (13-18), **Sera** (dalle 18), con le lezioni già finite di oggi fuori.
- **Card**: orario, corso, istruttore · sala; la pillola dei posti: «8 posti», «Ultimi 3 posti» (≤ 3), «Piena · 5 in attesa»; il bordo a sinistra del colore della categoria. A destra il pulsante tondo: **+** prenota, **✓** già prenotata (apre il foglio), lista chiusa o senza copertura: il motivo al posto del pulsante.
- **Prenota con un tocco**: subito, poi un messaggio «Prenotata: Yoga, gio 12 nov 12:15» con **Annulla** per 8 secondi (che disdice: vedi il margine di 10 minuti). Lezione piena: si apre il foglio della lista d'attesa (sotto).
- Dati: `GET /corsi/agenda?dal&al` a blocchi di **14 giorni**, senza `applicaFisse` nella GET.

### Corsi · Per corso (`CoursesByCategory.jsx` riscritta)
- Si apre **solo la categoria**, con «2 corsi · 7 orari» nell'intestazione; dentro ogni corso ha tutte le chip dei suoi orari, senza un secondo livello. Più categorie aperte insieme; all'ingresso è aperta quella della mia ultima prenotazione, e quelle aperte si ricordano (`localStorage`, con `try/catch`).
- Niente chip-filtro qui: filtra già la fisarmonica.
- Chip con «Fissa» se l'orario è già mio. Il tocco apre il **foglio dell'orario**: «Yoga · ogni giovedì 12:15 · Sala 2 · Elisa Paccagnella · 10 posti», le prossime lezioni con i posti e il **+**, in fondo **Prenota ogni giovedì** (D-4).
- Dati: `GET /corsi/catalogo`; le lezioni del foglio con `GET /corsi/agenda?sessione_id`.

### Lista d'attesa e ripensamento
- **Regola 1 · l'offerta di 12 ore** (decisa il 14/11). Quando si libera un posto (una disdetta, la capienza che cresce, un'offerta scaduta), `promuoviFinoACapienza` non conferma più nessuno da solo: **offre** il posto al primo in lista. La prenotazione resta `waitlisted` con `posto_offerto_fino_a` = il minore fra adesso + 12 ore e la chiusura della lista; il posto conta come occupato. Il socio riceve `posto_offerto` («Si è liberato un posto a Pilates: confermalo entro le 18:30») e in Home il banner con **Conferma**. Confermando passa a `confirmed`; con **Esci dalla lista** il posto va al successivo.
- **L'offerta scaduta**: il socio torna in attesa, **in fondo alla lista**, e l'offerta passa al successivo con la sua finestra di 12 ore, che parte dalla scadenza della precedente. Non serve un processo programmato: le scadenze si leggono dalle date, e `regolaOfferte(tx, lezione)` le sistema a ogni lettura o scrittura della lezione (agenda, Le mie lezioni, prenota, disdici) e nel giro notturno. *Decisione presa*: «torna in attesa» vuol dire in fondo, così il giro passa per tutti.
- **La chiusura della lista**: al termine di disdetta del corso (`limiteDisdetta`; 2 ore nei mockup); senza termine, all'inizio della lezione. Da lì nessuna offerta nuova, nessun nuovo in attesa (una lezione piena dice «Piena · lista chiusa»), e un'offerta aperta scade alla chiusura. Il posto liberato è di chi preme **Prenota**: anche chi era in attesa, che passa da `waitlisted` a `confirmed` (oggi riceve 409). *Deciso il 14/11*: corso per corso, con il termine di disdetta che il corso ha già; nessun campo nuovo.
- `promosso_lista_attesa` («Posto confermato») non si scrive più dal portale: resta per la reception, che conferma a mano da `cambiaStato`. Nella pagina della lezione dello staff, accanto a chi ha un'offerta, «Posto offerto fino alle 18:30».
- **Regola 2 · margine di 10 minuti**: il socio disdice sempre una prenotazione creata da meno di 10 minuti, anche oltre il termine. Costante `MARGINE_RIPENSAMENTO_MINUTI = 10` in `shared/corsi.js`; il controllo in `disdici`. Così «Annulla» del messaggio funziona anche a ridosso della lezione.
- Il foglio della lezione piena: «La lezione è piena: entri in lista d'attesa, al 2° posto. Se si libera un posto entro martedì alle 18:00 te lo offriamo: lo trovi in Notifiche e in Home, e hai 12 ore per confermarlo. Dopo quell'ora la lista si chiude e il posto va a chi lo prende per primo.» **Entra in lista d'attesa** · Annulla.

### Le mie lezioni (pagina nuova, `MemberLezioni.jsx`)
- **Fisse**: orario, «fino al 15 dic 2026 · 5 lezioni prenotate»; **Allunga** o accorcia, **Termina** (D-4).
- **Prossime** per giorno: stato («Confermata», «In lista d'attesa · 4°», «Fissa»), **Disdici** o il motivo per cui non si può; **Esci dalla lista** per chi è in attesa (stessa rotta di Disdici); **Calendario**.
- **Passate**: 30 giorni, chiuse; le lezioni annullate dalla palestra si vedono come tali.
- **Calendario**: un `.ics` da una funzione pura, `src/core/domain/ics.js`; su Android Chrome il link di Google Calendar (`calendar.google.com/calendar/render?action=TEMPLATE`).
- API: `GET /api/member/v1/lezioni?dal&al` (le mie prenotazioni, con lezione, stato, posizione, fissa, motivo della disdetta, termine di disdetta).

### Notifiche
- Ogni riga: l'**origine** (Dalla palestra · Automatica · Dalla lista d'attesa), il tempo relativo («2 ore fa», «ieri»), un'**azione**: «Vedi la lezione», «Disdici», «Altre lezioni di mer 18 nov», «Allunga».
- Tipi: `lezione_annullata` c'è già e prende `lezione_id`; nuovi `posto_offerto` (D-3), `fissa_da_allungare` e `sospensione_riprenotata` (D-4), con `fissa_id`/`lezione_id`. `fissa_senza_abbonamento` non si scrive più (le vecchie restano leggibili).
- In cima, gli avvisi dell'abbonamento come oggi, o «Nessun avviso: abbonamento in regola.»
- Il conteggio della campanella e il banner si ricaricano a ogni `visibilitychange` (oltre che al cambio di pagina). In fondo: «Il portale non manda email né notifiche sul telefono: quello che succede alle tue prenotazioni lo trovi qui e in Home.»

### Altro di D-3
- Un token del socio su `/api/prenotazioni` riceve **403**: il socio passa solo dal portale (un contratto solo).

## D-4 · Fisse con date

### Rotte del portale
| Rotta | Che cosa |
|---|---|
| `GET /corsi/sessioni/:id/fissa/anteprima?al&numero` | `{ dal, al, massimo, lezioni: [{ data, esito }], prenotate, in_attesa }`; `esito` fra `confermata`, `in_attesa`, `gia_prenotata`, `sospesa` |
| `POST /corsi/sessioni/:id/fissa` `{ al }` o `{ numero }` | `creaFissa` di C, con la stessa risposta dell'anteprima |
| `PUT /corsi/fisse/:id` `{ al }` o `{ numero }` | `modificaFissa` (accorcia o allunga) |
| `POST /corsi/fisse/:id/termina` `{ dal }` | `terminaFissa`; senza `dal` vale oggi (K10) |

Escono `POST /corsi/serie/:id/fissa` (senza fine) e `DELETE /corsi/fisse/:id`.

### Regole
- **Massimo**: il minore fra la copertura dell'abbonamento (`fineCopertura`, con le sospensioni) e l'ultima lezione della sessione. Il foglio lo dice: «Al massimo fino al 10 dic: l'ultima lezione coperta dal tuo abbonamento (scade il 15 dic)».
- **Anteprima uguale all'esito**: una funzione sola calcola l'esito lezione per lezione; l'anteprima la chiama senza scrivere, `creaFissa`/`modificaFissa` scrivendo. Il test confronta le due.
- **«Allunga»**: una notifica `fissa_da_allungare` quando il massimo di una fissa attiva supera il suo `al`: al **rinnovo** (vendita di un abbonamento, `routes/entities.js`) e quando la **sessione si allunga** (`POST /api/calendario/eventi/:id/data-fine`). Una volta sola per data di fine: si ricorda in `prenotazioni_fisse.avviso_inviato_per` (la colonna che usava l'avviso tolto). La notifica apre il foglio della fissa **già compilato con il nuovo massimo** («fino al 15 mar 2027»), con l'anteprima: un tocco su «Allunga» basta, e il socio può scegliere un'altra data o un numero di lezioni. Le fisse senza fine che esistono già le chiude la 0062 alla fine dell'abbonamento in corso (dati sintetici): è la risposta ai due punti aperti di «GRIP - fisse dal portale senza data di fine».
- **Sospensione**: le prenotazioni disdette dalla sospensione prendono `motivo_disdetta = 'sospensione'` (`routes/soci.js`). Quando la sospensione finisce prima, le lezioni dei giorni tornati liberi si **riprenotano** (lista d'attesa se piena) e il socio riceve `sospensione_riprenotata`. Si riprenotano **tutte** le disdette con quel motivo, anche quelle fatte a mano (deciso il 14/11), non solo quelle delle fisse come diceva `corsi.md` (M6). Si cambia `applicaFisse`, che oggi salta le lezioni con una prenotazione anche disdetta (corsi.md, «In sospeso» 3).

## Codice: server

| File (`server/src`) | Funzione o rotta | Azione | Pacch. |
|---|---|---|---|
| `routes/member/index.js` | `/accesso`, `/documenti`, `PUT /consensi` con `true`, `documenti` del profilo | Togli | D-1 |
| `routes/member/index.js` | `/palestra` | Aggiungi | D-2 |
| `routes/member/index.js` | `/corsi/agenda` (14 giorni, `sessione_id`, senza `applicaFisse`), `/corsi/catalogo`, `/corsi/miei-orari`, `/lezioni`, notifiche con `lezione_id` e `fissa_id` | Cambia · Aggiungi | D-3 |
| `routes/member/index.js` | le quattro rotte delle fisse | Cambia | D-4 |
| `routes/qr.js`, `lib/qrDinamico.js` | tutto | Togli | D-1 |
| `routes/ingressi.js` | `schedaIngresso`, `verifica` | Cambia: niente documenti né codice | D-1 |
| `routes/iscrizioni.js` | `POST /api/iscrivi` | Cambia: niente certificato né consensi | D-1 |
| `routes/persone.js` | `GET`/`POST /api/persone/:id/consensi` | Togli | D-1 |
| `routes/entities.js`, `entities/registry.js`, `entities/hooks.js` | `MemberDocument`, `QRAccesso`; Course con categoria obbligatoria (400); `consenso_genitori_firmato` in `anagraficaSocio` | Togli · Cambia | D-1 |
| `routes/impostazioni.js` | `GET`/`PUT /api/impostazioni/palestra` | Aggiungi | D-2 |
| `lib/prenotazioni.js` | `prenota` (lista chiusa; da attesa a confermata; conferma di un'offerta), `disdici` (10 minuti; `motivo`), `promuoviFinoACapienza` (offre invece di confermare), `regolaOfferte` | Cambia | D-3 |
| `lib/notifiche.js` | `notifica` con `lezioneId`, `fissaId` | Cambia | D-3 |
| `lib/prenotazioniFisse.js` | esito per lezione condiviso con l'anteprima; `massimoFissa`; `avvisaAllungabili`; `applicaFisse` riprenota le disdette per sospensione; via `soloSenzaFine`, `senzaFine`, l'avviso `fissa_senza_abbonamento` | Cambia | D-4 |
| `routes/soci.js` | sospensione (`motivo_disdetta`), fine anticipata (riprenota e notifica) | Cambia | D-4 |
| `routes/calendario.js` | data-fine: `avvisaAllungabili` al posto di `applicaFisse` | Cambia | D-4 |
| `routes/prenotazioni.js` | preHandler: il socio 403 | Cambia | D-3 |
| `lib/segnali.js`, `lib/avvisi.js`, `routes/dashboard.js` | documenti | Togli | D-1 |

## Codice: client e shared

| File | Cosa | Pacch. |
|---|---|---|
| `src/member/App.jsx`, `MemberLayout.jsx` | rotte, barra a quattro, avatar, menu laterale | D-1 (tagli), D-2 |
| `src/member/pages/MemberDashboard.jsx` | Home nuova | D-2 |
| `src/member/pages/MemberSubscription.jsx`, `MemberProfile.jsx` | come sopra | D-2 |
| `src/member/pages/MemberCoursesCalendar.jsx` e `components/` | `StrisciaGiorni`, `FiltriCategorie`, `CardLezione`, `FoglioLezione`, `ChipOrario`, `FoglioOrario`, `FasceDelGiorno`: sostituiscono `CoursesByCalendar`, `CoursesByCategory`, `CourseSessionsList`, `CourseSessionCard` | D-3 |
| `src/member/pages/MemberLezioni.jsx` | Fisse, Prossime, Passate | D-3 |
| `src/member/pages/MemberNotifiche.jsx` | origine e azione | D-3 |
| `src/member/components/fisse.jsx` | il foglio della fissa con «fino al» / «per N lezioni» e l'anteprima | D-4 |
| `src/member/pages/MemberQR.jsx`, `MemberDocuments.jsx`, `components/ConsensiComunicazioni.jsx` | via | D-1 |
| `src/core/api/portale.js` | rotte nuove, via le tolte | D-1…D-4 |
| `src/core/domain/ics.js` | il file `.ics` | D-3 |
| `src/staff/pages/crm/MemberDetail.jsx` | via QR, Documenti, Consensi; consenso dei genitori | D-1 |
| `src/staff/components/soci/Iscrivi.jsx`, `CampiAnagrafica.jsx` | R2, R4 | D-1 |
| `src/staff/pages/dafare/*`, `components/dafare/SchedaAvviso.jsx`, `pages/Dashboard.jsx` | via Documenti | D-1 |
| `src/staff/pages/admin/ContattiPalestra.jsx` | Contatti | D-2 |
| `shared/corsi.js` | `MARGINE_RIPENSAMENTO_MINUTI`, `ORE_OFFERTA_POSTO`, `chiusuraLista`, `fasciaDelGiorno` | D-3 |

Nessuna libreria nuova: `src/ui` (Card, Button, Dialog, Sheet se c'è, toast, Tabs, StatusBadge, LoadingState, ErrorState, EmptyState). Nessun colore nuovo: i token `primary`, `success`, `warning`, `destructive`, `muted`, `card`, `border`, chiaro e scuro. Le pillole: fondo al 10-14% del colore, testo nel colore pieno; il contrasto si misura (WCAG AA 4,5:1), soprattutto al buio.

## Test

**Da aggiungere (server, uno per regola)**: agenda per intervallo (campi, posti liberi, mio stato, motivi, copertura, 14 giorni, `sessione_id`); catalogo, miei-orari, lezioni, palestra; offerta di 12 ore (conferma, scadenza che manda in fondo e passa al successivo, finestra tagliata alla chiusura); nessuna offerta e nessun nuovo in attesa dopo la chiusura; da attesa a confermata con un posto libero; margine di 10 minuti oltre il termine; token del socio rifiutato su `/api/prenotazioni`; fissa (al, numero, rifiuti oltre il massimo, anteprima uguale all'esito, termina); «Allunga» al rinnovo e all'allungamento, una volta sola; sospensione finita prima che riprenota, con attesa se piena; `PUT /consensi` solo per togliere; Iscrivi senza documenti; consenso dei genitori; `courses.category_id` obbligatoria.
**Client**: `ics.js`, «I tuoi corsi», le fasce del giorno.

Prima di dire finito un pacchetto: `npm run lint`, `npm test`, `cd server && npm test`, i `verifica:*` pertinenti, `npm run build`. Poi a mano a 390 px, in chiaro e in scuro: Prenota → Annulla → Le mie lezioni → Abbonamento. L'`.ics` si prova su un Android vero.

## Dati di prova
`cd server && npm run dati:da-fare` crea i casi di Da fare e li cancella alla fine. Dopo D-1 perde il caso Documenti. Per D-3 e D-4 si aggiunge uno script `dati:portale`: un socio con l'accesso al portale, una fissa con date, una sospensione, una lezione piena con lista d'attesa e una lezione annullata.

## Rischi

| Rischio | Dove | Mitigazione |
|---|---|---|
| Conflitti con Da fare e C | `MemberDetail`, `DaFare`, `member/index.js` | C e Da fare sono già in main: si parte da lì |
| Posti vuoti all'ultimo, lista piena | lista d'attesa | il posto resta prenotabile e la card lo mostra |
| Margine di 10 minuti usato per tenersi posti | `disdici` | solo le proprie prenotazioni; da misurare |
| Fisse senza fine migrate male | 0062 | prova su `grip_locale_prima_0058` e su una copia della produzione |
| Il socio non vede un'offerta | notifiche | banner in Home con Conferma, `visibilitychange`; l'offerta scade e passa al successivo |
| Un'offerta che nessuno conferma tiene un posto vuoto | lista d'attesa | 12 ore al massimo per socio, tagliate alla chiusura |
| `.ics` su Android | `ics.js` | link di Google Calendar |
| Contrasto delle pillole al buio | CSS | misurato sui token |
| File dei documenti cancellati dalla pulizia | `pulisci-file-orfani.js` | continua a leggere `member_documents` |
| Il contratto `v1` | `member/index.js` | vedi «Dove il codice diverge» |

## Dove il codice diverge dall'analisi
1. `lezione_annullata` e `promosso_lista_attesa` si scrivono già (`lib/calendario.js`, `lib/prenotazioni.js`): i tipi davvero nuovi sono due.
2. `organizations.impostazioni` c'è già (le soglie di Da fare): i contatti sono una chiave, non una colonna.
3. La migrazione è la **0062** (la 0061 è `eventi_singoli_allineati`), non la 0061.
4. «Richiedi il rinnovo» è già tolto dal portale (Da fare).
5. Il commento di `routes/member/index.js` promette che dentro `v1` non si toglie una rotta né un campo. Il portale è solo web, rilasciato insieme al server, senza app installate: le rotte tolte da D-1 si tolgono, e il commento si riscrive (confermato il 14/11).
6. Lo stato `confirmed` nel glossario e in `StatusBadge` è **«Confermata»**; i mockup scrivono «Prenotata». Si tiene «Confermata» sulle pillole; «Prenotata: Yoga…» resta il messaggio dopo il tocco (confermato il 14/11).

## Ipotesi
Il dopo dei mockup è HTML con il CSS vero, non i componenti React: spaziature e stati (caricamento, vuoto, errore, offline) si rifanno sui componenti. «Prenotare in meno di 10 secondi» non è misurato. «I tuoi corsi» utile: nessun dato d'uso.
