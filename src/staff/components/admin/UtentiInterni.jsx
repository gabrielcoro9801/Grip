import React, { useState, useMemo } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Pencil, UserPlus, Ban, CheckCircle2, Search, Lock } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatDataOra } from "@/core/domain/format";
import { LUNGHEZZA_MINIMA_PASSWORD } from "@/core/domain/password";

const formVuoto = { nome: "", email: "", telefono: "", codice_fiscale: "", partita_iva: "", ruolo: "", istruttore: false, note: "", password: "" };
const NOTE_MASSIMO = 140;

// Il telefono: solo cifre, «+», spazi e trattini. Il server poi lo normalizza o lo rifiuta.
const soloTelefono = (v) => v.replace(/[^0-9+\s-]/g, "");

/**
 * Gli utenti interni: chi lavora nella struttura, e chi di loro tiene dei corsi (la spunta
 * «Istruttore», indipendente dal ruolo). Il primo amministratore sta nel file di configurazione
 * del server: qui non si cambiano né email né ruolo, e non si disattiva.
 */
export default function UtentiInterni({ accounts, ruoli, reload }) {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [cerca, setCerca] = useState("");
  const [mostraForm, setMostraForm] = useState(false);
  const [inModifica, setInModifica] = useState(null);
  const [form, setForm] = useState(formVuoto);
  const [saving, setSaving] = useState(false);

  const etichettaRuolo = (nome) => ruoli.find((r) => r.nome === nome)?.label || nome;
  const bloccato = Boolean(inModifica?.protetto);

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => a.nome?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q));
  }, [accounts, cerca]);

  const apriNuovo = () => {
    setInModifica(null);
    setForm({ ...formVuoto, ruolo: ruoli[0]?.nome ?? "" });
    setMostraForm(true);
  };

  const apriModifica = (acc) => {
    setInModifica(acc);
    // La password non è più leggibile: il campo parte vuoto e si invia solo se ne viene scritta una.
    setForm({
      nome: acc.nome ?? "",
      email: acc.email ?? "",
      telefono: acc.telefono ?? "",
      codice_fiscale: acc.codice_fiscale ?? "",
      partita_iva: acc.partita_iva ?? "",
      ruolo: acc.ruolo ?? "",
      istruttore: Boolean(acc.istruttore),
      note: acc.note ?? "",
      password: "",
    });
    setMostraForm(true);
  };

  const salva = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const dati = {
        nome: form.nome,
        telefono: form.telefono || null,
        codice_fiscale: form.codice_fiscale || null,
        partita_iva: form.partita_iva || null,
        note: form.note || null,
        istruttore: form.istruttore,
      };
      if (inModifica) {
        // Il primo amministratore: email e ruolo non si mandano nemmeno, il server li rifiuterebbe.
        if (!bloccato) Object.assign(dati, { email: form.email, ruolo: form.ruolo });
        if (!bloccato && form.password) dati.password = form.password;
        await api.entities.StaffAccount.update(inModifica.id, dati);
        toast({ title: "Utente aggiornato", description: form.nome });
      } else {
        await api.entities.StaffAccount.create({ ...dati, email: form.email, ruolo: form.ruolo, password: form.password, attivo: true });
        toast({ title: "Utente creato", description: form.nome });
      }
      setMostraForm(false);
      setInModifica(null);
      reload();
    } catch (err) {
      toast({ title: "Non salvato", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const commutaAttivo = async (acc) => {
    const attivo = !acc.attivo;
    try {
      await api.entities.StaffAccount.update(acc.id, { attivo });
      toast({ title: attivo ? "Utente riattivato" : "Utente disattivato", description: acc.nome });
      reload();
    } catch (err) {
      toast({ title: "Non salvato", description: err.message, variant: "destructive" });
    }
  };

  // Le azioni di una riga: la matita per tutti; il primo amministratore non si disattiva, e chi
  // è loggato non si disattiva da sé (chiuderebbe la porta dall'interno).
  const azioni = (acc) => (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon" className="h-9 w-9" title="Modifica" onClick={() => apriModifica(acc)}>
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      {acc.protetto ? (
        <Button variant="ghost" size="icon" className="h-9 w-9" disabled title="Primo amministratore: non si disattiva">
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          title={acc.id === staffUser?.id ? "Non puoi disattivare te stesso" : acc.attivo ? "Disattiva" : "Riattiva"}
          onClick={() => commutaAttivo(acc)}
          disabled={acc.id === staffUser?.id}
        >
          {acc.attivo ? <Ban className="w-3.5 h-3.5 text-destructive" /> : <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
        </Button>
      )}
    </div>
  );

  const stato = (acc) => (acc.attivo
    ? <Badge className="bg-success/10 text-success border-success/30">Abilitato</Badge>
    : <Badge className="bg-destructive/10 text-destructive border-destructive/30">Disabilitato</Badge>);

  const badgeIstruttore = (acc) => (acc.istruttore
    ? <Badge className="bg-info/10 text-info border-info/30 text-[10px]">Istruttore</Badge>
    : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input placeholder="Cerca per nome o email…" value={cerca} onChange={(e) => setCerca(e.target.value)} className="pl-9" />
        </div>
        <Button size="sm" onClick={apriNuovo} disabled={ruoli.length === 0}>
          <UserPlus className="w-4 h-4 mr-1" /> Nuovo utente interno
        </Button>
      </div>

      {/* Da 390 px ogni utente è un blocco con le azioni a destra: la tabella non ci starebbe. */}
      <div className="hidden sm:block border border-border rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">Nome</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Email</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Ruolo</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Ultima attività</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtrati.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">{cerca ? "Nessun utente corrisponde alla ricerca" : "Nessun utente interno"}</td></tr>
            ) : filtrati.map((acc) => (
              <tr key={acc.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 flex-wrap font-medium">{acc.nome}{badgeIstruttore(acc)}</div>
                  {acc.protetto && <p className="text-xs text-muted-foreground font-normal">Primo amministratore · email e password nel file di configurazione del server</p>}
                  {acc.note && <p className="text-xs text-muted-foreground font-normal truncate max-w-xs">{acc.note}</p>}
                </td>
                <td className="py-3 px-4 text-muted-foreground">{acc.email}</td>
                <td className="py-3 px-4"><Badge variant="outline">{etichettaRuolo(acc.ruolo)}</Badge></td>
                <td className="py-3 px-4">{stato(acc)}</td>
                <td className="py-3 px-4 text-muted-foreground text-xs">{acc.last_activity_date ? formatDataOra(acc.last_activity_date) : "Mai"}</td>
                <td className="py-3 px-4">{azioni(acc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="sm:hidden space-y-2">
        {filtrati.length === 0 ? (
          <li className="text-center py-8 text-muted-foreground text-sm">{cerca ? "Nessun utente corrisponde alla ricerca" : "Nessun utente interno"}</li>
        ) : filtrati.map((acc) => (
          <li key={acc.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap font-medium">{acc.nome}{badgeIstruttore(acc)}</div>
                <p className="text-sm text-muted-foreground truncate">{acc.email}</p>
                {acc.note && <p className="text-xs text-muted-foreground mt-0.5">{acc.note}</p>}
              </div>
              {azioni(acc)}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <Badge variant="outline">{etichettaRuolo(acc.ruolo)}</Badge>
              {stato(acc)}
              <span className="text-xs text-muted-foreground">Ultima attività: {acc.last_activity_date ? formatDataOra(acc.last_activity_date) : "mai"}</span>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={mostraForm} onOpenChange={(v) => { setMostraForm(v); if (!v) setInModifica(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{inModifica ? "Modifica utente interno" : "Nuovo utente interno"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salva} className="space-y-3">
            {bloccato && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-info/10 border border-info/30 text-info text-xs">
                <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Primo amministratore.</strong> Email, password e ruolo stanno nel file di configurazione del server
                  (<code>ADMIN_EMAIL</code>, <code>ADMIN_PASSWORD</code>): si cambiano da lì, e al riavvio l'account si allinea.
                </span>
              </div>
            )}
            <div><Label>Nome *</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label>Email *</Label><Input type="email" required disabled={bloccato} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div>
              <Label>Ruolo *</Label>
              <Select value={form.ruolo} disabled={bloccato} onValueChange={(v) => setForm({ ...form, ruolo: v })}>
                <SelectTrigger><SelectValue placeholder="Scegli un ruolo" /></SelectTrigger>
                <SelectContent>
                  {ruoli.map((r) => <SelectItem key={r.nome} value={r.nome}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {bloccato ? "Administrator: il ruolo del primo amministratore non si cambia." : "Cosa comporta ciascun ruolo è nella scheda «Ruoli e permessi»."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Telefono</Label>
                <Input type="tel" placeholder="+39 333 1234567" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: soloTelefono(e.target.value) })} />
                <p className="text-xs text-muted-foreground mt-1">Solo cifre, spazi, + e trattini.</p>
              </div>
              <div>
                <Label>Partita IVA</Label>
                <Input inputMode="numeric" maxLength={11} value={form.partita_iva} onChange={(e) => setForm({ ...form, partita_iva: e.target.value.replace(/\D/g, "") })} />
              </div>
            </div>
            <div>
              <Label>Codice fiscale</Label>
              <Input maxLength={16} value={form.codice_fiscale} onChange={(e) => setForm({ ...form, codice_fiscale: e.target.value.toUpperCase() })} />
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={form.istruttore} onCheckedChange={(v) => setForm({ ...form, istruttore: v === true })} className="mt-0.5" />
              <span className="text-sm">
                <span className="font-medium">Istruttore</span>
                <span className="block text-xs text-muted-foreground mt-0.5">Può essere scelto come istruttore di un corso. Non dipende dal ruolo.</span>
              </span>
            </label>

            <div>
              <Label>Note</Label>
              <Textarea maxLength={NOTE_MASSIMO} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="es. Pilates e yoga, solo mattina" />
              <p className="text-xs text-muted-foreground mt-1">Si vedono sotto il nome, nella tabella degli utenti.</p>
            </div>

            {!bloccato && (
              <div>
                <Label>{inModifica ? "Password" : "Password *"}</Label>
                <Input
                  type="password"
                  required={!inModifica}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  minLength={form.password ? LUNGHEZZA_MINIMA_PASSWORD : undefined}
                  placeholder={inModifica ? "Lascia vuoto per non cambiarla" : `Almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri`}
                />
                <p className="text-xs text-muted-foreground mt-1">Al primo accesso la persona dovrà sceglierne una sua.</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={saving || !form.ruolo}>
              {saving ? "Salvataggio…" : inModifica ? "Salva modifiche" : "Crea account"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
