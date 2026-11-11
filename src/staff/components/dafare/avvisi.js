// Le schede di Da fare e le loro regole in parole, con le soglie della palestra. Le leggono la
// barra (DaFareLayout), il titolo di ogni scheda (ElencoAvvisi) e le Regole, che le riscrivono
// mentre si cambiano i numeri.
import { TIPI_AVVISO } from "@/core/domain/daFare";
import { SOGLIE } from "@/core/domain/soglie";

/** Dove sta ogni scheda: il tipo dell'avviso e il suo percorso. */
export const SCHEDE = [
  { tipo: "in_scadenza", path: "/da-fare" },
  { tipo: "scaduto", path: "/da-fare/scaduti" },
  { tipo: "frequenza", path: "/da-fare/frequenza" },
  { tipo: "documento", path: "/da-fare/documenti" },
  { tipo: "compleanno", path: "/da-fare/compleanni" },
].map((s) => ({ ...s, ...TIPI_AVVISO.find((t) => t.valore === s.tipo) }));

/** Vera se la palestra non segue quel tipo: tutti i suoi segnali sono spenti nelle Regole. */
export function tipoSpento(tipo, spenti = []) {
  const t = TIPI_AVVISO.find((x) => x.valore === tipo);
  return Boolean(t) && t.segnali.every((s) => spenti.includes(s));
}

const giorni = (n) => `${n} ${n === 1 ? "giorno" : "giorni"}`;
const unite = (s = {}) => ({ ...SOGLIE, ...s, segnali: { ...SOGLIE.segnali, ...(s.segnali ?? {}) } });

/** Quando un avviso compare e quando se ne va, in parole: il sottotitolo della scheda e la regola nelle Regole. */
export function regolaAvviso(tipo, soglie) {
  const s = unite(soglie);
  switch (tipo) {
    case "in_scadenza":
      return `Compare quando l'abbonamento finisce entro ${giorni(s.abbonamentoInScadenzaGiorni)} e il socio non ha ancora rinnovato. Se ne va con il rinnovo, o quando scade e passa in Scaduti.`;
    case "scaduto":
      return `Compare quando l'abbonamento è scaduto senza un rinnovo. Se ne va con il rinnovo, o da solo ${giorni(s.scadutoGiorni)} dopo la scadenza.`;
    case "frequenza":
      return `Compare quando un socio non entra da ${giorni(s.segnali.assenzaGiorni)}, o nelle ultime 4 settimane viene meno del ${s.segnali.caloPercentuale}% della sua media (se viene almeno ${s.segnali.mediaMinimaCalo} volte ogni 4 settimane). Dopo «Contattato» o «Nascondi avviso» torna dopo ${giorni(s.frequenzaRiapriGiorni)}, se è ancora in calo.`;
    case "documento":
      return `Compare quando un documento obbligatorio è scaduto o scade entro ${giorni(s.documentoInScadenzaGiorni)}, uno per documento. Se ne va quando ne arriva uno nuovo dello stesso tipo.`;
    case "compleanno": {
      const prima = s.compleannoPrimaGiorni;
      const dopo = s.compleannoDopoGiorni;
      return `Compare ${prima ? `${giorni(prima)} prima del compleanno` : "il giorno del compleanno"} e se ne va da solo ${dopo ? `${giorni(dopo)} dopo` : "il giorno stesso"}, se non si segnano prima gli auguri.`;
    }
    default:
      return "";
  }
}
