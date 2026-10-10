# GRIP CRM nativo — piano di fondazione

## Context

GRIP sarà riprogettato come **multi-tenant con un'app unica** per tutte le palestre. È il momento di gettare le basi del CRM, **non di lanciarlo**: il codice arriva in produzione spento, e ogni palestra lo configura e lo accende dall'ERP.

Obiettivo: un CRM più semplice, più automatico e più efficiente di Glofox, Sportclubby e di ciò che si costruisce su Salesforce. Non un modulo in più, ma **un livello nativo** che attraversa ingressi, calendario, abbonamenti, documenti e portale.

Paletti decisi:
- niente Meta API (WhatsApp solo come link `wa.me` aperto a mano dallo staff);
- **niente pagamenti**: l'incasso resta in reception;
- canali in uscita: push (app), email, SMS se c'è il telefono;
- **tutto spento al primo deploy**;
- si parte dalla **retention**.

### Tesi di prodotto (quello che i miei ex datori di lavoro non hanno fatto)
1. **Una persona, una storia.** Lead, socio ed ex socio sono la stessa persona, con un diario solo. Glofox li tiene separati e perde la storia alla conversione, e oggi GRIP fa lo stesso.
2. **Un solo motore di "segnali"** che decide chi va seguito e perché. Alimenta tutto: la lista Oggi, la dashboard, il bancone, il portale, le automazioni.
3. **Il CRM vive al bancone.** Il momento migliore per un rinnovo o un recupero è quando il socio passa il QR, non una campagna email. Nessun concorrente lo sfrutta.
4. **Playbook pronti, non un costruttore di workflow.** I flow builder generici non li configura nessun titolare.
5. **Prova di efficacia**: "dei 40 soci contattati, 26 sono tornati entro 14 giorni".

---

## A. Revisione dell'esistente: cosa cambiare e perché

| # | Oggi | Problema | Cambio |
|---|---|---|---|
| A1 | `leads` e `members` sono tabelle separate; la trasformazione **cancella il lead** e il suo diario (`routes/lead.js` `trasforma`, `lead_attivita` ON DELETE CASCADE) | Storia persa. Un ex socio che richiama diventa uno sconosciuto. Doppioni invisibili | **Modello Persona** (sezione B) |
| A2 | `members.lead_canale_id` / `lead_data_contatto` + `GET /andamento` che unisce lead e soci | L'attribuzione regge un solo ingresso per persona: un ex socio che ritorna non si conta | **Trattative** multiple per persona; Andamento letto da lì |
| A3 | Quattro motori di "attenzione": `dashboard.js rinnovi()`, `avvisiCertificati()`, `ingressi/statistiche rischio`, `shared/avvisi.js`, `condizioniLead` | Regole e soglie duplicate e divergenti | **`shared/segnali.js`** unico (sezione C) |
| A4 | Soglie sparse: `SOGLIE_LEAD`, `GIORNI_ABBONAMENTO_IN_SCADENZA=14` (portale 7), `GIORNI_RISCHIO_ABBANDONO=14` | Non configurabili e incoerenti | **`shared/soglie.js`**: valori predefiniti, più quelli della palestra in `impostazioni` |
| A5 | `GET /api/lead/lavoro` **scrive** (chiude i non raggiungibili) e restituisce tutti i lead, chiusi compresi, senza limite | Una GET con effetti collaterali; con tante palestre e anni di dati il carico cresce senza fine | Chiusura spostata nel giro di manutenzione (C3); lista paginata, chiusi su richiesta |
| A6 | Nuovo lead: obbligatori nome, **cognome, sesso**, data, canale | Più campi obbligatori significa meno lead registrati, perché al telefono o su Instagram spesso c'è solo un nome | Obbligatori: **nome + (telefono o email) + canale**. Il resto è facoltativo; Andamento ha già la voce "nd" |
| A7 | Nota lead di 140 caratteri, `members.notes` testo libero | Due concetti per la stessa cosa, nessuna storia | Una nota diventa una riga del diario; una **nota in evidenza** sulla persona |
| A8 | Telefono ed email senza normalizzazione né controllo | wa.me, SMS e ricerca dei doppioni non funzionano | `normalizzaTelefono()` (E.164) ed email trim/lowercase in `shared/anagrafica.js`, con migrazione dei dati esistenti |
| A9 | `MembersList.jsx` scarica **tutti** i soci e **tutti** gli abbonamenti e incrocia nel browser; le tile mostrano telefono ed email | Non scala sul multi-tenant e mostra dati, non priorità | Elenco intelligente lato server (D2) |
| A10 | `MemberDetail.jsx`: griglia di card, nessuna azione rapida, nessuna storia | La scheda è un archivio, non un posto di lavoro | **Scheda 360** (D3) |
| A11 | `bookings` senza presenza: prenotato non vuol dire venuto | Manca il segnale più forte, il no-show | **Presenza calcolata**: ingresso del socio nella finestra della lezione (C4) |
| A12 | Nessun responsabile del lead | Non esiste "i miei contatti", né una misura per operatore | `assegnato_a` sulla trattativa |
| A13 | L'interesse del lead sta solo nella nota ("chiede del corso bimbi") | Non si analizza e non si personalizza | `interesse_categoria_id` → `categories` |
| A14 | Trasformazione: solo anagrafica, poi abbonamento, documenti e accesso a mano in tre punti | Molti clic in reception | **Flusso "Iscrivi"** unico (D4) |
| A15 | `canali_contatto.nome` unico a livello globale | Con il multi-tenant una palestra blocca le altre | Unicità per `(palestra_id, nome)`; vale per **ogni** UNIQUE di dominio |

---

## B. Modello dati nativo (da fare insieme al refactoring multi-tenant)

Ogni tabella ha `palestra_id`. L'**account** dell'app unica è globale; la **persona** è per palestra, perché ogni palestra è titolare dei propri dati.

```
account (globale)            login dell'app unica, push token
  └─ persone (per palestra)  anagrafica di contatto: nome, cognome?, telefono_e164, email, sesso?,
       │                     nascita?, nota_in_evidenza, account_id?, creato_il
       ├─ soci (1:1, facoltativo)    codice_socio, codice_fiscale, archiviato_il, …  (= l'attuale members)
       ├─ trattative (N)             canale_id, data_contatto, stato, tentativi…, richiamare_il,
       │                             assegnato_a, interesse_categoria_id, esito (aperta|vinta|persa),
       │                             motivo, chiusa_il   (= l'attuale leads, senza anagrafica)
       ├─ attivita (N)               il diario unico (= lead_attivita estesa)
       ├─ consensi (N)               registro: tipo, valore, fonte, quando
       └─ messaggi (N)               la coda in uscita (sezione E)
```

- **Lead = persona con una trattativa aperta e senza socio.** Socio = persona con `soci`. Ex socio = `soci.archiviato_il` valorizzato, oppure nessun abbonamento valido da più di N giorni.
- **Trasformazione**: la trattativa diventa `vinta`; nasce `soci`, oppure si **riattiva** quello esistente se è un ex socio. Il diario resta dov'è.
- **Persona che ritorna**: nuova trattativa sulla stessa persona. Andamento la conta come "riconquista", separata dai nuovi.
- **Doppioni**: indice UNIQUE parziale su `(palestra_id, telefono_e164)` più un controllo morbido sull'email. Al momento dell'inserimento compare "Questo numero è di Mario Rossi, ex socio fino a 03/2026: apri".
- Abbonamenti, documenti, ingressi, prenotazioni e QR puntano a `soci`. **Prenotazioni di prova** (fase acquisizione): `bookings.persona_id` con `prova = true`; lo schema lo prevede subito, si usa dopo.
- `attivita.tipo` è un elenco chiuso in `shared/`:
  - `nota`, `tentativo`, `risposta`, `richiamo`, `chiusura`, `riapertura`, `stato_automatico`;
  - `messaggio`, `richiesta_rinnovo`, `ingresso_dopo_contatto`, `sondaggio`;
  - (Fase 2) `contatto` — un contatto con un socio, con `canale` ed `esito`: `risposto`, `nessuna_risposta`, `proposto_rinnovo`, `salutato` (la proposta di rinnovo è un esito, non un tipo a sé) — e `rimando`, con `esito` = il giorno fino a cui i segnali tacciono;
  - (Fase 3) `sospensione` (`esito` = "dal/al") e `fine_sospensione`, `abbandono` (`esito` = il motivo, `MOTIVI_ABBANDONO`), `riattivazione`, `nota_istruttore`. Il contatto registra in `riferimento` i segnali da fare in quel momento (`{ segnali }`, li scrive il server); `ingresso_dopo_contatto` il contatto e l'ingresso (`{ contatto, ingresso }`, una riga per contatto).

  Ogni riga ha `autore` (null = sistema) e un `riferimento` jsonb (id del messaggio, della trattativa, dell'abbonamento).
- Migrazione dall'esistente:
  - ogni `member` → persona + `soci` (stesso id, per toccare meno codice);
  - ogni `lead` → persona + trattativa aperta, con `lead_attivita` → `attivita`;
  - i soci con `lead_canale_id` → trattativa `vinta` sintetica;
  - poi si eliminano `members.lead_*` e `leads`.

---

## C. Il motore dei segnali (il cuore)

### C1. `shared/segnali.js`: funzioni pure, testate con `node --test`
`segnaliPersona({ socio, trattativa, iscrizioni, documenti, ingressi, noShow, contatti, oggi, soglie })` restituisce `{ fase, segnali, copertura }`, con i segnali come `{ codice, titolo, priorita, motivo, azioni, pubblico: staff|socio|bancone, nascostoFino, dati }`.

Fatto nella Fase 2, con due scelte diverse dal disegno iniziale:
- il motore riceve **aggregati**, non righe: `ingressi = { ultimo, quattro, dodici, totale }` (null se la palestra non registra ingressi: senza, tutti sembrerebbero assenti), `noShow` (contato con `esitoPrenotazione`), `contatti = { ultimo, rimandatoAl }` dal diario. Li prepara `server/src/lib/segnali.js` con poche query;
- il contatto nasconde i segnali del socio per `contattoNascondeGiorni` (7); quelli del lead li nasconde solo il rimando, perché il contatto con un lead ne cambia già lo stato. Al bancone il saluto vale per il giorno, il rinnovo proposto come un contatto.
- Assorbe `avvisiSocio` (che resta come vista "pubblico socio"), `condizioniLead`, i rinnovi e i certificati della dashboard, il rischio degli ingressi.
- **Fase del ciclo di vita**, calcolata e mai salvata:
  - `lead`;
  - `nuovo` (0–30 giorni);
  - `ambientamento` (31–90 giorni, la finestra in cui si perdono più soci);
  - `attivo`;
  - `in_calo` (ingressi delle ultime 4 settimane sotto il 50% della media delle 12);
  - `assente` (14 giorni o più);
  - `in_scadenza`;
  - `scaduto_recuperabile` (fino a 60 giorni);
  - `ex_socio`.
- **Rischio spiegato**: ogni segnale porta il suo motivo in chiaro ("3 ingressi in 4 settimane contro 9 di media · scade tra 9 giorni · 2 no-show"). `ponytail:` regole esplicite; un modello statistico solo quando ci saranno dati da più palestre.
- **Un contatto registrato nasconde il segnale** per N giorni (`nascostoFino` calcolato da `attivita`): niente tabella di compiti da tenere allineata.
- Segnali principali:
  - `rinnovo_richiesto` (dal portale), `in_scadenza`, `scaduto_recuperabile`, `assente`, `in_calo`, `no_show_ripetuti`;
  - `ambientamento_giorno_7`, `ambientamento_pochi_ingressi`;
  - `certificato_*`, `compleanno`, `traguardo` (50°/100° ingresso);
  - per i lead: tutti i filtri attuali (`da_contattare`, `richiami_oggi`, …).

### C2. Un endpoint, molti consumatori
`GET /api/segnali?persona=|fase=|segnale=|assegnato=` calcola in blocco per la palestra: query aggregate (ultimo ingresso, conteggi a 4 e 12 settimane, ultima attività), poi `segnaliPersona` in memoria. `ponytail:` calcolo in memoria per palestra, che regge migliaia di persone; vista materializzata solo se le misure lo chiedono.

Consumatori:
- **Oggi**;
- dashboard (sostituisce `rinnovi()` e `avvisiCertificati()`);
- statistiche degli ingressi (sostituisce `rischio`);
- portale (pubblico socio);
- **bancone**;
- liste salvate;
- playbook.

### C3. Il giro quotidiano, in due parti
`server/src/giro.js`, lanciato da Railway Cron, scorre i tenant.
- **Manutenzione**, sempre attiva perché non invia nulla: chiusura dei lead non raggiungibili (spostata dalla GET, A5), registrazione di `ingresso_dopo_contatto` per misurare l'efficacia.
- **Invii**, dietro le tre serrature della sezione F.

### C4. Presenza alle lezioni senza lavoro in più
Una prenotazione `confirmed` con un ingresso del socio nella finestra (da 60 minuti prima dell'inizio alla fine) è **presente**; senza ingresso, a lezione finita, è **no-show**. Calcolato, mai salvato. Diventa un segnale ed è la base della vista istruttore.

---

## D. Frontend: da archivio a posto di lavoro

- **D1. `/oggi`, prima voce del menu staff.**
  - Righe ordinate per valore: rinnovo richiesto > scaduto recuperabile > in scadenza > assente > in calo > lead da contattare o richiamare > ambientamento > compleanni.
  - Ogni riga ha pulsanti in linea: `tel:`, `wa.me` (con testo da modello), email, "fatto con esito", "rimanda".
  - Filtro "i miei". Funziona da **telefono** (lo staff chiama dal cellulare). Aggiornamento in tempo reale via SSE, così due reception non chiamano la stessa persona.
- **D2. Elenco persone intelligente** (sostituisce `MembersList` e `Contatti` come elenchi separati, mantenendo le due viste):
  - filtri lato server per fase e segnale, salvati nell'URL come oggi la `vista` dei lead, e **liste salvate**;
  - colonne: fase, ultimo ingresso, frequenza a 4 settimane, scadenza, segnale principale;
  - azioni multiple: assegna, esporta CSV, e invia messaggio quando il CRM è acceso.
- **D3. Scheda 360** (`MemberDetail`):
  - intestazione con fase, segnali, nota in evidenza e azioni rapide (chiama, WhatsApp, email, registra contatto, nota);
  - **diario** a sinistra con tutto: contatti, messaggi, ingressi, prenotazioni e no-show, abbonamenti, documenti, consensi;
  - schede a destra (anagrafica, abbonamenti, documenti, fisse, accesso).
  - È la stessa scheda per un lead: le parti da socio compaiono solo se esiste `soci`.
- **D4. Flusso "Iscrivi"** in un'unica finestra a passi, da lead o da persona entrata direttamente:
  1. anagrafica (precompilata);
  2. abbonamento (riusa `dataFineAbbonamento`);
  3. certificato (foto o file);
  4. consenso privacy;
  5. credenziali del portale.

  Una transazione. Ingresso rapido del lead in una riga, con controllo doppioni in tempo reale.
- **D5. Il bancone diventa CRM** (ingressi, `routes/ingressi.js` verifica):
  - oltre al semaforo, i segnali con `pubblico: bancone`: "scade tra 3 giorni: proponi il rinnovo", "bentornato, non veniva da 20 giorni", "oggi compie gli anni", "50° ingresso!";
  - un tocco registra `proposta_rinnovo` o "salutato" nel diario.
- **D6. Ricerca globale Ctrl+K**: nome, telefono, CF o codice → scheda. È il gesto più frequente della reception.
- **D7. Vista istruttore**, con accesso leggero: le sue lezioni, presenti e no-show, assenti ricorrenti, nota nel diario.
  Fatta nella Fase 3 ("Le mie lezioni", `/istruttore`): `staff_accounts.instructor_id` collega l'account all'istruttore, il modulo `lezioni_istruttore` la apre. Vede solo chi è prenotato alle sue lezioni (ultime 12 settimane e future), e del diario solo le note degli istruttori.

---

## E. Canali e messaggi (costruiti ora, spenti)

### Il multi-tenant cambia la scelta dello scheduler
Sì. Con più palestre il giro alla lettura non regge: una palestra chiusa la domenica non apre GRIP, e quel giorno non parte nulla. Serve il giro programmato (C3), con idempotenza tramite `chiave` UNIQUE `(palestra, regola, destinatario, riferimento)`.

### Servono servizi terzi?
| Canale | Senza terzi? | Costo | Note |
|---|---|---|---|
| In-app (`notifiche`, esiste già) | Sì | 0 | Solo per chi apre l'app |
| Push app / Web Push | FCM/APNs gratuiti; Web Push con chiavi VAPID proprie | 0 | **Canale primario** con l'app unica |
| `wa.me`, `tel:`, `mailto:` | Sì, sono link | 0 | Li usa una persona dello staff; esito nel diario |
| Email | Un proprio server SMTP sui IP Railway finisce in spam. Si usa **(a) la casella della palestra** via SMTP (costo 0, mittente vero, limite circa 500 al giorno) oppure **(b) un relay** (Amazon SES o Brevo) | 0 – pochi € | Scelta per tenant |
| SMS | No, serve un operatore (Skebby, Aruba, Brevo). I gateway da SIM violano i termini degli operatori e le regole AGCOM | circa 4–6 cent | Solo dove rende, con budget mensile e tetto rigido |

Ordine di invio: push → email → SMS, solo se la regola lo prevede e c'è budget.

### Strutture
- `messaggi`: palestra, persona, canale, modello, testo, `chiave` UNIQUE, costo, id del fornitore, data, e `stato`:
  - `simulato`, `in_coda`, `inviato`, `consegnato`, `fallito`;
  - `bloccato_consenso`, `bloccato_budget`, `bloccato_silenzio`.

  Ogni invio scrive `attivita`.
- `modelli_messaggio` per tenant con segnaposto; i testi predefiniti stanno in `shared/`.
- Adattatori: `lib/canali/{email,sms,push,finto}.js`.
- `notifica()` in `lib/notifiche.js` diventa il **solo punto d'ingresso**: in-app sempre, gli altri canali solo se accesi. "Lezione annullata" e "promosso dalla lista d'attesa" partono subito, nella transazione.

### Playbook (elenco fisso in codice, tutti `spento` di default)
| Playbook | Quando | Canale | Tipo |
|---|---|---|---|
| Benvenuto | Iscrizione | push + email | servizio |
| Ambientamento | Giorno 7; giorno 21 con pochi ingressi → prima Oggi | push | servizio |
| Rinnovo | −14 / −3 gg, poi +3 gg; link a "Richiedi il rinnovo" | push + email; SMS a +3 | servizio |
| Riconquista | Scaduto da 30 / 60 gg | email + SMS | marketing |
| Assenza | 14 gg → Oggi (prima una persona); 21 gg → messaggio | push/email | servizio |
| Certificato | −30 / −7 gg, scaduto | push + email | servizio |
| Compleanno, traguardi | Il giorno | push | marketing |
| Lead: primo contatto | Trattativa creata | SMS/email | servizio |
| Lead: sollecito | `da_ricontattare` / `ultimo_tentativo` | email | servizio |
| Sondaggio NPS | 30 e 180 gg; voto 6 o meno → Oggi; 9–10 → recensione Google | email/push | marketing |

**"Richiedi il rinnovo"** nel portale (`/member-portal/abbonamento`): crea un'`attivita` di tipo `richiesta_rinnovo` e il segnale con priorità massima. Al posto dei pagamenti: il socio esprime l'intenzione, la reception incassa di persona.
Fatto nella Fase 3: `rinnovo_richiesto` (priorità 100) resta finché non si vende un abbonamento o non si registra un contatto riuscito dopo la richiesta (un "non ha risposto" non la chiude; un contatto di prima non la nasconde). Una seconda richiesta mentre la prima aspetta non ne crea un'altra.

---

## F. Tutto spento al primo deploy, si accende dall'ERP

| Attivo subito (non invia niente) | Spento finché non lo si accende |
|---|---|
| Modello Persona, diario, segnali, Oggi, elenco intelligente, Scheda 360, Iscrivi, bancone CRM, Ctrl+K | Parte "invii" del giro |
| Link `tel:`, `wa.me`, `mailto:` | Email, SMS, push |
| Consensi nel portale (servono *prima* di poter inviare) | Invio a una lista salvata |
| Giro di manutenzione | Playbook |
| Notifiche in-app di oggi, invariate | Parte multicanale di `notifica()` |

**Tre serrature**, controllate in un solo punto (la funzione che accoda in `messaggi`):
1. env `INVII_REALI`, falsa se assente: fornitore finto, stato `simulato`;
2. `impostazioni.comunicazioni.attive = false` per ogni palestra;
3. ogni canale va configurato e verificato con "invio di prova a me"; ogni playbook è `spento`.

**Modalità anteprima**: il playbook gira e scrive `simulato` ("domani sarebbero partiti 12 messaggi"), così la palestra controlla prima di accendere.

**Sezione `/admin/comunicazioni`** (modulo `crm_comunicazioni`, solo admin):
- canali, con stato `non configurato → da verificare → pronto`;
- fascia di silenzio (21–9);
- budget SMS;
- soglie (`shared/soglie.js` modificabili);
- playbook (`spento / anteprima / attivo`), con testo e anteprima su una persona reale;
- interruttore generale, abilitato solo dopo una lista di controllo (un canale pronto, informativa privacy confermata, testi rivisti);
- registro dei messaggi e costi del mese.

Ogni modifica passa da `lib/registro.js`.

**Credenziali**: cifrate con AES-256-GCM (chiave in env `CHIAVE_SEGRETI`) e **in sola scrittura**: l'API dice solo "impostata / non impostata". I webhook rifiutano tutto se il canale non è configurato.

---

## G. Consensi e GDPR (nativi, non aggiunti dopo)
- Registro `consensi` per palestra: `marketing_email`, `marketing_sms`, `marketing_push`, con fonte e data. Interruttori nel portale; link di disiscrizione firmato (`lib/urlFirmati.js`).
- Le comunicazioni di **servizio** non richiedono il consenso marketing.
- **Minori**: i messaggi vanno al contatto di riferimento (genitore) sulla persona.
- Diritti GDPR: esportazione ed anonimizzazione di una persona; le persone mai diventate socie e con trattative chiuse da oltre 24 mesi si anonimizzano nel giro di manutenzione. Contratto DPA con ogni palestra (GRIP è responsabile del trattamento).

---

## H. Fasi (da fare dopo e sopra le fondamenta multi-tenant)
1. **Fondamenta**: modello Persona e trattative, migrazione, `attivita`, E.164, `soglie.js`, consensi, impostazioni, ingresso del lead semplificato con controllo doppioni.
2. **Segnali e lavoro**: `segnali.js`, `/api/segnali`, Oggi, elenco intelligente, Scheda 360, bancone CRM, Ctrl+K, giro di manutenzione, presenze e no-show.
3. **Iscrivi e retention operativa**: flusso Iscrivi, "Richiedi il rinnovo", sospensione dell'abbonamento (congelamento con data di ripresa), motivo di abbandono, vista istruttore.
4. **Canali (spenti)**: `messaggi`, modelli, adattatori, `/admin/comunicazioni`, anteprima, giro degli invii. *Fatta.*
5. **Ascolto ed efficacia**: NPS, effetto dei contatti, retention per coorte, riepilogo settimanale al titolare, obiettivi per operatore.
6. **Acquisizione**: form pubblico e QR in sala, lezione di prova (`bookings.persona_id`), porta un amico, "scopri palestre" dell'app unica (solo con consenso).

Fuori ambito per decisione: pagamenti. Più avanti: assistente AI sul diario e sui testi; tesseramento EPS con scadenza.

**Fase 3, com'è andata.** Fatti: Iscrivi (`POST /api/iscrivi`, una transazione; sostituisce `trasforma`), "Richiedi il rinnovo", sospensione, motivo di abbandono, vista istruttore, segnali del tornello in cima a Oggi ("Entrati oggi") e nella scheda, `ingresso_dopo_contatto` nel giro. Scelte:
- **Sospensione** (`sospensioni`, del socio e non dell'iscrizione): la scadenza si calcola (`conSospensioni`), allunga l'iscrizione che copre il primo giorno e fa slittare il rinnovo già comprato che le viene dietro. La decide solo la reception, senza tetti di durata né di numero (scelta della palestra), motivo facoltativo; si parte da oggi o dopo, e si può far riprendere prima. Fase `sospeso`; dopo la ripresa l'assenza si conta dalla ripresa e il calo tace per 12 settimane.
- **Motivo di abbandono**: obbligatorio archiviando; "chiudere uno scaduto recuperabile perso" è la stessa archiviazione. La dashboard conta i motivi degli ultimi 12 mesi.
- **Istruttore**: i permessi predefiniti non gli danno più soci, documenti e contatti (migrazione 0055, solo se il ruolo aveva ancora i predefiniti). Tiene il calendario, che dall'endpoint generico apre ancora l'elenco dei soci: punto aperto dell'audit, da chiudere quando il calendario riceverà i nomi dal server.
- **Iscrivi**: l'informativa privacy firmata è obbligatoria e scrive `gdpr_consent`; i consensi promozionali si registrano con fonte `reception`. I file si caricano prima della transazione (`ponytail:` orfani se fallisce, li pulisce `manutenzione:file-orfani`).

**Fase 4, com'è andata.** Fatti: `messaggi` (chiave unica per palestra, playbook, persona e occasione), `modelli_messaggio`, `segreti_canali` (AES-256-GCM), gli adattatori `email` (SMTP della palestra o Brevo, scelta per palestra) e `finto`, `notifica()` punto d'ingresso unico, i playbook nel giro, `/admin/comunicazioni`, la disiscrizione firmata. Scelte:
- **Le serrature in `accoda`** (`lib/invii.js`); `spedisci` ripete la prima (senza `INVII_REALI` va al finto anche un messaggio in coda per errore).
- **Un canale per messaggio**, il primo possibile nell'ordine portale → email → SMS; "app" è la notifica nel portale (le push vere verranno con l'app). Un playbook non è un quinto conto: è un segnale del motore più una finestra di giorni (`occasione`), così un giro saltato si recupera e la chiave lo fa partire una volta sola.
- **Simulato non occupa il posto del vero**: la chiave dell'anteprima ha un suffisso suo. Con una serratura chiusa, anche un messaggio che sarebbe stato bloccato si scrive *simulato*, con il motivo.
- **Silenzio**: il giro in fascia di silenzio non accoda (il cron va di giorno); un avviso immediato in silenzio si scrive `bloccato_silenzio` e non parte (`ponytail:` si potrebbe rimandare all'alba). La notifica nel portale parte sempre.
- **Budget SMS** a zero di partenza, tetto rigido sotto lucchetto (`pg_advisory_xact_lock`); un freno di 300 messaggi veri per giro.
- **Minori**: nessun campo "contatto del genitore" esiste ancora, quindi un minore riceve solo nel portale; email e SMS sono bloccati.
- **Verifica dei canali**: un codice di sei cifre da riscrivere; vale per quella configurazione (impronta) e, se fatta in simulazione, non vale con gli invii veri accesi.
- **Lista di controllo**: un canale pronto, informativa confermata, testi riletti, `PUBLIC_BASE_URL` impostata.
- **Un messaggio automatico non è un contatto**: scrive `messaggio` nel diario ma non nasconde i segnali di Oggi.
- Le soglie del motore si cambiano dalla sezione (scheda Soglie).

**Fase 4, cosa resta fuori**: un fornitore SMS vero (Skebby, Aruba o Brevo, con il mittente registrato secondo AGCOM 12/23/CIR) e Web Push sul portale con chiavi VAPID (da fare insieme al portale installabile): rimandati per scelta dell'utente; le ricevute di consegna dai fornitori (webhook: lo stato `consegnato` esiste ma nessuno lo scrive); il contatto del genitore per i minori; playbook benvenuto, riconquista, lead e NPS (Fase 5 e 6); l'invio a una lista salvata; il riepilogo al titolare (Fase 5).

**Fase 3, cosa resta fuori**: il filtro "i miei" e il tempo reale di Oggi, le liste salvate, l'elenco unico persone (come prima); la richiesta di sospensione dal portale (decisione: solo la reception); i limiti alla sospensione (la palestra non li vuole: si aggiungono in `shared/soglie.js` se servono); la mostra dell'efficacia (Fase 5: il dato c'è); la sezione degli invii `/admin/comunicazioni` (Fase 4).

**Fase 2, cosa resta fuori** (rimandato, non scartato): il filtro "i miei" e l'aggiornamento in tempo reale (SSE) di Oggi; le liste salvate e le azioni multiple dell'elenco; l'elenco unico persone (soci e contatti restano due pagine); `ingresso_dopo_contatto` nel giro; `rinnovo_richiesto`, che nasce con "Richiedi il rinnovo" (Fase 3). Il bancone non c'è più: il controllo degli ingressi è passivo (tornello) e lo staff registra a mano solo le eccezioni. I segnali "bancone" compaiono nella finestra "Registra ingresso"; dove mostrarli per chi entra dal tornello è una scelta della Fase 3.

## File chiave toccati
- Schema: `server/src/db/schema/{crm,lead,courses,common}.js`, più i nuovi `persone.js` e `messaggi.js`; le migrazioni in `server/drizzle/`.
- Regole: `shared/segnali.js` (nuovo), `shared/soglie.js` (nuovo), `shared/lead.js` (stati e azioni restano, cambia la tabella), `shared/avvisi.js` (diventa una vista dei segnali), `shared/anagrafica.js` (`normalizzaTelefono`).
- Server: `routes/lead.js` (trattative; `trasforma` diventa `iscrivi`), `routes/dashboard.js` e `routes/ingressi.js` (leggono i segnali), `lib/notifiche.js` (punto d'ingresso unico), i nuovi `routes/segnali.js`, `routes/comunicazioni.js` e `giro.js`, `auth/authorize.js` e `shared/permissions.js` (moduli nuovi).
- Frontend: nuova `src/staff/pages/Oggi.jsx`; `pages/crm/MembersList.jsx`, `MemberDetail.jsx`, `pages/lead/Contatti.jsx`, `components/lead/TrasformaInSocio.jsx` (diventa Iscrivi); il portale `src/member/pages/` (consensi, richiesta di rinnovo); nuova `pages/admin/Comunicazioni.jsx`.

## Verifica
- Funzioni pure, con date fisse: `segnaliPersona` (fasi, rischio, segnale nascosto dopo un contatto, presenza e no-show), `normalizzaTelefono`, scelta dei playbook e della cascata di canali.
- Server (`app.inject` con Postgres):
  - **migrazione**: lead, soci e diari esistenti → persone, trattative e attivita senza perdite (conteggi prima e dopo);
  - la trasformazione conserva il diario; un ex socio che ritorna riattiva lo stesso `soci`;
  - telefono doppio nella stessa palestra → rifiutato o segnalato; tra palestre diverse → permesso;
  - una GET non scrive più nulla;
  - **spento di default**: database appena migrato, giro lanciato → zero `messaggi`, zero chiamate al fornitore; un test per ogni serratura e uno per l'anteprima;
  - il giro lanciato due volte non produce doppioni; i destinatari senza consenso marketing vengono bloccati, quelli di servizio passano;
  - isolamento dei tenant su persone, diario, segnali e messaggi;
  - le credenziali non tornano mai in una GET; un non admin riceve 403 su `/admin/comunicazioni`.
- Manuale (skill `run`): un socio con abbonamento a −3 giorni compare in Oggi e al bancone; dal bancone "proposto rinnovo" arriva nel diario e il segnale si nasconde; il giro con `INVII_REALI` assente produce solo `simulato`.
