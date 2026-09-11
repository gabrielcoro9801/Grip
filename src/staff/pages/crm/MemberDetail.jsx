import React, { useState, useEffect } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import StatusBadge from "@/ui/StatusBadge";
import { ArrowLeft, Plus, FileText, CreditCard, Dumbbell, Shield, Calendar, QrCode, KeyRound, RefreshCw, History } from "lucide-react";
import { generateQRCode, generaPasswordTemporanea } from "@/staff/lib/qrUtils";
import { qrDataUrl } from "@/ui/qr/qrImmagine";
import { useQrDinamico } from "@/ui/hooks/useQrDinamico";
import { logAction } from "@/staff/lib/auditLog";
import { useToast } from "@/ui/primitivi/use-toast";
import { LoadingState } from "@/ui/Spinner";
import { formatData, formatDataOra, formatEuro, toIsoDate, aggiungiGiorni, giorniAllaData } from "@/core/domain/format";
import { totaleSerieScheda, totaleEsercizi, formatDurata, durataSessione } from "@/core/domain/scheda";

export default function MemberDetail() {
  const { id } = useParams();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [member, setMember] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [plans, setPlans] = useState([]);
  const [exercisePlans, setExercisePlans] = useState([]);
  const [allenamenti, setAllenamenti] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSubForm, setShowSubForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subForm, setSubForm] = useState({ plan_id: "", start_date: new Date().toISOString().split("T")[0] });
  const [dateError, setDateError] = useState("");
  const [docForm, setDocForm] = useState({ document_type: "Certificato Medico", file_name: "", expiry_date: "", notes: "", caricato_da: "" });
  const [qrAccess, setQrAccess] = useState(null);
  const [portalAccount, setPortalAccount] = useState(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [generatedPassword, setGeneratedPassword] = useState("");

  const [loadError, setLoadError] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // Split into smaller batches to avoid rate limits
      const [m, p] = await Promise.all([
        api.entities.Member.get(id),
        api.entities.Plan.list(),
      ]);
      const [s, d] = await Promise.all([
        api.entities.Subscription.filter({ member_id: id }),
        api.entities.MemberDocument.filter({ member_id: id }),
      ]);
      const [ep, b, qr, sa, sess, evts, crs, allen] = await Promise.all([
        api.entities.ExercisePlan.filter({ member_id: id }),
        api.entities.Booking.filter({ member_id: id }),
        api.entities.QRAccesso.filter({ cliente_id: id }),
        api.entities.StaffAccount.filter({ linked_member_id: id, ruolo: "member" }),
        api.entities.Session.list(),
        api.entities.Event.list(),
        api.entities.Course.list(),
        api.entities.WorkoutSession.filter({ member_id: id }, "-iniziata_alle", 10),
      ]);
      const resolvedBookings = b.map(bk => {
        const session = sess.find(s => s.id === bk.session_id);
        const event = evts.find(e => e.id === session?.event_id);
        const course = crs.find(c => c.id === event?.course_id);
        return { ...bk, _course_name: course?.name, _date: session?.date };
      });

      setMember(m);
      setSubscriptions(s);
      setDocuments(d);
      setPlans(p.filter(pl => pl.is_active));
      setExercisePlans(ep);
      setAllenamenti(allen);
      setBookings(resolvedBookings);
      setQrAccess(qr[0] || null);
      setPortalAccount(sa[0] || null);
      setLoading(false);
    } catch (err) {
      setLoadError(true);
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [id]);

  // Lo stesso codice che il socio vede sul telefono, negli stessi secondi: lo firma il
  // server e lo consegna a entrambi, quindi alla reception basta confrontarli a vista.
  const { codice: codiceDinamico, secondiResidui } = useQrDinamico(id, qrAccess?.stato === "attivo");
  const [immagineQr, setImmagineQr] = useState(null);

  useEffect(() => {
    let vivo = true;
    if (!codiceDinamico) { setImmagineQr(null); return undefined; }
    qrDataUrl(codiceDinamico, 120).then((url) => { if (vivo) setImmagineQr(url); }).catch(() => {});
    return () => { vivo = false; };
  }, [codiceDinamico]);

  const handleNewSubscription = async (e) => {
    e.preventDefault();
    const plan = plans.find(p => p.id === subForm.plan_id);
    if (!plan) return;
    setDateError("");
    setSaving(true);
    try {
      const startDate = subForm.start_date;
      const endDate = toIsoDate(aggiungiGiorni(startDate, plan.duration_days));

      await api.entities.Subscription.create({
        member_id: id, plan_id: plan.id, plan_name: plan.name,
        start_date: startDate, end_date: endDate, status: "active",
        sessions_remaining: plan.sessions_included, price_paid: plan.price,
      });

      setShowSubForm(false);
      setSubForm({ plan_id: "", start_date: new Date().toISOString().split("T")[0] });
      loadData();
      toast({ title: "Abbonamento creato" });
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleNewDoc = async (e) => {
    e.preventDefault();
    await api.entities.MemberDocument.create({ member_id: id, ...docForm, caricato_da: docForm.caricato_da || staffUser?.nome || "" });
    setShowDocForm(false);
    setDocForm({ document_type: "Certificato Medico", file_name: "", expiry_date: "", notes: "", caricato_da: "" });
    loadData();
  };

  const handleRevokeQR = async () => {
    if (!qrAccess) return;
    await api.entities.QRAccesso.update(qrAccess.id, { stato: "revocato" });
    await logAction(staffUser, "deactivate", "member", `QR revocato — ${member?.full_name}`, qrAccess.id, "QR accesso revocato");
    toast({ title: "QR revocato" });
    loadData();
  };

  const handleRegenerateQR = async () => {
    const newCode = generateQRCode();
    if (qrAccess) {
      await api.entities.QRAccesso.update(qrAccess.id, { codice: newCode, stato: "attivo", data_generazione: new Date().toISOString() });
      await logAction(staffUser, "update", "member", `QR rigenerato — ${member?.full_name}`, qrAccess.id, "QR accesso rigenerato", qrAccess.codice, newCode);
    } else {
      const created = await api.entities.QRAccesso.create({
        cliente_id: id,
        cliente_name: member?.full_name || "",
        codice: newCode,
        data_generazione: new Date().toISOString(),
        stato: "attivo",
      });
      await logAction(staffUser, "create", "member", `QR generato — ${member?.full_name}`, created.id, "QR accesso generato");
    }
    toast({ title: "QR rigenerato" });
    loadData();
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    if (passwordForm.password !== passwordForm.confirm) {
      toast({ title: "Le password non coincidono", variant: "destructive" });
      return;
    }
    if (passwordForm.password.length < 6) {
      toast({ title: "Password troppo corta (min 6 caratteri)", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (portalAccount) {
        await api.entities.StaffAccount.update(portalAccount.id, { password: passwordForm.password });
        await logAction(staffUser, "password_reset", "staff_account", `Portale socio — ${member?.full_name}`, portalAccount.id, "Password impostata dal CRM");
      } else {
        const created = await api.entities.StaffAccount.create({
          nome: member?.full_name || "Socio",
          email: member?.email || "",
          ruolo: "member",
          password: passwordForm.password,
          attivo: true,
          linked_member_id: id,
        });
        await logAction(staffUser, "create", "staff_account", `Portale socio — ${member?.full_name}`, created.id, "Account portale socio creato dal CRM");
      }
      toast({ title: "Password impostata", description: "Il socio può accedere al portale" });
      setShowPasswordDialog(false);
      setPasswordForm({ password: "", confirm: "" });
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleGeneratePassword = async () => {
    setSaving(true);
    try {
      const pwd = generaPasswordTemporanea();
      if (portalAccount) {
        await api.entities.StaffAccount.update(portalAccount.id, { password: pwd });
        await logAction(staffUser, "password_reset", "staff_account", `Portale socio — ${member?.full_name}`, portalAccount.id, "Password generata dal CRM");
      } else {
        const created = await api.entities.StaffAccount.create({
          nome: member?.full_name || "Socio",
          email: member?.email || "",
          ruolo: "member",
          password: pwd,
          attivo: true,
          linked_member_id: id,
        });
        await logAction(staffUser, "create", "staff_account", `Portale socio — ${member?.full_name}`, created.id, "Account portale socio creato dal CRM");
      }
      setGeneratedPassword(pwd);
      toast({ title: "Password generata" });
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-muted-foreground">Errore nel caricamento dei dati (troppe richieste).</p>
        <Button variant="outline" size="sm" onClick={loadData}>Riprova</Button>
      </div>
    );
  }

  if (loading) {
    return <LoadingState minHeight="h-64" />;
  }

  if (!member) return <div className="p-8 text-center text-muted-foreground">Socio non trovato</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <Link to="/crm" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Torna ai soci
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-bold text-primary">{member.full_name.split(" ").map(n => n[0]).join("")}</span>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-heading font-bold">{member.full_name}</h1>
          {member.codice_socio && (
            <span className="inline-block mt-1 text-xs font-mono font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
              Codice socio: {member.codice_socio}
            </span>
          )}
          <div className="flex flex-wrap gap-3 mt-1 text-sm text-muted-foreground">
            {member.email && <span>{member.email}</span>}
            {member.phone && <span>{member.phone}</span>}
          </div>
          <div className="flex items-center gap-2 mt-2">
            {member.gdpr_consent ? (
              <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-xs">
                <Shield className="w-3 h-3 mr-1" /> Consenso GDPR {member.gdpr_consent_date && `(${formatData(member.gdpr_consent_date, "media")})`}
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-xs">Nessun consenso GDPR</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Subscriptions */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><CreditCard className="w-4 h-4" /> Abbonamenti</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowSubForm(true)}><Plus className="w-3 h-3 mr-1" /> Nuovo</Button>
          </CardHeader>
          <CardContent>
            {subscriptions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nessun abbonamento</p>
            ) : (
              <div className="space-y-3">
                {subscriptions.map(sub => (
                  <div key={sub.id} className="p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{sub.plan_name}</p>
                      <p className="text-xs text-muted-foreground">{formatData(sub.start_date, "giornoBreve")} — {formatData(sub.end_date, "media")}</p>
                      {sub.sessions_remaining < 999 && <p className="text-xs text-muted-foreground">{sub.sessions_remaining} sessioni residue</p>}
                    </div>
                    <div className="text-right">
                      <StatusBadge status={sub.status} />
                      <p className="text-xs text-muted-foreground mt-1">{formatEuro(sub.price_paid)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><FileText className="w-4 h-4" /> Documenti</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowDocForm(true)}><Plus className="w-3 h-3 mr-1" /> Carica</Button>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nessun documento</p>
            ) : (
              <div className="space-y-3">
                {documents.map(doc => {
                  const daysLeft = giorniAllaData(doc.expiry_date);
                  return (
                    <div key={doc.id} className="p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{doc.document_type}</p>
                        <p className="text-xs text-muted-foreground">{doc.file_name || "Nessun file"}</p>
                      </div>
                      {daysLeft !== null && (
                        <Badge variant="outline" className={`text-xs ${daysLeft < 0 ? "bg-destructive/10 text-destructive border-destructive/30" : daysLeft < 30 ? "bg-warning/10 text-warning border-warning/30" : "bg-success/10 text-success border-success/30"}`}>
                          {daysLeft < 0 ? "Scaduto" : `${daysLeft}g residui`}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* QR Accesso */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><QrCode className="w-4 h-4" /> QR accesso</CardTitle>
          </CardHeader>
          <CardContent>
            {qrAccess ? (
              <div className="flex items-center gap-4">
                {immagineQr ? (
                  <img src={immagineQr} alt="QR accesso" className="w-24 h-24 rounded-lg" />
                ) : (
                  <div className="w-24 h-24 rounded-lg bg-muted/40" />
                )}
                <div className="flex-1 min-w-0">
                  {/* Il codice del minuto è quello da confrontare con il telefono del socio;
                      la credenziale sotto è ciò che si revoca, e non cambia mai da sé. */}
                  <p className="font-mono text-sm font-medium break-all">{codiceDinamico || "—"}</p>
                  {qrAccess.stato === "attivo" && (
                    <p className="text-xs text-muted-foreground">Cambia tra {secondiResidui}s</p>
                  )}
                  <p className="text-[11px] text-muted-foreground font-mono break-all mt-1">
                    Credenziale: {qrAccess.codice}
                  </p>
                  <p className="text-xs text-muted-foreground">Generata il {formatData(qrAccess.data_generazione, "media")}</p>
                  <Badge variant="outline" className={`mt-1 text-xs ${qrAccess.stato === "attivo" ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
                    {qrAccess.stato === "attivo" ? "Attivo" : "Revocato"}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2 text-center">Nessun QR generato</p>
            )}
            <div className="flex gap-2 mt-3">
              {qrAccess?.stato === "attivo" && (
                <Button size="sm" variant="outline" onClick={handleRevokeQR} disabled={saving}>
                  Revoca
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleRegenerateQR} disabled={saving}>
                <RefreshCw className="w-3 h-3 mr-1" /> {qrAccess ? "Rigenera" : "Genera"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Portale socio */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><KeyRound className="w-4 h-4" /> Portale socio</CardTitle>
          </CardHeader>
          <CardContent>
            {portalAccount ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Account</span>
                  <Badge variant="outline" className={`text-xs ${portalAccount.attivo ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
                    {portalAccount.attivo ? "Attivo" : "Disattivato"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Email: {portalAccount.email || "—"}</p>
                <p className="text-xs text-muted-foreground">Ultimo accesso: {portalAccount.last_activity_date ? formatDataOra(portalAccount.last_activity_date) : "Mai"}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2 text-center">Nessun account portale</p>
            )}
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" onClick={() => { setShowPasswordDialog(true); setGeneratedPassword(""); }} disabled={saving || !member?.email}>
                Imposta password
              </Button>
              <Button size="sm" variant="outline" onClick={handleGeneratePassword} disabled={saving || !member?.email}>
                Genera password
              </Button>
            </div>
            {!member?.email && <p className="text-xs text-warning mt-2">Il socio non ha un'email: impossibile creare l'account portale</p>}
            {generatedPassword && (
              <div className="mt-3 p-3 rounded-lg bg-muted">
                <p className="text-xs text-muted-foreground mb-1">Password generata:</p>
                <p className="font-mono text-sm font-medium break-all">{generatedPassword}</p>
                <p className="text-xs text-warning mt-1">Comunica questa password al socio</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Schede di allenamento */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><Dumbbell className="w-4 h-4" /> Schede di allenamento</CardTitle>
            {/* Si compone nell'editor, non qui: una scheda è righe di serie, e questa è
                la vista d'insieme di un socio. Il socio arriva già scelto. */}
            <Button variant="ghost" size="sm" className="text-xs" asChild>
              <Link to={`/allenamento/schede/nuova?tipo=assegnata&member_id=${id}`}>
                <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Nuova
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {exercisePlans.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nessuna scheda assegnata</p>
            ) : (
              <div className="space-y-3">
                {exercisePlans.map(ep => {
                  const serie = totaleSerieScheda(ep.routines);
                  return (
                    <Link
                      key={ep.id}
                      to={`/allenamento/schede/${ep.id}`}
                      className="block p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <p className="text-sm font-medium">{ep.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ep.routines?.length || 0} routine · {totaleEsercizi(ep.routines)} esercizi · {serie} serie ·
                        {" "}Assegnata il {formatData(ep.assigned_date, "media")}
                      </p>
                      {ep.notes && <p className="text-xs text-muted-foreground mt-1 italic">{ep.notes}</p>}
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ultimi allenamenti: la scheda dice cosa è stato prescritto, questa dice se
            viene seguita. Senza, l'unico modo di saperlo era chiederlo al socio. */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-heading flex items-center gap-2">
              <History className="w-4 h-4" aria-hidden="true" /> Ultimi allenamenti
            </CardTitle>
            {allenamenti.length > 0 && (
              <Button variant="ghost" size="sm" className="text-xs" asChild>
                <Link to="/allenamento/svolti">Vedi tutti</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {allenamenti.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Non ha ancora registrato nessun allenamento
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {allenamenti.slice(0, 5).map(sessione => (
                  <li key={sessione.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{sessione.routine_name}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {sessione.plan_name} · {formatDataOra(sessione.iniziata_alle)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {sessione.terminata_alle ? formatDurata(durataSessione(sessione)) : "in corso"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Bookings */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><Calendar className="w-4 h-4" /> Prenotazioni</CardTitle>
          </CardHeader>
          <CardContent>
            {bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nessuna prenotazione</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {bookings.map(b => (
                  <div key={b.id} className="p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{b._course_name || "Corso"}</p>
                      <p className="text-xs text-muted-foreground">{b._date ? formatData(b._date, "giorno") : "—"}</p>
                    </div>
                    <StatusBadge status={b.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* New Subscription Dialog */}
      <Dialog open={showSubForm} onOpenChange={setShowSubForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nuovo abbonamento</DialogTitle></DialogHeader>
          <form onSubmit={handleNewSubscription} className="space-y-3">
            <div>
              <Label>Abbonamento *</Label>
              <Select value={subForm.plan_id} onValueChange={v => setSubForm({...subForm, plan_id: v})}>
                <SelectTrigger><SelectValue placeholder="Seleziona un abbonamento" /></SelectTrigger>
                <SelectContent>
                  {plans.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — {formatEuro(p.price)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Data inizio abbonamento</Label><Input type="date" value={subForm.start_date} onChange={e => setSubForm({...subForm, start_date: e.target.value})} /></div>
            {dateError && <p className="text-xs text-destructive font-medium -mt-1">{dateError}</p>}
            <Button type="submit" className="w-full" disabled={!subForm.plan_id || saving}>
              {saving ? "Registrazione..." : "Crea abbonamento"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Document Dialog */}
      <Dialog open={showDocForm} onOpenChange={setShowDocForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Aggiungi documento</DialogTitle></DialogHeader>
          <form onSubmit={handleNewDoc} className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={docForm.document_type} onValueChange={v => setDocForm({...docForm, document_type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Certificato Medico", "Contratto", "Modulo Privacy", "Documento Identità", "Altro"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Nome file</Label><Input value={docForm.file_name} onChange={e => setDocForm({...docForm, file_name: e.target.value})} placeholder="es. certificato.pdf" /></div>
            <div><Label>Data scadenza</Label><Input type="date" value={docForm.expiry_date} onChange={e => setDocForm({...docForm, expiry_date: e.target.value})} /></div>
            <div><Label>Note</Label><Input value={docForm.notes} onChange={e => setDocForm({...docForm, notes: e.target.value})} /></div>
            <div><Label>Caricato da</Label><Input value={docForm.caricato_da} onChange={e => setDocForm({...docForm, caricato_da: e.target.value})} placeholder="Nome operatore" /></div>
            <Button type="submit" className="w-full">Aggiungi documento</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={(v) => { setShowPasswordDialog(v); if (!v) { setPasswordForm({ password: "", confirm: "" }); setGeneratedPassword(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Imposta password portale</DialogTitle></DialogHeader>
          <form onSubmit={handleSetPassword} className="space-y-3">
            <p className="text-xs text-muted-foreground">Account: {member?.email}</p>
            <div><Label>Nuova password *</Label><Input type="text" required value={passwordForm.password} onChange={e => setPasswordForm({...passwordForm, password: e.target.value})} placeholder="Min 6 caratteri" /></div>
            <div><Label>Conferma password *</Label><Input type="text" required value={passwordForm.confirm} onChange={e => setPasswordForm({...passwordForm, confirm: e.target.value})} /></div>
            <Button type="submit" className="w-full" disabled={saving}>{saving ? "Salvataggio..." : "Imposta password"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}