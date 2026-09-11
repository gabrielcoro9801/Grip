import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { useOrganization } from "@/staff/lib/useOrganization";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Pencil, Shield, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { useToast } from "@/ui/primitivi/use-toast";
import { impostaMatrice, RUOLI_NON_CONFIGURABILI, PRESIDIO_AMMINISTRATORE } from "@/staff/lib/permissions";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";

/**
 * Chi può fare cosa.
 *
 * La matrice viveva nel codice: sei ruoli uguali per ogni installazione. Ora è dell'ente,
 * perché organigrammi diversi hanno bisogno di ruoli diversi — una ASD grande vuole un
 * tesoriere in sola lettura, una piccola non ha nemmeno il PT.
 *
 * Due cose restano fuori dalla portata di questa schermata, e sono dichiarate qui sotto
 * perché chi la usa deve saperlo: il socio non riceve permessi da qui, e l'amministratore
 * non può perdere la gestione degli utenti. Una terza protezione è nel server: nessuno può
 * concedere a un ruolo un permesso che lui stesso non ha.
 */
export default function GestioneRuoli() {
  const { organization } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  // Chi amministra gli utenti vede la matrice — deve sapere cosa comporta un ruolo prima
  // di assegnarlo — ma solo l'amministratore la riscrive. Il server applica lo stesso
  // limite: qui si nascondono i comandi, là si rifiutano le richieste.
  const puoModificare = staffUser?.ruolo === PRESIDIO_AMMINISTRATORE.ruolo;
  const [dati, setDati] = useState(null);
  const [inModifica, setInModifica] = useState(null);
  const [bozza, setBozza] = useState({ permessi: {}, capacita: [] });
  const [saving, setSaving] = useState(false);
  const [mostraNuovo, setMostraNuovo] = useState(false);
  const [nuovo, setNuovo] = useState({ label: "", descrizione: "", copiaDa: "" });

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

  const { ruoli, moduli, capacita: catalogoCapacita } = dati;
  const configurabili = ruoli.filter((r) => !RUOLI_NON_CONFIGURABILI.has(r.nome));

  const apri = (ruolo) => {
    setInModifica(ruolo);
    setBozza({ permessi: { ...(ruolo.permessi ?? {}) }, capacita: [...(ruolo.capacita ?? [])] });
  };

  const creaRuolo = async () => {
    if (!nuovo.label.trim()) return;
    setSaving(true);
    try {
      // Si parte da una copia, non dal vuoto: il caso reale è "come la reception, ma senza
      // il log audit". Spuntare le aree una per una da zero è un invito a dimenticarne una
      // — e dimenticare in eccesso non dà errore, si nota solo quando qualcuno vede
      // qualcosa che non doveva.
      const modello = ruoli.find((r) => r.id === nuovo.copiaDa);
      const esito = await api.ruoli.crea({
        organization_id: organization.id,
        label: nuovo.label.trim(),
        descrizione: nuovo.descrizione.trim() || null,
        permessi: modello?.permessi ?? {},
        capacita: modello?.capacita ?? [],
      });
      if (esito.matrice) impostaMatrice(esito.matrice);
      toast({ title: `Ruolo «${esito.ruolo.label}» creato`, description: "Ora puoi modificarne i permessi." });
      setNuovo({ label: "", descrizione: "", copiaDa: "" });
      setMostraNuovo(false);
      await carica();
    } catch (err) {
      toast({ title: "Non creato", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const eliminaRuolo = async (ruolo) => {
    if (!confirm(`Eliminare il ruolo «${ruolo.label}»?`)) return;
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

  const commuta = (modulo, azione) => {
    const attuali = new Set(azioniDi(modulo));
    if (attuali.has(azione)) {
      attuali.delete(azione);
      // Non si modifica ciò che non si vede: togliendo la vista cade anche la modifica.
      if (azione === "view") attuali.delete("edit");
    } else {
      attuali.add(azione);
      if (azione === "edit") attuali.add("view");
    }
    setBozza({ ...bozza, permessi: { ...bozza.permessi, [modulo]: [...attuali] } });
  };

  const commutaCapacita = (nome) => {
    const attuali = new Set(bozza.capacita);
    attuali.has(nome) ? attuali.delete(nome) : attuali.add(nome);
    setBozza({ ...bozza, capacita: [...attuali] });
  };

  const salva = async () => {
    setSaving(true);
    try {
      const esito = await api.ruoli.salva(inModifica.id, bozza);
      // Il salvataggio può aver cambiato i permessi di chi sta guardando: la matrice in uso
      // va riallineata subito, o l'interfaccia continuerebbe a mostrare quella di prima.
      if (esito.matrice) impostaMatrice(esito.matrice);
      toast({ title: `Permessi di "${inModifica.label}" aggiornati` });
      setInModifica(null);
      carica();
    } catch (err) {
      toast({ title: "Non salvato", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const presidio = (ruolo, modulo) =>
    ruolo.nome === PRESIDIO_AMMINISTRATORE.ruolo && modulo === PRESIDIO_AMMINISTRATORE.modulo;

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

        {puoModificare ? (
          <p className="text-xs text-muted-foreground">
            Puoi adattare i ruoli all'organizzazione. Due cose restano fuori portata: al{" "}
            <strong>socio</strong> non si assegnano permessi da qui — quello che vede nel portale
            è deciso altrove — e l'<strong>amministratore</strong> non può perdere la gestione utenti,
            o nessuno potrebbe più aprire questa schermata.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Questa tabella è in sola lettura: i ruoli li disegna l'<strong>amministratore</strong>.
            Qui vedi cosa comporta ciascuno, così sai cosa stai assegnando quando crei un account.
          </p>
        )}

        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="py-2 px-3 font-medium text-muted-foreground">Modulo</th>
                {configurabili.map((r) => (
                  <th key={r.nome} className="py-2 px-3 font-medium text-muted-foreground text-center whitespace-nowrap">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(moduli).map(([modulo, meta]) => (
                <tr key={modulo} className="border-b border-border/50">
                  <td className="py-2 px-3 font-medium whitespace-nowrap">{meta.label}</td>
                  {configurabili.map((r) => {
                    const perms = r.permessi?.[modulo] ?? [];
                    return (
                      <td key={r.nome} className="py-2 px-3 text-center">
                        {perms.includes("edit") ? (
                          <Badge className="bg-success/10 text-success border-success/30 text-[10px]">V + M</Badge>
                        ) : perms.includes("view") ? (
                          <Badge variant="outline" className="text-[10px]">V</Badge>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-b border-border/50 bg-muted/20">
                <td className="py-2 px-3 font-medium">Azioni privilegiate</td>
                {configurabili.map((r) => (
                  <td key={r.nome} className="py-2 px-3 text-center text-[10px] text-muted-foreground">
                    {r.capacita?.length ? `${r.capacita.length}` : "—"}
                  </td>
                ))}
              </tr>
              {puoModificare && (
                <tr>
                  <td className="py-2 px-3" />
                  {configurabili.map((r) => (
                    <td key={r.nome} className="py-2 px-3 text-center">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => apri(r)}>
                        <Pencil className="w-3 h-3 mr-1" /> Modifica
                      </Button>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Dialog open={mostraNuovo} onOpenChange={setMostraNuovo}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Nuovo ruolo</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Come si chiama *</Label>
                <Input
                  value={nuovo.label}
                  onChange={(e) => setNuovo({ ...nuovo, label: e.target.value })}
                  placeholder="es. Tesoriere"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Il nome visibile si può cambiare quando vuoi. Quello tecnico, che finisce negli
                  account, viene ricavato da qui e resta fisso: cambiarlo dopo lascerebbe senza
                  permessi chi è già collegato.
                </p>
              </div>

              <div>
                <Label>Parti dai permessi di</Label>
                <Select value={nuovo.copiaDa || "vuoto"} onValueChange={(v) => setNuovo({ ...nuovo, copiaDa: v === "vuoto" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vuoto">Nessun permesso — li assegno io</SelectItem>
                    {configurabili.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Partire da un ruolo simile e togliere quello che non serve è più sicuro che
                  spuntare le aree una per una: un permesso dimenticato <em>in eccesso</em> non
                  dà errore, si nota solo quando qualcuno vede ciò che non doveva.
                </p>
              </div>

              <div>
                <Label>A cosa serve (facoltativo)</Label>
                <Input
                  value={nuovo.descrizione}
                  onChange={(e) => setNuovo({ ...nuovo, descrizione: e.target.value })}
                  placeholder="es. Gestisce la cassa e i pagamenti, non tocca i soci"
                />
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
                      Stai modificando il <strong>tuo</strong> ruolo: quello che togli lo perdi tu per primo,
                      e vale subito.
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
                            <Checkbox
                              checked={azioniDi(modulo).includes("view")}
                              disabled={presidio(inModifica, modulo)}
                              onCheckedChange={() => commuta(modulo, "view")}
                            />
                            Vede
                          </label>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <Checkbox
                              checked={azioniDi(modulo).includes("edit")}
                              disabled={presidio(inModifica, modulo)}
                              onCheckedChange={() => commuta(modulo, "edit")}
                            />
                            Modifica
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  {presidio(inModifica, PRESIDIO_AMMINISTRATORE.modulo) && (
                    <p className="text-xs text-muted-foreground mt-2">
                      «{moduli[PRESIDIO_AMMINISTRATORE.modulo].label}» resta all'amministratore: è la
                      porta da cui si rientra se una configurazione va storta.
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-2">AZIONI PRIVILEGIATE</p>
                  <div className="space-y-2.5">
                    {Object.entries(catalogoCapacita).map(([nome, meta]) => (
                      <label key={nome} className="flex items-start gap-2 cursor-pointer">
                        <Checkbox
                          className="mt-0.5"
                          checked={bozza.capacita.includes(nome)}
                          onCheckedChange={() => commutaCapacita(nome)}
                        />
                        <span className="text-sm">
                          {meta.label}
                          <span className="block text-xs text-muted-foreground">{meta.descrizione}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button onClick={salva} disabled={saving} className="flex-1">
                    {saving ? "Salvataggio…" : "Salva permessi"}
                  </Button>
                  {/* I sei ruoli di base non si eliminano: il codice vi fa riferimento come
                      valori predefiniti. Per gli altri il server rifiuta comunque se ci sono
                      account collegati, e dice quanti. */}
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
      </CardContent>
    </Card>
  );
}
