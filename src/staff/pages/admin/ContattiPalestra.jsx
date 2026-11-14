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

// I recapiti della palestra che il socio vede nel portale (Profilo, Abbonamento). Una pagina
// piccola apposta: come farla bene si decide poi (docs/piani/portale.md, D-2).
const CAMPI = [
  { chiave: "nome", etichetta: "Nome della palestra" },
  { chiave: "indirizzo", etichetta: "Indirizzo", aiuto: "Nel portale apre Google Maps." },
  { chiave: "telefono", etichetta: "Telefono", tipo: "tel" },
  { chiave: "whatsapp", etichetta: "WhatsApp", tipo: "tel", aiuto: "Senza prefisso vale +39." },
  { chiave: "email", etichetta: "Email", tipo: "email" },
  { chiave: "orari", etichetta: "Orari della reception", righe: true },
];

const VUOTI = Object.fromEntries(CAMPI.map((c) => [c.chiave, ""]));

export default function ContattiPalestra() {
  const { staffUser } = useStaffAuth();
  const puoCambiare = canEdit(staffUser?.ruolo, "admin_users");
  const { toast } = useToast();
  const [valori, setValori] = useState(null);
  const [errore, setErrore] = useState(null);
  const [salvo, setSalvo] = useState(false);

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
      toast({ title: "Contatti salvati" });
    } catch (err) {
      toast({ title: "Non salvati", description: err.message, variant: "destructive" });
    } finally {
      setSalvo(false);
    }
  };

  if (errore) return <ErrorState error={errore} onRetry={carica} />;
  if (!valori) return <LoadingState minHeight="h-full" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Contatti" description="I recapiti della palestra che i soci vedono nel portale. Un campo vuoto non si mostra." />
      <Card>
        <CardContent className="p-4 sm:p-6">
          <form onSubmit={salva} className="space-y-4">
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
              <Button type="submit" disabled={salvo} className="min-h-11">{salvo ? "Salvataggio…" : "Salva"}</Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
