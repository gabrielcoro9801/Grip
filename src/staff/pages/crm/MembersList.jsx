import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/core/api/client";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { Plus, Search, Users } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { formatData } from "@/core/domain/format";
import { FASI, SEGNALI, fase as faseDi, etichettaSegnale } from "@/core/domain/segnali";
import Iscrivi from "@/staff/components/soci/Iscrivi";

const TUTTI = "tutti";
const NESSUNO = "nessuno";

const confrontaTesto = (a, b) => (a ?? "").localeCompare(b ?? "", "it", { sensitivity: "base" });
// Chi manca di un dato (nessuna scadenza, mai entrato) va in fondo, dove non disturba.
const inFondo = (a, b, confronta) => (!a || !b ? (a ? 0 : 1) - (b ? 0 : 1) : confronta(a, b));
const ORDINAMENTI = [
  { valore: "nome", etichetta: "Nome (A–Z)", confronta: (a, b) => confrontaTesto(a.nome, b.nome) },
  { valore: "scadenza", etichetta: "Scadenza più vicina", confronta: (a, b) => inFondo(a.scadenza, b.scadenza, (x, y) => x.localeCompare(y)) || confrontaTesto(a.nome, b.nome) },
  { valore: "ingresso", etichetta: "Assenti da più tempo", confronta: (a, b) => inFondo(a.ultimo_ingresso, b.ultimo_ingresso, (x, y) => x.localeCompare(y)) || confrontaTesto(a.nome, b.nome) },
];

/** "4 · media 6": gli ingressi delle ultime 4 settimane, e la media delle 12 per confronto. */
function Frequenza({ socio }) {
  if (socio.ingressi_4 === null) return "—";
  return <span className="tabular-nums">{socio.ingressi_4}<span className="text-muted-foreground"> · media {socio.media_4}</span></span>;
}

/**
 * L'elenco dei soci, con quello che serve per decidere: in che fase sono, quando sono entrati
 * l'ultima volta, quanto vengono, quando scadono e che cosa c'è da fare.
 */
export default function MembersList() {
  const [parametri, setParametri] = useSearchParams();
  // I filtri stanno nell'indirizzo, come la vista dei contatti: "Assenti" si tiene nei preferiti.
  const filtroFase = FASI.some((f) => f.valore === parametri.get("fase")) ? parametri.get("fase") : TUTTI;
  const filtroSegnale = SEGNALI.some((s) => s.valore === parametri.get("segnale")) ? parametri.get("segnale") : NESSUNO;
  const filtra = (chiave, valore, vuoto) => {
    const prossimi = new URLSearchParams(parametri);
    if (valore === vuoto) prossimi.delete(chiave); else prossimi.set(chiave, valore);
    setParametri(prossimi, { replace: true });
  };

  const [dati, setDati] = useState(null);
  const [search, setSearch] = useState("");
  const [ordine, setOrdine] = useState("nome");
  // "Aggiungi socio" è il flusso Iscrivi, per chi entra direttamente senza essere stato un contatto.
  const [showForm, setShowForm] = useState(false);
  const [errore, setErrore] = useState(null);

  // Fase, segnale e colonne li calcola il server (GET /api/segnali): prima la pagina scaricava
  // tutti i soci e tutti gli abbonamenti e li incrociava qui.
  const loadData = useCallback(() => {
    setErrore(null);
    api.segnali({ tipo: "soci", fase: filtroFase === TUTTI ? "" : filtroFase, segnale: filtroSegnale === NESSUNO ? "" : filtroSegnale })
      .then(setDati).catch(setErrore);
  }, [filtroFase, filtroSegnale]);

  useEffect(() => { loadData(); }, [loadData]);

  const elenco = useMemo(() => {
    if (!dati) return [];
    const cerca = search.trim().toLowerCase();
    const cifre = cerca.replace(/\D/g, "");
    const criterio = ORDINAMENTI.find((o) => o.valore === ordine) ?? ORDINAMENTI[0];
    return dati.persone
      // Senza filtro di fase gli ex soci non si mostrano: non frequentano più, ma si ritrovano.
      .filter((s) => filtroFase !== TUTTI || s.fase !== "ex_socio")
      .filter((s) => !cerca || [s.nome, s.email, s.codice_socio].some((v) => v && v.toLowerCase().includes(cerca))
        || (cifre.length >= 3 && (s.telefono ?? "").replace(/\D/g, "").includes(cifre)))
      .sort(criterio.confronta);
  }, [dati, search, ordine, filtroFase]);

  if (errore) return <ErrorState error={errore} onRetry={loadData} />;
  if (!dati) return <LoadingState minHeight="h-64" />;

  const fasi = dati.conteggi.fasi;
  const exSoci = fasi.ex_socio ?? 0;
  const frequentano = Object.entries(fasi).filter(([f]) => f !== "ex_socio").reduce((s, [, n]) => s + n, 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Gestione membri" description={`${frequentano} ${frequentano === 1 ? "socio" : "soci"}${exSoci ? ` · ${exSoci} ex soci` : ""}`}>
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Aggiungi socio
        </Button>
      </PageHeader>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Nome, codice, telefono o email..."
            aria-label="Cerca un socio"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Label htmlFor="fase-soci" className="sr-only">Fase</Label>
          <Select value={filtroFase} onValueChange={(v) => filtra("fase", v, TUTTI)}>
            <SelectTrigger id="fase-soci" className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TUTTI}>Tutti i soci ({frequentano})</SelectItem>
              {FASI.filter((f) => f.valore !== "lead").map((f) => (
                <SelectItem key={f.valore} value={f.valore}>{f.etichetta} ({fasi[f.valore] ?? 0})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="segnale-soci" className="sr-only">Da fare</Label>
          <Select value={filtroSegnale} onValueChange={(v) => filtra("segnale", v, NESSUNO)}>
            <SelectTrigger id="segnale-soci" className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NESSUNO}>Qualunque cosa da fare</SelectItem>
              {SEGNALI.filter((s) => dati.conteggi.segnali[s.valore] || s.valore === filtroSegnale).map((s) => (
                <SelectItem key={s.valore} value={s.valore}>{s.etichetta} ({dati.conteggi.segnali[s.valore] ?? 0})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="ordina-soci" className="sr-only">Ordina per</Label>
          <Select value={ordine} onValueChange={setOrdine}>
            <SelectTrigger id="ordina-soci" className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORDINAMENTI.map((o) => <SelectItem key={o.valore} value={o.valore}>{o.etichetta}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {elenco.length === 0 ? (
        <EmptyState
          icon={Users}
          title={frequentano + exSoci === 0 ? "Nessun socio registrato" : "Nessun socio corrisponde"}
          description={
            frequentano + exSoci === 0
              ? "Da qui si tesserano le persone che frequentano la palestra."
              : search ? `Nessun risultato per «${search}». Prova con un altro nome, il codice o il telefono.` : "Nessun socio in questo filtro, oggi."
          }
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden overflow-x-auto bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30">
                <th className="py-3 px-4 font-medium text-muted-foreground">Socio</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Fase</th>
                <th className="py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">Ultimo ingresso</th>
                <th className="py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">Ingressi in 4 settimane</th>
                <th className="py-3 px-4 font-medium text-muted-foreground hidden sm:table-cell">Scadenza</th>
                <th className="py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">Da fare</th>
              </tr>
            </thead>
            <tbody>
              {elenco.map((s) => {
                const f = faseDi(s.fase);
                return (
                  <tr key={s.socio_id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                    <td className="py-3 px-4">
                      <Link to={`/crm/soci/${s.socio_id}`} className="font-medium hover:underline">{s.nome}</Link>
                      <span className="block text-xs text-muted-foreground font-mono">{s.codice_socio}</span>
                    </td>
                    <td className="py-3 px-4"><StatusBadge status={s.fase} label={f.etichetta} tone={f.tono} className="py-0" /></td>
                    <td className="py-3 px-4 hidden md:table-cell">{s.ultimo_ingresso ? formatData(s.ultimo_ingresso, "breve") : "—"}</td>
                    <td className="py-3 px-4 hidden md:table-cell"><Frequenza socio={s} /></td>
                    <td className="py-3 px-4 hidden sm:table-cell">
                      {s.scadenza ? formatData(s.scadenza, "breve") : "—"}
                      {s.abbonamento && <span className="block text-xs text-muted-foreground">{s.abbonamento}</span>}
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell">
                      {s.da_fare[0] ? <span title={s.perche}>{etichettaSegnale(s.da_fare[0])}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Iscrivi aperto={showForm} onChiudi={() => setShowForm(false)} />
    </div>
  );
}
