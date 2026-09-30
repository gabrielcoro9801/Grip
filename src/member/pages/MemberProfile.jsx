import React, { useState, useEffect } from "react";
import { caricaProfilo } from "@/core/api/portale";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { User, Mail, Phone, MapPin, Calendar, Heart, Pencil, LogOut, Hash, KeyRound } from "lucide-react";
import { DialogCambioPassword } from "@/ui/CambioPassword";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/ui/primitivi/dialog";
import { LoadingState } from "@/ui/Spinner";
import { formatData } from "@/core/domain/format";

export default function MemberProfile() {
  const { logout, aggiornaUtente } = useMemberAuth();
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [cambioPassword, setCambioPassword] = useState(false);

  useEffect(() => {
    caricaProfilo()
      .then((profilo) => setMember(profilo?.socio ?? null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState minHeight="p-8" />;
  }

  const fields = [
    { icon: Hash, label: "Codice socio", value: member?.codice_socio },
    { icon: User, label: "Nome completo", value: member?.nome },
    { icon: Mail, label: "Email", value: member?.email },
    { icon: Phone, label: "Telefono", value: member?.telefono },
    { icon: Calendar, label: "Data di nascita", value: member?.data_nascita ? formatData(member.data_nascita, "media") : null },
    { icon: MapPin, label: "Residenza", value: member?.indirizzo },
    {
      icon: Heart,
      label: "Contatto di emergenza",
      value: member?.contatto_emergenza
        ? [member.contatto_emergenza.nome, member.contatto_emergenza.telefono].filter(Boolean).join(" — ")
        : null,
    },
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Anagrafica</h1>
        <p className="text-sm text-muted-foreground">I tuoi dati personali</p>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-1">
          {fields.map(f => (
            <div key={f.label} className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <f.icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <p className="text-sm font-medium">{f.value || "—"}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={() => setShowReport(true)}>
        <Pencil className="w-4 h-4 mr-1" /> Segnala una modifica
      </Button>

      <Button variant="outline" className="w-full" onClick={() => setCambioPassword(true)}>
        <KeyRound className="w-4 h-4 mr-1" /> Cambia password
      </Button>

      <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={logout}>
        <LogOut className="w-4 h-4 mr-1" /> Esci dall'area cliente
      </Button>

      <DialogCambioPassword open={cambioPassword} onClose={() => setCambioPassword(false)} onCambiata={aggiornaUtente} />

      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Segnala una modifica</DialogTitle>
            <DialogDescription>
              Per richiedere la correzione dei tuoi dati anagrafici, rivolgiti alla reception della palestra.
              Lo staff provvederà ad aggiornare i tuoi dati dopo verifica.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowReport(false)}>Ho capito</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}