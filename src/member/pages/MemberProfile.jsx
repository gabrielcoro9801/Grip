import React, { useState, useEffect } from "react";
import { caricaProfilo, caricaConsensi, scegliConsenso } from "@/core/api/portale";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { TIPI_CONSENSO } from "@/core/domain/consensi";
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

/**
 * Che cosa la palestra può mandare oltre alle comunicazioni di servizio (scadenze, lezioni
 * annullate): promozioni, auguri, proposte. Li sceglie il socio, canale per canale, e può
 * cambiare idea quando vuole.
 */
function ConsensiComunicazioni() {
  const [consensi, setConsensi] = useState(null);
  const [errore, setErrore] = useState(null);
  useEffect(() => {
    caricaConsensi().then((r) => setConsensi(r.consensi)).catch(setErrore);
  }, []);

  const scegli = async (tipo, valore) => {
    setErrore(null);
    try {
      setConsensi((await scegliConsenso(tipo, valore)).consensi);
    } catch (err) {
      setErrore(err);
    }
  };

  if (!consensi && !errore) return null;
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium">Comunicazioni dalla palestra</h2>
          <p className="text-xs text-muted-foreground">
            Scadenze e avvisi sulle lezioni ti arrivano comunque. Qui scegli se ricevere anche promozioni e novità.
          </p>
        </div>
        {errore && <p className="text-sm text-destructive">{errore.message}</p>}
        {consensi && TIPI_CONSENSO.map((t) => (
          <label key={t.valore} className="flex items-center gap-3 text-sm">
            <Checkbox checked={consensi[t.valore].valore} onCheckedChange={(v) => scegli(t.valore, v === true)} />
            {t.etichetta}
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

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

      <ConsensiComunicazioni />

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