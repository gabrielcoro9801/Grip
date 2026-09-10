import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { canEdit } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import PageHeader from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/Spinner";
import { EmptyState, ErrorState } from "@/components/shared/StateViews";
import { useConfirm } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import SchedaCard from "@/components/allenamento/SchedaCard";
import { Plus, Pencil, Trash2, ClipboardList, Search, LayoutTemplate } from "lucide-react";
import { formatData } from "@/lib/format";
import { clonaRoutines } from "@/lib/scheda";

export default function SchedeAssegnate() {
  const navigate = useNavigate();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();

  const [schede, setSchede] = useState([]);
  const [soci, setSoci] = useState([]);
  const [allenamenti, setAllenamenti] = useState([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(null);

  const [ricerca, setRicerca] = useState("");
  const [filtroSocio, setFiltroSocio] = useState("tutti");

  const [daPromuovere, setDaPromuovere] = useState(null);
  const [nomeModello, setNomeModello] = useState("");
  const [promozioneInCorso, setPromozioneInCorso] = useState(false);

  const puoModificare = canEdit(staffUser.ruolo, "crm_plans");

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const [s, m, w] = await Promise.all([
        api.entities.ExercisePlan.filter({ is_template: false }),
        api.entities.Member.list("full_name"),
        // Le **sessioni**, non le serie: dalla migrazione 0022 ogni riga di WorkoutLog è
        // una serie sola, e contarle come allenamenti faceva leggere tre sedute da sedici
        // serie come «48 allenamenti».
        api.entities.WorkoutSession.list("-iniziata_alle", 500),
      ]);
      setSchede(s);
      setSoci(m);
      setAllenamenti(w);
    } catch (err) {
      setErrore(err);
    }
    setCaricamento(false);
  }, []);

  useEffect(() => { carica(); }, [carica]);

  // Quanto è stata usata una scheda. È il dato che dice se il socio la sta seguendo o se
  // l'ha ricevuta e mai aperta — e senza, l'elenco dice solo cosa è stato consegnato.
  const usoPerScheda = useMemo(() => {
    const per = new Map();
    for (const sessione of allenamenti) {
      if (!sessione.plan_id) continue;
      const corrente = per.get(sessione.plan_id);
      // Le sessioni arrivano già dalla più recente: la prima che si incontra per una
      // scheda è l'ultima volta che il socio l'ha usata.
      if (corrente) corrente.quante += 1;
      else per.set(sessione.plan_id, { quante: 1, ultima: sessione.iniziata_alle });
    }
    return per;
  }, [allenamenti]);

  const visibili = useMemo(() => {
    const cercato = ricerca.trim().toLowerCase();
    return schede.filter((s) => {
      if (filtroSocio !== "tutti" && s.member_id !== filtroSocio) return false;
      if (!cercato) return true;
      return `${s.name} ${s.member_name ?? ""}`.toLowerCase().includes(cercato);
    });
  }, [schede, ricerca, filtroSocio]);

  // Raggruppate per socio: la domanda che ci si fa davanti a questo elenco è quasi sempre
  // "cosa sta facendo questa persona", non "quali schede esistono".
  const perSocio = useMemo(() => {
    const gruppi = new Map();
    for (const scheda of visibili) {
      const chiave = scheda.member_id ?? "senza-socio";
      if (!gruppi.has(chiave)) {
        gruppi.set(chiave, { id: scheda.member_id, nome: scheda.member_name || "Socio non più presente", schede: [] });
      }
      gruppi.get(chiave).schede.push(scheda);
    }
    for (const gruppo of gruppi.values()) {
      // La più recente per prima: è quella che il socio sta seguendo adesso.
      gruppo.schede.sort((a, b) => String(b.assigned_date ?? "").localeCompare(String(a.assigned_date ?? "")));
    }
    return [...gruppi.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [visibili]);

  const duplica = async (scheda) => {
    try {
      const copia = await api.entities.ExercisePlan.create({
        is_template: false,
        member_id: scheda.member_id,
        member_name: scheda.member_name,
        name: `${scheda.name} (copia)`,
        notes: scheda.notes ?? "",
        routines: clonaRoutines(scheda.routines),
        assigned_date: new Date().toISOString().split("T")[0],
        template_origin_id: scheda.template_origin_id ?? null,
      });
      navigate(`/allenamento/schede/${copia.id}`);
    } catch (err) {
      toast({ title: "Non è stato possibile duplicare", description: err.message, variant: "destructive" });
    }
  };

  /**
   * Da scheda di una persona a modello del catalogo.
   *
   * È l'inverso dell'assegnazione: una scheda scritta per un socio, e che ha funzionato,
   * diventa il punto di partenza per gli altri. Il nome si chiede perché quello buono per
   * una persona quasi mai lo è per un modello — «Forza — Giulia» non dice niente a chi
   * cercherà nel catalogo fra sei mesi.
   *
   * Il modello è una copia, non un collegamento: da qui in poi le due vite sono separate,
   * come per l'assegnazione.
   */
  const rendiModello = async (evento) => {
    evento.preventDefault();
    setPromozioneInCorso(true);
    try {
      const modello = await api.entities.ExercisePlan.create({
        is_template: true,
        name: nomeModello.trim() || daPromuovere.name,
        notes: daPromuovere.notes ?? "",
        routines: clonaRoutines(daPromuovere.routines),
        // Un modello non è di nessuno, e non "viene da" la scheda di un socio: il legame di
        // provenienza serve nell'altro verso, per sapere da quale modello nasce una scheda.
        template_origin_id: null,
      });
      setDaPromuovere(null);
      toast({
        title: `«${modello.name}» è ora un modello`,
        description: "Lo trovi fra le Schede modello, pronto da assegnare a chiunque.",
      });
      navigate(`/allenamento/schede/${modello.id}`);
    } catch (err) {
      toast({ title: "Non è stato possibile creare il modello", description: err.message, variant: "destructive" });
      setPromozioneInCorso(false);
    }
  };

  const elimina = async (scheda) => {
    const uso = usoPerScheda.get(scheda.id);
    if (uso) {
      // Gli allenamenti registrati puntano alla scheda: eliminarla spezzerebbe il filo fra
      // una sessione e quello che il socio doveva fare quel giorno. Si può sempre
      // modificarla, o assegnarne una nuova.
      toast({
        title: "Questa scheda non si può eliminare",
        description:
          `${scheda.member_name} ci ha registrato ${uso.quante} ${uso.quante === 1 ? "allenamento" : "allenamenti"}: ` +
          "eliminarla ne perderebbe lo storico. Puoi modificarla, o assegnargliene una nuova.",
        variant: "destructive",
      });
      return;
    }
    const ok = await conferma({
      title: `Eliminare «${scheda.name}»?`,
      description: `La scheda di ${scheda.member_name} sparisce anche dal suo portale.`,
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.entities.ExercisePlan.delete(scheda.id);
      toast({ title: `«${scheda.name}» eliminata` });
      carica();
    } catch (err) {
      toast({ title: "Non è stato possibile eliminare", description: err.message, variant: "destructive" });
    }
  };

  if (caricamento) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  return (
    <>
      <PageHeader
        title="Schede assegnate"
        description="Le schede che i soci hanno in mano, una per una. Ognuna è di quella persona e si adatta a lei."
      >
        {puoModificare && (
          <>
            <Button size="sm" variant="outline" onClick={() => navigate("/allenamento/modelli")}>
              <LayoutTemplate className="w-4 h-4 mr-1" aria-hidden="true" /> Parti da un modello
            </Button>
            <Button size="sm" onClick={() => navigate("/allenamento/schede/nuova?tipo=assegnata")}>
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuova scheda
            </Button>
          </>
        )}
      </PageHeader>

      {schede.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              className="pl-9"
              placeholder="Cerca per scheda o socio"
              value={ricerca}
              onChange={(e) => setRicerca(e.target.value)}
              aria-label="Cerca una scheda"
            />
          </div>
          <Select value={filtroSocio} onValueChange={setFiltroSocio}>
            <SelectTrigger className="sm:w-64" aria-label="Filtra per socio"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tutti">Tutti i soci</SelectItem>
              {soci.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {visibili.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={schede.length === 0 ? "Nessuna scheda assegnata" : "Nessuna scheda corrisponde"}
          description={
            schede.length === 0
              ? "Puoi partire da un modello del catalogo, oppure scriverne una da zero per un socio solo."
              : "Prova a cambiare la ricerca o il socio."
          }
          action={
            schede.length === 0 && puoModificare ? (
              <Button size="sm" onClick={() => navigate("/allenamento/schede/nuova?tipo=assegnata")}>
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuova scheda
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-8">
          {perSocio.map((gruppo) => (
            <section key={gruppo.id ?? "senza-socio"}>
              <h2 className="text-sm font-heading font-semibold mb-3">
                {gruppo.id ? (
                  <Link to={`/crm/soci/${gruppo.id}`} className="hover:text-primary transition-colors">
                    {gruppo.nome}
                  </Link>
                ) : (
                  gruppo.nome
                )}{" "}
                <span className="text-muted-foreground font-normal">
                  ({gruppo.schede.length} {gruppo.schede.length === 1 ? "scheda" : "schede"})
                </span>
              </h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {gruppo.schede.map((scheda) => {
                  const uso = usoPerScheda.get(scheda.id);
                  return (
                    <SchedaCard
                      key={scheda.id}
                      scheda={scheda}
                      sottotitolo={
                        `Assegnata il ${formatData(scheda.assigned_date, "media")}` +
                        (uso
                          ? ` · ${uso.quante} ${uso.quante === 1 ? "allenamento" : "allenamenti"}, ultimo il ${formatData(uso.ultima, "media")}`
                          : " · mai aperta")
                      }
                      onApri={() => navigate(`/allenamento/schede/${scheda.id}`)}
                      azioni={puoModificare && (
                        <>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            aria-label={`Rendi «${scheda.name}» un modello riutilizzabile`}
                            title="Rendi modello"
                            onClick={() => {
                              setDaPromuovere(scheda);
                              setNomeModello(scheda.name);
                            }}
                          >
                            <LayoutTemplate className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            aria-label={`Modifica ${scheda.name}`} title="Modifica"
                            onClick={() => navigate(`/allenamento/schede/${scheda.id}`)}
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                            aria-label={`Elimina ${scheda.name}`} title="Elimina"
                            onClick={() => elimina(scheda)}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    />
                  );
                })}
              </div>
              {puoModificare && (
                <Button
                  variant="ghost" size="sm" className="mt-2 text-xs text-muted-foreground"
                  onClick={() => duplica(gruppo.schede[0])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                  Nuova scheda da «{gruppo.schede[0].name}»
                </Button>
              )}
            </section>
          ))}
        </div>
      )}

      <Dialog open={Boolean(daPromuovere)} onOpenChange={(v) => !v && setDaPromuovere(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rendi «{daPromuovere?.name}» un modello</DialogTitle>
            <DialogDescription>
              Ne viene fatta una copia nel catalogo, senza il socio. La scheda di
              {" "}{daPromuovere?.member_name} resta dov'è e non cambia.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={rendiModello} className="space-y-4">
            <div>
              <Label htmlFor="modello-nome">Nome del modello *</Label>
              <Input
                id="modello-nome" required autoFocus
                value={nomeModello}
                onChange={(e) => setNomeModello(e.target.value)}
                placeholder="Full body principianti"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Chiamalo per quello che è, non per chi lo faceva: nel catalogo lo cercherai
                fra sei mesi.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={() => setDaPromuovere(null)}>Annulla</Button>
              <Button type="submit" disabled={!nomeModello.trim() || promozioneInCorso}>
                Crea il modello
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {dialogoConferma}
    </>
  );
}
