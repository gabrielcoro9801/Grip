import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/core/api/client";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { Plus, Search, Users, LayoutGrid, List, MessageCircle, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/ui/primitivi/card";
import { AvatarSocio } from "@/staff/components/soci/FotoSocio";
import { statoIscrizione } from "@/core/domain/abbonamenti";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { formatData } from "@/core/domain/format";
import { FASI, SEGNALI, fase as faseDi, regoleStati } from "@/core/domain/segnali";
import Iscrivi from "@/staff/components/soci/Iscrivi";
import Contatta from "@/staff/components/soci/Contatta";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";

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

// Tile o tabella: la scelta resta, per chi la fa, su quel browser. Le tile sono quelle di sempre;
// la tabella ha le colonne del motore dei segnali. Se il browser non lascia salvare, valgono le tile.
const CHIAVE_VISTA = "grip.soci.vista";
const VISTE = ["tile", "tabella"];
function vistaSalvata() {
  try { const v = localStorage.getItem(CHIAVE_VISTA); return VISTE.includes(v) ? v : "tile"; } catch { return "tile"; }
}
function salvaVista(v) {
  try { localStorage.setItem(CHIAVE_VISTA, v); } catch { /* resta per questa visita */ }
}

function RigaTile({ etichetta, children }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs min-h-5">
      <dt className="text-muted-foreground flex-shrink-0">{etichetta}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  );
}

/** Lo stato dell'abbonamento: archiviato, sospeso, attivo, in scadenza, scaduto, nessuno. */
function StatoTile({ socio }) {
  if (socio.archiviato_il) return <StatusBadge status="archiviato" label={`Archiviato il ${formatData(socio.archiviato_il, "breve")}`} tone="neutro" className="py-0" />;
  if (socio.sospensione) return <StatusBadge status="sospeso" label={`Sospeso fino al ${formatData(socio.sospensione.al, "breve")}`} tone="neutro" className="py-0" />;
  if (socio.scadenza) return <StatusBadge status={statoIscrizione({ end_date: socio.scadenza })} className="py-0" />;
  if (socio.valido) return <StatusBadge status="active" className="py-0" />;
  if (socio.ultima_fine) return <StatusBadge status="expired" className="py-0" />;
  return <StatusBadge status="nessuno" label="Senza abbonamento" tone="neutro" className="py-0" />;
}

/** "4 · media 6": gli ingressi delle ultime 4 settimane, e la media delle 12 per confronto. */
function Frequenza({ socio }) {
  if (socio.ingressi_4 === null) return "—";
  return <span className="tabular-nums">{socio.ingressi_4}<span className="text-muted-foreground"> · media {socio.media_4}</span></span>;
}

/** Il badge dello stato, con il perché al passaggio del mouse (le cose da fare, o la regola). */
function BadgeStato({ socio, soglie }) {
  const f = faseDi(socio.fase);
  const regola = regoleStati(soglie).find((r) => r.valore === socio.fase)?.regola;
  return <span title={socio.perche || regola}><StatusBadge status={socio.fase} label={f.etichetta} tone={f.tono} className="py-0" /></span>;
}

/** La legenda degli stati: che cosa vuol dire ognuno, con le soglie della palestra. */
function LegendaStati({ aperta, onChiudi, soglie }) {
  return (
    <Dialog open={aperta} onOpenChange={(v) => { if (!v) onChiudi(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gli stati dei soci</DialogTitle>
          <DialogDescription>Si guardano in quest'ordine: vale il primo. Abbonamento e cose da fare hanno le loro colonne e la loro pagina.</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3">
          {regoleStati(soglie).map((r) => (
            <div key={r.valore}>
              <dt><StatusBadge status={r.valore} label={r.etichetta} tone={r.tono} className="py-0" /></dt>
              <dd className="text-sm text-muted-foreground mt-1">{r.regola}.</dd>
            </div>
          ))}
        </dl>
        <Link to="/admin/da-fare" className="text-sm text-primary hover:underline">Le soglie si cambiano nelle Impostazioni di Da fare</Link>
      </DialogContent>
    </Dialog>
  );
}

/** Il pulsante che apre "Contatta": un'icona, con il nome per chi legge lo schermo. */
function PulsanteContatta({ socio, onApri, className = "" }) {
  return (
    <Button type="button" size="icon" variant="ghost" className={`h-8 w-8 ${className}`} title="Contatta" aria-label={`Contatta ${socio.nome}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onApri(socio); }}>
      <MessageCircle className="w-4 h-4" />
    </Button>
  );
}

/**
 * L'elenco dei soci, con quello che serve per decidere: in che stato sono, com'è l'abbonamento,
 * quando scade, quanto vengono — e "Contatta" per raggiungerli. Le cose da fare stanno in Da fare.
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
  const [vista, setVista] = useState(vistaSalvata);
  const scegliVista = (v) => { setVista(v); salvaVista(v); };
  // "Aggiungi socio" è il flusso Iscrivi, per chi entra direttamente senza essere stato un contatto.
  const [showForm, setShowForm] = useState(false);
  const [errore, setErrore] = useState(null);
  const [daContattare, setDaContattare] = useState(null);
  const [legenda, setLegenda] = useState(false);

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
      // Senza filtro di stato gli archiviati non si mostrano: non frequentano più, ma si ritrovano.
      .filter((s) => filtroFase !== TUTTI || s.fase !== "archiviato")
      .filter((s) => !cerca || [s.nome, s.email, s.codice_socio].some((v) => v && v.toLowerCase().includes(cerca))
        || (cifre.length >= 3 && (s.telefono ?? "").replace(/\D/g, "").includes(cifre)))
      .sort(criterio.confronta);
  }, [dati, search, ordine, filtroFase]);

  if (errore) return <ErrorState error={errore} onRetry={loadData} />;
  if (!dati) return <LoadingState minHeight="h-64" />;

  const fasi = dati.conteggi.fasi;
  const exSoci = fasi.archiviato ?? 0;
  const frequentano = Object.entries(fasi).filter(([f]) => f !== "archiviato").reduce((s, [, n]) => s + n, 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Gestione membri" description={`${frequentano} ${frequentano === 1 ? "socio" : "soci"}${exSoci ? ` · ${exSoci} ${exSoci === 1 ? "archiviato" : "archiviati"}` : ""}`}>
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
          <Label htmlFor="fase-soci" className="sr-only">Stato</Label>
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
          <div role="group" aria-label="Vista" className="inline-flex rounded-md border overflow-hidden">
            {[["tile", LayoutGrid, "Tile"], ["tabella", List, "Tabella"]].map(([v, Icona, etichetta]) => (
              <button key={v} type="button" aria-pressed={vista === v} title={etichetta}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-sm ${vista === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                onClick={() => scegliVista(v)}>
                <Icona className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{etichetta}</span>
              </button>
            ))}
          </div>
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
      ) : vista === "tile" ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {elenco.map((s) => (
            // Tutta la tile apre la scheda (il link del nome la copre, `after:inset-0`), ma un
            // bottone dentro un link non è HTML valido: "Contatta" sta sopra, fuori dal link.
            <div key={s.socio_id} className="relative">
              {/* Tutte le tile hanno la stessa altezza e le stesse righe, piene o con un
                  trattino: si confrontano a colpo d'occhio, e la griglia non balla. */}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow h-[200px]">
                <CardContent className="p-4 h-full flex flex-col">
                  <div className="flex items-start gap-3 pr-8">
                    <AvatarSocio socio={{ full_name: s.nome, nome: s.nome_proprio, cognome: s.nome?.slice((s.nome_proprio ?? "").length), foto_url: s.foto_url }} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-sm truncate" title={s.nome}>
                        <Link to={`/crm/soci/${s.socio_id}`} className="after:absolute after:inset-0 after:rounded-lg focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">{s.nome}</Link>
                      </h3>
                      <p className="text-xs text-muted-foreground font-mono">{s.codice_socio}</p>
                    </div>
                  </div>
                  <dl className="mt-auto space-y-1.5">
                    <RigaTile etichetta="Stato"><StatoTile socio={s} /></RigaTile>
                    <RigaTile etichetta="Abbonamento">{s.abbonamento || "—"}</RigaTile>
                    <RigaTile etichetta="Scadenza">{s.scadenza || s.ultima_fine ? formatData(s.scadenza ?? s.ultima_fine, "media") : "—"}</RigaTile>
                    <RigaTile etichetta="Telefono">{s.telefono || "—"}</RigaTile>
                    <RigaTile etichetta="Email">{s.email || "—"}</RigaTile>
                  </dl>
                </CardContent>
              </Card>
              <PulsanteContatta socio={s} onApri={setDaContattare} className="absolute top-2 right-2 z-10" />
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden overflow-x-auto bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30">
                <th className="py-3 px-4 font-medium text-muted-foreground">Socio</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    Stato
                    <button type="button" onClick={() => setLegenda(true)} className="text-muted-foreground hover:text-foreground" aria-label="Che cosa vogliono dire gli stati">
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </th>
                <th className="py-3 px-4 font-medium text-muted-foreground hidden sm:table-cell">Stato abbonamento</th>
                <th className="py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">Scadenza</th>
                <th className="py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">Ingressi in 4 settimane</th>
                <th className="py-3 px-4"><span className="sr-only">Contatta</span></th>
              </tr>
            </thead>
            <tbody>
              {elenco.map((s) => (
                <tr key={s.socio_id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                  <td className="py-3 px-4">
                    <Link to={`/crm/soci/${s.socio_id}`} className="font-medium hover:underline">{s.nome}</Link>
                    <span className="block text-xs text-muted-foreground font-mono">{s.codice_socio}</span>
                  </td>
                  <td className="py-3 px-4"><BadgeStato socio={s} soglie={dati.soglie} /></td>
                  <td className="py-3 px-4 hidden sm:table-cell"><StatoTile socio={s} /></td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    {s.scadenza || s.ultima_fine ? formatData(s.scadenza ?? s.ultima_fine, "breve") : "—"}
                    {s.abbonamento && <span className="block text-xs text-muted-foreground">{s.abbonamento}</span>}
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell"><Frequenza socio={s} /></td>
                  <td className="py-3 px-4 text-right"><PulsanteContatta socio={s} onApri={setDaContattare} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Iscrivi aperto={showForm} onChiudi={() => setShowForm(false)} />
      <Contatta socio={daContattare} onChiudi={() => setDaContattare(null)} />
      <LegendaStati aperta={legenda} onChiudi={() => setLegenda(false)} soglie={dati.soglie} />
    </div>
  );
}
