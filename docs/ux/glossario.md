# Glossario di GRIP

Le parole dell'interfaccia, una per cosa. Vale per il gestionale, il portale dei soci, i
messaggi, i test e il README. Se una parola qui non basta, si aggiunge una riga qui prima di
usarla in una schermata.

Perché esiste: "Attivo" voleva dire quattro cose con lo stesso badge verde (il socio,
l'abbonamento venduto, il tipo del listino, l'account); "Abbonamenti" era il listino e
"Nuovo abbonamento" ne creava un *tipo*, mentre nella scheda "Abbonamenti → Nuovo" ne
*vendeva* uno; "Iscrizioni" erano gli abbonamenti venduti, ma "Iscrivi" crea un socio.

## Le persone

| Parola | Che cosa è | Non dire |
|---|---|---|
| **Socio** | Chi è iscritto alla palestra, con una scheda e un codice. | membro |
| **Soci** | La sezione del gestionale (menu). | Gestione membri |
| **Contatto** | Chi ha chiesto informazioni e non è (ancora) socio. La sezione Lead è uscita dall'applicazione il 17/11/2026 (branch `archivio/lead`). | — |
| **Iscrivi** | Far diventare socio una persona: anagrafica, abbonamento, privacy, accesso al portale. | Aggiungi socio, Nuovo socio |
| **Archivia** | Un socio che ha lasciato la palestra esce dagli elenchi; si ritrova e si riattiva. | Elimina |

## Gli abbonamenti

| Parola | Che cosa è | Non dire |
|---|---|---|
| **Listino** | I tipi di abbonamento che la palestra vende: nome, prezzo, durata. | Catalogo abbonamenti, Abbonamenti (per il listino) |
| **Tipo** | Una voce del listino ("Annuale", 480 €). **Nuovo tipo** la crea. | Nuovo abbonamento (per un tipo) |
| **Abbonamento** | Un tipo venduto a un socio, con un inizio e una fine. | Iscrizione |
| **Abbonamenti venduti** | L'elenco di tutti gli abbonamenti dei soci. | Iscrizioni |
| **Vendi** | Dare un abbonamento a un socio dalla sua scheda. | Nuovo, Crea abbonamento |
| **Rinnova** | Vendere a un socio il prossimo abbonamento: stesso tipo, dal giorno dopo la fine. | — |
| **Sospendi** | Fermare un abbonamento per un periodo: la scadenza slitta di altrettanto. | — |

## Gli stati

Ogni cosa ha i suoi. **"Attivo" è solo uno stato del socio.**

| Di che cosa | Stati | Forma |
|---|---|---|
| **Socio** | Nuovo, Attivo, In calo, Senza abbonamento, Sospeso, Archiviato | punto colorato e parola (StatoSocio) |
| **Abbonamento** | Valido, In scadenza, Scaduto | badge colorato |
| **Tipo del listino** | In vendita, Sospeso, Ritirato | badge colorato |
| **Contatto** | Nuovo, In attesa di risposta, In conversazione, Da richiamare, Non raggiungibile, Non interessato, Iscritto | badge colorato |
| **Prenotazione** | Confermata, In lista d'attesa, Disdetta | badge colorato |
| **Lezione** | (in calendario), Annullata | testo |
| **Account** | Abilitato, Disabilitato | badge colorato |
| **Sala** | Disponibile, Sospesa, Annullata | badge colorato |
| **Canale dei contatti** | In uso, Non in uso | badge colorato |
| **Messaggio automatico** | Spento, Anteprima, Attivo | interruttore |

"Nuovo" vale per il socio (primi 30 giorni) e per il contatto (appena arrivato): si
distinguono dalla forma, punto per il socio e badge per il contatto.

## Le prenotazioni

| Parola | Che cosa è | Non dire |
|---|---|---|
| **Prenota** | Il socio, o la reception per lui, si prende un posto a una lezione. | — |
| **Disdici / Disdetta** | Lasciare il posto: la riga resta nello storico. | Annulla, Cancellato |
| **Elimina** | Togliere una prenotazione inserita per errore: sparisce anche dallo storico. | — |
| **Lista d'attesa** | Chi aspetta un posto libero, in ordine. | — |
| **Annullata** | Una lezione che la palestra non tiene: le prenotazioni si disdicono da sole. | Cancellata |
| **Annulla** | Solo nel messaggio che compare subito dopo «Prenota», per qualche secondo: disfa la prenotazione appena fatta. Nello storico è una disdetta. | — |
| **Esci dalla lista** | Disdire una prenotazione in lista d'attesa. | — |
| **Posto offerto** | Si è liberato un posto e il primo in lista d'attesa ha 12 ore per confermarlo; se non lo fa torna in attesa, in fondo, e il posto si offre al successivo. Al termine di disdetta la lista si chiude. | Promosso |

## I corsi

In interfaccia «sessione» è la riga di `events`, non di `sessions`.

| Parola | Che cosa è | Non dire |
|---|---|---|
| **Lezione** | Un appuntamento in una data: un corso, a un'ora, in una sala. | Evento |
| **Lezione singola** | Una lezione che non si ripete. «Nuova lezione» in calendario crea solo queste. | Nuovo evento |
| **Sessione** | Una lezione che si ripete ogni settimana, stesso giorno e stessa ora. Una sessione ha un giorno solo. | Serie, Ricorrenza |
| **Prenotazione fissa** | Un socio prenotato a una sessione, da una data a un'altra (o per N lezioni). Prenota o disdice solo quando la si crea, cambia o cancella: non riparte da sola al rinnovo dell'abbonamento. Archiviando il socio, le sue fisse si chiudono. Ha sempre una fine, anche quando la crea il socio dal portale. | — |
| **Allunga** | Spostare più avanti la fine di una prenotazione fissa, entro l'abbonamento e l'ultima lezione della sessione. Il portale lo propone al rinnovo e quando la sessione si allunga. | Rinnova (per una fissa) |
| **Mattino · Pomeriggio · Sera** | Le fasce in cui il portale divide le lezioni di un giorno: prima delle 13, dalle 13 alle 18, dalle 18. | — |

## Il portale dei soci

| Parola | Che cosa è | Non dire |
|---|---|---|
| **Home · Corsi · Le mie lezioni · Abbonamento** | Le quattro voci della barra del portale. Notifiche e Profilo si aprono dalla campanella e dall'avatar. | — |
| **Le mie lezioni** | La pagina del portale con le fisse, le prossime prenotazioni e le passate (30 giorni). | Le mie prenotazioni |
| **Notifiche** | Quello che è successo alle prenotazioni del socio (una lezione annullata, un posto dalla lista d'attesa), con chi l'ha fatto e cosa si può fare adesso. Restano solo nel portale: niente email né notifiche sul telefono. | Avvisi (per le notifiche) |
| **Profilo** | I dati del socio, i contatti della palestra, tema e password. | Anagrafica (nel portale) |

## Il lavoro della segreteria

| Parola | Che cosa è |
|---|---|
| **Da fare** | La sezione con chi seguire e perché, divisa in schede: In scadenza, Scaduti, Frequenza, Compleanni, Archivio, Regole. |
| **Avviso** | Una cosa precisa da seguire in Da fare (un abbonamento che scade, un calo di frequenza, un compleanno): si apre da solo e si chiude a mano o da solo. Un socio può avere più avvisi. |
| **Nascondi avviso** | Chiudere a mano un avviso senza fare altro: va nell'Archivio di Da fare e si ripristina. In Da fare non si dice mai «Archivia». |
| **Archivio di Da fare** | Gli avvisi chiusi, a mano o da soli: come, chi e quando. Non è l'archivio dei soci. |
| **Regole** | La scheda di Da fare, per l'amministratore, con le soglie di ogni avviso. |
| **Diario** | La storia di una persona: contatti, note, cose da fare comparse e risolte. Nella scheda socio la sezione si chiama **Note**. (Nei Lead, usciti il 17/11/2026, si chiamava Diario.) |
| **Ingresso** | Un passaggio registrato a mano al bancone (il lettore al tornello non c'è ancora). |
| **Impostazioni** | La sezione in fondo al menu, per l'amministratore: Utenti e ruoli, Comunicazioni, Registro delle azioni. Le regole di Da fare stanno nella scheda Regole di Da fare. |
| **Registro delle azioni** | Chi ha fatto che cosa, e quando (era "Log audit"). |

## Date e nomi

- Un giorno: **21/10/2026** nel gestionale (tabelle, tile, campi), **21 ott 2026** nelle frasi
  e nel portale. Una lezione porta il giorno della settimana: **lun 12 ott**.
- Una persona: **Nome Cognome**, sempre.
- I soldi: in euro, **1.234,50 €**, anche quando il server li tiene in centesimi.
