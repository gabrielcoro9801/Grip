import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Users, CalendarCheck, Wallet, AlertCircle, Clock } from "lucide-react";
import moment from "moment";
import { calcCompensoPT } from "@/lib/ptValidation";

const STATO_LABEL = { prenotata: "Prenotata", confermata: "Confermata", svolta: "Svolta", annullata: "Annullata" };
const STATO_VARIANT = { prenotata: "secondary", confermata: "default", svolta: "default", annullata: "destructive" };

export default function PtPortal() {
  const { staffUser } = useStaffAuth();
  const isPT = staffUser?.ruolo === "pt";
  const collaboratoreId = staffUser?.linked_collaboratore_id;
  const [loading, setLoading] = useState(true);
  const [coll, setColl] = useState(null);
  const [sedute, setSedute] = useState([]);

  useEffect(() => {
    if (isPT && collaboratoreId) {
      Promise.all([
        api.entities.Collaboratore.get(collaboratoreId).catch(() => null),
        api.entities.SedutaPT.filter({ collaboratore_id: collaboratoreId }, "-data_ora_inizio", 200),
      ]).then(([c, s]) => {
        setColl(c);
        setSedute(s);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [collaboratoreId]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  if (!isPT || !collaboratoreId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mb-3" />
        <p className="text-sm text-muted-foreground">Portale riservato ai collaboratori sportivi (PT).</p>
        <p className="text-xs text-muted-foreground mt-1">Il tuo account non è collegato a un profilo collaboratore. Contatta l'amministratore.</p>
      </div>
    );
  }

  const now = moment();
  const year = now.year();
  const month = now.month();

  const mySedute = sedute.filter((s) => s.stato !== "annullata");
  const clienti = [...new Set(mySedute.map((s) => s.cliente_nome).filter(Boolean))];
  const prossime = mySedute.filter((s) => new Date(s.data_ora_inizio) >= new Date() && s.stato !== "svolta").slice(0, 5);
  const daConfermare = mySedute.filter((s) => s.stato === "confermata" || s.stato === "prenotata");
  const svolte = mySedute.filter((s) => s.stato === "svolta");
  const compenso = calcCompensoPT(coll, svolte, year, month);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Ciao, {coll?.nome} {coll?.cognome}</h1>
        <p className="text-sm text-muted-foreground capitalize">{now.format("MMMM YYYY")}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Clienti" value={clienti.length} />
        <StatCard icon={CalendarCheck} label="Sedute prossime" value={prossime.length} />
        <StatCard icon={Clock} label="Da confermare" value={daConfermare.length} />
        <StatCard icon={Wallet} label="Compenso mese" value={"€" + compenso.importo.toFixed(2)} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/pt/sedute"><Button size="lg" className="w-full sm:w-auto"><CalendarCheck className="w-5 h-5 mr-2" /> Le mie sedute</Button></Link>
        <Link to="/pt/compensi"><Button size="lg" variant="outline" className="w-full sm:w-auto"><Wallet className="w-5 h-5 mr-2" /> I miei compensi</Button></Link>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader><CardTitle className="text-base">Prossime sedute</CardTitle></CardHeader>
        <CardContent>
          {prossime.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna seduta programmata.</p>
          ) : (
            <div className="space-y-2">
              {prossime.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm border-b border-border/50 pb-2">
                  <div>
                    <p className="font-medium">{s.cliente_nome}</p>
                    <p className="text-xs text-muted-foreground">{moment(s.data_ora_inizio).format("ddd DD MMM HH:mm")} · {s.sala_nome || "Nessuna sala"}</p>
                  </div>
                  <Badge variant={STATO_VARIANT[s.stato]}>{STATO_LABEL[s.stato]}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="w-4 h-4" />
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}