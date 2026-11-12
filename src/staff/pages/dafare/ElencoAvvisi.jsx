import React, { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api } from "@/core/api/client";
import PageHeader from "@/staff/components/PageHeader";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import SchedaAvviso from "@/staff/components/dafare/SchedaAvviso";
import Contatta from "@/staff/components/soci/Contatta";
import DialogoVendita from "@/staff/components/soci/DialogoVendita";
import DialogoAbbandono from "@/staff/components/soci/DialogoAbbandono";
import DialogoCaricaDocumento from "@/staff/components/soci/DialogoCaricaDocumento";
import { SCHEDE, regolaAvviso, tipoSpento } from "@/staff/components/dafare/avvisi";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { spostaGiorni } from "@/core/domain/giorni";
import { ListChecks } from "lucide-react";

// Come si dice, dopo, una chiusura a mano: l'avviso è finito in Archivio.
const DETTO = {
  nascosto: "Avviso nascosto",
  contattato: "Segnato: contattato",
  auguri_fatti: "Segnato: auguri fatti",
};

/**
 * Una scheda di Da fare: gli avvisi aperti di un tipo, nell'ordine dell'urgenza (lo dà il
 * server, shared/daFare.js `ordina`). Da 1280 px su due colonne (P2).
 *
 * Ogni azione si fa qui, senza uscire: Rinnova apre la vendita già compilata (lo stesso tipo,
 * dal giorno dopo la fine; per uno scaduto, da oggi), Non rinnova «Perché se ne va?», Carica
 * documento il caricamento con il tipo già scelto. Quelle tre non chiudono l'avviso a mano: lo
 * chiude il server alla lettura dopo, con l'esito giusto. Contattato, Auguri fatti e Nascondi
 * avviso lo chiudono subito. Dopo ogni azione si rileggono la lista e i numeri della barra.
 *
 * @param tipo uno dei cinque tipi (shared/daFare.js, TIPI_AVVISO)
 */
export default function ElencoAvvisi({ tipo }) {
  const { aggiornaConteggi } = useOutletContext() ?? {};
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  const [occupato, setOccupato] = useState(null); // l'id dell'avviso con un'azione in corso
  // La finestra aperta: { quale: 'recapiti'|'vendita'|'abbandono'|'documento', avviso, proposta? }
  const [finestra, setFinestra] = useState(null);

  const scheda = SCHEDE.find((s) => s.tipo === tipo);
  const puoModificare = canEdit(staffUser?.ruolo, "crm_members");
  const puoCaricare = puoModificare && canEdit(staffUser?.ruolo, "crm_documents");

  const carica = useCallback(() => {
    setErrore(null);
    return api.avvisi.lista({ tipo })
      .then((d) => { setDati(d); aggiornaConteggi?.(d.conteggi); })
      .catch(setErrore);
  }, [tipo, aggiornaConteggi]);
  useEffect(() => { carica(); }, [carica]);

  const chiudi = async (avviso, esito) => {
    setOccupato(avviso.id);
    try {
      await api.avvisi.chiudi(avviso.id, esito);
      toast({ title: `${avviso.nome}: ${DETTO[esito].toLowerCase()}`, description: "Lo ritrovi in Archivio." });
    } catch (err) {
      toast({ title: "Non fatto", description: err.message, variant: "destructive" });
    }
    await carica();
    setOccupato(null);
  };

  // Il rinnovo: lo stesso tipo dell'abbonamento che scade, dal giorno dopo la fine. Per uno
  // scaduto da oggi: i giorni già passati non si vendono.
  const rinnova = async (avviso) => {
    setOccupato(avviso.id);
    const oggi = dati.oggi;
    const fine = avviso.dati?.data;
    const start_date = avviso.tipo === "in_scadenza" && fine && fine >= oggi ? spostaGiorni(fine, 1) : oggi;
    let plan_id = "";
    try {
      if (avviso.dati?.iscrizione_id) plan_id = (await api.entities.Subscription.get(avviso.dati.iscrizione_id))?.plan_id ?? "";
    } catch {
      // Senza l'abbonamento di prima la vendita si apre lo stesso: il tipo lo si sceglie a mano.
    }
    setOccupato(null);
    setFinestra({ quale: "vendita", avviso, proposta: { plan_id, start_date } });
  };

  const azione = (avviso, nome) => {
    switch (nome) {
      case "recapiti": return setFinestra({ quale: "recapiti", avviso });
      case "rinnova": return rinnova(avviso);
      case "non_rinnova": return setFinestra({ quale: "abbandono", avviso });
      case "carica": return setFinestra({ quale: "documento", avviso });
      case "contattato": return chiudi(avviso, "contattato");
      case "auguri_fatti": return chiudi(avviso, "auguri_fatti");
      case "nascondi": return chiudi(avviso, "nascosto");
      default: return undefined;
    }
  };

  const aperta = (quale) => (finestra?.quale === quale ? finestra.avviso : null);
  const chiudiFinestra = () => setFinestra(null);
  const spento = dati && tipoSpento(tipo, dati.soglie?.segnaliSpenti);

  return (
    <div>
      <PageHeader title={scheda?.titolo} description={regolaAvviso(tipo, dati?.soglie)} />

      {errore && <ErrorState error={errore} onRetry={carica} />}
      {!dati && !errore && <LoadingState minHeight="h-64" />}

      {dati && spento && (
        <EmptyState
          icon={ListChecks} title="La palestra non segue questo avviso"
          description="È spento nelle Regole di Da fare: non compare per nessuno."
          action={canEdit(staffUser?.ruolo, "admin_users") && <Link to="/da-fare/regole" className="text-sm text-primary hover:underline">Apri le Regole</Link>}
        />
      )}
      {dati && !spento && dati.avvisi.length === 0 && (
        <EmptyState icon={ListChecks} title="Niente da fare qui" description="Gli avvisi chiusi sono in Archivio." />
      )}
      {dati && !spento && dati.avvisi.length > 0 && (
        <ol className="grid gap-3 xl:grid-cols-2">
          {dati.avvisi.map((a) => (
            <li key={a.id}>
              <SchedaAvviso
                avviso={a} oggi={dati.oggi} puoModificare={puoModificare} puoCaricare={puoCaricare}
                occupato={occupato === a.id} onAzione={(nome) => azione(a, nome)}
              />
            </li>
          ))}
        </ol>
      )}

      <Contatta soloRecapiti socio={aperta("recapiti")} onChiudi={chiudiFinestra} />
      <DialogoVendita
        socioId={aperta("vendita")?.socio_id} proposta={finestra?.quale === "vendita" ? finestra.proposta : null}
        onChiudi={chiudiFinestra} onFatto={carica}
      />
      {aperta("abbandono") && (
        <DialogoAbbandono socio={{ id: aperta("abbandono").socio_id, nome: aperta("abbandono").nome }} aperto onChiudi={chiudiFinestra} onFatto={carica} />
      )}
      <DialogoCaricaDocumento
        socioId={aperta("documento")?.socio_id} tipo={aperta("documento")?.dati?.tipo_documento ?? null}
        caricatoDa={staffUser?.nome || ""} onChiudi={chiudiFinestra} onFatto={carica}
      />
    </div>
  );
}
