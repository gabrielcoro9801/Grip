import React, { useState, useEffect, useCallback } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { caricaNotifiche, segnaNotificheLette } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Bell, CalendarX, CalendarCheck, Repeat, AlertTriangle, XCircle, ChevronRight, CheckCircle2, Ticket } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData, tempoFa } from "@/core/domain/format";
import { oggiIso } from "@/core/domain/giorni";

// Un'icona per tipo di notifica; un tipo nuovo che la pagina non conosce prende la campanella.
const ICONE = {
  lezione_annullata: CalendarX, fissa_senza_abbonamento: Repeat, fissa_da_allungare: Repeat,
  posto_offerto: Ticket, promosso_lista_attesa: CalendarCheck, sospensione_riprenotata: CalendarCheck,
};
// Da dove viene (D-3): la palestra che ha fatto qualcosa, la lista d'attesa, o GRIP da solo.
const ORIGINE = {
  lezione_annullata: "Dalla palestra", promosso_lista_attesa: "Dalla palestra",
  posto_offerto: "Dalla lista d'attesa",
  fissa_senza_abbonamento: "Automatica", fissa_da_allungare: "Automatica", sospensione_riprenotata: "Automatica",
};
/** Che cosa si può fare da una notifica, se c'è qualcosa: { percorso, etichetta }. */
function azioneDi(n) {
  if (n.tipo === "lezione_annullata") {
    if (!n.lezione || n.lezione.data < oggiIso()) return null;
    return { percorso: `/member-portal/corsi?giorno=${n.lezione.data}`, etichetta: `Altre lezioni di ${formatData(n.lezione.data, "giorno")}` };
  }
  if (n.tipo === "fissa_da_allungare") return { percorso: "/member-portal/lezioni", etichetta: "Allunga" };
  if (n.lezione_id || n.fissa_id) return { percorso: "/member-portal/lezioni", etichetta: "Vedi la lezione" };
  return null;
}
// Dove si sistema un avviso.
const AZIONI = {
  abbonamento: { percorso: "/member-portal/abbonamento", etichetta: "Vai all'abbonamento" },
};
// Gravità: colore, icona ed etichetta insieme, mai il colore da solo.
const GRAVITA = {
  rosso: { icona: XCircle, etichetta: "Da sistemare subito", classi: "border-destructive/40 bg-destructive/10", testo: "text-destructive" },
  giallo: { icona: AlertTriangle, etichetta: "Da sistemare", classi: "border-warning/40 bg-warning/10", testo: "text-warning" },
};

/**
 * Notifiche e avvisi, due cose diverse nella stessa pagina.
 *
 * Gli **avvisi** sono quello che è vero adesso e va sistemato — un abbonamento scaduto o in
 * scadenza — e si calcolano a ogni apertura: spariscono da soli quando il socio
 * rinnova, quindi non si "leggono". Le **notifiche** sono le cose successe
 * (una lezione annullata, una prenotazione fissa ferma): aprire la pagina le segna come lette, e
 * le nuove restano evidenziate finché si resta qui.
 */
export default function MemberNotifiche() {
  const { azzeraNonLette } = useOutletContext() ?? {};
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);

  const carica = useCallback(() => {
    setErrore(null);
    caricaNotifiche()
      .then(async (risposta) => {
        setDati(risposta);
        if (risposta.non_lette > 0) {
          await segnaNotificheLette();
          azzeraNonLette?.();
        }
      })
      .catch(setErrore);
  }, [azzeraNonLette]);

  useEffect(() => { carica(); }, [carica]);

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!dati) return <LoadingState minHeight="p-8" />;
  const avvisi = dati.avvisi_elenco ?? [];

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-heading font-bold">Notifiche e avvisi</h1>
        <p className="text-sm text-muted-foreground">Cosa c'è da sistemare, e cosa è successo</p>
      </div>

      <section aria-labelledby="titolo-avvisi" className="space-y-2">
        <h2 id="titolo-avvisi" className="text-sm font-semibold">Avvisi</h2>
        {avvisi.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3 text-sm text-muted-foreground">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" aria-hidden="true" />
              Nessun avviso: abbonamento in regola.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {avvisi.map((a) => {
              const g = GRAVITA[a.gravita] ?? GRAVITA.giallo;
              const azione = AZIONI[a.azione];
              return (
                <li key={a.codice} className={`rounded-lg border p-4 flex gap-3 ${g.classi}`}>
                  <g.icona className={`w-5 h-5 shrink-0 mt-0.5 ${g.testo}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-semibold">
                      {a.titolo} <span className={`ml-1 text-[10px] font-medium uppercase tracking-wide ${g.testo}`}>{g.etichetta}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{a.testo}</p>
                    {azione && (
                      <Link to={azione.percorso} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                        {azione.etichetta} <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="titolo-notifiche" className="space-y-2">
        <h2 id="titolo-notifiche" className="text-sm font-semibold">Notifiche</h2>
        {dati.notifiche.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 text-center">
              <Bell className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Nessuna notifica</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {dati.notifiche.map((n) => {
              const Icona = ICONE[n.tipo] ?? Bell;
              return (
                <li key={n.id}>
                  <Card className={`border-0 shadow-sm ${n.letta ? "" : "ring-1 ring-primary/40 bg-primary/5"}`}>
                    <CardContent className="p-4 flex gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${n.letta ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
                        <Icona className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {n.titolo}
                          {!n.letta && <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-primary">Nuova</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {ORIGINE[n.tipo] ?? "Dalla palestra"} · <time dateTime={n.creata_il}>{tempoFa(n.creata_il)}</time>
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">{n.testo}</p>
                        {azioneDi(n) && (
                          <Link to={azioneDi(n).percorso} className="mt-1 inline-flex items-center gap-1 min-h-11 text-sm font-medium text-primary hover:underline">
                            {azioneDi(n).etichetta} <ChevronRight className="w-4 h-4" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted-foreground text-center">
        Il portale non manda email né notifiche sul telefono: quello che succede alle tue prenotazioni lo trovi qui e in Home.
      </p>
    </div>
  );
}
