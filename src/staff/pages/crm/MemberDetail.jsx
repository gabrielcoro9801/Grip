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
import { ArrowLeft, Plus, CreditCard, QrCode, KeyRound, RefreshCw, Pencil, UserRound } from "lucide-react";
import CampiAnagrafica, { anagraficaDi, motivoAnagraficaIncompleta } from "@/staff/components/soci/CampiAnagrafica";
import DocumentiSocio from "@/staff/components/soci/DocumentiSocio";
import { AvatarSocio, SceltaFoto } from "@/staff/components/soci/FotoSocio";
import { caricaFile } from "@/staff/lib/uploads";
import { canEdit } from "@/staff/lib/permissions";
import { etichettaSesso } from "@/core/domain/anagrafica";
import { generateQRCode, generaPasswordTemporanea } from "@/staff/lib/qrUtils";
import { qrDataUrl } from "@/ui/qr/qrImmagine";
import { useQrDinamico } from "@/ui/hooks/useQrDinamico";
import { logAction } from "@/staff/lib/auditLog";
import { useToast } from "@/ui/primitivi/use-toast";
import { LoadingState } from "@/ui/Spinner";
import { formatData, formatDataOra, formatEuro } from "@/core/domain/format";
import { dataFineAbbonamento, descriviDurata, motivoNonVendibile, oggiIso } from "@/core/domain/abbonamenti";

/** Gli anni compiuti a oggi, o null senza data di nascita. */
function eta(dataNascita) {
  if (!dataNascita) return null;
  const nascita = new Date(dataNascita);
  if (Number.isNaN(nascita.getTime())) return null;
  const oggi = new Date();
  let anni = oggi.getFullYear() - nascita.getFullYear();
  if (oggi.getMonth() < nascita.getMonth() || (oggi.getMonth() === nascita.getMonth() && oggi.getDate() < nascita.getDate())) anni -= 1;
  return anni;
}

/** Un dato della tile anagrafica: un trattino quando manca, così ogni scheda ha le stesse righe. */
function DatoAnagrafico({ etichetta, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{etichetta}</dt>
      <dd className="text-sm font-medium break-words">
        {children || <span className="text-muted-foreground font-normal">—</span>}
      </dd>
    </div>
  );
}

export default function MemberDetail() {
  const { id } = useParams();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [member, setMember] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSubForm, setShowSubForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subForm, setSubForm] = useState({ plan_id: "", start_date: oggiIso() });
  const [dateError, setDateError] = useState("");
  // L'anagrafica in modifica, o null quando la finestra è chiusa.
  const [anagrafica, setAnagrafica] = useState(null);
  const [foto, setFoto] = useState({ file: null, rimossa: false });
  const puoModificare = canEdit(staffUser?.ruolo, "crm_members");
  // I documenti stanno sotto il loro modulo, non sotto le anagrafiche: è quello che il server
  // controlla (auth/authorize.js). Nei ruoli di base i due permessi coincidono, ma un ruolo
  // costruito a mano può avere l'uno e non l'altro — e allora carica ed elimina sarebbero
  // pulsanti che chiamano l'API solo per prendersi un 403.
  const puoModificareDocumenti = canEdit(staffUser?.ruolo, "crm_documents");
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
      // Schede, allenamenti e prenotazioni non stanno più nella scheda: se ne occupano le
      // sezioni Allenamento e Gestione corsi. Con loro se ne vanno le letture di tutte le
      // lezioni, gli eventi e i corsi dell'ente, che servivano solo a dare un nome a una
      // prenotazione.
      const [m, p, s, d, qr, sa] = await Promise.all([
        api.entities.Member.get(id),
        api.entities.Plan.list(),
        api.entities.Subscription.filter({ member_id: id }),
        api.entities.MemberDocument.filter({ member_id: id }),
        api.entities.QRAccesso.filter({ cliente_id: id }),
        api.entities.StaffAccount.filter({ linked_member_id: id, ruolo: "member" }),
      ]);

      setMember(m);
      setSubscriptions(s);
      setDocuments(d);
      // Si propongono solo i tipi che si possono vendere oggi; il server lo ricontrolla.
      setPlans(p.filter(pl => !motivoNonVendibile(pl)));
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

  const pianoScelto = plans.find(p => p.id === subForm.plan_id);
  const scadenzaProposta = pianoScelto ? dataFineAbbonamento(subForm.start_date, pianoScelto.durata_valore, pianoScelto.durata_unita) : null;

  const handleNewSubscription = async (e) => {
    e.preventDefault();
    const plan = plans.find(p => p.id === subForm.plan_id);
    if (!plan) return;
    setDateError("");
    setSaving(true);
    try {
      // Scadenza e nome del tipo li fissa il server dalla durata del tipo: qui si mostrano soltanto.
      await api.entities.Subscription.create({
        member_id: id, plan_id: plan.id, start_date: subForm.start_date, status: "active", price_paid: plan.price,
      });

      setShowSubForm(false);
      setSubForm({ plan_id: "", start_date: oggiIso() });
      loadData();
      toast({ title: "Abbonamento creato" });
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const salvaAnagrafica = async (e) => {
    e.preventDefault();
    const dati = { ...anagrafica };
    setSaving(true);
    try {
      if (foto.file) dati.foto_url = (await caricaFile({ file: foto.file })).file_url;
      else if (foto.rimossa) dati.foto_url = null;
      await api.entities.Member.update(id, dati);
      await logAction(staffUser, "update", "member", `${dati.nome} ${dati.cognome}`.trim(), id, "Anagrafica modificata");
      toast({ title: "Anagrafica aggiornata" });
      chiudiAnagrafica();
      loadData();
    } catch (err) {
      toast({ title: "Anagrafica non salvata", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const apriAnagrafica = () => {
    setFoto({ file: null, rimossa: false });
    setAnagrafica(anagraficaDi(member));
  };
  const chiudiAnagrafica = () => {
    setAnagrafica(null);
    setFoto({ file: null, rimossa: false });
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
        await logAction(staffUser, "password_reset", "staff_account", `Portale socio — ${member?.full_name}`, portalAccount.id, "Password impostata da Gestione membri");
      } else {
        const created = await api.entities.StaffAccount.create({
          nome: member?.full_name || "Socio",
          email: member?.email || "",
          ruolo: "member",
          password: passwordForm.password,
          attivo: true,
          linked_member_id: id,
        });
        await logAction(staffUser, "create", "staff_account", `Portale socio — ${member?.full_name}`, created.id, "Account portale socio creato da Gestione membri");
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
        await logAction(staffUser, "password_reset", "staff_account", `Portale socio — ${member?.full_name}`, portalAccount.id, "Password generata da Gestione membri");
      } else {
        const created = await api.entities.StaffAccount.create({
          nome: member?.full_name || "Socio",
          email: member?.email || "",
          ruolo: "member",
          password: pwd,
          attivo: true,
          linked_member_id: id,
        });
        await logAction(staffUser, "create", "staff_account", `Portale socio — ${member?.full_name}`, created.id, "Account portale socio creato da Gestione membri");
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
        <ArrowLeft className="w-4 h-4" /> Torna a Gestione membri
      </Link>

      {/* Intestazione: chi è, e basta. I dati stanno tutti nella tile dell'anagrafica qui
          sotto; ripeterli qui voleva dire leggerli due volte. */}
      <div>
        <h1 className="text-xl font-heading font-bold">{member.full_name}</h1>
        <span className="inline-block mt-1 text-xs font-mono font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
          Codice socio: {member.codice_socio}
        </span>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Anagrafica: la tile principale, a tutta larghezza. Stesso ordine del modulo, così
            chi corregge un dato lo ritrova dove l'ha visto. */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><UserRound className="w-4 h-4" /> Anagrafica</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-6">
              <AvatarSocio socio={member} size="lg" className="self-center sm:self-start" />
              <dl className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                <DatoAnagrafico etichetta="Nome">{member.nome}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Cognome">{member.cognome}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Codice fiscale">{member.codice_fiscale}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Data di nascita">
                  {member.date_of_birth && `${formatData(member.date_of_birth, "media")} (${eta(member.date_of_birth)} anni)`}
                </DatoAnagrafico>
                <DatoAnagrafico etichetta="Sesso">{etichettaSesso(member.sesso)}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Residenza">{member.address}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Telefono">{member.phone}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Email">{member.email}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Contatto di emergenza">{member.emergency_contact_name}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Telefono di emergenza">{member.emergency_contact_phone}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Socio dal">{formatData(member.created_date, "media")}</DatoAnagrafico>
              </dl>
            </div>
            {puoModificare && (
              <div className="flex justify-end mt-4">
                <Button size="sm" variant="outline" onClick={apriAnagrafica}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Modifica anagrafica
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

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

        {/* I documenti occupano due righe: sono la tile più lunga, e affiancata ad abbonamenti
            e accesso non lascia buchi nella griglia. */}
        <div className="lg:row-span-2">
          <DocumentiSocio socio={member} documenti={documents} puoModificare={puoModificareDocumenti} staffUser={staffUser} onCambio={loadData} />
        </div>

        {/* Accesso: il QR per entrare in palestra e la password per entrare nel portale.
            Sono le due credenziali del socio, e si gestiscono insieme. */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><QrCode className="w-4 h-4" /> Accesso e portale</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <section aria-label="QR accesso">
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
            </section>

            <section aria-labelledby="portale-socio" className="border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="portale-socio" className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> Portale socio
                </h3>
                <p className="text-xs text-muted-foreground">
                  Ultimo accesso: {portalAccount?.last_activity_date ? formatDataOra(portalAccount.last_activity_date) : "Mai"}
                </p>
              </div>
              {/* L'account del portale si crea con l'email del socio: senza, i pulsanti restano
                  spenti e il perché si legge passandoci sopra. */}
              <div className="flex gap-2 mt-3" title={member.email ? undefined : "Serve l'email del socio per creare l'account del portale"}>
                <Button size="sm" variant="outline" onClick={() => { setShowPasswordDialog(true); setGeneratedPassword(""); }} disabled={saving || !member.email}>
                  Imposta password
                </Button>
                <Button size="sm" variant="outline" onClick={handleGeneratePassword} disabled={saving || !member.email}>
                  Genera password
                </Button>
              </div>
              {generatedPassword && (
                <div className="mt-3 p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">Password generata:</p>
                  <p className="font-mono text-sm font-medium break-all">{generatedPassword}</p>
                  <p className="text-xs text-warning mt-1">Comunica questa password al socio</p>
                </div>
              )}
            </section>
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
                    <SelectItem key={p.id} value={p.id}>{p.name} — {descriviDurata(p.durata_valore, p.durata_unita)} — {formatEuro(p.price)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Data inizio abbonamento</Label><Input type="date" value={subForm.start_date} onChange={e => setSubForm({...subForm, start_date: e.target.value})} /></div>
            {dateError && <p className="text-xs text-destructive font-medium -mt-1">{dateError}</p>}
            {scadenzaProposta && <p className="text-xs text-muted-foreground">Valido fino al {formatData(scadenzaProposta, "media")} compreso.</p>}
            {showSubForm && plans.length === 0 && <p className="text-xs text-muted-foreground">Nessun abbonamento in vendita: controlla stato e data massima nel catalogo.</p>}
            <Button type="submit" className="w-full" disabled={!subForm.plan_id || saving}>
              {saving ? "Registrazione..." : "Crea abbonamento"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!anagrafica} onOpenChange={(aperta) => !aperta && chiudiAnagrafica()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Modifica anagrafica</DialogTitle></DialogHeader>
          {anagrafica && (
            <form onSubmit={salvaAnagrafica} className="space-y-4">
              {!member.codice_fiscale && (
                <p className="text-sm rounded-lg bg-warning/10 px-3 py-2">
                  Questo socio è stato registrato senza codice fiscale: per salvare va completato.
                </p>
              )}
              <CampiAnagrafica valori={anagrafica} onChange={setAnagrafica} />
              <SceltaFoto socio={anagrafica} attuale={member.foto_url} file={foto.file} rimossa={foto.rimossa} onChange={setFoto} />
              <Button type="submit" className="w-full" disabled={Boolean(motivoAnagraficaIncompleta(anagrafica)) || saving}>
                {saving ? "Salvataggio..." : "Salva"}
              </Button>
            </form>
          )}
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