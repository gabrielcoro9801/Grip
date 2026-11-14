import React, { useState, useEffect, useCallback } from "react";
import { caricaProfilo } from "@/core/api/portale";
import RevocaConsensi from "@/member/components/RevocaConsensi";
import { usePalestra, RecapitiPalestra } from "@/member/components/Palestra";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Mail, Phone, MapPin, Calendar, Heart, LogOut, KeyRound, Info } from "lucide-react";
import { DialogCambioPassword } from "@/ui/CambioPassword";
import SelettoreTema from "@/ui/SelettoreTema";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData } from "@/core/domain/format";

// Il Profilo, dall'avatar (docs/piani/portale.md, D-2): i miei dati, la palestra con i suoi
// recapiti, la revoca dei consensi se ce n'è uno, e l'account (tema, password, Esci).

function Sezione({ titolo, children }) {
  const id = `profilo-${titolo.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-1">
      <h2 id={id} className="text-sm font-semibold">{titolo}</h2>
      <Card className="border-0 shadow-sm">{children}</Card>
    </section>
  );
}

export default function MemberProfile() {
  const { logout, aggiornaUtente } = useMemberAuth();
  const palestra = usePalestra();
  const [member, setMember] = useState(null);
  const [errore, setErrore] = useState(null);
  const [cambioPassword, setCambioPassword] = useState(false);

  const carica = useCallback(() => {
    setErrore(null);
    caricaProfilo().then((profilo) => setMember(profilo?.socio ?? {})).catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!member) return <LoadingState minHeight="p-8" />;

  const fields = [
    { icon: Mail, label: "Email", value: member.email },
    { icon: Phone, label: "Telefono", value: member.telefono },
    { icon: Calendar, label: "Data di nascita", value: member.data_nascita ? formatData(member.data_nascita, "lungo") : null },
    { icon: MapPin, label: "Residenza", value: member.indirizzo },
    {
      icon: Heart,
      label: "Contatto di emergenza",
      value: member.contatto_emergenza
        ? [member.contatto_emergenza.nome, member.contatto_emergenza.telefono].filter(Boolean).join(" — ")
        : null,
    },
  ];
  const conRecapiti = palestra && (palestra.indirizzo || palestra.telefono || palestra.whatsapp || palestra.email || palestra.orari);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-heading font-bold">{member.nome ?? "Profilo"}</h1>
        {member.codice_socio && <p className="text-sm text-muted-foreground">Codice socio {member.codice_socio}</p>}
      </div>

      <Sezione titolo="I tuoi dati">
        <CardContent className="p-4 space-y-1">
          {fields.map(f => (
            <div key={f.label} className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <f.icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <p className="text-sm font-medium break-words">{f.value || "—"}</p>
              </div>
            </div>
          ))}
        </CardContent>
        <p className="flex items-center gap-2 px-4 pb-4 text-sm text-muted-foreground">
          <Info className="w-4 h-4 shrink-0" aria-hidden="true" /> Dati sbagliati? Scrivi o chiama la reception.
        </p>
      </Sezione>

      {conRecapiti && (
        <Sezione titolo={palestra.nome ?? "La palestra"}>
          <CardContent className="px-4 py-2"><RecapitiPalestra palestra={palestra} /></CardContent>
        </Sezione>
      )}

      <RevocaConsensi />

      <Sezione titolo="Account">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 min-h-11">
            <span className="text-sm">Tema scuro</span>
            <SelettoreTema />
          </div>
          <Button variant="outline" className="w-full min-h-11" onClick={() => setCambioPassword(true)}>
            <KeyRound className="w-4 h-4 mr-1" aria-hidden="true" /> Cambia password
          </Button>
          <Button variant="ghost" className="w-full min-h-11 text-destructive hover:text-destructive" onClick={logout}>
            <LogOut className="w-4 h-4 mr-1" aria-hidden="true" /> Esci
          </Button>
        </CardContent>
      </Sezione>

      <DialogCambioPassword open={cambioPassword} onClose={() => setCambioPassword(false)} onCambiata={aggiornaUtente} />
    </div>
  );
}
