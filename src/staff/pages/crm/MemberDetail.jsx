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
import { ArrowLeft, Plus, CreditCard, QrCode, KeyRound, RefreshCw, Pencil, UserRound, Archive, ArchiveRestore } from "lucide-react";
import CampiAnagrafica, { anagraficaDi, motivoAnagraficaIncompleta } from "@/staff/components/soci/CampiAnagrafica";
import FisseSocio from "@/staff/components/soci/FisseSocio";
import IngressiSocio from "@/staff/components/soci/IngressiSocio";
import DiarioSocio from "@/staff/components/soci/DiarioSocio";
import DocumentiSocio from "@/staff/components/soci/DocumentiSocio";
import SituazioneSocio from "@/staff/components/soci/SituazioneSocio";
import { AvatarSocio, SceltaFoto } from "@/staff/components/soci/FotoSocio";
import { caricaFile } from "@/staff/lib/uploads";
import { canAccess, canEdit } from "@/staff/lib/permissions";
import { motivoPasswordNonValida, LUNGHEZZA_MINIMA_PASSWORD } from "@/core/domain/password";
import { etichettaSesso, etaA } from "@/core/domain/anagrafica";
import { generateQRCode, generaPasswordTemporanea } from "@/staff/lib/qrUtils";
import { qrDataUrl } from "@/ui/qr/qrImmagine";
import { useQrDinamico } from "@/ui/hooks/useQrDinamico";
import { useToast } from "@/ui/primitivi/use-toast";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useConfirm } from "@/ui/ConfirmDialog";
import { formatData, formatDataOra, formatEuro } from "@/core/domain/format";
import { dataFineAbbonamento, descriviDurata, motivoNonVendibile, oggiIso } from "@/core/domain/abbonamenti";


/** Un dato della tile anagrafica: un trattino quando manca, così ogni scheda ha le stesse righe. */
function DatoAnagrafico({ etichetta, children, className = "" }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs text-muted-foreground">{etichetta}</dt>
      <dd className="text-sm font-medium break-words whitespace-pre-line">
        {children || <span className="text-muted-foreground font-normal">—</span>}
      </dd>
    </div>
  );
}

export default function MemberDetail() {
  const { id } = useParams();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
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
  // Senza la visione il server rifiuta anche la lettura: la sezione non si mostra, invece di
  // mostrarla vuota come se il socio non avesse documenti.
  const puoVedereDocumenti = canAccess(staffUser?.ruolo, "crm_documents", "view");
  const [qrAccess, setQrAccess] = useState(null);
  const [portalAccount, setPortalAccount] = useState(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [generatedPassword, setGeneratedPassword] = useState("");

  const [loadError, setLoadError] = useState(null);
  // Cresce a ogni contatto registrato dall'intestazione: il diario si ricarica e lo mostra.
  const [versioneDiario, setVersioneDiario] = useState(0);
  // Il diario è lavoro della segreteria: lo vede chi segue i soci o i contatti.
  const vedeDiario = canAccess(staffUser?.ruolo, "crm_members", "view") || canAccess(staffUser?.ruolo, "crm_leads", "view");

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Prenotazioni e lezioni non stanno nella scheda: se ne occupano le
      // sezioni dedicate, come Gestione corsi. Con loro se ne vanno le letture di tutte le
      // lezioni, gli eventi e i corsi dell'ente, che servivano solo a dare un nome a una
      // prenotazione.
      // I documenti hanno un permesso loro: un ruolo che vede le anagrafiche ma non i
      // certificati apre la scheda lo stesso, senza la sezione documenti.
      const [m, p, s, d, qr, sa] = await Promise.all([
        api.entities.Member.get(id),
        api.entities.Plan.list(),
        api.entities.Subscription.filter({ member_id: id }),
        puoVedereDocumenti ? api.entities.MemberDocument.filter({ member_id: id }) : [],
        api.entities.QRAccesso.filter({ cliente_id: id }),
        api.soci.accessoPortale(id),
      ]);

      setMember(m);
      setSubscriptions(s);
      setDocuments(d);
      // Si propongono solo i tipi che si possono vendere oggi; il server lo ricontrolla.
      setPlans(p.filter(pl => !motivoNonVendibile(pl)));
      setQrAccess(qr[0] || null);
      setPortalAccount(sa);
      setLoading(false);
    } catch (err) {
      setLoadError(err);
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

  // Revocare e rigenerare cambiano la credenziale con cui il socio entra: si chiede conferma,
  // e un errore si dice invece di lasciare il pulsante senza risposta.
  const handleRevokeQR = async () => {
    if (!qrAccess) return;
    const ok = await conferma({
      title: "Revocare il QR?",
      description: `${member.full_name} non potrà più entrare con il codice attuale finché non ne generi uno nuovo.`,
      confirmLabel: "Revoca",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.entities.QRAccesso.update(qrAccess.id, { stato: "revocato" });
      toast({ title: "QR revocato" });
      loadData();
    } catch (err) {
      toast({ title: "QR non revocato", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateQR = async () => {
    if (qrAccess) {
      const ok = await conferma({
        title: "Rigenerare il QR?",
        description: "Il codice attuale smette di funzionare subito: il socio vedrà quello nuovo alla prossima apertura del portale.",
        confirmLabel: "Rigenera",
      });
      if (!ok) return;
    }
    const newCode = generateQRCode();
    setSaving(true);
    try {
      if (qrAccess) {
        await api.entities.QRAccesso.update(qrAccess.id, { codice: newCode, stato: "attivo", data_generazione: new Date().toISOString() });
      } else {
        await api.entities.QRAccesso.create({
          cliente_id: id,
          cliente_name: member?.full_name || "",
          codice: newCode,
          data_generazione: new Date().toISOString(),
          stato: "attivo",
        });
      }
      toast({ title: qrAccess ? "QR rigenerato" : "QR generato" });
      loadData();
    } catch (err) {
      toast({ title: "QR non generato", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Un socio che lascia la palestra si archivia: niente si cancella, e lo si riattiva quando
  // torna. Lo fa il server, che disdice anche le prenotazioni future e spegne portale e QR.
  const archivia = async () => {
    const ok = await conferma({
      title: `Archiviare ${member.full_name}?`,
      description:
        "Scheda, abbonamenti e storico restano. Non comparirà più fra i soci che frequentano, non potrà prenotare né comprare abbonamenti, " +
        "e portale e QR non lo faranno entrare. Le sue prenotazioni future vengono disdette. Potrai riattivarlo in qualunque momento.",
      confirmLabel: "Archivia",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const { prenotazioni_disdette: disdette } = await api.soci.archivia(id);
      toast({
        title: "Socio archiviato",
        description: disdette ? `Disdette ${disdette} ${disdette === 1 ? "prenotazione futura" : "prenotazioni future"}.` : undefined,
      });
      loadData();
    } catch (err) {
      toast({ title: "Socio non archiviato", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const riattiva = async () => {
    setSaving(true);
    try {
      await api.soci.riattiva(id);
      toast({ title: "Socio riattivato", description: "Portale e QR tornano a funzionare con le credenziali di prima." });
      loadData();
    } catch (err) {
      toast({ title: "Socio non riattivato", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // L'accesso al portale passa da una rotta sua, con il permesso della scheda: prima si
  // scriveva un account, che il server riserva all'amministratore, e per la reception i due
  // pulsanti rispondevano sempre 403. Il registro delle azioni lo scrive il server.
  const impostaAccesso = (password) => api.soci.impostaAccessoPortale(id, password);

  const handleSetPassword = async (e) => {
    e.preventDefault();
    if (passwordForm.password !== passwordForm.confirm) {
      toast({ title: "Le password non coincidono", variant: "destructive" });
      return;
    }
    const nonValida = motivoPasswordNonValida(passwordForm.password);
    if (nonValida) {
      toast({ title: nonValida, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await impostaAccesso(passwordForm.password);
      toast({ title: "Password impostata", description: "Al primo accesso il socio dovrà sceglierne una sua" });
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
      await impostaAccesso(pwd);
      setGeneratedPassword(pwd);
      toast({ title: "Password generata" });
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  // L'errore vero, non un "troppe richieste" scritto per tutti i casi.
  if (loadError) return <ErrorState error={loadError} onRetry={loadData} />;

  if (loading) {
    return <LoadingState minHeight="h-64" />;
  }

  if (!member) return <div className="p-8 text-center text-muted-foreground">Socio non trovato</div>;


  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <Link to="/crm" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Torna a Gestione membri
      </Link>

      {/* Intestazione: chi è, a che punto è con la palestra e che cosa c'è da fare. I dati
          stanno tutti nella tile dell'anagrafica; ripeterli qui voleva dire leggerli due volte. */}
      <div className="space-y-3">
        <h1 className="text-xl font-heading font-bold">{member.full_name}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="inline-block text-xs font-mono font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
            Codice socio: {member.codice_socio}
          </span>
          {member.archiviato_il && (
            <StatusBadge status="archiviato" label={`Archiviato il ${formatData(member.archiviato_il, "breve")}`} tone="neutro" />
          )}

        </div>
        {vedeDiario && (
          <SituazioneSocio
            personaId={member.persona_id} onFatto={() => setVersioneDiario((v) => v + 1)}
            puoModificare={puoModificare || canEdit(staffUser?.ruolo, "crm_leads")}
          />
        )}
      </div>

      {/* Il diario al centro: è la storia della persona, ed è lì che si lavora. Le schede con
          anagrafica, abbonamenti, documenti e accesso gli stanno accanto. */}
      <div className="grid lg:grid-cols-5 gap-6 items-start">
        {vedeDiario && (
          <div className="lg:col-span-3">
            <DiarioSocio key={versioneDiario} socio={member} puoModificare={puoModificare || canEdit(staffUser?.ruolo, "crm_leads")} />
          </div>
        )}
        <div className={`${vedeDiario ? "lg:col-span-2" : "lg:col-span-5"} space-y-6`}>
        {/* Anagrafica: la tile principale, a tutta larghezza. Stesso ordine del modulo, così
            chi corregge un dato lo ritrova dove l'ha visto. */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><UserRound className="w-4 h-4" /> Anagrafica</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-6">
              <AvatarSocio socio={member} size="lg" className="self-center sm:self-start" />
              <dl className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <DatoAnagrafico etichetta="Nome">{member.nome}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Cognome">{member.cognome}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Codice fiscale">{member.codice_fiscale}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Data di nascita">
                  {member.date_of_birth && `${formatData(member.date_of_birth, "media")} (${etaA(member.date_of_birth)} anni)`}
                </DatoAnagrafico>
                <DatoAnagrafico etichetta="Sesso">{etichettaSesso(member.sesso)}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Residenza">{member.address}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Telefono">{member.phone}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Email">{member.email}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Contatto di emergenza">{member.emergency_contact_name}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Telefono di emergenza">{member.emergency_contact_phone}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Socio dal">{formatData(member.created_date, "media")}</DatoAnagrafico>
                <DatoAnagrafico etichetta="Note" className="sm:col-span-2">{member.notes}</DatoAnagrafico>
              </dl>
            </div>
            {puoModificare && (
              <div className="flex flex-wrap justify-end gap-2 mt-4">
                {member.archiviato_il ? (
                  <Button size="sm" variant="outline" onClick={riattiva} disabled={saving}>
                    <ArchiveRestore className="w-3.5 h-3.5 mr-1" /> Riattiva socio
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={archivia} disabled={saving}>
                    <Archive className="w-3.5 h-3.5 mr-1" /> Archivia socio
                  </Button>
                )}
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
            {/* Un socio archiviato non compra abbonamenti: prima lo si riattiva. */}
            {puoModificare && !member.archiviato_il && (
              <Button size="sm" variant="outline" onClick={() => setShowSubForm(true)}><Plus className="w-3 h-3 mr-1" /> Nuovo</Button>
            )}
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

        {puoVedereDocumenti && (
          <DocumentiSocio socio={member} documenti={documents} puoModificare={puoModificareDocumenti} staffUser={staffUser} onCambio={loadData} />
        )}

        {/* Le prenotazioni fisse: sono prenotazioni, quindi le vede chi vede il calendario. */}
        {canAccess(staffUser?.ruolo, "calendar", "view") && (
          <FisseSocio socio={member} puoModificare={canEdit(staffUser?.ruolo, "calendar")} />
        )}

        {/* Accesso: il QR per entrare in palestra e la password per entrare nel portale.
            Sono le due credenziali del socio, e si gestiscono insieme. */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><QrCode className="w-4 h-4" /> Accesso e portale</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <IngressiSocio socioId={member.id} />
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
              {/* Il QR è una scrittura sulla scheda: chi la vede soltanto non lo tocca, e il
                  server rifiuterebbe comunque. */}
              {puoModificare && (
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
              )}
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
              {puoModificare && (
                <div className="flex gap-2 mt-3" title={member.email ? undefined : "Serve l'email del socio per creare l'account del portale"}>
                  <Button size="sm" variant="outline" onClick={() => { setShowPasswordDialog(true); setGeneratedPassword(""); }} disabled={saving || !member.email}>
                    Imposta password
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleGeneratePassword} disabled={saving || !member.email}>
                    Genera password
                  </Button>
                </div>
              )}
              {generatedPassword && (
                <div className="mt-3 p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">Password generata:</p>
                  <p className="font-mono text-sm font-medium break-all">{generatedPassword}</p>
                  <p className="text-xs text-warning mt-1">Comunicala al socio: al primo accesso dovrà sceglierne una sua.</p>
                </div>
              )}
            </section>
          </CardContent>
        </Card>

        </div>
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

      {dialogoConferma}

      {/* Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={(v) => { setShowPasswordDialog(v); if (!v) { setPasswordForm({ password: "", confirm: "" }); setGeneratedPassword(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Imposta password portale</DialogTitle></DialogHeader>
          <form onSubmit={handleSetPassword} className="space-y-3">
            <p className="text-xs text-muted-foreground">Account: {member?.email}</p>
            <div><Label>Nuova password *</Label><Input type="text" required value={passwordForm.password} onChange={e => setPasswordForm({...passwordForm, password: e.target.value})} placeholder={`Almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri`} /></div>
            <div><Label>Conferma password *</Label><Input type="text" required value={passwordForm.confirm} onChange={e => setPasswordForm({...passwordForm, confirm: e.target.value})} /></div>
            <Button type="submit" className="w-full" disabled={saving}>{saving ? "Salvataggio..." : "Imposta password"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}