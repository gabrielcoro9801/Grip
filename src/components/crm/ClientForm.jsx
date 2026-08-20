import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import IndirizzoFatturazione from "@/components/shared/IndirizzoFatturazione";
import { datiMancantiCliente, DESTINATARIO_SCONOSCIUTO } from "../../../shared/fatturaElettronica.js";

const VUOTO = {
  tipo: "privato",
  nome: "",
  cognome: "",
  ragione_sociale: "",
  email: "",
  telefono: "",
  codice_fiscale_piva: "",
  partita_iva: "",
  codice_fiscale: "",
  indirizzo_via: "",
  indirizzo_civico: "",
  indirizzo_cap: "",
  indirizzo_comune: "",
  indirizzo_provincia: "",
  codice_destinatario: "",
  pec: "",
  pubblica_amministrazione: false,
  scissione_pagamenti: false,
  note: "",
};

/**
 * Anagrafica cliente, in creazione e in modifica.
 *
 * Prima esisteva solo la creazione: un cliente registrato non si poteva più correggere, il
 * che con l'arrivo dei dati di fatturazione avrebbe reso impossibile completare le schede
 * già esistenti.
 *
 * I campi della fattura elettronica stanno in una sezione a parte perché servono solo a chi
 * emette fattura — un socio occasionale che paga in contanti non ne ha bisogno — ma si apre
 * da sola per le aziende, che sono esattamente i clienti a cui la fattura va emessa.
 */
export default function ClientForm({ open, onClose, organization, cliente, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState(VUOTO);
  const [mostraFatturazione, setMostraFatturazione] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (cliente) {
      const caricato = { ...VUOTO };
      for (const chiave of Object.keys(VUOTO)) caricato[chiave] = cliente[chiave] ?? VUOTO[chiave];
      setForm(caricato);
      setMostraFatturazione(cliente.tipo === "azienda");
    } else {
      setForm(VUOTO);
      setMostraFatturazione(false);
    }
  }, [open, cliente]);

  const mancanti = datiMancantiCliente(form);

  const salva = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // I campi vuoti si salvano come null: una stringa vuota in un codice destinatario
      // sembrerebbe un valore compilato quando si controlla cosa manca.
      const dati = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]));
      if (cliente) {
        await api.entities.Client.update(cliente.id, dati);
      } else {
        await api.entities.Client.create({ ...dati, organization_id: organization.id, attivo: true });
      }
      toast({ title: cliente ? "Cliente aggiornato" : "Cliente creato" });
      onSaved?.();
      onClose();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cliente ? "Modifica cliente" : "Nuovo cliente occasionale"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={salva} className="space-y-3">
          <div>
            <Label>Tipo cliente *</Label>
            <Select
              value={form.tipo}
              onValueChange={(v) => {
                setForm({ ...form, tipo: v });
                if (v === "azienda") setMostraFatturazione(true);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="privato">Privato</SelectItem>
                <SelectItem value="azienda">Azienda</SelectItem>
              </SelectContent>
            </Select>
            {form.tipo === "azienda" && (
              <p className="text-xs text-muted-foreground mt-1">
                A un'azienda si emette fattura, non ricevuta: servono i dati della sezione qui sotto.
              </p>
            )}
          </div>

          {form.tipo === "privato" ? (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome *</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
              <div><Label>Cognome *</Label><Input required value={form.cognome} onChange={(e) => setForm({ ...form, cognome: e.target.value })} /></div>
            </div>
          ) : (
            <div><Label>Ragione sociale *</Label><Input required value={form.ragione_sociale} onChange={(e) => setForm({ ...form, ragione_sociale: e.target.value })} /></div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Telefono</Label><Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
          </div>

          <div>
            <Label>Codice Fiscale / P.IVA</Label>
            <Input value={form.codice_fiscale_piva} onChange={(e) => setForm({ ...form, codice_fiscale_piva: e.target.value })} />
            <p className="text-xs text-muted-foreground mt-1">Come compare su ricevute e documenti di cortesia.</p>
          </div>

          <button
            type="button"
            onClick={() => setMostraFatturazione((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium pt-2 w-full text-left"
          >
            {mostraFatturazione ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Dati per la fattura elettronica
            {!mostraFatturazione && mancanti.length > 0 && form.tipo === "azienda" && (
              <span className="ml-1 text-xs font-normal text-amber-700">({mancanti.length} da completare)</span>
            )}
          </button>

          {mostraFatturazione && (
            <div className="space-y-3 pl-5 border-l-2 border-muted">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Partita IVA</Label>
                  <Input
                    value={form.partita_iva}
                    onChange={(e) => setForm({ ...form, partita_iva: e.target.value.replace(/\s/g, "") })}
                    placeholder="11223344556"
                    maxLength={16}
                  />
                </div>
                <div>
                  <Label>Codice fiscale</Label>
                  <Input
                    value={form.codice_fiscale}
                    onChange={(e) => setForm({ ...form, codice_fiscale: e.target.value.replace(/\s/g, "").toUpperCase() })}
                    maxLength={16}
                  />
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Sede</Label>
                <IndirizzoFatturazione valori={form} onChange={setForm} />
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.pubblica_amministrazione}
                  onChange={(e) => setForm({ ...form, pubblica_amministrazione: e.target.checked })}
                />
                <span className="text-sm">
                  È una Pubblica Amministrazione
                  <span className="block text-xs text-muted-foreground">
                    Comune, scuola, ente pubblico. Cambia il tracciato della fattura e richiede il
                    Codice Univoco Ufficio, che l'ente ti comunica.
                  </span>
                </span>
              </label>

              {form.pubblica_amministrazione && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.scissione_pagamenti}
                    onChange={(e) => setForm({ ...form, scissione_pagamenti: e.target.checked })}
                  />
                  <span className="text-sm">
                    Scissione dei pagamenti (split payment)
                    <span className="block text-xs text-muted-foreground">
                      L'IVA la versa l'ente direttamente all'erario: tu incassi solo l'imponibile.
                      Va dichiarato nella fattura, altrimenti l'importo atteso non torna.
                    </span>
                  </span>
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{form.pubblica_amministrazione ? "Codice Univoco Ufficio" : "Codice destinatario"}</Label>
                  <Input
                    value={form.codice_destinatario}
                    onChange={(e) => setForm({
                      ...form,
                      codice_destinatario: e.target.value
                        .replace(/[^A-Za-z0-9]/g, "")
                        .toUpperCase()
                        .slice(0, form.pubblica_amministrazione ? 6 : 7),
                    })}
                    placeholder={form.pubblica_amministrazione ? "UF1234" : "ABC1234"}
                  />
                </div>
                <div>
                  <Label>PEC</Label>
                  <Input
                    type="email"
                    value={form.pec}
                    onChange={(e) => setForm({ ...form, pec: e.target.value })}
                    placeholder="cliente@pec.it"
                    disabled={form.pubblica_amministrazione}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                {form.pubblica_amministrazione ? (
                  <>
                    Verso una PA il Codice Univoco Ufficio è l'unico recapito possibile: non esiste
                    il ripiego della PEC né del cassetto fiscale. Lo trovi nell'Indice PA o te lo
                    comunica l'ente insieme all'incarico.
                  </>
                ) : (
                  <>
                    È il dato da cui dipende se la fattura arriva. Basta uno dei due: il cliente ti
                    dice quale usa. Senza nessuno dei due si trasmette
                    con <code>{DESTINATARIO_SCONOSCIUTO}</code> e la fattura resta nel suo cassetto
                    fiscale — valido, ma lui potrebbe non accorgersene.
                  </>
                )}
              </p>

              {mancanti.length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-medium">A questo cliente non si può ancora emettere una fattura elettronica:</p>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                      {mancanti.map((m) => <li key={m}>{m}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          <div><Label>Note</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>

          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Salvataggio…" : cliente ? "Salva modifiche" : "Crea cliente"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
