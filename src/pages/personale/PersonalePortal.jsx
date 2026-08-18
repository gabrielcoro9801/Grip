import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Clock, CalendarDays, CalendarOff, Hourglass, Users, TrendingUp, AlertCircle } from "lucide-react";
import moment from "moment";
import { calcOreMese, calcFerieResidue } from "@/lib/presenzeUtils";

export default function PersonalePortal() {
  const { staffUser } = useStaffAuth();
  const isAdmin = staffUser?.ruolo === "admin";
  const empId = staffUser?.linked_collaboratore_id;
  const { organization } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState(null);
  const [timbrature, setTimbrature] = useState([]);
  const [turni, setTurni] = useState([]);
  const [ferie, setFerie] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [pendingFerie, setPendingFerie] = useState([]);

  useEffect(() => {
    const now = moment();
    const year = now.year();
    const month = now.month();

    if (isAdmin) {
      if (!organization?.id) return;
      Promise.all([
        base44.entities.Collaboratore.filter({ organization_id: organization.id, tipo_rapporto: "dipendente" }),
        base44.entities.Timbratura.list("-data_ora_server", 200),
        base44.entities.RichiestaFeriePermesso.filter({ stato: "in_attesa" }),
      ]).then(([emps, tims, pf]) => {
        setEmployees(emps);
        setTimbrature(tims);
        setPendingFerie(pf);
        setLoading(false);
      });
    } else if (empId) {
      Promise.all([
        base44.entities.Collaboratore.get(empId).catch(() => null),
        base44.entities.Timbratura.filter({ dipendente_id: empId }, "-data_ora_server", 200),
        base44.entities.Turno.filter({ dipendente_id: empId }, "data", 50),
        base44.entities.RichiestaFeriePermesso.filter({ dipendente_id: empId }),
      ]).then(([emp, tims, tur, fer]) => {
        setEmployee(emp);
        setTimbrature(tims);
        setTurni(tur);
        setFerie(fer);
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [organization]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  if (!isAdmin && !empId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mb-3" />
        <p className="text-sm text-muted-foreground">Il tuo account non è collegato a un profilo dipendente.</p>
        <p className="text-xs text-muted-foreground mt-1">Contatta l'amministratore per abilitare il portale.</p>
      </div>
    );
  }

  const now = moment();
  const year = now.year();
  const month = now.month();
  const monthLabel = now.format("MMMM YYYY");

  if (isAdmin) {
    const todayStr = now.format("YYYY-MM-DD");
    const timbratureOggi = timbrature.filter((t) => moment(t.data_ora_server).format("YYYY-MM-DD") === todayStr);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold">Dashboard Personale</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Users} label="Dipendenti" value={employees.length} />
          <StatCard icon={Clock} label="Timbrature oggi" value={timbratureOggi.length} />
          <StatCard icon={CalendarOff} label="Ferie in attesa" value={pendingFerie.length} />
          <StatCard icon={TrendingUp} label="Ore totali mese" value={calcOreMese(timbrature, year, month).toFixed(0) + "h"} />
        </div>

        {pendingFerie.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Richieste ferie in attesa</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pendingFerie.map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{r.dipendente_nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.tipo === "ferie" ? "Ferie" : "Permesso"} · {moment(r.data_inizio).format("DD/MM")}
                        {r.data_fine && r.data_fine !== r.data_inizio ? ` → ${moment(r.data_fine).format("DD/MM")}` : ""}
                      </p>
                    </div>
                    <Link to="/personale/ferie"><Button size="sm" variant="outline">Gestisci</Button></Link>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Dipendente view
  const oreMese = calcOreMese(timbrature, year, month);
  const ferieResidue = calcFerieResidue(ferie, employee?.giorni_ferie_anno, year);
  const todayStr = now.format("YYYY-MM-DD");
  const prossimiTurni = turni.filter((t) => t.data >= todayStr && t.stato !== "annullato").slice(0, 5);
  const ultimeTimbrature = timbrature.slice(0, 5);
  const lastTimbratura = timbrature[0];
  const isClockedIn = lastTimbratura?.tipo === "entrata";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Ciao, {employee ? `${employee.nome} ${employee.cognome}` : staffUser.nome}</h1>
        <p className="text-sm text-muted-foreground capitalize">{monthLabel}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="Ore mese" value={oreMese.toFixed(1) + "h"} />
        <StatCard icon={Hourglass} label="Ferie residue" value={ferieResidue + " gg"} />
        <StatCard icon={CalendarDays} label="Turni prossimi" value={prossimiTurni.length} />
        <StatCard icon={Clock} label="Stato" value={isClockedIn ? "In servizio" : "Fuori"} highlight={isClockedIn} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/personale/timbratura"><Button size="lg" className="w-full sm:w-auto"><Clock className="w-5 h-5 mr-2" /> Timbra</Button></Link>
        <Link to="/personale/ferie"><Button size="lg" variant="outline" className="w-full sm:w-auto"><CalendarOff className="w-5 h-5 mr-2" /> Richiedi ferie</Button></Link>
        <Link to="/personale/turni"><Button size="lg" variant="outline" className="w-full sm:w-auto"><CalendarDays className="w-5 h-5 mr-2" /> I miei turni</Button></Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Prossimi turni</CardTitle></CardHeader>
          <CardContent>
            {prossimiTurni.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun turno programmato.</p>
            ) : (
              <div className="space-y-2">
                {prossimiTurni.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium capitalize">{moment(t.data).format("ddd DD MMM")}</span>
                    <span className="text-muted-foreground">{t.ora_inizio}–{t.ora_fine} {t.sala_nome ? `· ${t.sala_nome}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Ultime timbrature</CardTitle></CardHeader>
          <CardContent>
            {ultimeTimbrature.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna timbratura.</p>
            ) : (
              <div className="space-y-2">
                {ultimeTimbrature.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{t.tipo === "entrata" ? "Entrata" : "Uscita"}</span>
                    <span className="text-muted-foreground">{moment(t.data_ora_server).format("DD/MM HH:mm")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, highlight }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="w-4 h-4" />
          <span className="text-xs">{label}</span>
        </div>
        <p className={`text-xl font-bold ${highlight ? "text-emerald-600" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}