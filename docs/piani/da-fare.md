# Da fare: piano di sviluppo completo

> **Nel piano unico (11/11/2026)** questo è il ramo **D**, `feature/da-fare-avvisi`, sul database **`grip_dafare`** (vedi `server/.env` del worktree). Si unisce **dopo Soci** e **prima di Corsi**.
> Il piano unico aggiunge queste righe K:
> - **K1**: la migrazione di D è **`0058_avvisi`**. Corsi userà la 0059 e la 0060.
> - **K2, K3**: niente `grip_dev`. Le verifiche nel browser (`verifica:*`, `dati:da-fare`) non le lancia l'agente ma la sessione principale. L'agente lancia `npm test`, `npm run lint` e `cd server && npm test`.
> - **K4**: `server/scripts/dati-da-fare.mjs` e la voce `dati:da-fare` in `server/package.json` **non esistono**. Vanno **creati** (passo 10): un caso per ogni avviso e per ogni modo di chiusura, poi la stampa «Ogni caso è dove deve stare».
> - **K5, K6**: Soci si unisce prima e cambia `MembersList.jsx` (paginazione, `?pagina=&q=&ordine=`) e `MemberDetail.jsx` (:349). D lavora sopra quelle modifiche e cerca le funzioni per nome, non per numero di riga. I codici nuovi (`scaduto` al posto di `scaduto_recuperabile`) devono funzionare in `?segnale=`.
> - **K7**: `verifica-da-fare.mjs` lo riscrive D, ma la sezione «Elenco soci» resta con l'adattamento di Soci (ricerca per nome prima di «Contatta»).
> - **K11**: «Non rinnova» archivia il socio. Che `archivia` chiuda anche le fisse lo fa il ramo Corsi: D non tocca `server/src/routes/soci.js`.
> - **K13**: in `server/src/routes/member/index.js` D toglie solo la richiesta di rinnovo; le fisse (:314, :467-488) sono di Corsi. In `Dashboard.jsx` D cambia le tessere; la riga 133 è di Corsi.
> - **K14**: il glossario (P8) è **già aggiornato su main**; il README si aggiorna alla fine. **Non toccare né `docs/ux/glossario.md` né `README.md`.**
> - **K15**: D ripara anche `server/scripts/verifica-oggi.mjs:125` (`dash.rinnovi`, rotto già oggi) contro le cinque tessere nuove.
> - Il backup di produzione (passo 1) lo fa la sessione principale nella Fase 4. L'agente salta il passo 1.

Nov 4, 2026. Il piano rifà la sezione **Da fare**: cinque avvisi in una barra di schede, un Archivio di quelli chiusi e una scheda Regole. Riferimenti `file:riga` al commit `7db6320a`: se il codice è cambiato, cerca la funzione per nome.

Materiale visivo (deck prima/dopo e video): «Da fare: piano di revisione» (artifact).

## Perimetro

| | Che cosa |
|---|---|
| Dentro | `src/staff/pages/DaFare.jsx`, `src/staff/pages/admin/ImpostazioniDaFare.jsx`, `src/staff/components/segnali/AzioniPersona.jsx`, `src/staff/components/soci/Contatta.jsx`, `DialogoAbbandono.jsx`, la vendita in `MemberDetail.jsx`, il caricamento in `DocumentiSocio.jsx` |
| Dentro: API | `GET /api/segnali`, `POST /api/persone/:id/contatti`, `GET` e `PUT /api/impostazioni/da-fare`, `POST /api/soci/:id/archivia` |
| Dentro: motore | `shared/segnali.js`, `shared/soglie.js`, `shared/avvisi.js`, `server/src/lib/segnali.js`, `server/src/giro.js` |
| Dentro: tabelle | `attivita`, `organizations.impostazioni`, `members`, `persone`, `subscriptions`, `member_documents`, `ingressi` |
| Fuori, toccato solo dalla cascata | tessere della Dashboard, filtro e legenda dell'Elenco soci, diario e `?azione=` della scheda socio, richiesta di rinnovo del portale, permessi del menu |
| Fuori, non toccato | bancone degli Ingressi, sezione Lead, presenze dell'istruttore, seed, migrazioni esistenti |

## Com'è oggi

Una pagina sola con sei «linee» a pillola (Rinnovi, Chi non viene, Nuovi soci, Documenti, Compleanni, Contatti) sotto un riquadro «Entrati oggi». Niente si salva: gli avvisi si ricalcolano dalle date a ogni apertura.

Percorso dei dati:
1. `DaFare.jsx` chiama `GET /api/segnali?da_fare=1` e `?entrati_oggi=1` (`DaFare.jsx:42-44`).
2. La rotta (`server/src/routes/segnali.js:57`) chiama `situazioni()` (`server/src/lib/segnali.js:44`), che legge `persone`, `members`, abbonamenti, `member_documents`, `ingressi`, `bookings` e `attivita`.
3. Ogni persona passa da `segnaliPersona()` (`shared/segnali.js:240`).
4. Il box «Fatto» scrive una riga `contatto` in `attivita` con `riferimento.segnali` (`POST /api/persone/:id/contatti`, `server/src/routes/persone.js:131`): nasconde quel segnale per 7 giorni (`contattoNascondeGiorni`, `shared/segnali.js:388`), poi torna.
5. Le soglie stanno in `organizations.impostazioni` (jsonb), via `/api/impostazioni/da-fare` (`server/src/routes/impostazioni.js:64-73`).

Problemi: l'ordine non segue l'urgenza (`DaFare.jsx:70`); un buco di 120 giorni fra `recuperabileGiorni` (60, `shared/soglie.js:29`) e `archiviazioneGiorni` (180, `:36`; `giro.js:87-92`); «Fatto» non risolve niente; il compleanno vale solo il giorno stesso (`eCompleanno`, `shared/segnali.js:211`); i documenti sono raggruppati per persona (`:341-344`); la stessa persona compare due volte; «Rinnova» e «Carica» fanno uscire da Da fare (`?azione=`, `MemberDetail.jsx:135-141`); fino a 10 pulsanti per riga (`AzioniPersona.jsx:70-98`); le pillole sono diverse dalla barra delle altre sezioni (`DaFare.jsx:114-131`).

## Le decisioni dell'utente (non si cambiano senza un nuovo sì)

Sostituiscono `docs/ux/prompt-migliorie-ux.md:58-61`.

| Tema | Decisione |
|---|---|
| Navigazione | Barra in alto come nelle altre sezioni; le impostazioni sono l'ultima scheda, **Regole** |
| Avvisi che restano | Abbonamenti in scadenza, Abbonamenti scaduti, Frequenza in calo, Documenti in scadenza, Compleanni |
| Avvisi tolti | Contatti (lead), Nuovi soci, «Prenota e non viene», «Documento mancante», «Entrati oggi» |
| Contatti | niente link a telefono, WhatsApp o email in Da fare: solo una finestrella con i recapiti. Per ora solo in Da fare |
| Stato del socio | tolto dalle schede di Da fare |
| Più avvisi | un socio può comparire in più schede |
| Archivio | una sezione generale per gli avvisi chiusi, divisa come la parte principale; contiene anche quelli chiusi da soli |
| «Archivia» | non compare mai come pulsante in Da fare: per l'avviso si dice «Nascondi avviso» |
| Non rinnova | archivia il socio, con il motivo |
| Archiviazione automatica del socio | non la decide Da fare: lo Scaduto chiude solo il proprio avviso dopo N giorni |
| Frequenza | resta su 4 settimane (28 giorni) |
| Dopo «Contattato» | l'avviso della frequenza torna dopo N giorni, scelti nelle Regole |
| Altre soglie (stati dei soci, Lead, bancone) | non stanno in questa sezione |
| Richiesta di rinnovo dal portale | tolta |
| Documenti | un avviso per singolo documento |
| Dati | tutto quello che si toglie si cancella anche dal database |
| Rottura 1 (diario senza mezzo) | B: resta nei rischi |
| Rotture 2 e 3 (menu, link della legenda) | A: corrette nel piano |
| Proposte P1-P8 | tutte incluse |

Proposte: P1 ordine per urgenza · P2 due colonne da 1280 px · P3 «oggi», «domani» e lo scaduto in rosso · P4 etichette corte nella barra · P5 «Copia» nei recapiti · P6 «Ripristina» in Archivio · P7 Regole solo per l'amministratore · P8 glossario (già fatto su main).

## Cosa cambia per chi usa l'app

### La barra
- `SectionTabs.jsx`, con il numero di avvisi aperti: **In scadenza · Scaduti · Frequenza · Documenti · Compleanni · Archivio · Regole**.
- Percorsi: `/da-fare` (In scadenza), `/da-fare/scaduti`, `/da-fare/frequenza`, `/da-fare/documenti`, `/da-fare/compleanni`, `/da-fare/archivio`, `/da-fare/regole`.
- Regole solo con `admin_users` in modifica (P7). `/admin/da-fare` → `/da-fare/regole`; `/oggi` → `/da-fare`.
- A 390 px la barra scorre di lato (P4). Ogni scheda ha un titolo e una frase con le soglie della palestra.

### La scheda di un avviso
- In alto a sinistra **Nome Cognome** e accanto il codice socio in grigio chiaro (`text-muted-foreground/70`).
- Sotto: la frase con la data (21/10/2026) e i giorni («tra 4 giorni», «oggi», «10 giorni fa»). «Oggi», «domani» e lo scaduto in `text-destructive` (P3).
- In alto a destra l'icona dei recapiti: una finestrella con telefono ed email in chiaro, ognuno con «Copia» (P5); un recapito mancante dice «Nessun telefono» o «Nessuna email». Niente link.
- In basso a sinistra le azioni; in basso a destra **Nascondi avviso** (a 390 px «Nascondi», senza icona).
- Niente badge dello stato. Due colonne da 1280 px (`xl:grid-cols-2`, P2).
- Ordine (P1): In scadenza per fine crescente; Scaduti dal più recente; Frequenza da chi entra meno; Documenti per data di scadenza; Compleanni per data.

### I cinque avvisi

| Scheda | Testo | Azioni | Si chiude quando |
|---|---|---|---|
| In scadenza | Abbonamento in scadenza il 04/11/2026 · tra 4 giorni | Rinnova · Non rinnova · Nascondi avviso | rinnovato; socio archiviato; scade e passa in Scaduti; nascosto |
| Scaduti | Abbonamento scaduto il 30/10/2026 · 1 giorno fa | Rinnova · Non rinnova · Nascondi avviso | rinnovato; socio archiviato; dopo N giorni (Regole, 60); nascosto |
| Frequenza | Frequenza media ogni 4 settimane: 8,3 · Entrate nelle ultime 4 settimane: 2 | Contattato · Nascondi avviso | torna a venire; socio archiviato. Dopo Contattato o Nascondi ricompare dopo N giorni (Regole, 30) se è ancora in calo |
| Documenti | Certificato medico in scadenza il 12/11/2026 · tra 12 giorni, oppure scaduto il 21/10/2026 · 10 giorni fa | Carica documento · Nascondi avviso | caricato un documento nuovo dello stesso tipo; socio archiviato; nascosto |
| Compleanni | Compleanno il 03/11 · tra 3 giorni, oppure 2 giorni fa | Auguri fatti · Nascondi avviso | auguri fatti; N giorni dopo (Regole, 3); nascosto |

- **Rinnova** apre la vendita dentro Da fare, già compilata: stesso tipo, dal giorno dopo la fine (dallo stesso giorno, per uno scaduto).
- **Non rinnova** apre «Perché se ne va?» (`DialogoAbbandono`, motivo obbligatorio) e archivia il socio: tutti i suoi avvisi si chiudono.
- **Carica documento** apre il caricamento con il tipo già scelto.
- **Contattato** e **Auguri fatti**: un tocco, una riga nel diario.
- Nella Frequenza entrano gli stessi soci con lo stato «In calo»: nessun ingresso da 14 giorni, oppure meno del 50% della media (`shared/segnali.js:307`).

### Archivio
- Una seconda fila con le stesse cinque voci (`tabs` di `src/ui/primitivi/tabs.jsx`), ognuna con il suo numero.
- Una riga per avviso chiuso: socio e codice, la frase, com'è stato chiuso, chi e quando («In automatico» se l'ha chiuso GRIP). Le 200 più recenti, dalla più nuova.
- Chiusure a mano: Nascosto, Contattato, Auguri fatti. Chiusure da sole: Rinnovato, Passato in Scaduti, Documento caricato, Socio archiviato, Chiuso dopo N giorni, Non più da fare.
- Un avviso **Nascosto** ha «Ripristina»: torna nella sua scheda (P6).

### Regole
Cinque riquadri: interruttore «Segui», la regola in parole che si aggiorna mentre si scrive, i campi numerici. A 390 px «Salva» è una barra fissa in basso.

| Avviso | Campi (predefinito) | Nota |
|---|---|---|
| In scadenza | Avvisa quanti giorni prima della scadenza (14) | vale anche per portale, bancone ed Elenco soci |
| Scaduti | Chiudi l'avviso quanti giorni dopo la scadenza (60) | — |
| Frequenza | Giorni senza ingressi (14) · Sotto la % della media (50) · Media minima, ingressi in 4 settimane (4) · Ricompare dopo quanti giorni (30) | le stesse soglie decidono lo stato «In calo» |
| Documenti | Avvisa quanti giorni prima della scadenza (30) | vale anche per il portale del socio |
| Compleanni | Avvisa quanti giorni prima (3) · Chiudi quanti giorni dopo (3); 0 = il giorno stesso | — |

### Cosa sparisce
- Da Da fare: le linee Contatti e Nuovi soci; «Chiede di rinnovare», «Prenota e non viene», «Documento mancante»; il riquadro «Entrati oggi» (il bancone resta in Soci › Ingressi); il box «Fatto»; i link di contatto; il badge dello stato.
- Dal menu: Impostazioni › Da fare.
- Dal portale soci: il pulsante «Voglio rinnovare» e la sua richiesta.
- Dalla Dashboard: le tessere Contatti e Nuovi soci; restano cinque tessere, una per avviso.

## Quando un avviso si apre e quando si chiude

Un avviso è un'occorrenza precisa (un abbonamento, un documento, un compleanno di un anno) e ha una sola vita: si apre quando il motore lo vede, si chiude a mano o da solo, finisce in Archivio. Le chiusure a mano non si riaprono mai, tranne un «Nascosto» con Ripristina; quelle automatiche si riaprono se l'avviso torna vero (per esempio a fine sospensione). L'In scadenza che scade non torna: si chiude con «Passato in Scaduti» e si apre uno Scaduto con la stessa chiave.

| Avviso | Chiave | Si apre quando | Si chiude da solo (esito) | A mano (esito) |
|---|---|---|---|---|
| In scadenza | id dell'abbonamento | valido, non rinnovato, fine entro `abbonamentoInScadenzaGiorni` | Rinnovato · Passato in Scaduti · Socio archiviato | Nascosto |
| Scaduti | id dell'abbonamento | senza abbonamento, fine da non più di `scadutoGiorni` | Rinnovato · Chiuso dopo N giorni · Socio archiviato | Nascosto |
| Frequenza | giorno di apertura | `assente` o `in_calo` | Non più da fare (torna a venire) · Socio archiviato | Contattato · Nascosto, poi ricompare dopo `frequenzaRiapriGiorni` se ancora in calo |
| Documenti | id del documento | scaduto, o scade entro `documentoInScadenzaGiorni` | Documento caricato · Non più da fare · Socio archiviato | Nascosto |
| Compleanni | anno del compleanno | `compleannoPrimaGiorni` prima del compleanno | Chiuso dopo `compleannoDopoGiorni` · Socio archiviato | Auguri fatti · Nascosto |

### L'allineamento
`allinea()` in `server/src/lib/avvisi.js` lo chiamano `GET /api/avvisi` e il giro notturno, sotto `pg_advisory_xact_lock(hashtext('dafare:avvisi'))`, come `scriviDaFare` (`server/src/giro.js:124`):
1. Calcola gli avvisi di oggi da `situazioni()` con `avvisiDi()` di `shared/daFare.js`.
2. Apre quelli che non hanno una riga (`insert … on conflict do nothing` sull'indice unico).
3. Riapre quelli chiusi da soli che sono tornati veri.
4. Chiude le righe aperte che non sono più vere, con l'esito di `esitoChiusura()`: un abbonamento venduto dopo dà Rinnovato; `members.archiviato_il` dà Socio archiviato; un documento più nuovo dello stesso tipo dà Documento caricato; la fine passata dà Passato in Scaduti; la finestra finita dà Chiuso dopo N giorni; il resto Non più da fare.
5. Per la Frequenza non apre una riga nuova se l'ultima chiusura a mano è più recente di `frequenzaRiapriGiorni`.

Un avviso spento nelle Regole non si calcola: le sue righe aperte restano dove sono e ricompaiono se lo si riaccende.

## Database

Tabella nuova `avvisi` e migrazione **0058** (`server/drizzle/0058_avvisi.sql`, generata con `npm run db:generate` e completata a mano con la pulizia dei dati). La tabella va in `server/src/db/schema/persone.js`, accanto ad `attivita`, ed è esportata da `schema/index.js`.

| Campo | Tipo | A cosa serve |
|---|---|---|
| `id` | uuid, chiave primaria, `defaultRandom()` | — |
| `persona_id` | uuid → `persone.id`, `on delete cascade` | di chi è l'avviso |
| `tipo` | varchar(16), not null | `in_scadenza`, `scaduto`, `frequenza`, `documento`, `compleanno` |
| `chiave` | varchar(64), not null | l'occorrenza: id dell'abbonamento, id del documento, anno del compleanno, giorno d'apertura del calo |
| `aperto_il` | timestamptz, not null, default now | quando è comparso |
| `chiuso_il` | timestamptz, null | null = aperto |
| `esito` | varchar(24), null | com'è stato chiuso |
| `autore_id` | uuid → `staff_accounts.id`, `on delete set null` | chi l'ha chiuso; null = in automatico |
| `autore_nome` | varchar(255), null | il nome, che resta anche se l'account sparisce |
| `dati` | jsonb | istantanea per l'Archivio: data, tipo di abbonamento, nome del documento, la frase |
| indice unico | `(persona_id, tipo, chiave)` | niente doppioni, anche con due allineamenti insieme |
| indice | `(tipo, chiuso_il)` | le letture per scheda e per l'Archivio |

`chiave` non ha chiave esterna di proposito: cancellare un documento o un abbonamento non deve cancellare la riga d'archivio, che ha la sua istantanea in `dati`. Nessun dato da migrare: il primo allineamento apre gli avvisi di oggi.

### I dati che la 0058 cancella o cambia

| Dove | Condizione | Perché |
|---|---|---|
| `attivita` | `tipo = 'richiesta_rinnovo'` | la richiesta dal portale non c'è più |
| `attivita` | `tipo = 'contatto' and esito = 'fatto'` | il box «Fatto»; i contatti del bancone (`salutato`, `proposto_rinnovo`) restano |
| `attivita` | `tipo = 'ingresso_dopo_contatto'` con `riferimento->>'contatto'` fra i «Fatto» cancellati | punterebbero a righe che non esistono |
| `attivita` | `tipo in ('segnale_aperto','segnale_chiuso')` con `esito` fra i codici tolti | il giro non li scrive più; senza pulizia, al primo giro scriverebbe una chiusura per ogni socio |
| `attivita` | `esito = 'scaduto_recuperabile'` diventa `'scaduto'` nelle stesse due tipologie | rinomina: la storia continua |
| `organizations.impostazioni.segnali_spenti` | `scaduto_recuperabile` → `scaduto`; via i codici tolti | chi aveva spento lo scaduto lo ritrova spento |
| `organizations.impostazioni.soglie.segnali` | via `noShowSegnale`, `primoControlloGiorni`, `ingressiAmbientamento`, `ambientamentoGiorni` | soglie di segnali tolti |
| `organizations.impostazioni.soglie` | quattro chiavi nuove: `scadutoGiorni` 60, `frequenzaRiapriGiorni` 30, `compleannoPrimaGiorni` 3, `compleannoDopoGiorni` 3 | nessuna migrazione: valgono i predefiniti di `shared/soglie.js` |

Codici tolti: `rinnovo_richiesto`, `scaduto_recuperabile` (rinominato), `no_show_ripetuti`, `ambientamento_giorno_7`, `ambientamento_pochi_ingressi`, `documento_mancante`, `richiami_oggi`, `da_contattare`, `ultimo_tentativo`, `da_ricontattare`, `conversazioni_ferme`, `da_recuperare`.

## Codice: server e shared

Il motore resta uno, in `shared/segnali.js`. Una sola funzione pura nuova trasforma i segnali in avvisi con la loro chiave, e il server tiene la tabella allineata.

### shared/

| File | Funzione o costante | Azione | Motivo |
|---|---|---|---|
| `shared/daFare.js` (nuovo) e `src/core/domain/daFare.js` (riesporta, come `segnali.js`) | `TIPI_AVVISO`, `avvisiDi(persona, oggi, soglie)`, `esitoChiusura(avviso, persona)`, `ordina(avvisi, tipo)`, `ESITI` | aggiungi | I cinque avvisi come funzioni pure, provate senza database |
| `shared/segnali.js` | `SEGNALI` (:63) | cambia | Restano 7 segnali per lo staff: `in_scadenza`, `scaduto`, `assente`, `in_calo`, `documento_scaduto`, `documento_in_scadenza`, `compleanno`; più quelli del bancone |
| `shared/segnali.js` | scaduto (:316) | cambia | `scaduto_recuperabile` → `scaduto`, con la finestra `scadutoGiorni`. `recuperabileGiorni` resta solo per la continuità di «Nuovo» (:186) |
| `shared/segnali.js` | compleanno (:346) | cambia | Per lo staff da `compleannoPrimaGiorni` prima a `compleannoDopoGiorni` dopo, con la regola del 29 febbraio (:215); per il bancone resta il giorno stesso |
| `shared/segnali.js` | `LINEE` (:99), `lineaDi`, `richiestaRinnovoAperta` (:203), `testoMessaggio` (:405), il ramo staff di `nascondi` (:388), il ramo lead di `segnaliPersona` (:258-265), `no_show_ripetuti` e `ambientamento_*` (:325-331), `documento_mancante` per lo staff | togli | Nessuno li usa dopo il piano |
| `shared/segnali.js` | `esitoPrenotazione` (:135) | resta | La usa `server/src/routes/istruttore.js:18` |
| `shared/soglie.js` | `SOGLIE`, `ZERO_AMMESSO` | cambia | Quattro chiavi nuove; via `noShowSegnale`, `primoControlloGiorni`, `ingressiAmbientamento`, `ambientamentoGiorni`; 0 ammesso per le due dei compleanni |
| `shared/permissions.js` | `SIDEBAR_PERMISSIONS` (:193, :200) | cambia | `"/da-fare": "crm_members"`; via `"/admin/da-fare"` (rottura 2) |

### server/

| File | Funzione o rotta | Azione | Motivo |
|---|---|---|---|
| `server/src/db/schema/persone.js`, `schema/index.js` | `avvisi` | aggiungi | La tabella |
| `server/drizzle/0058_avvisi.sql` | — | aggiungi | Tabella e pulizia dei dati |
| `server/src/lib/avvisi.js` (nuovo) | `allinea(conn, persone, oggi, soglie)`, `leggi({ vista, tipo })`, `chiudi(id, esito, utente)`, `ripristina(id, utente)` | aggiungi | Sotto `pg_advisory_xact_lock(hashtext('dafare:avvisi'))` |
| `server/src/routes/avvisi.js` (nuovo), registrata in `server/src/app.js` | `GET /api/avvisi`, `POST /api/avvisi/:id/chiudi`, `POST /api/avvisi/:id/ripristina` | aggiungi | Lettura: `crm_members` in lettura. Scrittura: `crm_members` in modifica. Il socio (`member`) mai |
| `server/src/lib/segnali.js` | la query `richiesta` (:91), la query delle prenotazioni per i no-show | togli | Segnali tolti |
| `server/src/routes/segnali.js` | i parametri `da_fare` ed `entrati_oggi` (:77-81) | togli | `fase`, `segnale`, `persona` restano per l'Elenco e la scheda |
| `server/src/routes/dashboard.js` | `lineeDaFare` (:76-87) | cambia | Conta gli avvisi aperti per tipo, gli stessi numeri della barra |
| `server/src/routes/member/index.js` | `POST /abbonamento/richiesta-rinnovo` (:202), i campi `richiesta_rinnovo` e `rinnovo_proponibile` (:189-190), `richiestaRinnovoDi` (:577) | togli | Richiesta dal portale tolta |
| `server/src/giro.js` | chiamata ad `allinea()`; l'eccezione `rinnovo_richiesto` (:93) | aggiungi · togli | Le chiusure automatiche vanno in Archivio anche se nessuno apre Da fare |
| `server/src/routes/persone.js` | `POST /api/persone/:id/contatti` (:131) | resta | La usa il bancone (`SegnaliBancone.jsx:27`) |

### Il contratto delle rotte nuove
- `GET /api/avvisi?vista=aperti|archivio&tipo=<tipo>` → `{ oggi, soglie, conteggi: { in_scadenza, scaduto, frequenza, documento, compleanno }, avvisi: [{ id, tipo, chiave, persona_id, socio_id, nome, codice_socio, telefono, email, dati, aperto_il, chiuso_il, esito, autore_nome }] }`. Prima di leggere chiama `allinea()`. In archivio: le 200 più recenti per `chiuso_il`.
- `POST /api/avvisi/:id/chiudi { esito }` con `esito` fra `nascosto`, `contattato`, `auguri_fatti` → `{ avviso }`. 400 se è già chiuso o se l'esito non vale per il tipo (`contattato` solo per la frequenza, `auguri_fatti` solo per i compleanni). `contattato` e `auguri_fatti` scrivono anche una riga `contatto` in `attivita` con `riferimento: { segnali, avviso }`, così i rientri del giro (`giro.js:59-75`) continuano a contarli.
- `POST /api/avvisi/:id/ripristina` → `{ avviso }`. Solo per `esito = 'nascosto'`: rimette a null `chiuso_il`, `esito` e l'autore.
- Rinnova, Non rinnova e Carica documento **non** passano da queste rotte: usano quelle di oggi (vendita, `POST /api/soci/:id/archivia`, caricamento). L'allineamento successivo chiude l'avviso con l'esito giusto.

## Codice: client

### La sezione Da fare

| File | Componente | Azione | Sostituisce |
|---|---|---|---|
| `src/staff/App.jsx` (:59-61, :97) | rotte `/da-fare/*` sotto un `DaFareLayout`; `/admin/da-fare` → `/da-fare/regole`; permesso della rotta solo `crm_members` | cambia | — |
| `src/staff/components/SectionTabs.jsx` | `tabs[].conta`: un numero accanto all'etichetta (facoltativo) | aggiungi | — |
| `src/staff/pages/dafare/DaFareLayout.jsx` | barra e conteggi, sullo schema di `src/staff/pages/crm/CrmLayout.jsx`; passa i dati con il contesto dell'`Outlet` | aggiungi | — |
| `src/staff/pages/dafare/ElencoAvvisi.jsx` | le cinque schede, una prop `tipo` | aggiungi | `src/staff/pages/DaFare.jsx` |
| `src/staff/components/dafare/SchedaAvviso.jsx` | la scheda dell'avviso | aggiungi | `src/staff/components/segnali/AzioniPersona.jsx` |
| `src/staff/pages/dafare/ArchivioAvvisi.jsx` | l'archivio con la seconda fila | aggiungi | — |
| `src/staff/pages/dafare/Regole.jsx` | le regole; visibile con `canEdit(ruolo, "admin_users")` | aggiungi | `src/staff/pages/admin/ImpostazioniDaFare.jsx` |
| `src/staff/components/AppLayout.jsx` (:37) | la voce Impostazioni › Da fare | togli | — |
| `src/core/api/client.js` | `api.avvisi.lista({ vista, tipo })`, `api.avvisi.chiudi(id, esito)`, `api.avvisi.ripristina(id)` | aggiungi | — |

### Fuori dalla sezione

| File | Componente | Azione | Motivo |
|---|---|---|---|
| `src/staff/components/soci/Contatta.jsx` | prop `soloRecapiti`: telefono ed email in testo, «Copia» con `navigator.clipboard`, nessun link | cambia | L'Elenco soci continua a usarla con i link |
| `src/staff/components/soci/DialogoVendita.jsx` | «Vendi un abbonamento», estratta da `MemberDetail.jsx:157-192` e `:561-585` | aggiungi | Rinnova in Da fare; la scheda usa la stessa |
| `src/staff/components/soci/DialogoCaricaDocumento.jsx` | «Carica», estratta da `DocumentiSocio.jsx:154-180` e `:307-335`, con il tipo già scelto | aggiungi | Carica documento in Da fare; la scheda usa la stessa |
| `src/staff/components/soci/DialogoAbbandono.jsx` | — | resta | Non rinnova lo usa com'è |
| `src/staff/pages/crm/MemberDetail.jsx` (:135-141) | il parametro `?azione=rinnova\|documenti` | togli | — |
| `src/staff/pages/crm/MembersList.jsx` (:94) | il link della legenda: «Le soglie di «In calo» si cambiano nelle Regole di Da fare», verso `/da-fare/regole`, solo per l'amministratore | cambia | Rottura 3 |
| `src/staff/pages/Dashboard.jsx` (:88-94) | cinque tessere, ognuna verso `/da-fare/<scheda>` | cambia | Le linee non ci sono più |
| `src/core/api/portale.js` (:34) | `richiediRinnovo` | togli | Richiesta dal portale tolta |
| `src/member/pages/MemberSubscription.jsx` (:17, :82) | `RichiestaRinnovo` e il blocco che la mostra | togli | Richiesta dal portale tolta |

Si usano i componenti di `src/ui/` che ci sono già (`Card`, `Button`, `Dialog`, `tabs`, `Input`, `Checkbox`, `LoadingState`, `EmptyState`, `ErrorState`, `useToast`): nessuna libreria nuova.

## Test

`npm test` nella radice (i moduli di `src/core`, `shared/` compreso) e `cd server && npm test` (con PostgreSQL).

| File | Azione | Cosa deve provare |
|---|---|---|
| `src/core/domain/daFare.test.js` | aggiungi | un avviso per documento con la sua chiave; il compleanno a cavallo d'anno (31/12 con la finestra in gennaio) e il 29 febbraio negli anni non bisestili; lo scaduto che esce dopo `scadutoGiorni`; la finestra del compleanno con 0 prima e 0 dopo; l'ordine di ogni scheda; ogni esito di chiusura |
| `src/core/domain/segnali.test.js` | cambia | via i casi dei segnali tolti (:35, :121, :157-173, :210-214); lo scaduto con `scadutoGiorni` (:69-72); `soglieDi` senza `noShowSegnale` (:149) |
| `src/core/domain/sospensioni.test.js` | cambia | via `richiestaRinnovoAperta` e `rinnovo_richiesto` (:96-109) |
| `server/test/da-fare.test.js` | riscrivi | `GET /api/avvisi` e i permessi (reception sì, istruttore no, socio no); chiudi e ripristina; Rinnova dà «Rinnovato»; Non rinnova chiude tutti gli avvisi del socio; l'abbonamento che scade dà «Passato in Scaduti» e apre lo Scaduto; Contattato ricompare dopo `frequenzaRiapriGiorni` solo se ancora in calo; due allineamenti insieme non scrivono doppio; le Regole nuove si salvano e il registro delle azioni lo dice; il giro senza l'eccezione della richiesta |
| `server/test/richiesta-rinnovo.test.js` | cancella | e le sue parti in `server/test/api-member.test.js` |
| `server/test/segnali.test.js` | cambia | via `?da_fare=1` (:33, :204) e i no-show (:160, :172) |
| `server/test/dashboard.test.js` | cambia | cinque tessere al posto di sei (:63-71), nessuna «contatti» (:90) |
| `server/test/rientri.test.js` | cambia | via `entrati_oggi` (:61); un Contattato sulla frequenza conta come contatto per chi poi rientra |
| `server/test/permessi-lettura.test.js` o accanto | aggiungi | un ruolo con i soli Lead non ha Da fare nel menu (rottura 2) |
| `server/scripts/dati-da-fare.mjs` (**da creare**, K4), `server/scripts/verifica-da-fare.mjs` | aggiungi · cambia | un caso per ogni avviso e per ogni modo di chiusura; la verifica nel browser sulle schede nuove |

Criterio di chiusura: le due suite verdi, `npm run dati:da-fare` che dice «Ogni caso è dove deve stare», `npm run verifica:da-fare` verde (questi due li lancia la sessione principale).

## Ordine di implementazione (pacchetti del piano unico)

- **D-1 (passi 2-4)**: 2. Soglie: in `shared/soglie.js` aggiungi le quattro chiavi, togli le quattro vecchie. 3. Motore: in `shared/segnali.js` rinomina lo scaduto, allarga il compleanno per lo staff, togli segnali, linee e funzioni morte; aggiorna `segnali.test.js` e `sospensioni.test.js`. 4. Avvisi puri: `shared/daFare.js` e `daFare.test.js`. Controllo: `npm test`. *Attenzione: togliere `LINEE` e simili rompe il client di oggi (`DaFare.jsx`, `AzioniPersona.jsx`, Dashboard) finché D-3 non li sostituisce. Il lint e `npm test` devono restare verdi: se un import si rompe, D-1 lascia temporaneamente le esportazioni usate dal client vecchio e lo scrive nel resoconto.*
- **D-2 (passi 5-6)**: 5. Database: `avvisi` nello schema, `npm run db:generate` (deve uscire **0058**), si completa con la pulizia, `npm run db:migrate` su `grip_dafare`. 6. Server: `lib/avvisi.js`, `routes/avvisi.js`, la registrazione in `app.js`; poi `lib/segnali.js`, `routes/segnali.js`, `routes/dashboard.js`, `giro.js`, il portale in `routes/member/index.js` (solo la richiesta di rinnovo); i permessi in `shared/permissions.js`. I test del server riscritti. Controllo: `cd server && npm test`.
- **D-3 (passi 7-8)**, dopo il ribase su main con Soci: 7. `DialogoVendita.jsx` e `DialogoCaricaDocumento.jsx`, usati da `MemberDetail.jsx` e `DocumentiSocio.jsx`; `Contatta.jsx` con `soloRecapiti`. 8. `SectionTabs` con `conta`, `DaFareLayout`, `ElencoAvvisi`, `SchedaAvviso`, `ArchivioAvvisi`, `Regole`; le rotte in `App.jsx`; via la voce del menu e i tre file vecchi.
- **D-4 (passi 9-10)**: 9. Dashboard, legenda dell'Elenco soci, `?azione=` della scheda, portale. `npx vite build` senza errori. 10. Crea `dati-da-fare.mjs` e la voce npm (K4); aggiorna `verifica-da-fare.mjs` (K7); ripara `verifica-oggi.mjs:125` (K15). Niente glossario né README.

## Dipendenze (la cascata)

**Si rompono**

| Collegamento | Dove | Esito |
|---|---|---|
| Riga di diario di Contattato e Auguri fatti, scritta senza mezzo («Fatto: · Non viene da un po'») | `shared/lead.js:474-477`, `:313`; `src/staff/components/soci/DiarioSocio.jsx:19-22` | scelta B: nei rischi |
| Voce del menu per un ruolo con i soli Lead («Accesso negato») | `shared/permissions.js:193`; `AppLayout.jsx:78` | scelta A: corretta |
| Link della legenda degli stati | `MembersList.jsx:94` | scelta A: corretta |

**Da adattare**: tessere della Dashboard (`server/src/routes/dashboard.js:76-87`; `Dashboard.jsx:88`); filtro «Da fare» dell'Elenco soci, con meno voci (`MembersList.jsx:118`, `:201`); portale, abbonamento e richiesta (`server/src/routes/member/index.js:166-210`; `MemberSubscription.jsx:82`); `?azione=` (`MemberDetail.jsx:135-141`); script `verifica-da-fare.mjs`.

**Non toccati**: rientri dopo un contatto (`giro.js:59-75`); segnali del bancone (`ingressi.js:84`; `SegnaliBancone.jsx:27`); presenze dell'istruttore (`istruttore.js:18`); validazione delle Regole (`impostazioni.js:79`, `CODICI_SEGNALE` si restringe da solo); diario dei segnali del giro (`giro.js:118-155`); avvisi del portale (`shared/avvisi.js:59`, `:67`); sezione Lead (`shared/lead.js:406-441`); seed e migrazioni esistenti.

## Rischi

| Rischio | Dove | Mitigazione |
|---|---|---|
| La 0058 cancella dati anche in produzione | `0058_avvisi.sql`, `npm run db:deploy` | confermare che la produzione è sintetica; backup prima del deploy; prova generale (Fase 4) |
| Diario «Fatto: » senza mezzo dopo Contattato e Auguri fatti (rottura 1, scelta B) | `shared/lead.js:474-477` | (se l'utente lo decide) due esiti nuovi in `ESITI_CONTATTO` (`shared/lead.js:278`) e un caso senza canale in `descriviAttivita` |
| Soglie senza pagina (stati dei soci, Lead, bancone, archiviazione) | `shared/soglie.js` | restano col valore salvato |
| Leggere Da fare scrive nel database | `server/src/lib/avvisi.js` | blocco come quello del giro; se pesa, allineamento solo nel giro |
| Elenco soci e Da fare contano diverso | `MembersList.jsx:201` | accettato |
| Socio da meno di 12 settimane: media 0 | `server/src/lib/segnali.js:159` | «—» sotto le 12 settimane (da decidere) |
| Certificato cancellato: esce da Da fare | `shared/avvisi.js:101` | resta segnalato nella scheda e nel portale |
| I vecchi «Fatto» degli ultimi 7 giorni non nascondono più niente | `attivita` | avvisare la reception |
| Archivio senza paginazione | `GET /api/avvisi?vista=archivio` | le 200 più recenti |

Ipotesi: la tabella `avvisi` e l'allineamento in lettura funzionano come descritto; il costo dell'allineamento a ogni lettura è trascurabile a questa scala; i predefiniti nuovi (60, 30, 3, 3) sono proposti, non decisi dall'utente.
