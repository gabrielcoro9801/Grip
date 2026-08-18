import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import moment from "moment";
import { Building2, Award, FileText, Receipt } from "lucide-react";

const fmtDate = (val) => val ? moment(val).format("D MMM YYYY") : "—";
const fmtBool = (val) => val === true ? "Sì" : val === false ? "No" : "—";
const fmt = (val) => val || "—";

function Field({ label, value }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

export default function SnapshotView({ snapshot }) {
  if (!snapshot) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">Nessuno snapshot registrato.</p>
        <p className="text-xs mt-1">Usa "Registra un aggiornamento" per creare il primo profilo fiscale.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
          In vigore dal {fmtDate(snapshot.data_decorrenza)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Registrato il {snapshot.data_inserimento ? moment(snapshot.data_inserimento).format("D MMM YYYY, HH:mm") : "—"}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm bg-muted/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" /> Inquadramento giuridico</CardTitle></CardHeader>
          <CardContent>
            <Field label="Forma giuridica" value={fmt(snapshot.forma_giuridica)} />
            <Field label="Data costituzione" value={fmtDate(snapshot.data_costituzione)} />
            <Field label="Chiusura esercizio sociale" value={fmtDate(snapshot.data_chiusura_esercizio)} />
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-muted/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Award className="w-4 h-4" /> Affiliazioni e registri</CardTitle></CardHeader>
          <CardContent>
            <Field label="Ente di affiliazione" value={fmt(snapshot.ente_affiliazione)} />
            <Field label="Numero affiliazione" value={fmt(snapshot.numero_affiliazione)} />
            <Field label="Iscritta al RASD" value={fmtBool(snapshot.iscritta_rasd)} />
            {snapshot.iscritta_rasd && <Field label="Numero iscrizione RASD" value={fmt(snapshot.numero_iscrizione_rasd)} />}
            <Field label="Iscritta al RUNTS" value={fmtBool(snapshot.iscritta_runts)} />
            {snapshot.iscritta_runts && <Field label="Qualifica RUNTS" value={fmt(snapshot.qualifica_runts)} />}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-muted/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> Regime fiscale</CardTitle></CardHeader>
          <CardContent>
            <Field label="Regime applicato" value={fmt(snapshot.regime_fiscale)} />
            {snapshot.regime_fiscale === "Legge 398/1991" && (
              <>
                <Field label="Data comunicazione SIAE" value={fmtDate(snapshot.data_comunicazione_siae)} />
                <Field label="Data di opzione" value={fmtDate(snapshot.data_opzione)} />
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-muted/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Receipt className="w-4 h-4" /> Partita IVA</CardTitle></CardHeader>
          <CardContent>
            <Field label="Partita IVA posseduta" value={fmtBool(snapshot.partita_iva_posseduta)} />
            {snapshot.partita_iva_posseduta && (
              <>
                <Field label="Numero partita IVA" value={fmt(snapshot.numero_partita_iva)} />
                <Field label="Data apertura" value={fmtDate(snapshot.data_apertura_partita_iva)} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {snapshot.note && (
        <div className="p-3 rounded-lg bg-muted/50">
          <p className="text-xs text-muted-foreground mb-1">Note</p>
          <p className="text-sm whitespace-pre-wrap">{snapshot.note}</p>
        </div>
      )}
    </div>
  );
}