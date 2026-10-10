import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { SESSI, etichettaSesso } from "@/core/domain/anagrafica";

const etichettaSessoAndamento = (v) => (v === "nd" ? "Non indicato" : etichettaSesso(v));
import { oggiIso } from "@/core/domain/giorni";
import {
  MESI, FASCE_ETA, intervalloPeriodo, filtraAndamento, fasciaEta, riepilogoAndamento, serieMensile, esitiPerCanale,
  matriceStagionalita, motiviPerdita, contaInOrdine, anniDisponibili, etichettaMotivoChiusura,
} from "@/core/domain/lead";
import RiquadriNumeri from "@/staff/components/lead/andamento/RiquadriNumeri";
import GraficoMensile from "@/staff/components/lead/andamento/GraficoMensile";
import EsitiCanali from "@/staff/components/lead/andamento/EsitiCanali";
import Stagionalita from "@/staff/components/lead/andamento/Stagionalita";
import BarreConteggio from "@/staff/components/lead/andamento/BarreConteggio";
import { COLORI } from "@/staff/components/lead/andamento/comuni";
import { X } from "lucide-react";

// Radix non accetta una voce con valore vuoto: "tutti" è il filtro spento.
const TUTTI = "tutti";

function Filtro({ id, etichetta, valore, onChange, voci }) {
  return (
    <div className="min-w-[10rem] flex-1 sm:flex-none">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{etichetta}</Label>
      <Select value={valore ?? TUTTI} onValueChange={(v) => onChange(v === TUTTI ? null : v)}>
        <SelectTrigger id={id} className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {voci.map((v) => <SelectItem key={v.valore} value={v.valore}>{v.etichetta}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

const etichettaMotivo = (m) => (m === "non_raggiungibile" ? "Non raggiungibile" : etichettaMotivoChiusura(m));
const meseLeggibile = (mese) => `${MESI[Number(mese.slice(5, 7)) - 1]} ${mese.slice(0, 4)}`;

/**
 * Andamento dei contatti: quanti ne arrivano, da dove, quando, di chi — e soprattutto quanti
 * diventano soci e perché gli altri si perdono.
 *
 * I filtri stanno in una riga sopra a tutto e nell'indirizzo, così una vista si manda a un
 * collega. Ogni grafico è anche un filtro: un clic su un mese, un canale, un sesso o una fascia
 * restringe tutta la pagina. Il grafico da cui si è filtrato ignora il proprio filtro, così la
 * voce scelta resta in evidenza e le altre si vedono ancora, attenuate.
 */
export default function Andamento() {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  const [parametri, setParametri] = useSearchParams();

  const carica = useCallback(() => {
    setErrore(null);
    api.lead.andamento().then(setDati).catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);

  const filtri = {
    periodo: parametri.get("periodo") || "ultimi_12",
    canaleId: parametri.get("canale"),
    sesso: parametri.get("sesso"),
    fascia: parametri.get("eta"),
    mese: parametri.get("mese"),
  };
  const CHIAVI = { periodo: "periodo", canaleId: "canale", sesso: "sesso", fascia: "eta", mese: "mese" };
  const imposta = (campo) => (valore) => {
    const prossimi = new URLSearchParams(parametri);
    if (valore === null || (campo === "periodo" && valore === "ultimi_12")) prossimi.delete(CHIAVI[campo]);
    else prossimi.set(CHIAVI[campo], valore);
    // Cambiando periodo un mese scelto non c'è più.
    if (campo === "periodo") prossimi.delete("mese");
    setParametri(prossimi, { replace: true });
  };
  const azzera = () => setParametri({}, { replace: true });

  const oggi = oggiIso();
  const conti = useMemo(() => {
    if (!dati) return null;
    const { righe, canali } = dati;
    const { dal, al, mesi, precedente } = intervalloPeriodo(filtri.periodo, oggi);
    const { canaleId, sesso, fascia, mese } = filtri;
    const tutti = { dal, al, canaleId, sesso, fascia, mese };
    const meseAnnoPrima = mese ? `${Number(mese.slice(0, 4)) - 1}${mese.slice(4)}` : null;
    const senza = (campo) => filtraAndamento(righe, { ...tutti, [campo]: null });
    return {
      ora: riepilogoAndamento(filtraAndamento(righe, tutti)),
      prima: riepilogoAndamento(filtraAndamento(righe, { ...precedente, canaleId, sesso, fascia, mese: meseAnnoPrima })),
      serie: serieMensile(senza("mese"), mesi, filtraAndamento(righe, { ...precedente, canaleId, sesso, fascia })),
      canali: esitiPerCanale(senza("canaleId"), canali),
      stagioni: matriceStagionalita(senza("canaleId"), canali),
      motivi: motiviPerdita(filtraAndamento(righe, tutti)),
      // Il sesso di un contatto è facoltativo: chi non l'ha indicato si conta a parte, come l'età.
      sessi: contaInOrdine(senza("sesso"), (r) => r.sesso ?? "nd", [...SESSI.map((s) => s.valore), "nd"]),
      fasce: contaInOrdine(senza("fascia"), fasciaEta, FASCE_ETA.map((f) => f.valore)),
      anni: anniDisponibili(righe),
      vuoto: righe.length === 0,
    };
    // `filtri` si ricostruisce a ogni render dai parametri: dipende da loro.
  }, [dati, parametri, oggi]);

  if (errore) return <ErrorState error={errore} onRetry={carica} />;
  if (!conti) return <LoadingState minHeight="h-64" />;

  const nomeCanale = (id) => dati.canali.find((c) => c.id === id)?.nome ?? "Canale eliminato";
  const annoCorrente = Number(oggi.slice(0, 4));
  const vociPeriodo = [
    { valore: "ultimi_12", etichetta: "Ultimi 12 mesi" },
    { valore: "anno", etichetta: `Quest'anno (${annoCorrente})` },
    ...conti.anni.filter((a) => a !== annoCorrente).map((a) => ({ valore: String(a), etichetta: String(a) })),
  ];
  const filtriAttivi = [
    filtri.mese && { campo: "mese", testo: meseLeggibile(filtri.mese) },
    filtri.canaleId && { campo: "canaleId", testo: nomeCanale(filtri.canaleId) },
    filtri.sesso && { campo: "sesso", testo: etichettaSessoAndamento(filtri.sesso) },
    filtri.fascia && { campo: "fascia", testo: FASCE_ETA.find((f) => f.valore === filtri.fascia)?.etichetta },
  ].filter(Boolean);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader title="Andamento dei contatti" description="Quanti contatti arrivano, da dove e quando — e quanti diventano soci." />

      {/* Una riga di filtri sopra a tutto: ogni grafico qui sotto guarda la stessa fetta. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <Filtro id="f-periodo" etichetta="Periodo" valore={filtri.periodo} onChange={(v) => imposta("periodo")(v ?? "ultimi_12")} voci={vociPeriodo} />
          <Filtro
            id="f-canale" etichetta="Canale" valore={filtri.canaleId} onChange={imposta("canaleId")}
            voci={[{ valore: TUTTI, etichetta: "Tutti" }, ...dati.canali.map((c) => ({ valore: c.id, etichetta: c.nome }))]}
          />
          <Filtro
            id="f-sesso" etichetta="Sesso" valore={filtri.sesso} onChange={imposta("sesso")}
            voci={[{ valore: TUTTI, etichetta: "Tutti" }, ...SESSI.map((s) => ({ valore: s.valore, etichetta: s.etichetta }))]}
          />
          <Filtro
            id="f-eta" etichetta="Età" valore={filtri.fascia} onChange={imposta("fascia")}
            voci={[{ valore: TUTTI, etichetta: "Tutte" }, ...FASCE_ETA.map((f) => ({ valore: f.valore, etichetta: f.etichetta }))]}
          />
          {(filtriAttivi.length > 0 || filtri.periodo !== "ultimi_12") && (
            <Button variant="ghost" size="sm" className="h-9" onClick={azzera}>Azzera filtri</Button>
          )}
        </div>
        {filtriAttivi.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Filtri attivi">
            {filtriAttivi.map((f) => (
              <li key={f.campo}>
                <button
                  type="button" onClick={() => imposta(f.campo)(null)}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2.5 py-1 hover:bg-primary/20"
                  aria-label={`Togli il filtro ${f.testo}`}
                >
                  {f.testo} <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {conti.vuoto ? (
        <p className="text-sm text-muted-foreground text-center py-16">Nessun contatto registrato: i numeri compariranno con i primi lead.</p>
      ) : (
        <>
          <RiquadriNumeri ora={conti.ora} prima={conti.prima} />

          <GraficoMensile serie={conti.serie} meseScelto={filtri.mese} onScegliMese={imposta("mese")} />

          <EsitiCanali canali={conti.canali} canaleScelto={filtri.canaleId} onScegliCanale={imposta("canaleId")} />

          {/* La stagionalità a tutta larghezza: dodici mesi in colonna non stanno in mezza pagina. */}
          <Stagionalita matrice={conti.stagioni} />

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            <BarreConteggio
              titolo="Perché si perdono"
              sottotitolo="I motivi dei contatti chiusi senza iscrizione"
              voci={conti.motivi.map((m) => ({ chiave: m.motivo, etichetta: etichettaMotivo(m.motivo), totale: m.totale }))}
              colore={COLORI.persi}
              vuoto="Nessun contatto perso nel periodo"
            />
            <BarreConteggio
              titolo="Per sesso" sottotitolo="Clic per filtrare"
              voci={conti.sessi.map((s) => ({ chiave: s.valore, etichetta: etichettaSessoAndamento(s.valore), totale: s.totale }))}
              colore={COLORI.contatti} scelta={filtri.sesso} onScegli={imposta("sesso")}
            />
            <BarreConteggio
              titolo="Per età" sottotitolo="All'anno del contatto · clic per filtrare"
              voci={conti.fasce.map((f) => ({ chiave: f.valore, etichetta: FASCE_ETA.find((x) => x.valore === f.valore).etichetta, totale: f.totale }))}
              colore={COLORI.contatti} scelta={filtri.fascia} onScegli={imposta("fascia")}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Diventati soci: chi si è iscritto dopo essere stato un contatto, contato nel mese in cui ci ha contattato.
            La provenienza dei soci si registra dal 7 ottobre 2026: chi è stato trasformato prima non compare fra le conversioni.
          </p>
        </>
      )}
    </div>
  );
}
