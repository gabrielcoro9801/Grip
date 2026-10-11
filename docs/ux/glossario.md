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
| **Contatto** | Chi ha chiesto informazioni e non è (ancora) socio. La sezione del menu resta "Lead". | — |
| **Iscrivi** | Far diventare socio una persona: anagrafica, abbonamento, certificato, consensi. | Aggiungi socio, Nuovo socio |
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
| **Codice QR** | Valido, Revocato | badge colorato |
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

## Il lavoro della segreteria

| Parola | Che cosa è |
|---|---|
| **Da fare** | La pagina con chi seguire e perché, divisa in **linee** (Rinnovi, Chi non viene, Nuovi soci, Documenti, Compleanni, Contatti). |
| **Fatto** | Un tocco che dice "l'abbiamo cercato" (Di persona, Chiamato, Messaggio, Email): nasconde la riga per qualche giorno. |
| **Diario** | La storia di una persona: contatti, note, cose da fare comparse e risolte. |
| **Ingresso** | Un passaggio dal tornello o registrato a mano. |

## Date e nomi

- Un giorno: **21/10/2026** nel gestionale (tabelle, tile, campi), **21 ott 2026** nelle frasi
  e nel portale. Una lezione porta il giorno della settimana: **lun 12 ott**.
- Una persona: **Nome Cognome**, sempre.
- I soldi: in euro, **1.234,50 €**, anche quando il server li tiene in centesimi.
