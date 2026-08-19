# Roadmap Contabilità & Finance — stato di avanzamento

Checklist operativa della *Roadmap Evolutiva — Contabilità & Finance*. Il documento
originale raccomanda di tenere traccia separata di **fatto** e **verificato**: questo file
serve a quello. Una riga è "verificata" solo quando qualcuno ha osservato il
comportamento corretto nell'applicazione, non quando il codice è stato scritto.

Legenda: `[ ]` da fare · `[~]` fatto, non verificato · `[x]` fatto e verificato · `[—]` non serve

---

## Fase 0 — Fondamenta già costruite

Verificare, non ricostruire.

- [x] Motore `generateJournalEntry` a partita doppia — verificato a codice
- [x] Hub Movimenti (Registro / Scadenzario / Prima Nota / Fornitori / IVA / Cespiti)
- [~] IVA forfettizzata 50% su incassato commerciale — logica verificata a codice, manca il test end-to-end (Fase 1)
- [~] Cessione cespiti con plusvalenza/minusvalenza — logica verificata a codice, manca il test end-to-end (Fase 1)

## Fase 0-bis — Debito tecnico emerso dopo la migrazione a PostgreSQL

Non presente nel documento originale: nasce dal passaggio da un datastore senza schema a
un database tipizzato.

- [x] **Campi `numeric` restituiti come stringhe.** PostgreSQL serializza i `numeric` come
  stringhe; il codice contabile ci fa aritmetica (`s + l.dare`, `.toFixed(2)`). Senza
  conversione le somme diventano concatenazioni di stringhe. Risolto in
  `server/src/db/client.js` con un type parser. *Era latente solo perché il database era vuoto.*
- [x] **Date inviate come stringa ISO.** Le colonne `timestamp` richiedono un oggetto data,
  mentre l'applicazione invia stringhe (`new Date().toISOString()`). Bloccava la creazione
  di sedute PT, timbrature, QR accessi e voci di log. Risolto nella conversione centrale
  in `server/src/entities/columnMaps.js`, insieme alla normalizzazione delle stringhe vuote.
- [x] **Confusione fra id socio e id cliente nella catena ricevute.** `MemberDetail.jsx`
  passava l'id del Member dove la contabilità si aspetta l'id del Client, e
  `receiptEngine.js` scriveva un id di Client nella colonna `member_id`. Il datastore
  precedente, senza chiavi esterne, assorbiva l'errore in silenzio; PostgreSQL lo rifiuta.
  Risolto seguendo il collegamento `Member.cliente_id`, con il socio della ricevuta
  risolto a partire dal cliente. *Senza questo, le ricevute non comparivano nel portale soci.*
- [x] **Scritture contabili non atomiche + protocollo non sequenziale.** Risolti insieme in
  Fase 1 con l'endpoint transazionale.
- [x] **Permessi non applicati lato server.** Risolto: la matrice ruolo → modulo è stata
  spostata in `shared/permissions.js`, usata sia dall'interfaccia sia dal server, e viene
  applicata sulle modifiche in `server/src/auth/authorize.js`. Copre oggi le aree
  sensibili — piano dei conti, causali, finanziamenti, profilo fiscale, fornitori,
  template ricevuta, account staff — mentre le altre entità restano aperte a qualunque
  utente autenticato dello staff: l'elenco si stringe man mano che ogni area viene
  verificata, invece di indovinare tutto in una volta e bloccare flussi funzionanti.
  *Verificato:* un account reception legge il piano dei conti ma non può modificarlo,
  non può creare account (era una scalata di privilegi possibile), non può inserire
  registrazioni manuali; può però registrare normalmente i movimenti.
- [x] **Il portale soci leggeva tutto il database.** Un socio autenticato riceveva 200 su
  `Payslip` (gli stipendi di tutti), `StaffAccount`, `JournalEntry`, `Invoice`,
  `Collaboratore` e l'anagrafica completa degli altri soci: la separazione esisteva solo
  nell'interfaccia. Risolto con `server/src/auth/memberScope.js`, che definisce le sole
  entità che il portale ha ragione di leggere e la colonna con cui si riconoscono le righe
  del socio; il filtro è imposto dal server sia sulla lista sia sulla lettura per id, così
  indovinare un identificativo non aggira nulla. Le prenotazioni fanno eccezione — servono
  tutte per contare i posti liberi — ma la risposta non porta più `member_name`.
  In scrittura il socio può creare solo il proprio codice di accesso e i propri
  allenamenti, e il proprietario lo impone il server: un QR intestato a un altro socio
  viene riscritto a nome di chi lo chiede.
  *Verificato:* 43 controlli su HTTP reali (entità vietate → 403, entità proprie filtrate,
  scheda di un altro socio → 404, prenotazioni senza nome, scritture altrui riportate al
  richiedente) più un giro del browser su tutte e otto le pagine del portale, che mostrano
  i dati di Giulia senza un solo errore HTTP o JS, e sulle 28 pagine staff, invariate.
- [x] **Registrazioni contabili e upload aperti a chiunque fosse autenticato.** Emersi
  mentre si verificava il punto sopra, entrambi fuori da `/api/entities`:
  `POST /api/journal-entries` controllava il ruolo **solo** per le registrazioni manuali,
  quindi un socio poteva scrivere in contabilità dichiarando qualsiasi altra origine;
  `POST /api/uploads` non chiedeva nemmeno l'autenticazione, cioè era un deposito di file
  aperto sul disco del server, con i file poi serviti pubblicamente da `/uploads/*`.
  *Verificato:* le nove rotte contabili dedicate rispondono ora 403 al socio e 401
  all'upload senza token, mentre il flusso reale ricevuta — scrittura, PDF, upload,
  emissione — resta funzionante per lo staff.

## Fase 1 — Correttezza dei dati (blocca tutto il resto)

- [x] **IVA su quote istituzionali.** Risolto: `MemberDetail.jsx` costruisce ora una causale
  virtuale con `gestisce_iva: false` e passa `natura_fiscale`, come il wizard di
  `Movimenti.jsx`. Aggiunto nel form un selettore *Istituzionale / Commerciale*
  (predefinito: istituzionale) invece di fissare il comportamento nel codice.
  *Verificato:* un abbonamento da 100 € produce due sole righe — Cassa 100,00 in dare e
  Ricavi 6.1 100,00 in avere — **nessuna riga sul conto 4.3**, `natura_fiscale: istituzionale`.
- [x] **Doppia scrittura Revenue.** Risolto ed eliminato l'intero registro parallelo:
  rimossa la scrittura in `MemberDetail.jsx`, cancellato `Finance.jsx` (era già
  irraggiungibile), rimosse le entità dal client e dal registro del server, tabelle
  `revenues`/`expenses` eliminate con migrazione.
  `Dashboard.jsx` ora calcola ricavi e costi dalle righe di partita doppia (conti di tipo
  "ricavo" in avere, "costo" in dare, solo scritture confermate).
  *Verificato:* dopo un incasso di 100 €, la dashboard mostra "Ricavi totali € 100".
- [x] **Receipt duplicata al saldo di un credito.** *Verificato: non accade.* `settleJournalEntry`
  porta l'originale a `stato_pagamento: "saldata"`, `CreditiDebiti.jsx:143` passa l'id
  originale e `generateReceiptForJournalEntry` trova la bozza e chiama `promoteDraftReceipt`.
  Una sola ricevuta, promossa. Nessun intervento necessario.
- [x] **Contatore `numero_protocollo` atomico + atomicità della partita doppia.** Risolti
  insieme con `POST /api/journal-entries` (`server/src/routes/journalEntries.js`): testata e
  righe vengono scritte in un'unica transazione e il numero arriva da un contatore
  incrementato al suo interno (tabella `numbering_counters`, riusabile per ricevute e
  codici socio). L'endpoint rifiuta le registrazioni senza righe e quelle confermate che
  non quadrano; le bozze restano libere di non quadrare. La creazione diretta di
  JournalEntry/JournalLine dall'endpoint generico è ora bloccata, così la strada
  non atomica non è più percorribile.
  *I punti erano 6, non 5*: oltre a `journalEntryEngine.js` (3), `NewJournalEntry.jsx` e
  `CespitiTab.jsx`, anche `PtCompensiPage.jsx` — vedi sotto.
  *Verificato:* 15 scritture simultanee producono 15 protocolli distinti; una riga con
  riferimento non valido non lascia alcuna testata orfana (rollback); il flusso completo
  dall'interfaccia continua a funzionare.
- [x] **"Registra in contabilità" dei compensi PT ora esegue davvero.** (Anticipato dalla
  Fase 2 perché creava una testata *senza righe*, la stessa falla chiusa qui sopra.)
  Prima creava una registrazione vuota e diceva all'utente di completarla a mano in Prima
  Nota; ora genera la scrittura reale — costo del personale (7.6) in dare, debito verso il
  collaboratore (4.4) in avere — e il compenso compare fra i debiti da pagare, saldabile da
  Crediti/Debiti come ogni altro debito.
  *Da rivedere in Fase 3:* la ritenuta d'acconto sui professionisti non è ancora gestita.
- [x] **Test end-to-end di un mese simulato.** Eseguito attraverso l'applicazione reale
  (interfaccia e motore contabile veri, nessuna logica riscritta nel test): quota
  associativa, affitto sala con IVA, acquisto attrezzatura a credito con successivo saldo,
  incasso PT commerciale, compenso istruttore, cessione cespite in plusvalenza.
  *Esiti:* 7 registrazioni, protocolli da 1 a 7 senza buchi né duplicati; tutte quadrate
  (dare = avere); IVA a debito presente solo sull'incasso commerciale (44,00) e **assente**
  sulla quota associativa; cessione cespite ripartita correttamente (banca 2.500 in dare,
  cespite 2.000 in avere, plusvalenza 500 sul conto 6.7); saldi di cassa e banca coerenti
  con i movimenti; dashboard allineata (ricavi 800, costi 710); il compenso non pagato
  compare nello scadenzario fra i debiti.

## Fase 2 — Consolidamento UX

- [x] **Etichetta pagamento in CRM sincronizzata.** La scheda socio non tiene più uno stato
  proprio: segue la catena `Subscription → Receipt → JournalEntry` e mostra "Da incassare"
  o "Pagato" leggendo lo stato reale della scrittura. Saldando altrove, l'etichetta cambia
  da sola al ricaricamento della scheda, senza nulla da tenere allineato a mano.
- [x] **Saldo pagamenti solo in Crediti/Debiti.** Verificato che nessun altro modulo espone
  un'azione di saldo; la scheda socio rimanda esplicitamente a Movimenti → Scadenzario
  quando c'è un incasso in sospeso.
- [x] **Piano dei conti: modifica, disattivazione ed eliminazione dei conti non di sistema.**
  I conti di sistema restano bloccati perché il motore contabile li cerca per codice
  (cassa, IVA, crediti): rinominarli o eliminarli farebbe fallire la generazione delle
  scritture. Un conto già movimentato non è eliminabile — il database lo impedisce e
  l'interfaccia lo spiega, suggerendo di disattivarlo per non perdere la storia contabile.
- [x] **`NewJournalEntry.jsx` ristretto a "ultima risorsa".** Riservato all'amministratore
  (bloccato anche lato server, non solo nascosto), motivo obbligatorio salvato con la
  scrittura, avviso che rimanda ai flussi ordinari, e badge "Manuale" con il motivo nel
  Registro. Le scritture di saldo, che prima si dichiaravano anch'esse "manuale", ora
  hanno un'origine propria e non vengono più confuse con quelle digitate a mano.
- [x] Modulo Team/Compensi — **risolto**: "Registra in contabilità" genera la scrittura reale
  (Fase 1); i compensi a percentuale si sono rivelati corretti (verificato: 3 sedute da 50 €
  al 60% danno 90,00 €) — lo zero segnalato nasce da un'anagrafica incompleta, e ora
  l'interfaccia dice quale dato manca invece di mostrare uno zero muto.
- [x] **Assegnazioni corsi collegate alla natura economica dell'istruttore.** La riga
  originale ("le assegnazioni corsi non generano entrate/uscite") era formulata su una
  premessa sbagliata: l'assegnazione di un corso **non è** un evento contabile. Chi insegna
  può esserlo a due titoli, e l'evento contabile è diverso in ciascuno:
  - **persona del team** (dipendente o collaboratore sportivo) → l'evento è il compenso
    periodico, che già genera la scrittura; il corso fornisce le ore;
  - **professionista esterno** → l'evento è la fattura del fornitore, che passa dal ciclo
    acquisti (Fase 3), come per qualunque altro servizio.

  Il vero difetto era che `Instructor` era un'anagrafica isolata, senza alcun collegamento
  né a `Collaboratore` né ad `AccountingSupplier`: la stessa persona esisteva due volte e
  scollegata, quindi il sistema non poteva sapere in quale dei due mondi collocarla.
  Aggiunti entrambi i collegamenti, facoltativi e coesistenti (la stessa persona può tenere
  un corso come collaboratore e un altro con partita IVA), più `courses.tipo_incarico` che
  dice quale dei due vale per un dato corso — chiesto solo quando l'istruttore ha entrambi
  i titoli, altrimenti dedotto dall'anagrafica.
  *Verificato:* i quattro casi (solo team, solo fornitore, entrambi, nessuno) mostrano
  l'indicazione corretta; il campo di scelta compare solo nel caso ambiguo; un istruttore
  senza collegamenti viene segnalato come "non si sa come vada retribuito".
  **Non costruito di proposito:** le ore che alimentano il compenso dell'istruttore interno,
  perché il modello della tariffa oraria e delle maggiorazioni non è ancora stato definito.

### Emerso durante la Fase 2

- [x] **Il Registro nascondeva delle scritture.** Mostrava solo i movimenti generati da una
  causale operativa (`.filter(e => e.causaleObj)`): restavano invisibili saldi, compensi,
  cessioni di cespiti e registrazioni manuali — proprio quelle che questa fase doveva
  rendere riconoscibili. Ora il registro mostra tutte le scritture; il verso (entrata o
  uscita) si ricava dalle righe invece che dalla causale, e le scritture puramente
  patrimoniali, come il saldo di un debito, restano senza segno.

> Chiusa la Fase 2 più il report istituzionale (4.1), il **Traguardo A** (cliente beta) è raggiunto.

## Fase 3 — Funzionalità core (Traguardo B)

- [x] **Modulo acquisti/ordini fornitori** (scheda "Acquisti" in Movimenti).
  Ordinato → Consegnato → Fatturato → Pagato, con la scrittura contabile generata **alla
  consegna**: ordinare non è un fatto contabile, ricevere sì. Registrare il costo all'ordine
  significherebbe mettere a bilancio merce che potrebbe non arrivare mai.
  - *Consegna:* crea costo in dare e debito verso il fornitore in avere, in transazione con
    il cambio di stato — se la scrittura fallisse, l'ordine non risulterebbe consegnato.
    L'importo è correggibile: alla consegna può emergere che la fornitura vale diversamente
    da quanto previsto.
  - *Fattura:* annota gli estremi del documento senza generare una seconda scrittura, perché
    il costo è già rilevato. Se l'importo fatturato differisce, l'interfaccia lo segnala
    invece di correggere in silenzio.
  - *Pagamento:* si registra da Scadenzario come ogni altro debito, riusando il flusso
    esistente.
  Lo stato "Pagato" **non è un campo dell'ordine**: si legge dalla scrittura collegata.
  Duplicarlo avrebbe creato due versioni della stessa verità, destinate a divergere — la
  stessa lezione dell'etichetta di pagamento in CRM (Fase 2).
  L'avviso sulla ritenuta d'acconto compare sull'ordine quando il fornitore vi è soggetto.
  *Verificato:* ciclo completo dall'interfaccia — l'ordine non genera scritture, la consegna
  ne genera una sola e corretta (7.3 in dare, 4.1 in avere con controparte), la fattura non
  ne aggiunge, e dopo il pagamento l'ordine risulta "Pagato" pur avendo ancora
  `stato = fatturato` nel database: la derivazione funziona.
- [x] **Anagrafica fornitori con distinzione del tipo di soggetto.** Ogni fornitore dichiara
  se è società, professionista persona fisica, ditta individuale o altro, e se applica il
  regime forfettario. Da qui il sistema deduce se un pagamento è soggetto a ritenuta
  d'acconto — dovuta ai professionisti persona fisica, non alle società né ai forfettari —
  e lo segnala **al momento di registrare il pagamento**, non dopo: la ritenuta va
  trattenuta quando si paga, accorgersene a versamento avvenuto significa doverla recuperare.
  L'avviso mostra quanto spetta al fornitore e quanto resta da versare all'erario.
  La regola vive in `shared/ritenuta.js`, condivisa fra interfaccia e server, perché la
  stessa domanda si ripresenta nell'anagrafica, nel pagamento e nel futuro ciclo acquisti.
  *Verificato:* professionista non forfettario su 1.000 € → segnalati 800 € al fornitore e
  200 € di ritenuta; forfettario, società e ditta individuale → nessun avviso; un fornitore
  senza tipo indicato viene marcato come tale invece di essere trattato come esente.
  **Non costruito:** la scrittura contabile che separa la ritenuta (debito verso l'erario)
  — oggi la registrazione riporta il costo per intero e l'avviso lo dichiara esplicitamente.
- [x] **Fatturazione clienti terzi** (scheda "Fatture" in Movimenti). Registrando un incasso
  da un cliente di tipo **azienda** viene emessa una fattura in PDF; a un privato continua a
  essere emessa una ricevuta. La distinzione è automatica: il documento dipende da chi paga,
  non da una scelta manuale che qualcuno può dimenticare.

  Non esiste un pulsante per creare una fattura da zero: nasce sempre dalla scrittura che la
  origina, altrimenti sarebbe un documento scollegato dalla contabilità.

  Il **numero è assegnato dal server in transazione** (`shared` counter per organizzazione ed
  esercizio, ripartendo da 1 ogni anno). Su una fattura conta più che altrove: la numerazione
  dev'essere progressiva senza salti né duplicati, ed è uno dei primi elementi che un
  controllo verifica. La scheda segnala da sé eventuali salti nella numerazione.
  *Verificato:* affitto sala a un'azienda per 610 € → fattura 1/2026 con imponibile 500 €,
  IVA 110 € al 22%, totale 610 €, PDF generato e scaricabile, con partita IVA
  dell'intestatario esposta.

  **Limite dichiarato, anche nell'interfaccia e sul documento stesso:** questo è un PDF di
  cortesia. Verso soggetti con partita IVA la fattura elettronica in XML trasmessa allo SdI
  è obbligatoria e **non è ancora implementata** — il PDF non la sostituisce.
- [x] **Anagrafica banche.** L'ente finanziatore era un campo di testo libero: lo stesso
  istituto veniva scritto in modi diversi e non era possibile vedere quanto si deve
  complessivamente a ciascuno. Ora è un'anagrafica (nome, IBAN, referente, contatti),
  creabile al volo dal form del finanziamento. Il nome resta salvato anche come testo, così
  un finanziamento continua a dire da chi proviene anche se la banca venisse rimossa.
- [x] **Piano di ammortamento alla francese, calcolato automaticamente.** Inserendo capitale,
  tasso, durata e periodicità (mensile/trimestrale/semestrale/annuale) il piano si genera da
  solo: rata costante, quota capitale crescente, quota interessi calante, debito residuo.
  L'anteprima compare già nel form — rata e interessi totali sono il dato che dice se il
  finanziamento è sostenibile, e vederlo prima di salvare evita di scoprirlo dopo.
  Calcolo in `shared/ammortamento.js`.
  *Verificato:* 10.000 € al 5% su 12 rate mensili → rata costante 856,07 € (formula francese
  standard), somma delle quote capitale esattamente 10.000,00 €, debito residuo azzerato
  all'ultima rata, interessi totali 272,89 €. Gestiti anche il tasso zero (che manderebbe in
  errore la formula, dividendo per zero) e le scadenze di fine mese (31 gennaio → 28 febbraio
  → 31 marzo).
- [x] **Rate generate una alla volta.** Il piano completo è consultabile come proiezione, ma
  le rate diventano record — e quindi debiti nello scadenzario — solo quando vengono
  generate. Una rata futura è una previsione, non un debito: mostrarle tutte insieme fra le
  scadenze aperte darebbe un quadro dei debiti falsato. Ogni rata arriva precompilata dal
  piano e resta correggibile, perché la banca può applicare importi leggermente diversi.
  *Verificato:* la prima rata generata riporta 814,40 € di capitale e 41,67 € di interessi,
  esattamente i valori calcolati; il piano evidenzia le rate già generate.
- [x] **Vista movimenti di cassa** (scheda "Cassa e banca" in Movimenti). Estratto conto per
  conto liquido: saldo iniziale, movimenti in ordine di data con saldo progressivo accanto a
  ciascuno, saldo finale — più il saldo di ogni conto a colpo d'occhio in alto ed export CSV.

  Risponde a una domanda che i totali aggregati non possono risolvere: *quanto c'è adesso*.
  Entrate e uscite complessive dicono quanto si è incassato e speso, ma un incasso ancora da
  riscuotere non è denaro disponibile. Qui compaiono **solo i movimenti che toccano davvero
  la liquidità**, e la data usata è quella dell'effettivo movimento di cassa, non quella di
  competenza: un costo di marzo pagato ad aprile esce di cassa ad aprile.
  *Verificato:* i saldi mostrati (Cassa 364,00 €, Banca −2.180,00 €) coincidono con quelli
  calcolati direttamente sul database; il saldo progressivo torna riga per riga.

## Fase 4 — Reportistica gestionale

- [x] **Report gestione istituzionale** (scheda "Istituzionale" in Movimenti). Affianca
  gestione istituzionale e commerciale — proventi, costi diretti, saldo — su un periodo
  scelto, con apertura sull'esercizio in corso.

  *Premessa che mancava:* le entrate erano già classificabili come istituzionali, ma
  **nessuna causale di uscita** lo prevedeva, quindi i costi non erano attribuibili. Ora
  ogni uscita chiede a quale attività serve: istituzionale, commerciale o **promiscua**
  (il caso più comune in una palestra: affitto, utenze). La natura di un'entrata dipende da
  chi paga — se è un socio; quella di un costo da cosa serve, quindi è una scelta a sé e non
  segue la controparte.

  I costi promiscui sono mostrati **a parte, non ripartiti**: la percentuale di riparto è
  una scelta da concordare col commercialista, e attribuirli d'ufficio darebbe a una stima
  l'aspetto di un dato certo. Il report espone però il rapporto proventi
  commerciali/totali, che è il riferimento con cui quel riparto si decide.
  Le registrazioni ancora prive di natura sono segnalate esplicitamente ed escluse dai
  totali, invece di essere sommate a una delle due gestioni.
  *Verificato:* con proventi istituzionali 100 €, commerciali 200 €, costi 200 istituzionali,
  760 commerciali e 1.500 promiscui, il report riporta i saldi corretti e una quota
  commerciale del 62,5%.
- [x] **Bilancio provvisorio** (Contabilità → Bilancio). Quattro letture in un'unica pagina,
  perché separate rispondono solo a metà della domanda:
  - **conto economico** — proventi e oneri del periodo, per conto, con avanzo o disavanzo;
  - **stato patrimoniale** — cosa si possiede e cosa si deve a una data, cumulativo e non
    limitato al periodo: il patrimonio è una fotografia, non un flusso;
  - **flusso di cassa** — liquidità realmente entrata e uscita, che è cosa diversa dal
    risultato: un ricavo fatturato ma non incassato migliora il conto economico senza
    portare un euro in cassa, e l'interfaccia lo dice;
  - **gestione istituzionale** — la ripartizione fra attività verso i soci e commerciale.

  **Controllo di quadratura integrato:** poiché ogni registrazione è bilanciata, deve valere
  *attivo = passivo + patrimonio netto + risultato*. Se non torna, non è la contabilità a
  essere sbagliata ma la classificazione del piano dei conti: il prospetto lo segnala e
  indica quali conti sono privi di tipo.
  *Verificato:* proventi 1.320 €, oneri 3.560 €, disavanzo 2.240 €; equazione patrimoniale
  soddisfatta esattamente (−1.986 = 254 + 0 − 2.240), con i valori coincidenti a quelli
  calcolati sul database.

  Dichiarato nel prospetto: è un documento gestionale, non un bilancio da depositare, e a
  esercizio aperto mancano per definizione le scritture di assestamento (ammortamenti,
  ratei, risconti) che si fanno in chiusura.

## Fase 5 — Fine esercizio

- [x] **Stima IRES** (Contabilità → Fine esercizio). Applica il coefficiente di redditività
  del 3% ai proventi commerciali e somma le plusvalenze per intero, poi l'aliquota del 24%.
  In regime 398/1991 i costi effettivi non incidono sul reddito imponibile, e questo è
  spiegato nell'interfaccia perché è controintuitivo. Regola in `shared/ires.js`.
  Etichettata come **stima indicativa** ovunque compaia: non considera variazioni fiscali,
  perdite pregresse né agevolazioni.
  *Verificato:* proventi commerciali 700 € → reddito 21 €, più plusvalenze 500 € →
  imponibile 521 €, IRES stimata 125,04 €.
- [x] **Export dati per il commercialista.** Tre CSV: riepilogo fiscale (proventi per natura,
  plusvalenze, IVA a debito, calcolo IRES), saldi dei conti, registro dei movimenti riga per
  riga. Sono i dati con cui si compila il Modello Redditi ENC, **non** il modello compilato:
  la dichiarazione resta di competenza del commercialista, che qui riceve numeri già pronti
  invece di ricostruirli dalla prima nota.
- [x] **Chiusura esercizio.** Gira il risultato al conto 5.2 (Utili/perdite a nuovo)
  azzerando proventi e oneri dell'anno, e blocca le scritture con competenza in quell'anno.
  Testata e righe della scrittura di chiusura sono create in transazione.
  Vincoli: non si chiude due volte lo stesso anno, non si chiude un anno se il precedente è
  ancora aperto (il risultato si accumula in ordine), ed è riservata all'amministratore.
  *Verificato:* la scrittura di chiusura azzera i cinque conti di costo e i quattro di
  ricavo e porta il disavanzo di 2.240 € su 5.2, quadrando (dare = avere = 3.560 €);
  una registrazione datata 2026 viene rifiutata, una datata 2027 passa.

  **Difetto trovato dal test e corretto:** dopo la chiusura il bilancio contava il risultato
  **due volte** — una in 5.2 e una come disavanzo del periodo — sbilanciando di 2.240 €. Il
  prospetto ora esclude la scrittura di chiusura dal conto economico (altrimenti l'anno
  chiuso risulterebbe senza attività) e, a esercizio chiuso, non risomma il risultato al
  patrimonio perché vi è già confluito. Senza il controllo di quadratura integrato nel
  bilancio, questo errore sarebbe passato inosservato.

## Fase 6 — Personale e compensi sportivi

- [x] **Soglie compensi sportivi rese operative.** Un avviso esisteva già, ma non era
  utilizzabile per decidere: il cumulo sommava solo i compensi **già liquidati**, quindi
  diceva se si era già sforato — non se *questo* pagamento avrebbe fatto sforare. Ora la
  posizione è calcolata includendo il compenso che si sta per erogare.
  - **Prima di erogare** l'interfaccia dice di quanto si supererebbe: cumulo prima, cumulo
    dopo, quota oltre soglia. Sotto soglia mostra invece il residuo disponibile.
  - **Al momento di registrare** compare una conferma con gli stessi numeri. Non blocca:
    superare la soglia è legittimo, cambia solo il trattamento fiscale dell'eccedenza — un
    blocco costringerebbe ad aggirare il sistema invece di documentare la scelta.
  - **Autocertificazione mancante segnalata come tale.** Senza, il cumulo vede solo i
    compensi di questa associazione: un "sotto soglia" calcolato su dati parziali è peggio
    di nessuna informazione, perché dà per tranquillo qualcosa che non lo è.

  Regola in `shared/compensiSportivi.js`.
  *Verificato:* collaboratore con 14.000 € autocertificati da altri enti e compenso di
  1.500 € → segnalato il superamento con 500 € di eccedenza, e conferma richiesta prima di
  registrare; collaboratore senza autocertificazione → cumulo dichiarato inattendibile;
  collaboratore sotto soglia → residuo disponibile di 14.700 €.
- [x] **Costo del personale nel conto economico** (Personale → Cedolini). Il cedolino resta
  calcolato dal consulente del lavoro: qui si trascrivono le voci macro e si allega il
  documento.

  **Il nodo:** "costo del personale" e "quanto prende il dipendente" divergono in due
  direzioni opposte, e con i due soli conti che esistevano (7.6 e 4.4) nessuna era visibile.
  Parte del lordo non arriva mai al dipendente — IRPEF, contributi a suo carico, cessione
  del quinto — e sono debiti verso terzi, non minor costo. Parte del costo non è nel
  cedolino — contributi a carico ente, TFR — perché non riguarda il dipendente.

  Due identità rendono il tutto verificabile:
  `lordo = netto + IRPEF + contributi dipendente + trattenute a terzi` (dice se il cedolino
  è stato trascritto bene) e `costo = lordo + contributi ente + TFR` (è il costo vero).
  La prima è controllata **mentre si digita** e blocca la registrazione se non torna: un
  errore di trascrizione scoperto dopo significa correggere una scrittura contabile.

  Aggiunti al piano dei conti: 7.10 Oneri sociali, 7.11 Accantonamento TFR, 7.12 Premio
  INAIL, 4.5 Erario c/ritenute, 4.6 INPS c/contributi, 4.7 Fondo TFR, 4.8 INAIL c/premi,
  4.9 Terzi c/trattenute. Rinominati 7.6 in "Salari e stipendi" e 4.4 in "Dipendenti
  c/retribuzioni", perché ora contengono solo il lordo e solo il netto.

  Scelte concordate: **una scrittura aggregata al mese** (i cedolini dei singoli si allegano
  alla scrittura); **destinazione TFR per singolo dipendente** (in azienda alimenta il fondo,
  a previdenza complementare diventa un versamento); **INAIL solo all'autoliquidazione**.
  *Verificato:* due dipendenti, uno con cessione del quinto e TFR in azienda, uno con TFR a
  fondo pensione → costo 4.809 € a fronte di 2.366 € di netti in busta, scrittura quadrata,
  TFR ripartito correttamente fra fondo interno (148 €) e versamento (111 €), e un cedolino
  incoerente rifiutato prima di arrivare in contabilità.

  *Semplificazione da rivedere se il caso diventasse reale:* il TFR destinato a previdenza
  complementare confluisce nel conto 4.6 (INPS c/contributi) invece di avere un conto
  dedicato al fondo pensione. Oggi nessun dipendente lo destina fuori.

---

## Dopo la roadmap

- [x] **Ritenuta d'acconto registrata in contabilità.** Il sistema la segnalava al momento
  del pagamento ma poi scritturava il costo per intero verso il fornitore: restava un
  obbligo annunciato e non riflesso, la stessa asimmetria che c'era sul costo del personale.

  Ora il costo resta intero — la ritenuta non è uno sconto — mentre il lato avere si divide
  fra chi riceve davvero il denaro e l'erario, a cui lo si versa per suo conto. Vale in
  entrambi i percorsi: pagamento immediato dal wizard Movimenti e consegna di un ordine
  fornitore (lato server).

  Aggiunto il conto **4.10 Erario c/ritenute lavoro autonomo**, distinto dal 4.5 delle
  ritenute sui dipendenti perché nell'F24 sono codici tributo diversi: sapere quanto è
  dell'uno e quanto dell'altro serve a compilarlo.

  *Verificato:* compenso di 1.000 € a un professionista pagato subito → costo 1.000, banca
  800, erario 200; lo stesso a credito su 2.000 € → costo 2.000, debito verso il fornitore
  **1.600**, erario 400; pagamento a una società → nessuna riga di ritenuta, come prima.
  Conseguenza visibile: lo scadenzario mostra 1.600 € da pagare al professionista, non
  2.000 — perché 400 non gli andranno mai.

- [x] **Numerazioni progressive tutte lato server.** Erano rimaste col vecchio metodo — leggi
  il massimo e somma uno — le ricevute (in due punti: creazione ed emissione di una bozza) e
  il codice socio, che anzi lo calcolava sul massimo fra i soci **caricati nella pagina**,
  quindi sbagliava anche senza concorrenza, con una lista non aggiornata.
  La logica, che nel frattempo era stata duplicata in quattro file, è ora in
  `server/src/lib/numbering.js`.
  *Verificato:* 12 soci e 12 ricevute create simultaneamente producono numeri tutti distinti,
  nessun duplicato in banca dati; il contatore riparte dal massimo preesistente; i flussi
  reali continuano a funzionare, sia la ricevuta emessa subito sia la bozza che prende il
  numero al saldo del credito.

## Da chiarire

- **I file caricati restano leggibili senza autenticazione.** L'upload ora richiede un
  account dello staff, ma `/uploads/*` continua a servire i file a chiunque ne conosca
  l'URL. Il nome è un UUID casuale, quindi non si indovina, ed è lo stesso schema con cui
  circolano i link alle ricevute PDF — ma un URL che finisce in una cronologia o in una
  chat resta valido per sempre e non distingue chi lo apre. Se in futuro si caricheranno
  documenti dei soci (certificati medici, documenti d'identità) va servito passando dal
  server, con lo stesso controllo di proprietà usato per le entità.

- **IVA sugli acquisti.** Sulle uscite il motore addebita al conto di costo l'intero
  importo lordo e non genera alcuna riga di IVA a credito: l'affitto da 610 € finisce tutto
  sul conto 7.1. Per un'ASD in regime 398/1991 è corretto — l'IVA sugli acquisti non è
  detraibile e resta un costo. Va però tenuto presente per il **Traguardo B**: un ente in
  regime ordinario si aspetterebbe la separazione sul conto 3.9. Nota collegata: il motore
  calcola comunque un valore di IVA per le uscite e lo restituisce al chiamante senza
  usarlo — se un giorno venisse mostrato in interfaccia suggerirebbe una detraibilità che
  in questo regime non esiste.

## Stato dei traguardi

**Traguardo A — cliente beta: raggiunto.** Fasi 0, 1 e 2 chiuse e verificate, più il report
della gestione istituzionale (4.1). Restano da decidere insieme, quando si presenteranno:
il riparto dei costi promiscui e le ore che alimentano il compenso di un istruttore interno.

**Traguardo B — vendita ad altre ASD: tutte le fasi completate.**

Resta fuori, per scelta esplicita e dichiarato nell'interfaccia: la trasmissione delle
fatture elettroniche allo SdI, oggi sostituita da un PDF di cortesia che non la sostituisce.

Altre cose consapevolmente non costruite, ciascuna annotata dove serve: il riparto dei costi
promiscui fra istituzionale e commerciale (serve un criterio da concordare col
commercialista), le ore che alimentano il compenso di un istruttore interno (manca il
modello di tariffa oraria e maggiorazioni), e un conto dedicato al TFR destinato a
previdenza complementare. La separazione contabile della ritenuta d'acconto era in questo
elenco: è stata costruita dopo la roadmap, vedi *Dopo la roadmap*.

## Note di scope

- **Ambiente di test**: i dati contabili attuali verranno azzerati, quindi nessuna procedura
  di bonifica dello storico è necessaria per le scritture già create con IVA errata.
- **Traguardo A** (cliente beta, attività quasi interamente istituzionale): Fasi 0-2 + report 4.1.
- **Traguardo B** (vendita ad altre ASD): tutte le fasi.
- L'obiettivo dichiarato non è sostituire il commercialista, ma fargli **validare numeri già
  pronti** invece di ricostruirli.
