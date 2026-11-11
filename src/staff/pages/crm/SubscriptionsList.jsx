import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/core/api/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { Link, useSearchParams } from "react-router-dom";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { CreditCard } from "lucide-react";
import { formatData, formatEuro } from "@/core/domain/format";
import { oggiIso, statisticheVenduti } from "@/core/domain/abbonamenti";
import { paginaDi } from "@/core/domain/paginazione";
import Paginazione from "@/ui/Paginazione";
import RiquadriVenduti from "@/staff/components/soci/RiquadriVenduti";

const FILTRI = ["active", "expiring", "expired"];
const PER_PAGINA = 25;

export default function SubscriptionsList() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);
  // Filtro e pagina stanno nell'indirizzo, come nell'elenco soci: tornando indietro da un socio
  // si ritrova la stessa pagina. Cambiare filtro riporta a pagina 1.
  const [parametri, setParametri] = useSearchParams();
  const filter = FILTRI.includes(parametri.get("stato")) ? parametri.get("stato") : "all";
  const pagina = Number(parametri.get("pagina")) || 1;
  const aggiorna = (cambi) => {
    const prossimi = new URLSearchParams(parametri);
    for (const [chiave, valore] of Object.entries(cambi)) {
      if (valore === null) prossimi.delete(chiave); else prossimi.set(chiave, valore);
    }
    setParametri(prossimi, { replace: true });
  };
  const filtra = (v) => aggiorna({ stato: v === "all" ? null : v, pagina: null });
  const cambiaPagina = (p) => {
    aggiorna({ pagina: p > 1 ? String(p) : null });
    window.scrollTo({ top: 0 });
  };

  // Senza `catch`, un errore di rete lasciava la pagina sulla rotellina per sempre.
  const carica = useCallback(() => {
    setLoading(true);
    setErrore(null);
    Promise.all([
      api.entities.Subscription.list(),
      api.entities.Member.list(),
    ]).then(([s, m]) => {
      setSubscriptions(s);
      setMembers(m);
    }).catch(setErrore).finally(() => setLoading(false));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const nomi = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);
  const getMemberName = (id) => nomi.get(id) || "Sconosciuto";

  // I riquadri contano tutti gli abbonamenti; la tabella solo quelli del filtro.
  const statistiche = useMemo(() => statisticheVenduti(subscriptions, oggiIso()), [subscriptions]);
  // I più recenti in cima: l'ultimo venduto è quello che si cerca più spesso.
  const filtered = useMemo(() => subscriptions
    .filter((s) => filter === "all" || s.status === filter)
    .sort((a, b) => String(b.start_date ?? "").localeCompare(String(a.start_date ?? ""))), [subscriptions, filter]);
  const { righe, pagina: paginaVista } = paginaDi(filtered, pagina, PER_PAGINA);

  if (loading) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Abbonamenti venduti" description={`${subscriptions.length} in tutto`}>
        <Select value={filter} onValueChange={filtra}>
          <SelectTrigger className="w-40" aria-label="Stato"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti</SelectItem>
            <SelectItem value="active">Validi</SelectItem>
            <SelectItem value="expiring">In scadenza</SelectItem>
            <SelectItem value="expired">Scaduti</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>

      {subscriptions.length > 0 && <RiquadriVenduti statistiche={statistiche} />}

      {filtered.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="Nessun abbonamento venduto"
          description="Un abbonamento si vende dalla scheda di un socio, scegliendo un tipo dal listino."
        />
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-3 px-4 font-medium text-muted-foreground">Socio</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Abbonamento</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Periodo</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Prezzo</th>
            </tr>
          </thead>
          <tbody>
            {righe.map(sub => (
              <tr key={sub.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4">
                  <Link to={`/crm/soci/${sub.member_id}`} className="font-medium text-primary hover:underline">{getMemberName(sub.member_id)}</Link>
                </td>
                <td className="py-3 px-4">{sub.plan_name}</td>
                <td className="py-3 px-4 text-muted-foreground">{formatData(sub.start_date, "breve")} – {formatData(sub.end_date, "breve")}</td>
                <td className="py-3 px-4"><StatusBadge status={sub.status} /></td>
                <td className="py-3 px-4 text-right font-medium">{formatEuro(sub.price_paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <Paginazione pagina={paginaVista} totale={filtered.length} perPagina={PER_PAGINA} onCambia={cambiaPagina} />
    </div>
  );
}
