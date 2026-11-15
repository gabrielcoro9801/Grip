import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { useOrganization } from "@/staff/lib/useOrganization";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Pencil, Shield, AlertTriangle, Plus, Trash2, Lock } from "lucide-react";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { useToast } from "@/ui/primitivi/use-toast";
import { useConfirm } from "@/ui/ConfirmDialog";
import { impostaMatrice, RUOLI_NON_CONFIGURABILI, RUOLO_AMMINISTRATORE, canEdit } from "@/staff/lib/permissions";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";

// Le azioni di un modulo, come si leggono in tabella: V vede, M modifica, I istruttore (ristretto ai
// corsi di cui l'utente è istruttore). Il badge dice tutto, anche senza la legenda.
const etichetta = (azioni = []) => {
  const v = azioni.includes("view");
  const m = azioni.includes("edit");
  const i = azioni.includes("suoi");
  if (!v) return null;
  if (m && i) return "V + M · Istr.";
  if (m) return "V + M";
  if (i) return "V · Istr.";
  return "V";
};

/**
 * Chi può fare cosa.
 *
 * La matrice è dell'ente: organigrammi diversi hanno ruoli diversi. Due cose restano fuori dalla
 * portata di questa schermata: il socio non riceve permessi da qui, e l'amministratore non può
 * perdere la gestione di utenti e ruoli. Il server applica gli stessi limiti, e nessuno può
 * concedere a un ruolo un permesso che non ha.
 */
export default function GestioneRuoli() {
  const { organization } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  // Chi ha il permesso Ruoli in modifica ridisegna la matrice; gli altri la leggono.
  const puoModificare = canEdit(staffUser?.ruolo, "ruoli");
  const [dati, setDati] = useState(null);
  const [inModifica, setInModifica] = useState(null);
  const [bozza, setBozza] = useState({ permessi: {}, capacita: [] });
  const [saving, setSaving] = useState(false);
  const [mostraNuovo, setMostraNuovo] = useState(false);
  const [nuovo, setNuovo] = useState({ label: "", copiaDa: "" });

  const carica = useCallback(async () => {
    if (!organization) return;
    try {
      setDati(await api.ruoli.lista(organization.id));
    } catch (err) {
      toast({ title: "Permessi non leggibili", description: err.message, variant: "destructive" });
    }
  }, [organization, toast]);

  useEffect(() => { carica(); }, [carica]);

  if (!dati) return null;

  const { ruoli, moduli } = dati;
  const configurabili = ruoli.filter((r) => !RUOLI_NON_CONFIGURABILI.has(r.nome));
  const blocco = (ruolo) => ruolo.nome === RUOLO_AMMINISTRATORE;

  const apri = (ruolo) => {
    setInModifica(ruolo);
    setBozza({ permessi: { ...(ruolo.permessi ?? {}) }, capacita: [] });
  };

  const creaRuolo = async () => {
    if (!nuovo.label.trim()) return;
    setSaving(true);
    try {
      // Si parte da una copia, non dal vuoto: il caso reale è «come la reception, ma senza il registro».
      const modello = ruoli.find((r) => r.id === nuovo.copiaDa);
      const esito = await api.ruoli.crea({
        organization_id: organization.id,
        label: nuovo.label.trim(),
        descrizione: null,
        permessi: modello?.permessi ?? {},
        capacita: [],
      });
      if (esito.matrice) impostaMatrice(esito.matrice);
      toast({ title: `Ruolo «${esito.ruolo.label}» creato`, description: "Ora puoi modificarne i permessi." });
      setNuovo({ label: "", copiaDa: "" });
      setMostraNuovo(false);
      await carica();
    } catch (err) {
      toast({ title: "Non creato", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const eliminaRuolo = async (ruolo) => {
    const ok = await conferma({
      title: `Eliminare il ruolo «${ruolo.label}»?`,
      description: "Si può eliminare solo se nessun account lo usa.",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.ruoli.elimina(ruolo.id);
      toast({ title: `Ruolo «${ruolo.label}» eliminato` });
      setInModifica(null);
      await carica();
    } catch (err) {
      toast({ title: "Non eliminato", description: err.message, variant: "destructive" });
    }
  };

  const azioniDi = (modulo) => bozza.permessi[modulo] ?? [];

  // Vede è la base: togliendola cadono la modifica e l'istruttore. Modifica e istruttore accendono
  // anche la vista, così non si può modificare ciò che non si vede.
  const commuta = (modulo, azione) => {
    const attuali = new Set(azioniDi(modulo));
    if (attuali.has(azione)) {
      attuali.delete(azione);
      if (azione === "view") { attuali.delete("edit"); attuali.delete("suoi"); }
    } else {
      attuali.add(azione);
      if (azione !== "view") attuali.add("view");
    }
    setBozza({ ...bozza, permessi: { ...bozza.permessi, [modulo]: [...attuali] } });
  };

  const salva = async () => {
    setSaving(true);
    try {
      const esito = await api.ruoli.salva(inModifica.id, bozza);
      // Il salvataggio può aver cambiato i permessi di chi sta guardando: la matrice in uso va
      // riallineata subito, o l'interfaccia continuerebbe a mostrare quella di prima.
      if (esito.matrice) impostaMatrice(esito.matrice);
      toast({ title: `Permessi di «${inModifica.label}» aggiornati` });
      setInModifica(null);
      carica();
    } catch (err) {
      toast({ title: "Non salvato", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-semibold text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" /> Permessi per ruolo
          </h3>
          {puoModificare && (
            <Button size="sm" variant="outline" onClick={() => setMostraNuovo(true)}>
              <Plus className="w-4 h-4 mr-1" /> Nuovo ruolo
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {puoModificare ? (
            <>Puoi adattare i ruoli all'organizzazione. L'<strong>Administrator</strong> ha tutto e non si modifica; al <strong>socio</strong> non si assegnano permessi da qui. <strong>Istr.</strong> (Istruttore): vede e modifica solo ciò che riguarda i corsi di cui l'utente è istruttore.</>
          ) : (
            <>Questa tabella è in sola lettura: i ruoli li disegna chi ha il permesso Ruoli in modifica. Qui vedi cosa comporta ciascuno, così sai cosa stai assegnando.</>
          )}
        </p>

        {/* Da 390 px un ruolo per blocco, con i suoi moduli: una colonna sola non ci starebbe. */}
        <div className="hidden sm:block overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="py-2 px-3 font-medium text-muted-foreground">Modulo</th>
                {configurabili.map((r) => (
                  <th key={r.nome} className="py-2 px-3 font-medium text-muted-foreground text-center whitespace-nowrap">{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(moduli).map(([modulo, meta]) => (
                <tr key={modulo} className="border-b border-border/50">
                  <td className="py-2 px-3 font-medium whitespace-nowrap">{meta.label}</td>
                  {configurabili.map((r) => {
                    const testo = etichetta(r.permessi?.[modulo]);
                    return (
                      <td key={r.nome} className="py-2 px-3 text-center">
                        {testo ? <Badge variant="outline" className="text-[10px]">{testo}</Badge> : <span className="text-muted-foreground text-[10px]">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {puoModificare && (
                <tr>
                  <td className="py-2 px-3" />
                  {configurabili.map((r) => (
                    <td key={r.nome} className="py-2 px-3 text-center">
                      {blocco(r) ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="w-3 h-3" aria-hidden="true" /> Fisso</span>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => apri(r)}>
                          <Pencil className="w-3 h-3 mr-1" /> Modifica
                        </Button>
                      )}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="sm:hidden space-y-3">
          {configurabili.map((r) => (
            <div key={r.nome} className="rounded-lg border border-border">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
                <span className="font-medium text-sm">{r.label}</span>
                {puoModificare && (blocco(r) ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="w-3 h-3" aria-hidden="true" /> Fisso</span>
                ) : (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => apri(r)}>
                    <Pencil className="w-3 h-3 mr-1" /> Modifica
                  </Button>
                ))}
              </div>
              <div className="divide-y divide-border">
                {Object.entries(moduli).filter(([modulo]) => etichetta(r.permessi?.[modulo])).map(([modulo, meta]) => (
                  <div key={modulo} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{meta.label}</span>
                    <Badge variant="outline" className="text-[10px]">{etichetta(r.permessi?.[modulo])}</Badge>
                  </div>
                ))}
                {Object.keys(moduli).every((modulo) => !etichetta(r.permessi?.[modulo])) && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">Nessun permesso: chi ha questo ruolo vede solo la pagina di benvenuto.</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <Dialog open={mostraNuovo} onOpenChange={setMostraNuovo}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Nuovo ruolo</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Come si chiama *</Label>
                <Input value={nuovo.label} onChange={(e) => setNuovo({ ...nuovo, label: e.target.value })} placeholder="es. Tesoriere" />
                <p className="text-xs text-muted-foreground mt-1">
                  Il nome visibile si può cambiare quando vuoi. Quello tecnico, che finisce negli account, viene ricavato da qui e resta fisso.
                </p>
              </div>

              <div>
                <Label>Parti dai permessi di</Label>
                <Select value={nuovo.copiaDa || "vuoto"} onValueChange={(v) => setNuovo({ ...nuovo, copiaDa: v === "vuoto" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vuoto">Nessun permesso: li assegno io</SelectItem>
                    {configurabili.filter((r) => !blocco(r)).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Partire da un ruolo simile e togliere quello che non serve è più sicuro che spuntare le aree una per una.
                </p>
              </div>

              <Button onClick={creaRuolo} disabled={saving || !nuovo.label.trim()} className="w-full">
                {saving ? "Creazione…" : "Crea ruolo"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(inModifica)} onOpenChange={(v) => !v && setInModifica(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Permessi di «{inModifica?.label}»</DialogTitle></DialogHeader>

            {inModifica && (
              <div className="space-y-4">
                {inModifica.nome === staffUser?.ruolo && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Stai modificando il <strong>tuo</strong> ruolo: quello che togli lo perdi tu per primo, e vale subito.
                    </span>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">AREE</p>
                  <div className="space-y-1.5">
                    {Object.entries(moduli).map(([modulo, meta]) => (
                      <div key={modulo} className="flex items-center justify-between gap-3 py-1">
                        <span className="text-sm">{meta.label}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <Checkbox checked={azioniDi(modulo).includes("view")} onCheckedChange={() => commuta(modulo, "view")} />
                            Vede
                          </label>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <Checkbox checked={azioniDi(modulo).includes("edit")} onCheckedChange={() => commuta(modulo, "edit")} />
                            Modifica
                          </label>
                          {meta.azioni?.includes("suoi") && (
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Vede e modifica solo i corsi di cui l'utente è istruttore">
                              <Checkbox checked={azioniDi(modulo).includes("suoi")} onCheckedChange={() => commuta(modulo, "suoi")} />
                              Istruttore
                            </label>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    <strong>Istruttore</strong>: vede e modifica solo ciò che riguarda i corsi di cui l'utente è istruttore (la spunta «Istruttore» in Utenti). Accenderla accende anche «Vede».
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button onClick={salva} disabled={saving} className="flex-1">
                    {saving ? "Salvataggio…" : "Salva permessi"}
                  </Button>
                  {/* I ruoli di base non si eliminano: il codice vi fa riferimento come valori predefiniti. */}
                  {!inModifica.sistema && (
                    <Button variant="outline" className="text-destructive" onClick={() => eliminaRuolo(inModifica)}>
                      <Trash2 className="w-4 h-4 mr-1" /> Elimina
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        {dialogoConferma}
      </CardContent>
    </Card>
  );
}
