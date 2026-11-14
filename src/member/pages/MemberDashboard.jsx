import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { caricaProfilo, caricaMieProssime, caricaNotifiche } from "@/core/api/portale";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { ChevronRight, Bell, MapPin, User } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData, giornoLezione } from "@/core/domain/format";
import { PillolaStato, RigaLezione, TermineDisdetta, useDisdici, ora } from "@/member/components/lezioni";

// La Home (docs/piani/portale.md, D-2): in cima la novità che conta, poi l'abbonamento in una riga,
// la prossima lezione in grande e le due dopo. Niente da sistemare qui: gli avvisi stanno nelle
// Notifiche, e l'abbonamento scaduto si vede già rosso nella sua riga.

const DUE_GIORNI_MS = 48 * 3_600_000;

/**
 * La notifica non letta più recente delle ultime 48 ore, se c'è. Un tocco apre le Notifiche.
 * In D-3 sarà quella legata a una lezione dei prossimi due giorni, con l'azione.
 */
function Novita({ notifica }) {
  if (!notifica) return null;
  return (
    <Link to="/member-portal/notifiche" className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 min-h-11">
      <Bell className="w-4 h-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold">{notifica.titolo}</span>
        {notifica.testo && <span className="block text-sm text-muted-foreground">{notifica.testo}</span>}
      </span>
      <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/** L'abbonamento in una riga: il pallino, fino a quando, quanto manca. Un tocco apre Abbonamento. */
function RigaAbbonamento({ abbonamento }) {
  const giorni = abbonamento?.giorni_alla_scadenza;
  const scaduto = !abbonamento || giorni < 0;
  const inScadenza = !scaduto && abbonamento.in_scadenza;
  const pallino = scaduto ? "bg-destructive" : inScadenza ? "bg-warning" : "bg-success";
  const titolo = !abbonamento
    ? "Nessun abbonamento"
    : scaduto
      ? `Abbonamento scaduto il ${formatData(abbonamento.fine, "lungo")}`
      : `Abbonamento valido fino al ${formatData(abbonamento.fine, "lungo")}`;
  const sotto = !abbonamento
    ? "Per abbonarti passa in reception"
    : scaduto
      ? `${abbonamento.piano} · per rinnovare passa in reception`
      : `${abbonamento.piano} · ${giorni === 0 ? "scade oggi" : giorni === 1 ? "manca 1 giorno" : `mancano ${giorni} giorni`}`;
  return (
    <Link to="/member-portal/abbonamento" className="flex items-center gap-3 rounded-lg bg-card shadow-sm px-4 py-3 min-h-11">
      <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${pallino}`} />
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-medium ${scaduto ? "text-destructive" : ""}`}>{titolo}</span>
        <span className="block text-xs text-muted-foreground">{sotto}</span>
      </span>
      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/** La prossima lezione, in grande: lo stato, quando, dove, con chi; Disdici e il termine. */
function ProssimaLezione({ lezione, onDisdici, inCorso }) {
  if (!lezione) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Nessuna lezione prenotata</p>
          <Button asChild className="min-h-11"><Link to="/member-portal/corsi">Prenota una lezione</Link></Button>
        </CardContent>
      </Card>
    );
  }
  const puoDisdire = !lezione.motivo_disdetta_chiusa;
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prossima lezione</p>
          <PillolaStato prenotazione={lezione.mia_prenotazione} />
        </div>
        <div>
          <h2 className="text-lg font-heading font-bold">{lezione.corso?.nome ?? "Lezione"}</h2>
          <p className="text-sm font-medium">{giornoLezione(lezione.data)} · {ora(lezione.inizio)}–{ora(lezione.fine)}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lezione.sala && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />{lezione.sala.nome}</span>}
            {lezione.istruttore && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" aria-hidden="true" />{lezione.istruttore.nome}</span>}
          </div>
        </div>
        {puoDisdire && (
          <Button variant="outline" className="w-full min-h-11" disabled={inCorso} onClick={() => onDisdici(lezione)}>
            {lezione.mia_prenotazione.stato === "waitlisted" ? "Esci dalla lista" : "Disdici"}
          </Button>
        )}
        <TermineDisdetta lezione={lezione} className="text-center" />
      </CardContent>
    </Card>
  );
}

export default function MemberDashboard() {
  const { memberUser } = useMemberAuth();
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);

  // Profilo e prossime lezioni insieme; se le lezioni o le notifiche non arrivano la Home resta
  // utile lo stesso. Se il profilo non arriva lo si dice: prima la pagina mostrava "nessun
  // abbonamento" a chi ce l'ha, solo perché la rete era caduta.
  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([
      caricaProfilo(),
      caricaMieProssime().catch(() => null),
      caricaNotifiche().catch(() => null),
    ])
      .then(([profilo, lezioni, notifiche]) => setDati({ profilo, lezioni, notifiche }))
      .catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);
  // Si torna sul portale dopo un po': quello che è cambiato intanto (un posto offerto, una
  // lezione annullata) si rilegge.
  useEffect(() => {
    const torna = () => { if (document.visibilityState === "visible") carica(); };
    document.addEventListener("visibilitychange", torna);
    return () => document.removeEventListener("visibilitychange", torna);
  }, [carica]);

  const [disdici, dialogoDisdici, inCorso] = useDisdici(carica);

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!dati) return <LoadingState minHeight="p-8" />;

  const { profilo, lezioni, notifiche } = dati;
  const novita = (notifiche?.notifiche ?? []).find((n) => !n.letta && Date.now() - Date.parse(n.creata_il) < DUE_GIORNI_MS);
  const [prossima, ...dopo] = lezioni ?? [];

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <Novita notifica={novita} />

      <h1 className="text-xl font-heading font-bold">
        Ciao, {profilo?.socio?.nome?.split(" ")[0] || memberUser.nome}
      </h1>

      <RigaAbbonamento abbonamento={profilo?.abbonamento} />

      {lezioni && <ProssimaLezione lezione={prossima} onDisdici={disdici} inCorso={inCorso} />}

      {dopo.length > 0 && (
        <section aria-labelledby="titolo-dopo">
          <h2 id="titolo-dopo" className="text-sm font-semibold mb-1">Poi</h2>
          <Card className="border-0 shadow-sm">
            <CardContent className="px-4 py-1">
              <ul className="divide-y divide-border">
                {dopo.slice(0, 2).map((l) => <RigaLezione key={l.id} lezione={l} />)}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
      {lezioni && (
        <Link to="/member-portal/lezioni" className="flex items-center justify-center gap-1 min-h-11 rounded-md text-sm font-medium text-primary hover:bg-primary/5">
          Tutte le mie lezioni <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      )}
      {dialogoDisdici}
    </div>
  );
}
