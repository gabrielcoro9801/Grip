import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { caricaProfilo, caricaMieProssime, caricaNotifiche, caricaMieiOrari } from "@/core/api/portale";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { ChevronRight, Bell, MapPin, User } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData, giornoLezione, quandoIstante } from "@/core/domain/format";
import { oggiIso, spostaGiorni } from "@/core/domain/giorni";
import { PillolaStato, RigaLezione, TermineDisdetta, AggiungiAlCalendario, useDisdici, usePrenota, nomeLezione, ora } from "@/member/components/lezioni";
import { CardLezione, useTocco } from "@/member/components/corsi";
import { usePalestra } from "@/member/components/Palestra";

// La Home (docs/piani/portale.md, D-2): in cima la novità che conta, poi l'abbonamento in una riga,
// la prossima lezione in grande e le due dopo. Niente da sistemare qui: gli avvisi stanno nelle
// Notifiche, e l'abbonamento scaduto si vede già rosso nella sua riga.

/**
 * In cima, la novità che conta. Prima un posto offerto dalla lista d'attesa, con «Conferma»
 * (scade); poi una notifica non letta su una lezione dei prossimi due giorni, che apre le Notifiche.
 */
function Novita({ offerta, notifica, onConferma, inCorso }) {
  if (offerta) {
    return (
      <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 space-y-2">
        <p className="text-sm font-semibold">Si è liberato un posto: {nomeLezione(offerta)}</p>
        <p className="text-sm text-muted-foreground">Dalla lista d'attesa. È tuo se lo confermi entro {quandoIstante(offerta.mia_prenotazione.posto_offerto_fino_a)}.</p>
        <Button className="w-full min-h-11" disabled={inCorso} onClick={() => onConferma(offerta)}>Conferma</Button>
      </div>
    );
  }
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
function ProssimaLezione({ lezione, onDisdici, inCorso, palestra }) {
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
          <PillolaStato lezione={lezione} />
        </div>
        <div>
          <h2 className="text-lg font-heading font-bold">{lezione.corso?.nome ?? "Lezione"}</h2>
          <p className="text-sm font-medium">{giornoLezione(lezione.data)} · {ora(lezione.inizio)}–{ora(lezione.fine)}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lezione.sala && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />{lezione.sala.nome}</span>}
            {lezione.istruttore && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" aria-hidden="true" />{lezione.istruttore.nome}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {puoDisdire && (
            <Button variant="outline" className="flex-1 min-h-11" disabled={inCorso} onClick={() => onDisdici(lezione)}>
              {lezione.mia_prenotazione.stato === "waitlisted" ? "Esci dalla lista" : "Disdici"}
            </Button>
          )}
          {lezione.mia_prenotazione.stato === "confirmed" && <AggiungiAlCalendario lezione={lezione} palestra={palestra} className="flex-1" />}
        </div>
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
      caricaMieiOrari().catch(() => []),
    ])
      .then(([profilo, lezioni, notifiche, mieiOrari]) => setDati({ profilo, lezioni, notifiche, mieiOrari }))
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

  const palestra = usePalestra();
  const [disdici, dialogoDisdici, disdicendo] = useDisdici(carica);
  const [prenota, prenotando] = usePrenota(carica);
  const { tocca, fogli, inCorso: toccando } = useTocco(carica, palestra);
  const inCorso = disdicendo || prenotando || toccando;

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!dati) return <LoadingState minHeight="p-8" />;

  const { profilo, lezioni, notifiche, mieiOrari } = dati;
  const offerta = (lezioni ?? []).find((l) => l.mia_prenotazione?.posto_offerto_fino_a);
  const fraDueGiorni = spostaGiorni(oggiIso(), 2);
  const novita = (notifiche?.notifiche ?? []).find((n) => !n.letta && n.lezione && n.lezione.data >= oggiIso() && n.lezione.data <= fraDueGiorni);
  const [prossima, ...dopo] = lezioni ?? [];

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <Novita offerta={offerta} notifica={novita} onConferma={prenota} inCorso={inCorso} />

      <h1 className="text-xl font-heading font-bold">
        Ciao, {profilo?.socio?.nome?.split(" ")[0] || memberUser.nome}
      </h1>

      <RigaAbbonamento abbonamento={profilo?.abbonamento} />

      {lezioni && <ProssimaLezione lezione={prossima} onDisdici={disdici} inCorso={inCorso} palestra={palestra} />}

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
      {mieiOrari?.length > 0 && (
        <section aria-labelledby="titolo-tuoi-corsi" className="space-y-2">
          <h2 id="titolo-tuoi-corsi" className="text-sm font-semibold">I tuoi corsi</h2>
          <ul className="space-y-2">
            {mieiOrari.map((l) => <CardLezione key={l.id} lezione={l} onTocca={tocca} inCorso={inCorso} conGiorno />)}
          </ul>
        </section>
      )}
      {dialogoDisdici}
      {fogli}
    </div>
  );
}
