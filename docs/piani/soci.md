# GRIP · Sezione Soci: piano delle modifiche (v2)

> **Nel piano unico (11/11/2026)** questo è il ramo **S**, `feature/soci-elenco`, sul database `grip_dev`, e si unisce **per primo**.
> Il piano unico aggiunge queste righe K:
> - **K8**: `corrispondeRicerca` non va in `core/domain/ricerca.js` ma in **`shared/ricerca.js`** (pura, senza React). `src/core/domain/ricerca.js` la riesporta, come fa `segnali.js`. La userà anche il server (`GET /api/soci/cerca` del ramo Corsi). I test vanno in `src/core/domain/ricerca.test.js`.
> - **K9**: `ui/Paginazione.jsx` lo riusa anche `SceltaSocio` del ramo Corsi. Deve accettare pagina, totale, perPagina e `onCambia`, e funzionare anche con un totale che arriva dal server.
> - **K5, K6**: i file `MembersList.jsx` e `MemberDetail.jsx` (:349) li modifica S; D e C li adattano dopo.
> - **K7, K15**: in `verifica-da-fare.mjs` S cambia solo le righe 172-179; in `verifica-oggi.mjs` solo le 88-90.
> - **K14**: il glossario è già aggiornato su main; il README si aggiorna alla fine. **Non toccare né `docs/ux/glossario.md` né `README.md`.**
> - C9 resta fuori.

Data: 3 novembre 2026. Per chi implementa. Nessuna modifica al database né al server.
Deck con le schermate prima/dopo: https://claude.ai/artifact/Aj1pr59yjT75bpDJsz6yJc

Percorsi dentro `src/` salvo diversa indicazione. Numeri di riga riferiti al repository al 3 novembre 2026 (commit `7db6320a`).

## Perimetro

**Dentro**
- Elenco soci e Iscrivi: `staff/pages/crm/MembersList.jsx`, `staff/components/soci/Iscrivi.jsx`
- Scheda socio: `staff/pages/crm/MemberDetail.jsx`, `staff/components/soci/DiarioSocio.jsx`
- Listino: `staff/pages/crm/PlansCatalog.jsx`
- Abbonamenti venduti: `staff/pages/crm/SubscriptionsList.jsx`
- Ingressi, registro: `staff/components/ingressi/RegistroIngressi.jsx`
- Rotte lette, non cambiate: `segnali`, `entities`, `iscrivi`, `ingressi`, `persone`
- Tabelle lette: `members`, `plans`, `subscriptions`, `ingressi`, `persone`, `attivita`

**Fuori**: Lead (compreso `DiarioLead.jsx`), Da fare, Dashboard, Calendario e corsi, Admin, portale soci. La cascata ha guardato tutto il repository.

## Le modifiche

| N. | Dove | Cosa cambia |
|---|---|---|
| C1 | Elenco · Listino · Venduti | Paginazione: 12 tile o 25 righe; pagina, ricerca e ordine nell'indirizzo; «Torna ai soci» riporta alla stessa pagina |
| C2 | Elenco soci | Ricerca per più parole in qualsiasi ordine, senza accenti né apostrofi; ricerca su una riga sua a tutta larghezza |
| C3 | Elenco, tabella | Un clic su tutta la riga apre la scheda |
| C4 | Iscrivi | Via la riga di stato accanto ad «Avanti» (resta `sr-only`) e la frase «L'incasso resta in reception, come sempre.» |
| C5 | Scheda socio | «Diario» diventa «Note» (solo nella scheda; il Diario dei Lead resta) |
| C6 | Listino | Filtro per stato (`?stato=`); l'ordine In vendita → Sospeso → Ritirato c'è già; paginazione a 12 |
| C7 | Abbonamenti venduti | Cinque riquadri di statistiche; tabella ordinata per inizio decrescente e paginata a 25 |
| C8 | Ingressi | «Con avvisi» diventa «Da controllare», sempre in giallo |
| C9 | Scheda socio | **Proposta, non approvata**: tab Anagrafica · Abbonamenti · Documenti · Accesso · Note. Solo mockup |

Proposte di Claude tenute: P1 (indirizzo e «Torna ai soci»), P2 (ricerca a tutta riga), P3 (ordine e paginazione dei venduti), P5 (tipi a vendita chiusa in fondo), P6 (stato di Iscrivi solo per lo screen reader). Scartata: P4 (colonne dei venduti da telefono).

### C1 · Paginazione
- Elenco: 12 tile (3×4) o 25 righe di tabella. Listino: 12. Venduti: 25. Il paginatore compare solo oltre una pagina.
- Contenuto: «1–12 di 54», Precedente, «Pagina 1 di 5», Successivo.
- Filtro, ricerca, ordine o vista riportano a pagina 1.
- Indirizzo: `?pagina=2&q=…&ordine=…`, accanto a `fase` e `segnale` (che restano).
- `MemberDetail.jsx:349`: «Torna ai soci» usa `to={"/crm" + (state?.da ?? "")}`; le tile e le righe passano `<Link state={{ da: location.search }}>`.

### C2 · Ricerca
`corrispondeRicerca(socio, testo)`: minuscolo, senza accenti, `’ʼ‘` uniformati a `'`, spazi ridotti; ogni parola deve comparire in nome, email o codice; telefono da 3 cifre. Sostituisce `MembersList.jsx:154-155`. La ricerca globale Ctrl+K (`server/src/routes/persone.js:57`) non cambia. **(K8: in `shared/ricerca.js`.)**

| Digitato | Oggi | Dopo | Come lo so |
|---|---|---|---|
| Alessandro | 1 | 1 | Provato, 54 soci |
| Colombo Alessandro | 0 | 1 | Provato: 0 su 54 |
| colombo ale | 0 | 1 | Provato: 0 su 54 |
| D’Angelo con ’ del telefono | 0 | 2 | Dal codice |
| Niccolo per Niccolò | 0 | sì | Dal codice |

### C3 · Riga cliccabile
`MembersList.jsx:289-292`: `onClick` sulla riga con `useNavigate` e cursore a mano, con guardia `e.target.closest("a,button")`. Senza la guardia il clic sul nome navigherebbe due volte e la seconda volta senza `state`, perdendo la pagina. «Contatta» fa già `stopPropagation` (`MembersList.jsx:104`).

### C4 · Iscrivi
- `Iscrivi.jsx:176`: resta «Scade il {data}.» (dato calcolato), cade la frase sull'incasso.
- `Iscrivi.jsx:240`: il paragrafo di stato (quattro messaggi, righe 87-91) diventa `sr-only`.
- `Iscrivi.jsx:241`: il gruppo dei pulsanti prende `sm:ml-auto`, altrimenti «Avanti» scivola a sinistra.
- Vale anche per Iscrivi aperto dai Lead (`pages/lead/Contatti.jsx:493`): è lo stesso componente.
- Non toccate le altre frasi di aiuto («Se lo porta dopo, salta…», «Il socio le può cambiare…», descrizione sotto il titolo).

### C5 · Note
`DiarioSocio.jsx:63`: titolo «Note». Il campo «Note» dell'anagrafica resta com'è (scelta B). Il glossario è già aggiornato su main (K14).

### C6 · Listino
- Menu in intestazione, accanto a «Nuovo tipo»: Tutti i tipi (11) · In vendita (9) · Sospeso (1) · Ritirato (1).
- `ordinaTipi(tipi, oggi)` in `shared/abbonamenti.js` sostituisce `ORDINE_STATO` e il sort di `PlansCatalog.jsx:33,61`; un tipo In vendita con data di vendita passata va in fondo al gruppo (P5). A parità, ordine alfabetico.

### C7 · Abbonamenti venduti
Cinque riquadri sopra la tabella, calcolati su **tutti** gli abbonamenti (non sul filtro).

| Riquadro | Regola | 3 nov 2026 (dati locali) |
|---|---|---|
| Venduti a novembre | `start_date` nel mese di calendario corrente | 6 |
| Venduti a ottobre | `start_date` nel mese precedente | 17 |
| Venduti a nov 2025 | `start_date` nello stesso mese dell'anno prima | 8 |
| Attivi oggi | `start_date` ≤ oggi ≤ `end_date`; sotto, i soci distinti | 83 (50 soci) |
| In scadenza | tra gli attivi, `end_date` ≤ oggi + 1, 3, 6 mesi (cumulativi) | 10 · 33 · 54 |

- `statisticheVenduti(abbonamenti, oggi)` e `aggiungiMesi(giorno, n)` in `shared/abbonamenti.js` (giorno portato a fine mese: 31 gen + 1 mese = 28 feb).
- `Numero` si estrae da `AndamentoIngressi.jsx:17-27` in `staff/components/lead/andamento/comuni.jsx` e si riusa in `RiquadriVenduti.jsx`.
- Griglia: quattro colonne uguali e una da 1,5fr (`xl:grid-cols-[repeat(4,1fr)_1.5fr]`); da telefono due colonne, «In scadenza» a tutta riga. Etichette con due righe riservate per allineare i numeri.
- Le date arrivano dal server già corrette dalle sospensioni (`shared/abbonamenti.js:165-166`): sono quelle della colonna Periodo.
- «In scadenza» conta abbonamenti, non soci: dirlo nel sottotitolo del riquadro.

### C8 · Ingressi
`RegistroIngressi.jsx:23`: `ammesso_con_avvisi: "Da controllare"`. Il valore salvato non cambia (`server/src/db/schema/crm.js:165`, `server/src/routes/ingressi.js:36`, `server/test/ingressi.test.js:112,158`).

### C9 · Scheda a tab (proposta, fuori)
Pillole come in Ingressi, con `?scheda=`: Anagrafica · Abbonamenti (con prenotazioni fisse) · Documenti (con comunicazioni) · Accesso · Note. Dopo il ramo Da fare non c'è più `?azione=` da collegare.

## Database

Nessuna modifica, nessuna migrazione, dati esistenti invariati.

## Codice

| File | Funzione o componente | Azione | Motivo |
|---|---|---|---|
| `ui/Paginazione.jsx` | Precedente, Successivo, «da–a di tot» | Aggiungi | C1, K9 |
| `core/domain/paginazione.js` | `paginaDi(elenco, pagina, perPagina)` | Aggiungi | C1 |
| `shared/ricerca.js` + riesportazione `core/domain/ricerca.js` | `corrispondeRicerca(socio, testo)` | Aggiungi | C2, K8 |
| `staff/pages/crm/MembersList.jsx:114-157` | parametri `pagina`, `q`, `ordine`; ricerca nuova | Cambia | C1, C2, P1 |
| `MembersList.jsx:174-184, 249, 289-292` | ricerca a tutta riga; `Link state={da}`; riga cliccabile con guardia | Cambia | P2, C3 |
| `staff/pages/crm/MemberDetail.jsx:349` | «Torna ai soci» con `state.da` | Cambia | P1 |
| `staff/components/soci/Iscrivi.jsx:176, 240-241` | frase incasso; stato `sr-only`; `sm:ml-auto` | Cambia | C4, P6 |
| `staff/components/soci/DiarioSocio.jsx:63` | titolo «Note» | Cambia | C5 |
| `staff/pages/crm/PlansCatalog.jsx:33,61` e menu | filtro `?stato=`, paginazione 12, `ordinaTipi()` | Cambia | C6, P5 |
| `staff/pages/crm/SubscriptionsList.jsx` | riquadri, ordine per `start_date`, paginazione 25 | Cambia | C7, P3 |
| `staff/components/soci/RiquadriVenduti.jsx` | cinque riquadri | Aggiungi | C7 |
| `staff/components/lead/andamento/comuni.jsx` | esporta `Numero` | Cambia | C7 |
| `staff/components/ingressi/RegistroIngressi.jsx:23` | etichetta «Da controllare» | Cambia | C8 |
| `shared/abbonamenti.js` (radice) | `aggiungiMesi`, `statisticheVenduti`, `ordinaTipi` | Aggiungi | C6, C7 |
| `server/scripts/verifica-da-fare.mjs:172-179` | scrive il nome nella ricerca prima di cliccare Contatta | Cambia | rottura, scelta A |
| `server/scripts/verifica-oggi.mjs:88-90` | stessa cosa per la riga del socio | Cambia | rottura, scelta A |

## Test

| File | Azione | Casi |
|---|---|---|
| `core/domain/paginazione.test.js` | Nuovo | elenco vuoto; pagina oltre l'ultima → ultima; 12 esatti → 1 pagina; 13 → 2 pagine |
| `core/domain/ricerca.test.js` | Nuovo | una parola come oggi; «Cognome Nome»; due parziali; accenti; `’` `ʼ` `'`; spazi doppi; telefono da 3 cifre; codice |
| `core/domain/abbonamenti.test.js` | Cambia | `ordinaTipi` (stati, vendita chiusa in fondo, alfabetico); `aggiungiMesi` (31 gen, 29 feb); `statisticheVenduti` (confini di mese, gennaio/dicembre, fine oggi attivo, inizio domani no, cumulativi crescenti, soci distinti) |

Si lanciano con `npm test` nella radice. I test del server restano uguali. Gli script `verifica-da-fare` e `verifica-oggi` li rilancia la sessione principale al punto di unione (K3).

## Collegamenti

| Dipendenza | Dove | Esito |
|---|---|---|
| Script Contatta per nome | `server/scripts/verifica-da-fare.mjs:172-179` | Si rompe: Marco e Sara non sono in pagina 1. Adattato |
| Script elenco filtrato | `server/scripts/verifica-oggi.mjs:88-90` | Può rompersi: la riga deve stare in pagina 1. Adattato |
| «Torna ai soci» | `MemberDetail.jsx:349` | `state.da`; senza `state` torna a `/crm` come oggi |
| Iscrivi dai Lead | `Contatti.jsx:493` | Cambia anche lì (voluto) |
| Clic sulla riga | `MembersList.jsx:289, 104` | Guardia `closest("a,button")` |

Non toccato: link a `/crm` con parametri (solo `verifica-oggi.mjs:88`); valore `ammesso_con_avvisi`; `shared/giorni.js`; confini del lint (`eslint.config.js:126-199`: `core` senza React, `ui` senza `staff`).

## Rischi

| Rischio | Dove | Mitigazione |
|---|---|---|
| «Avanti» a sinistra | `Iscrivi.jsx:240-241` | `sm:ml-auto` sul gruppo pulsanti |
| Doppia navigazione sulla riga | `MembersList.jsx:289` | guardia `closest("a,button")` |
| Classi Tailwind nuove assenti dal CSS | riquadri, griglia 1,5fr | controllare dopo `npx vite build` |
| `start_date` spostato dalle sospensioni | `shared/abbonamenti.js:165-166` | accettato |
| Tetto di 5.000 righe sulla lista | `server/src/routes/entities.js:26` | oggi 182 righe |
| Due gialli con parole diverse | `RegistroIngressi.jsx:20` e `:23` | non incluso: da decidere |
