import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { generateJournalEntry } from "@/lib/journalEntryEngine";
import { generateReceiptForJournalEntry, regenerateReceiptPdf } from "@/lib/receiptEngine";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "@/components/shared/StatusBadge";
import { ArrowLeft, Upload, Plus, FileText, CreditCard, Dumbbell, Shield, Calendar, CheckCircle2, Clock, Download, RefreshCw, QrCode, KeyRound } from "lucide-react";
import { generateQRCode, getQRImageUrl } from "@/lib/qrUtils";
import { logAction } from "@/lib/auditLog";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";
import { puo } from "@/lib/permissions";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData, formatDataOra, formatEuro } from "@/lib/format";

export default function MemberDetail() {
  const { id } = useParams();
  const { organization } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [member, setMember] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [receipts, setReceipts] = useState([]);
  // abbonamento id → stato_pagamento della scrittura contabile collegata
  const [pagamentoPerAbbonamento, setPagamentoPerAbbonamento] = useState({});
  const [plans, setPlans] = useState([]);
  const [exercisePlans, setExercisePlans] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSubForm, setShowSubForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // `istituzionale` parte attivo: la quota versata da un socio è fuori campo IVA. Resta
  // disattivabile perché lo stesso piano può essere venduto come prestazione commerciale.
  const [subForm, setSubForm] = useState({ plan_id: "", start_date: new Date().toISOString().split("T")[0], data_pagamento: new Date().toISOString().split("T")[0], payment_method: "Cash", pagato_subito: true, data_scadenza: "", istituzionale: true });
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
      const [s, d, r] = await Promise.all([
        api.entities.Subscription.filter({ member_id: id }),
        api.entities.MemberDocument.filter({ member_id: id }),
        api.entities.Receipt.filter({ member_id: id }),
      ]);
      const [ep, b, qr, sa, sess, evts, crs] = await Promise.all([
        api.entities.ExercisePlan.filter({ member_id: id }),
        api.entities.Booking.filter({ member_id: id }),
        api.entities.QRAccesso.filter({ cliente_id: id }),
        api.entities.StaffAccount.filter({ linked_member_id: id, ruolo: "member" }),
        api.entities.Session.list(),
        api.entities.Event.list(),
        api.entities.Course.list(),
      ]);
      const resolvedBookings = b.map(bk => {
        const session = sess.find(s => s.id === bk.session_id);
        const event = evts.find(e => e.id === session?.event_id);
        const course = crs.find(c => c.id === event?.course_id);
        return { ...bk, _course_name: course?.name, _date: session?.date };
      });

      // Lo stato di pagamento di un abbonamento non è salvato sull'abbonamento: la verità
      // sta sulla scrittura contabile, che può essere saldata da Crediti/Debiti. Lo si
      // segue attraverso la ricevuta, che collega i due (subscription_id → journal_entry_id).
      // Così l'etichetta si aggiorna da sé, senza uno stato duplicato da tenere allineato.
      const entryIds = [...new Set(r.map(rec => rec.journal_entry_id).filter(Boolean))];
      const entries = await Promise.all(entryIds.map(eid => api.entities.JournalEntry.get(eid).catch(() => null)));
      const entryById = new Map(entries.filter(Boolean).map(e => [e.id, e]));
      const statoPerAbbonamento = {};
      for (const rec of r) {
        if (rec.subscription_id && rec.journal_entry_id) {
          statoPerAbbonamento[rec.subscription_id] = entryById.get(rec.journal_entry_id)?.stato_pagamento ?? null;
        }
      }
      setPagamentoPerAbbonamento(statoPerAbbonamento);

      setMember(m);
      setSubscriptions(s);
      setDocuments(d);
      setReceipts(r);
      setPlans(p.filter(pl => pl.is_active));
      setExercisePlans(ep);
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

  const handleNewSubscription = async (e) => {
    e.preventDefault();
    const plan = plans.find(p => p.id === subForm.plan_id);
    if (!plan) return;
    // Validazione: data_pagamento e data_scadenza non precedenti alla data inizio abbonamento
    if (subForm.pagato_subito && subForm.data_pagamento && subForm.start_date) {
      if (moment(subForm.data_pagamento).isBefore(moment(subForm.start_date), "day")) {
        setDateError("La data di pagamento non può essere precedente alla data di inizio abbonamento");
        return;
      }
    }
    if (!subForm.pagato_subito && subForm.data_scadenza && subForm.start_date) {
      if (moment(subForm.data_scadenza).isBefore(moment(subForm.start_date), "day")) {
        setDateError("La data di scadenza non può essere precedente alla data di inizio abbonamento");
        return;
      }
    }
    setDateError("");
    if (!organization) { toast({ title: "Organizzazione non pronta", variant: "destructive" }); return; }
    // La contabilità usa come controparte il Client anagrafico, non il Member: sono due
    // record distinti collegati da `cliente_id`. Senza questo collegamento la ricevuta
    // non troverebbe l'intestatario.
    if (!member?.cliente_id) {
      toast({ title: "Socio senza anagrafica cliente", description: "Impossibile registrare l'incasso: manca il cliente collegato al socio.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const startDate = subForm.start_date;
      const dataPagamento = subForm.pagato_subito ? subForm.data_pagamento : startDate;
      const endDate = moment(startDate).add(plan.duration_days, "days").format("YYYY-MM-DD");

      const sub = await api.entities.Subscription.create({
        member_id: id, plan_id: plan.id, plan_name: plan.name,
        start_date: startDate, end_date: endDate, status: "active",
        sessions_remaining: plan.sessions_included, price_paid: plan.price,
      });

      // Recupera conti e causale "Incasso abbonamento/quota"
      const [accounts, causali] = await Promise.all([
        api.entities.ChartOfAccount.filter({ organization_id: organization.id }),
        api.entities.CausaleOperativa.filter({ organization_id: organization.id, attivo: true }),
      ]);
      const causale = causali.find(c => c.nome_visibile === "Incasso abbonamento/quota");
      if (!causale) throw new Error("Causale 'Incasso abbonamento/quota' non trovata");

      // Mappa metodo pagamento → metodo liquidità
      const metodoMap = { "Cash": "cassa", "Credit Card": "cassa", "Bank Transfer": "banca", "Other": "cassa" };
      const metodo_liquidita = metodoMap[subForm.payment_method] || "cassa";

      // Un incasso istituzionale è fuori campo IVA: si usa una copia della causale con
      // l'IVA disattivata, senza modificare la causale salvata. Stessa logica del wizard
      // in Movimenti.jsx — senza di essa una quota associativa movimenterebbe il conto
      // 4.3 IVA a debito.
      const isIstituzionale = causale.puo_essere_istituzionale && subForm.istituzionale;
      const causaleEffettiva = isIstituzionale
        ? { ...causale, gestisce_iva: false, aliquota_iva_default: 0 }
        : causale;

      // Genera scrittura contabile
      const journalEntry = await generateJournalEntry({
        organization_id: organization.id,
        causale: causaleEffettiva,
        importo_lordo: plan.price,
        data: dataPagamento,
        metodo_liquidita: subForm.pagato_subito ? metodo_liquidita : undefined,
        controparte_id: member.cliente_id,
        controparte_tipo: "cliente",
        a_credito: !subForm.pagato_subito,
        data_scadenza: subForm.pagato_subito ? undefined : subForm.data_scadenza,
        accounts,
        descrizione: `Abbonamento ${plan.name} — ${member.full_name}`,
        tipo_origine: "incasso_cliente",
        natura_fiscale: isIstituzionale ? "istituzionale" : "commerciale",
        controparte_e_socio: causale.puo_essere_istituzionale ? subForm.istituzionale : undefined,
      });

      // Genera ricevuta PDF automaticamente (solo se pagato subito = saldata)
      let receipt = null;
      if (subForm.pagato_subito) {
        receipt = await generateReceiptForJournalEntry(journalEntry.id, organization, accounts, {
          subscription_id: sub.id,
          plan_name: plan.name,
          payment_method: subForm.payment_method,
        });
      } else {
        // Crea receipt placeholder "pending" per tracking credito
        receipt = await api.entities.Receipt.create({
          organization_id: organization.id,
          cliente_id: member.cliente_id, cliente_name: member.full_name,
          member_id: id, member_name: member.full_name,
          subscription_id: sub.id, plan_name: plan.name,
          journal_entry_id: journalEntry.id,
          data_emissione: dataPagamento, date: dataPagamento,
          amount: plan.price, importo_lordo: plan.price,
          payment_status: "pending", stato: "bozza",
          data_scadenza: subForm.data_scadenza,
        });
      }

      setShowSubForm(false);
      setSubForm({ plan_id: "", start_date: new Date().toISOString().split("T")[0], data_pagamento: new Date().toISOString().split("T")[0], payment_method: "Cash", pagato_subito: true, data_scadenza: "", istituzionale: true });
      loadData();
      toast({ title: subForm.pagato_subito ? "Abbonamento creato e incassato" : "Abbonamento creato (credito registrato)", description: subForm.pagato_subito ? "Ricevuta PDF generata automaticamente" : "Ricevuta emessa al saldo del credito" });
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateReceipt = async (receiptId) => {
    if (!organization) return;
    setSaving(true);
    try {
      await regenerateReceiptPdf(receiptId, organization);
      toast({ title: "Ricevuta rigenerata" });
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
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
        await logAction(staffUser, "password_reset", "staff_account", `Portale cliente — ${member?.full_name}`, portalAccount.id, "Password impostata dal CRM");
      } else {
        const created = await api.entities.StaffAccount.create({
          nome: member?.full_name || "Cliente",
          email: member?.email || "",
          ruolo: "member",
          password: passwordForm.password,
          attivo: true,
          linked_member_id: id,
        });
        await logAction(staffUser, "create", "staff_account", `Portale cliente — ${member?.full_name}`, created.id, "Account portale cliente creato dal CRM");
      }
      toast({ title: "Password impostata", description: "Il cliente può accedere al portale" });
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
      const chars = "abcdefghjkmnpqrstuvwxyz23456789";
      let pwd = "";
      for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
      if (portalAccount) {
        await api.entities.StaffAccount.update(portalAccount.id, { password: pwd });
        await logAction(staffUser, "password_reset", "staff_account", `Portale cliente — ${member?.full_name}`, portalAccount.id, "Password generata dal CRM");
      } else {
        const created = await api.entities.StaffAccount.create({
          nome: member?.full_name || "Cliente",
          email: member?.email || "",
          ruolo: "member",
          password: pwd,
          attivo: true,
          linked_member_id: id,
        });
        await logAction(staffUser, "create", "staff_account", `Portale cliente — ${member?.full_name}`, created.id, "Account portale cliente creato dal CRM");
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
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                <Shield className="w-3 h-3 mr-1" /> Consenso GDPR {member.gdpr_consent_date && `(${formatData(member.gdpr_consent_date, "media")})`}
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">Nessun consenso GDPR</Badge>
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
                      {pagamentoPerAbbonamento[sub.id] === "da_incassare" && (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 mt-1">
                          <Clock className="w-3 h-3 mr-1" /> Da incassare
                        </Badge>
                      )}
                      {pagamentoPerAbbonamento[sub.id] === "saldata" && (
                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 mt-1">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Pagato
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Il saldo si registra in un solo posto — Crediti/Debiti — per non avere due
                strade che aggiornano lo stesso stato in modi diversi. */}
            {Object.values(pagamentoPerAbbonamento).includes("da_incassare") && (
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/50">
                Gli incassi in sospeso si registrano da{" "}
                <Link to="/movimenti" className="underline underline-offset-2">Movimenti → Scadenzario</Link>.
              </p>
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
                  const daysLeft = doc.expiry_date ? moment(doc.expiry_date).diff(moment(), "days") : null;
                  return (
                    <div key={doc.id} className="p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{doc.document_type}</p>
                        <p className="text-xs text-muted-foreground">{doc.file_name || "Nessun file"}</p>
                      </div>
                      {daysLeft !== null && (
                        <Badge variant="outline" className={`text-xs ${daysLeft < 0 ? "bg-red-100 text-red-700 border-red-200" : daysLeft < 30 ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}`}>
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

        {/* Receipts */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><CreditCard className="w-4 h-4" /> Ricevute</CardTitle>
          </CardHeader>
          <CardContent>
            {receipts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nessuna ricevuta</p>
            ) : (
              <div className="space-y-2">
                {receipts.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-2 text-sm border-b border-border/30 last:border-0">
                    <div>
                      <span className="font-medium">N. {r.numero_progressivo || "—"}/{r.esercizio_fiscale || ""}</span>
                      {r.plan_name && <span className="text-xs text-muted-foreground ml-2">{r.plan_name}</span>}
                      <div className="text-xs text-muted-foreground">{formatData(r.date || r.data_emissione)}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{formatEuro(Number(r.amount || r.importo_lordo || 0))}</span>
                      {r.payment_status === "pending" || r.stato === "bozza" ? (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                          <Clock className="w-3 h-3 mr-1" /> Bozza
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Emessa
                        </Badge>
                      )}
                      {r.pdf_url && (
                        <a href={r.pdf_url} target="_blank" rel="noopener noreferrer">
                          <Button size="icon" variant="ghost" className="h-7 w-7"><Download className="w-3.5 h-3.5" /></Button>
                        </a>
                      )}
                      {puo(staffUser?.ruolo, "rigenerare_documento") && r.stato === "emessa" && r.pdf_url && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRegenerateReceipt(r.id)} disabled={saving}>
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* QR Accesso */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><QrCode className="w-4 h-4" /> QR Accesso</CardTitle>
          </CardHeader>
          <CardContent>
            {qrAccess ? (
              <div className="flex items-center gap-4">
                <img src={getQRImageUrl(qrAccess.codice, 120)} alt="QR" className="w-24 h-24 rounded-lg" />
                <div className="flex-1">
                  <p className="font-mono text-sm font-medium">{qrAccess.codice}</p>
                  <p className="text-xs text-muted-foreground">Generato il {formatData(qrAccess.data_generazione, "media")}</p>
                  <Badge variant="outline" className={`mt-1 text-xs ${qrAccess.stato === "attivo" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
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

        {/* Portale Cliente */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><KeyRound className="w-4 h-4" /> Portale Cliente</CardTitle>
          </CardHeader>
          <CardContent>
            {portalAccount ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Account</span>
                  <Badge variant="outline" className={`text-xs ${portalAccount.attivo ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
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
            {!member?.email && <p className="text-xs text-amber-600 mt-2">Il cliente non ha un'email: impossibile creare l'account portale</p>}
            {generatedPassword && (
              <div className="mt-3 p-3 rounded-lg bg-muted">
                <p className="text-xs text-muted-foreground mb-1">Password generata:</p>
                <p className="font-mono text-sm font-medium break-all">{generatedPassword}</p>
                <p className="text-xs text-amber-600 mt-1">Comunica questa password al cliente</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Exercise Plans */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><Dumbbell className="w-4 h-4" /> Piani di allenamento</CardTitle>
          </CardHeader>
          <CardContent>
            {exercisePlans.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nessun piano assegnato</p>
            ) : (
              <div className="space-y-3">
                {exercisePlans.map(ep => (
                  <div key={ep.id} className="p-3 rounded-lg bg-muted/50">
                    <p className="text-sm font-medium">{ep.name}</p>
                    <p className="text-xs text-muted-foreground">{ep.exercises?.length || 0} esercizi · Assegnato il {formatData(ep.assigned_date, "media")}</p>
                    {ep.notes && <p className="text-xs text-muted-foreground mt-1 italic">{ep.notes}</p>}
                  </div>
                ))}
              </div>
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
            {dateError && <p className="text-xs text-red-600 font-medium -mt-1">{dateError}</p>}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label className="cursor-pointer">Pagato subito</Label>
                <p className="text-xs text-muted-foreground">{subForm.pagato_subito ? "Registra incasso in cassa/banca" : "Registra come credito da incassare"}</p>
              </div>
              <Select value={subForm.pagato_subito ? "true" : "false"} onValueChange={v => setSubForm({...subForm, pagato_subito: v === "true"})}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sì, pagato</SelectItem>
                  <SelectItem value="false">A credito</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label className="cursor-pointer">Quota istituzionale</Label>
                <p className="text-xs text-muted-foreground">
                  {subForm.istituzionale
                    ? "Fuori campo IVA (quota associativa del socio)"
                    : "Incasso commerciale, soggetto a IVA"}
                </p>
              </div>
              <Select value={subForm.istituzionale ? "true" : "false"} onValueChange={v => setSubForm({...subForm, istituzionale: v === "true"})}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Istituzionale</SelectItem>
                  <SelectItem value="false">Commerciale</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {subForm.pagato_subito && (
              <>
                <div>
                  <Label>Data pagamento</Label>
                  <Input type="date" value={subForm.data_pagamento} min={subForm.start_date} onChange={e => { setSubForm({...subForm, data_pagamento: e.target.value}); setDateError(""); }} />
                  {dateError && <p className="text-xs text-red-600 mt-1">{dateError}</p>}
                </div>
                <div>
                  <Label>Metodo di pagamento</Label>
                  <Select value={subForm.payment_method} onValueChange={v => setSubForm({...subForm, payment_method: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[["Cash", "Contanti"], ["Credit Card", "Carta di credito"], ["Bank Transfer", "Bonifico"], ["Other", "Altro"]].map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {!subForm.pagato_subito && (
              <div>
                <Label>Data scadenza pagamento</Label>
                <Input type="date" value={subForm.data_scadenza} min={subForm.start_date} onChange={e => { setSubForm({...subForm, data_scadenza: e.target.value}); setDateError(""); }} />
              </div>
            )}
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