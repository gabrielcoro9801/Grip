import React, { useState, useEffect, useCallback } from "react";
import { caricaProfilo, caricaAgenda } from "@/core/api/portale";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Link, useOutletContext } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { CreditCard, QrCode, FileText, ChevronRight, Calendar, AlertCircle, AlertTriangle, CalendarCheck } from "lucide-react";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData } from "@/core/domain/format";
import { oggiIso, spostaGiorni } from "@/core/domain/giorni";
import ConsensiComunicazioni from "@/member/components/ConsensiComunicazioni";

/**
 * Le prossime lezioni prenotate, al massimo tre: è la seconda cosa che il socio apre, dopo il QR.
 * Se l'agenda non arriva la sezione non c'è: la home resta utile anche senza.
 */
function ProssimeLezioni() {
  const [lezioni, setLezioni] = useState(null);
  useEffect(() => {
    const oggi = oggiIso();
    caricaAgenda({ dal: oggi, al: spostaGiorni(oggi, 30) })
      .then((a) => setLezioni(a.giorni.flatMap((g) => g.lezioni).filter((l) => l.mia_prenotazione && !l.finita).slice(0, 3)))
      .catch(() => setLezioni(null));
  }, []);
  if (!lezioni) return null;
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-heading flex items-center gap-2">
          <CalendarCheck className="w-4 h-4" aria-hidden="true" /> Le tue prossime lezioni
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {lezioni.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna lezione prenotata.</p>
        ) : (
          <ul className="divide-y divide-border">
            {lezioni.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{l.corso?.nome ?? "Lezione"}</p>
                  <p className="text-xs text-muted-foreground">{formatData(l.data, "giorno")} · {String(l.inizio).slice(0, 5)}{l.sala ? ` · ${l.sala.nome}` : ""}</p>
                </div>
                {l.mia_prenotazione.stato === "waitlisted" && (
                  <StatusBadge status="waitlisted" label={`In lista · ${l.mia_prenotazione.posizione_attesa}°`} />
                )}
              </li>
            ))}
          </ul>
        )}
        <Link to="/member-portal/corsi" className="flex items-center justify-center gap-1 min-h-11 rounded-md text-sm font-medium text-primary hover:bg-primary/5">
          Prenota una lezione <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

export default function MemberDashboard() {
  const { memberUser } = useMemberAuth();
  const { conteggio } = useOutletContext() ?? {};
  const [profilo, setProfilo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);

  // Una richiesta sola: anagrafica e abbonamento arrivano insieme, e quale sia
  // l'abbonamento in corso lo ha già deciso il server. Se fallisce lo si dice: prima la
  // pagina mostrava "nessun abbonamento" a chi ce l'ha, solo perché la rete era caduta.
  const carica = useCallback(() => {
    setLoading(true);
    setErrore(null);
    caricaProfilo()
      .then(setProfilo)
      .catch(setErrore)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  if (loading) {
    return <LoadingState minHeight="p-8" />;
  }
  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;

  const member = profilo?.socio;
  const activeSub = profilo?.abbonamento;
  const daysToExpiry = activeSub?.giorni_alla_scadenza ?? null;
  const expiringSoon = Boolean(activeSub?.in_scadenza) && daysToExpiry >= 0;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Se c'è qualcosa da sistemare (documenti, abbonamento) lo si dice in cima, con un link. */}
      {conteggio?.avvisi > 0 && (
        <Link
          to="/member-portal/notifiche"
          className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium ${conteggio.avvisi_gravi ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-warning"}`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{conteggio.avvisi === 1 ? "Hai 1 cosa da sistemare" : `Hai ${conteggio.avvisi} cose da sistemare`}</span>
          <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
        </Link>
      )}
      <h1 className="text-2xl font-heading font-bold">
        Ciao, {member?.nome?.split(" ")[0] || memberUser.nome}
      </h1>

      {/* Il QR in cima: è la cosa che si apre davanti al tornello, con una mano. Stava sotto
          l'abbonamento e, al primo accesso, sotto la domanda sui consensi. */}
      <Link to="/member-portal/qr" className="flex items-center gap-4 rounded-xl bg-primary text-primary-foreground p-4 min-h-[72px] shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <QrCode className="w-8 h-8 shrink-0" aria-hidden="true" />
        <span className="flex-1">
          <span className="block font-heading font-semibold">Mostra il QR per entrare</span>
          <span className="block text-sm opacity-90">Il codice cambia ogni minuto</span>
        </span>
        <ChevronRight className="w-5 h-5 shrink-0" aria-hidden="true" />
      </Link>

      <ProssimeLezioni />

      {/* Chi non ha mai scelto se ricevere promozioni se lo sente chiedere qui, una volta. */}
      <ConsensiComunicazioni primaVolta />

      {/* Subscription summary */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> Il mio abbonamento
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!activeSub ? (
            <p className="text-sm text-muted-foreground text-center py-3">Nessun abbonamento valido</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{activeSub.piano}</h3>
                <StatusBadge status={activeSub.stato} />
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Inizio: {formatData(activeSub.inizio, "lungo")}</div>
                <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Fine: {formatData(activeSub.fine, "lungo")}</div>
              </div>
              {expiringSoon && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs">
                  <AlertCircle className="w-4 h-4" />
                  In scadenza tra {daysToExpiry} giorni
                </div>
              )}
              <Link to="/member-portal/abbonamento">
                <Button variant="ghost" size="sm" className="w-full mt-1">
                  Dettagli <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documenti non è nella barra in basso: l'unica strada dal telefono, con l'abbonamento
          ("Dettagli" qui sopra). Le tile di prima ripetevano anche Anagrafica, che nella barra c'è. */}
      <Link to="/member-portal/documenti" className="flex items-center gap-3 rounded-xl bg-card shadow-sm p-4 min-h-11 hover:bg-muted/50">
        <FileText className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
        <span className="flex-1 text-sm font-medium">I tuoi documenti</span>
        <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
      </Link>
    </div>
  );
}