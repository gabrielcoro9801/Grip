import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Cog, Pencil, Trash2, Eye, EyeOff, AlertCircle } from "lucide-react";
import MappaRuoliConti from "@/components/accounting/MappaRuoliConti";
import { RUOLI_SISTEMA, NOMI_RUOLI } from "../../../shared/contiSistema.js";
import { TIPI_CONTO, naturaTipica, eRettificativo, effettoDelMovimento } from "../../../shared/tipiConto.js";
import { LoadingState } from "@/components/shared/Spinner";

const TIPO_LABELS = {
  attivo: "Attivo",
  passivo: "Passivo",
  patrimonio_netto: "Patrimonio Netto",
  ricavo: "Ricavo",
  costo: "Costo",
};

export default function ChartOfAccounts() {
  const { organization, loading: orgLoading } = useOrganization();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTipo, setFilterTipo] = useState("tutti");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ codice: "", nome: "", tipo_conto: "", natura: "", conto_padre_id: "", gestisce_iva: false });

  const loadAccounts = (orgId) => {
    api.entities.ChartOfAccount.filter({ organization_id: orgId }, "codice").then(a => { setAccounts(a); setLoading(false); });
  };

  useEffect(() => {
    if (organization) loadAccounts(organization.id);
  }, [organization]);

  const filtered = useMemo(() => {
    return filterTipo === "tutti" ? accounts : accounts.filter(a => a.tipo_conto === filterTipo);
  }, [accounts, filterTipo]);

  const roots = filtered.filter(a => !a.conto_padre_id);
  const getChildren = (id) => filtered.filter(a => a.conto_padre_id === id);

  const emptyForm = { codice: "", nome: "", tipo_conto: "", natura: "", conto_padre_id: "", gestisce_iva: false, ruolo_sistema: "" };

  const openCreate = () => { setEditing(null); setForm(emptyForm); setError(""); setShowForm(true); };

  const openEdit = (acc) => {
    setEditing(acc);
    setForm({
      codice: acc.codice, nome: acc.nome, tipo_conto: acc.tipo_conto,
      natura: acc.natura, conto_padre_id: acc.conto_padre_id || "",
      gestisce_iva: !!acc.gestisce_iva,
      ruolo_sistema: acc.ruolo_sistema || "",
    });
    setError("");
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    // La classificazione non ha un valore predefinito apposta: sceglierla per conto
    // dell'utente significherebbe che metà dei conti finisce nell'attivo senza che nessuno
    // ci abbia pensato.
    if (!form.tipo_conto) {
      setError("Indica che cosa registra questo conto: da lì dipende dove compare in bilancio.");
      return;
    }
    const payload = {
      ...form,
      conto_padre_id: form.conto_padre_id || null,
      // Un compito appartiene a un conto solo: la stringa vuota della select va salvata
      // come "nessun compito", non come compito chiamato "".
      ruolo_sistema: form.ruolo_sistema || null,
    };
    try {
      if (editing) {
        // Spostare un compito su un altro conto richiede di toglierlo prima da dove sta:
        // il database non ammette due conti con lo stesso compito, e il messaggio che ne
        // uscirebbe parlerebbe di indici invece che di contabilità.
        if (payload.ruolo_sistema && payload.ruolo_sistema !== editing.ruolo_sistema) {
          const precedente = accounts.find(a => a.ruolo_sistema === payload.ruolo_sistema && a.id !== editing.id);
          if (precedente) await api.entities.ChartOfAccount.update(precedente.id, { ruolo_sistema: null });
        }
        await api.entities.ChartOfAccount.update(editing.id, payload);
      } else {
        await api.entities.ChartOfAccount.create({
          ...payload, organization_id: organization.id, sistema: false, attivo: true,
        });
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      loadAccounts(organization.id);
    } catch (err) {
      // Il vincolo di unicità sul codice è la causa più probabile: vale la pena dirlo,
      // invece di riportare il messaggio del database.
      setError(
        /univoc|duplicat|unique/i.test(err.message)
          ? `Esiste già un conto con codice "${form.codice}". I codici devono essere distinti.`
          : err.message,
      );
    }
  };

  const handleDelete = async (acc) => {
    setError("");
    // Un conto con sottoconti non può sparire senza lasciarli orfani: prima vanno
    // spostati o eliminati loro.
    if (accounts.some(a => a.conto_padre_id === acc.id)) {
      setError(`"${acc.nome}" ha dei sottoconti: eliminali o spostali prima di procedere.`);
      return;
    }
    // Un conto con un compito è quello su cui l'applicazione registra da sé: toglierlo
    // significa bloccare quelle registrazioni. Va prima assegnato il compito a un altro.
    if (acc.ruolo_sistema) {
      const label = RUOLI_SISTEMA[acc.ruolo_sistema]?.label ?? acc.ruolo_sistema;
      setError(`"${acc.nome}" ha il compito «${label}»: assegnalo prima a un altro conto, altrimenti le registrazioni che lo usano non potranno più essere completate.`);
      return;
    }

    // Si contano i movimenti prima di provare: così il messaggio dice *quanti* ne
    // impediscono l'eliminazione, invece di riportare un errore di chiave esterna che non
    // dice nulla a chi lo legge.
    let movimenti = 0;
    try {
      movimenti = (await api.entities.JournalLine.filter({ conto_id: acc.id })).length;
    } catch { /* se il conteggio fallisce si prova comunque a eliminare */ }
    if (movimenti > 0) {
      setError(`"${acc.nome}" è usato in ${movimenti} ${movimenti === 1 ? "registrazione" : "registrazioni"} e non può essere eliminato: si perderebbe la storia contabile. Puoi disattivarlo, così sparisce dalle scelte ma i movimenti passati restano leggibili.`);
      return;
    }
    if (!confirm(`Eliminare definitivamente il conto "${acc.codice} ${acc.nome}"?`)) return;

    try {
      await api.entities.ChartOfAccount.delete(acc.id);
      loadAccounts(organization.id);
    } catch {
      setError(`"${acc.nome}" non può essere eliminato: è collegato ad altri dati. Puoi disattivarlo.`);
    }
  };

  const toggleAttivo = async (acc) => {
    setError("");
    try {
      await api.entities.ChartOfAccount.update(acc.id, { attivo: !acc.attivo });
      loadAccounts(organization.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const renderAccount = (acc, depth = 0) => {
    const children = getChildren(acc.id);
    return (
      <div key={acc.id}>
        <div className="flex items-center justify-between py-2.5 px-4 border-b border-border/50 hover:bg-muted/30" style={{ paddingLeft: `${16 + depth * 24}px` }}>
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-muted-foreground w-16">{acc.codice}</span>
            <span className="text-sm font-medium">{acc.nome}</span>
            {/* Il compito che il conto svolge per il motore contabile. Si mostra qui perché
                altrimenti sarebbe invisibile: chi rinumera o riclassifica un conto deve
                sapere che l'applicazione ci registra sopra da sé. */}
            {acc.ruolo_sistema && (
              <Badge variant="outline" className="text-xs gap-1 border-blue-200 text-blue-700">
                <Cog className="w-3 h-3" />
                {RUOLI_SISTEMA[acc.ruolo_sistema]?.label ?? acc.ruolo_sistema}
              </Badge>
            )}
            {acc.gestisce_iva && <Badge variant="outline" className="text-xs">IVA</Badge>}
            {!acc.attivo && <Badge variant="secondary" className="text-xs">Disattivo</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{TIPO_LABELS[acc.tipo_conto]}</Badge>
            <span className="text-xs text-muted-foreground w-14 text-right capitalize">{acc.natura}</span>
            {/* Ogni conto è modificabile, compresi quelli con un compito: il motore ormai li
                trova dal compito e non dal numero, quindi rinumerare non rompe più niente.
                L'eliminazione resta protetta da `handleDelete`, che spiega perché. */}
            <div className="flex items-center gap-1 w-[88px] justify-end">
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Modifica" onClick={() => openEdit(acc)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" title={acc.attivo ? "Disattiva" : "Riattiva"} onClick={() => toggleAttivo(acc)}>
                {acc.attivo ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Elimina" onClick={() => handleDelete(acc)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
        {children.map(c => renderAccount(c, depth + 1))}
      </div>
    );
  };

  if (orgLoading || loading) return <LoadingState minHeight="h-full" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Piano dei conti" description="Struttura dei conti contabili dell'organizzazione">
        <Select value={filterTipo} onValueChange={setFilterTipo}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti i tipi</SelectItem>
            {Object.entries(TIPO_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Nuovo conto</Button>
      </PageHeader>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <MappaRuoliConti accounts={accounts} onAssegna={openEdit} />

      <div className="border border-border rounded-lg overflow-hidden">
        {roots.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nessun conto trovato</p>
        ) : roots.map(a => renderAccount(a))}
      </div>

      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? `Modifica conto ${editing.codice}` : "Nuovo conto"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div><Label>Nome *</Label><Input required value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} placeholder="es. Contributi da enti pubblici" /></div>

            {/* La domanda è in italiano corrente e la classificazione si ricava: "attivo",
                "passivo" e "natura dare" sono il vocabolario giusto, ma sbagliarli non dà
                errore — la registrazione quadra e il bilancio risulta storto. */}
            <div>
              <Label>Che cosa registra questo conto? *</Label>
              <Select
                value={form.tipo_conto}
                onValueChange={v => setForm({ ...form, tipo_conto: v, natura: naturaTipica(v) })}
              >
                <SelectTrigger><SelectValue placeholder="Scegli…" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPI_CONTO).map(([k, t]) => (
                    <SelectItem key={k} value={k}>{t.domanda}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.tipo_conto && (
                <p className="text-xs text-muted-foreground mt-1">
                  Per esempio: {TIPI_CONTO[form.tipo_conto].esempi}. In bilancio compare fra
                  i conti di tipo <strong>{TIPI_CONTO[form.tipo_conto].label}</strong>.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Codice *</Label>
                <Input required value={form.codice} onChange={e => setForm({...form, codice: e.target.value})} placeholder="es. 6.8" />
              </div>
              <div>
                <Label>Aumenta in *</Label>
                <Select value={form.natura} onValueChange={v => setForm({...form, natura: v})} disabled={!form.tipo_conto}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dare">Dare</SelectItem>
                    <SelectItem value="avere">Avere</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Si mostra la conseguenza, non la regola: "natura avere" non dice niente,
                "un movimento in avere lo aumenta" sì. */}
            <p className={`text-xs -mt-1 ${eRettificativo(form.tipo_conto, form.natura) ? "text-orange-700" : "text-muted-foreground"}`}>
              {effettoDelMovimento(form.tipo_conto, form.natura)}
            </p>
            {eRettificativo(form.tipo_conto, form.natura) && (
              <p className="text-xs text-orange-700 -mt-1">
                È il caso raro dei fondi (ammortamento, svalutazione): se non è quello che
                intendevi, riporta il valore a <strong>{naturaTipica(form.tipo_conto) === "avere" ? "«avere»" : "«dare»"}</strong>.
              </p>
            )}

            <div>
              <Label>Conto padre (opzionale)</Label>
              <Select value={form.conto_padre_id || "none"} onValueChange={v => setForm({...form, conto_padre_id: v === "none" ? "" : v})}>
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuno</SelectItem>
                  {/* Un conto non può essere padre di sé stesso. */}
                  {accounts.filter(a => a.id !== editing?.id).map(a => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="gestisce_iva" checked={form.gestisce_iva} onCheckedChange={c => setForm({...form, gestisce_iva: !!c})} />
              <Label htmlFor="gestisce_iva" className="font-normal">Gestisce IVA</Label>
            </div>

            <div className="pt-2 border-t">
              <Label>Compito nel motore contabile</Label>
              <Select
                value={form.ruolo_sistema || "nessuno"}
                onValueChange={v => setForm({ ...form, ruolo_sistema: v === "nessuno" ? "" : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nessuno">Nessuno — conto normale</SelectItem>
                  {NOMI_RUOLI.map(r => {
                    const occupato = accounts.find(a => a.ruolo_sistema === r && a.id !== editing?.id);
                    return (
                      <SelectItem key={r} value={r}>
                        {RUOLI_SISTEMA[r].label}{occupato ? ` — ora su ${occupato.codice}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {form.ruolo_sistema
                  ? RUOLI_SISTEMA[form.ruolo_sistema]?.descrizione
                  : "La maggior parte dei conti non ha un compito: sono quelli che scegli tu di volta in volta quando registri."}
              </p>
              {form.ruolo_sistema && (() => {
                const occupato = accounts.find(a => a.ruolo_sistema === form.ruolo_sistema && a.id !== editing?.id);
                const atteso = RUOLI_SISTEMA[form.ruolo_sistema]?.tipoAtteso;
                return (
                  <>
                    {occupato && (
                      <p className="text-xs text-amber-700 mt-1">
                        Il compito è oggi di <strong>{occupato.codice} {occupato.nome}</strong>: salvando lo sposti qui,
                        e le prossime registrazioni useranno questo conto.
                      </p>
                    )}
                    {atteso && form.tipo_conto !== atteso && (
                      <p className="text-xs text-orange-700 mt-1">
                        Di solito questo compito sta su un conto di tipo <strong>{TIPO_LABELS[atteso]}</strong>,
                        non {TIPO_LABELS[form.tipo_conto]}. Puoi procedere, ma verifica: un compito sul tipo
                        sbagliato non dà errori e falsa il bilancio.
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
            <Button type="submit" className="w-full">{editing ? "Salva modifiche" : "Crea conto"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}