import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/core/api/client";
import PageHeader from "@/staff/components/PageHeader";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { caricaFile } from "@/staff/lib/uploads";
import { Dumbbell } from "lucide-react";

// Dettagli societari: nome e logo (il menu laterale del gestionale) e i recapiti che il socio vede
// nel portale (Profilo, Abbonamento). Come farla bene si decide poi (docs/piani/portale.md, D-2).
const CAMPI = [
  { chiave: "nome", etichetta: "Nome della palestra" },
  { chiave: "indirizzo", etichetta: "Indirizzo", aiuto: "Nel portale apre Google Maps." },
  { chiave: "telefono", etichetta: "Telefono", tipo: "tel" },
  { chiave: "whatsapp", etichetta: "WhatsApp", tipo: "tel", aiuto: "Senza prefisso vale +39." },
  { chiave: "email", etichetta: "Email", tipo: "email" },
  { chiave: "orari", etichetta: "Orari della reception", righe: true },
];

const VUOTI = { ...Object.fromEntries(CAMPI.map((c) => [c.chiave, ""])), logo_url: "" };

export default function ContattiPalestra() {
  const { staffUser } = useStaffAuth();
  const puoCambiare = canEdit(staffUser?.ruolo, "impostazioni");
  const { toast } = useToast();
  const [valori, setValori] = useState(null);
  const [errore, setErrore] = useState(null);
  const [salvo, setSalvo] = useState(false);
  const [carico, setCarico] = useState(false);

  const prendi = (dati) => setValori({ ...VUOTI, ...Object.fromEntries(Object.entries(dati).map(([k, v]) => [k, v ?? ""])) });
  const carica = useCallback(() => {
    setErrore(null);
    api.impostazioni.palestra().then(prendi).catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);

  const salva = async (e) => {
    e.preventDefault();
    setSalvo(true);
    try {
      prendi(await api.impostazioni.salvaPalestra(valori));
      // Il menu laterale rilegge nome e logo.
      window.dispatchEvent(new Event("palestra-aggiornata"));
      toast({ title: "Dettagli salvati" });
    } catch (err) {
      toast({ title: "Non salvati", description: err.message, variant: "destructive" });
    } finally {
      setSalvo(false);
    }
  };

  const scegliLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCarico(true);
    try {
      const { file_url } = await caricaFile({ file, uso: "logo" });
      setValori((v) => ({ ...v, logo_url: file_url }));
    } catch (err) {
      toast({ title: "Logo non caricato", description: err.message, variant: "destructive" });
    } finally {
      setCarico(false);
    }
  };

  if (errore) return <ErrorState error={errore} onRetry={carica} />;
  if (!valori) return <LoadingState minHeight="h-full" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Dettagli Societari" description="Nome e logo compaiono nel menu laterale; i recapiti i soci li vedono nel portale. Un campo vuoto non si mostra." />
      <Card>
        <CardContent className="p-4 sm:p-6">
          <form onSubmit={salva} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="contatti-logo">Logo</Label>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-sidebar-primary flex items-center justify-center overflow-hidden shrink-0">
                  {valori.logo_url
                    ? <img src={valori.logo_url} alt="Logo attuale" className="w-full h-full object-contain" />
                    : <Dumbbell className="w-5 h-5 text-sidebar-primary-foreground" aria-hidden="true" />}
                </div>
                {puoCambiare && (
                  <>
                    <Input id="contatti-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={scegliLogo} disabled={carico} className="max-w-xs" />
                    {valori.logo_url && (
                      <Button type="button" variant="outline" onClick={() => setValori((v) => ({ ...v, logo_url: "" }))}>Togli</Button>
                    )}
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{carico ? "Caricamento…" : "PNG, JPEG, WebP o SVG. Senza logo resta il manubrio."}</p>
            </div>
            {CAMPI.map((c) => {
              const id = `contatti-${c.chiave}`;
              const Campo = c.righe ? Textarea : Input;
              return (
                <div key={c.chiave} className="space-y-1">
                  <Label htmlFor={id}>{c.etichetta}</Label>
                  <Campo
                    id={id}
                    type={c.righe ? undefined : (c.tipo ?? "text")}
                    rows={c.righe ? 3 : undefined}
                    value={valori[c.chiave]}
                    disabled={!puoCambiare}
                    onChange={(e) => setValori((v) => ({ ...v, [c.chiave]: e.target.value }))}
                  />
                  {c.aiuto && <p className="text-xs text-muted-foreground">{c.aiuto}</p>}
                </div>
              );
            })}
            {puoCambiare && (
              <Button type="submit" disabled={salvo || carico} className="min-h-11">{salvo ? "Salvataggio…" : "Salva"}</Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
