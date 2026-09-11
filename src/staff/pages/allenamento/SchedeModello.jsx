import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import SchedaCard from "@/staff/components/SchedaCard";
import { Plus, Pencil, Trash2, Copy, UserPlus, LayoutTemplate, Search } from "lucide-react";
import { clonaRoutines } from "@/core/domain/scheda";

export default function SchedeModello() {
  const navigate = useNavigate();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();

  const [modelli, setModelli] = useState([]);
  const [soci, setSoci] = useState([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(null);
  const [ricerca, setRicerca] = useState("");

  const [daAssegnare, setDaAssegnare] = useState(null);
  const [socioScelto, setSocioScelto] = useState("");
  const [nomeAssegnata, setNomeAssegnata] = useState("");
  const [assegnazioneInCorso, setAssegnazioneInCorso] = useState(false);

  const puoModificare = canEdit(staffUser.ruolo, "crm_plans");

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const [m, s] = await Promise.all([
        api.entities.ExercisePlan.filter({ is_template: true }, "name"),
        api.entities.Member.list("full_name"),
      ]);
      setModelli(m);
      setSoci(s);
    } catch (err) {
      setErrore(err);
    }
    setCaricamento(false);
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const visibili = useMemo(() => {
    const cercato = ricerca.trim().toLowerCase();
    if (!cercato) return modelli;
    return modelli.filter((m) =>
      `${m.name} ${(m.routines ?? []).flatMap((r) => [r.nome, ...(r.esercizi ?? []).map((e) => e.exercise_name)]).join(" ")}`.toLowerCase().includes(cercato)
    );
  }, [modelli, ricerca]);

  const apriAssegnazione = (modello) => {
    setDaAssegnare(modello);
    setSocioScelto("");
    setNomeAssegnata(modello.name);
  };

  const assegna = async (evento) => {
    evento.preventDefault();
    const socio = soci.find((s) => s.id === socioScelto);
    if (!socio) return;
    setAssegnazioneInCorso(true);
    try {
      // Una copia, non un riferimento: da qui in poi il personal trainer adatta la scheda
      // a quella persona — carichi, ripetizioni, un esercizio sostituito — senza che le
      // sue correzioni ricadano sul modello, e quindi su tutti gli altri soci.
      const copia = await api.entities.ExercisePlan.create({
        is_template: false,
        member_id: socio.id,
        member_name: socio.full_name,
        name: nomeAssegnata.trim() || daAssegnare.name,
        notes: daAssegnare.notes ?? "",
        routines: clonaRoutines(daAssegnare.routines),
        assigned_date: new Date().toISOString().split("T")[0],
        template_origin_id: daAssegnare.id,
      });
      setDaAssegnare(null);
      toast({
        title: `Scheda assegnata a ${socio.full_name}`,
        description: "Aprila per adattarla a lui prima che la veda.",
      });
      navigate(`/allenamento/schede/${copia.id}`);
    } catch (err) {
      toast({ title: "Non è stato possibile assegnare", description: err.message, variant: "destructive" });
      setAssegnazioneInCorso(false);
    }
  };

  const duplica = async (modello) => {
    try {
      const copia = await api.entities.ExercisePlan.create({
        is_template: true,
        name: `${modello.name} (copia)`,
        notes: modello.notes ?? "",
        routines: clonaRoutines(modello.routines),
      });
      navigate(`/allenamento/schede/${copia.id}`);
    } catch (err) {
      toast({ title: "Non è stato possibile duplicare", description: err.message, variant: "destructive" });
    }
  };

  const elimina = async (modello) => {
    // Le schede già assegnate non si toccano: sono copie, e il legame col modello è solo
    // storico. Vale la pena dirlo, perché "elimina un modello usato 12 volte" suona
    // come se stesse per succedere qualcosa a quelle 12 persone.
    const assegnate = await api.entities.ExercisePlan.filter({ template_origin_id: modello.id });
    const ok = await conferma({
      title: `Eliminare il modello «${modello.name}»?`,
      description: assegnate.length
        ? `Le ${assegnate.length} schede già assegnate a partire da questo modello restano ` +
          "dove sono: sono copie, e non cambiano. Sparisce solo il modello dal catalogo."
        : "Sparisce dal catalogo dei modelli.",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.entities.ExercisePlan.delete(modello.id);
      toast({ title: `«${modello.name}» eliminato` });
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
        title="Schede modello"
        description="Le schede pronte del catalogo. Non sono di nessuno: si assegnano a un socio facendone una copia."
      >
        {puoModificare && (
          <Button size="sm" onClick={() => navigate("/allenamento/schede/nuova?tipo=modello")}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuovo modello
          </Button>
        )}
      </PageHeader>

      {modelli.length > 0 && (
        <div className="relative mb-6 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            className="pl-9"
            placeholder="Cerca per nome o esercizio"
            value={ricerca}
            onChange={(e) => setRicerca(e.target.value)}
            aria-label="Cerca un modello"
          />
        </div>
      )}

      {visibili.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title={modelli.length === 0 ? "Nessun modello nel catalogo" : "Nessun modello corrisponde"}
          description={
            modelli.length === 0
              ? "Un modello si scrive una volta e si assegna a quanti soci si vuole, adattandolo a ognuno."
              : "Prova a cambiare la ricerca."
          }
          action={
            modelli.length === 0 && puoModificare ? (
              <Button size="sm" onClick={() => navigate("/allenamento/schede/nuova?tipo=modello")}>
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuovo modello
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibili.map((modello) => (
            <SchedaCard
              key={modello.id}
              scheda={modello}
              onApri={() => navigate(`/allenamento/schede/${modello.id}`)}
              azioni={puoModificare && (
                <>
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9"
                    aria-label={`Assegna ${modello.name} a un socio`} title="Assegna a un socio"
                    onClick={() => apriAssegnazione(modello)}
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9"
                    aria-label={`Duplica ${modello.name}`} title="Duplica"
                    onClick={() => duplica(modello)}
                  >
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9"
                    aria-label={`Modifica ${modello.name}`} title="Modifica"
                    onClick={() => navigate(`/allenamento/schede/${modello.id}`)}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9 text-destructive"
                    aria-label={`Elimina ${modello.name}`} title="Elimina"
                    onClick={() => elimina(modello)}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </>
              )}
            />
          ))}
        </div>
      )}

      <Dialog open={Boolean(daAssegnare)} onOpenChange={(v) => !v && setDaAssegnare(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assegna «{daAssegnare?.name}»</DialogTitle>
            <DialogDescription>
              Il socio riceve una copia. Da lì in poi la sua scheda e il modello sono
              indipendenti: adattarla a lui non cambia il modello.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={assegna} className="space-y-4">
            <div>
              <Label htmlFor="assegna-socio">Socio *</Label>
              <Select value={socioScelto} onValueChange={setSocioScelto}>
                <SelectTrigger id="assegna-socio"><SelectValue placeholder="Scegli il socio" /></SelectTrigger>
                <SelectContent>
                  {soci.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="assegna-nome">Nome della scheda</Label>
              <Input
                id="assegna-nome"
                value={nomeAssegnata}
                onChange={(e) => setNomeAssegnata(e.target.value)}
                placeholder={daAssegnare?.name}
              />
              <p className="text-xs text-muted-foreground mt-1">
                È il nome che vedrà il socio: spesso conviene datarlo, tipo «Forza — ottobre».
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={() => setDaAssegnare(null)}>Annulla</Button>
              <Button type="submit" disabled={!socioScelto || assegnazioneInCorso}>Assegna e apri</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {dialogoConferma}
    </>
  );
}
