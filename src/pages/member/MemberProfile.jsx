import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import SelettoreTema from "@/components/shared/SelettoreTema";
import { Button } from "@/components/ui/button";
import { User, Mail, Phone, MapPin, Calendar, Heart, Pencil, LogOut, Hash } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData } from "@/lib/format";

export default function MemberProfile() {
  const { memberUser, logout } = useMemberAuth();
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    if (!memberUser?.member_id) return;
    api.entities.Member.get(memberUser.member_id).then(m => {
      setMember(m);
      setLoading(false);
    });
  }, [memberUser?.member_id]);

  if (loading) {
    return <LoadingState minHeight="p-8" />;
  }

  const fields = [
    { icon: Hash, label: "Codice socio", value: member?.codice_socio },
    { icon: User, label: "Nome completo", value: member?.full_name },
    { icon: Mail, label: "Email", value: member?.email },
    { icon: Phone, label: "Telefono", value: member?.phone },
    { icon: Calendar, label: "Data di nascita", value: member?.date_of_birth ? formatData(member.date_of_birth, "media") : null },
    { icon: MapPin, label: "Indirizzo", value: member?.address },
    { icon: Heart, label: "Contatto di emergenza", value: member?.emergency_contact_name ? `${member.emergency_contact_name}${member.emergency_contact_phone ? " — " + member.emergency_contact_phone : ""}` : null },
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
          {member?.notes && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground">Note</p>
              <p className="text-sm">{member.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sul telefono la barra laterale non c'è, quindi la scelta del tema va qui: è la
          pagina dove un socio cerca le proprie impostazioni. */}
      <Card className="border-0 shadow-sm lg:hidden">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Aspetto</p>
          <SelettoreTema />
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={() => setShowReport(true)}>
        <Pencil className="w-4 h-4 mr-1" /> Segnala una modifica
      </Button>

      <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={logout}>
        <LogOut className="w-4 h-4 mr-1" /> Esci dall'area cliente
      </Button>

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