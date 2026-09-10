import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { canEdit } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/Spinner";
import { EmptyState, ErrorState } from "@/components/shared/StateViews";
import { useConfirm } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Pencil, Trash2, Dumbbell, Search, Image as ImageIcon } from "lucide-react";
import { gruppiPerZona } from "@/lib/gruppiMuscolari";

const FORM_VUOTO = { name: "", muscle_group: "petto", description: "", image_url: "" };

export default function LibreriaEsercizi() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();

  const [esercizi, setEsercizi] = useState([]);
  const [schede, setSchede] = useState([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(null);

  const [ricerca, setRicerca] = useState("");
  const [filtroGruppo, setFiltroGruppo] = useState("tutti");

  const [inModifica, setInModifica] = useState(null);
  const [form, setForm] = useState(FORM_VUOTO);
  const [formAperto, setFormAperto] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);
  const [caricamentoImmagine, setCaricamentoImmagine] = useState(false);

  const puoModificare = canEdit(staffUser.ruolo, "crm_plans");

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const [e, s] = await Promise.all([
        api.entities.Exercise.list("name"),
        api.entities.ExercisePlan.list(),
      ]);
      setEsercizi(e);
      setSchede(s);
    } catch (err) {
      setErrore(err);
    }
    setCaricamento(false);
  }, []);

  useEffect(() => { carica(); }, [carica]);

  // In quante schede compare un esercizio. Serve a dire, prima di eliminarlo, che cosa si
  // sta per svuotare: un esercizio del catalogo può essere dentro venti schede già
  // consegnate, e dal solo nome non si vede.
  const usoPerEsercizio = useMemo(() => {
    const conteggio = new Map();
    for (const scheda of schede) {
      // Uno stesso esercizio può comparire due volte nella stessa scheda — in due routine
      // diverse, o due volte nella stessa: conta come una.
      const idVisti = new Set(
        (scheda.routines ?? [])
          .flatMap((r) => r.esercizi ?? [])
          .map((es) => es.exercise_id)
          .filter(Boolean)
      );
      for (const id of idVisti) conteggio.set(id, (conteggio.get(id) ?? 0) + 1);
    }
    return conteggio;
  }, [schede]);

  const visibili = useMemo(() => {
    const cercato = ricerca.trim().toLowerCase();
    return esercizi.filter((es) => {
      if (filtroGruppo !== "tutti" && es.muscle_group !== filtroGruppo) return false;
      if (!cercato) return true;
      return `${es.name} ${es.description ?? ""}`.toLowerCase().includes(cercato);
    });
  }, [esercizi, ricerca, filtroGruppo]);

  // Raggruppati per gruppo muscolare: un catalogo che cresce a qualche centinaio di voci
  // in ordine alfabetico puro non si sfoglia più.
  const perGruppo = useMemo(() => {
    return gruppiPerZona()
      .map((zona) => ({
        ...zona,
        gruppi: zona.gruppi
          .map((g) => ({ ...g, esercizi: visibili.filter((es) => es.muscle_group === g.codice) }))
          .filter((g) => g.esercizi.length > 0),
      }))
      .filter((zona) => zona.gruppi.length > 0);
  }, [visibili]);

  const apriNuovo = () => {
    setInModifica(null);
    // Se sto filtrando su un gruppo, è quasi certo che l'esercizio nuovo sia di quel gruppo.
    setForm({ ...FORM_VUOTO, muscle_group: filtroGruppo === "tutti" ? "petto" : filtroGruppo });
    setFormAperto(true);
  };

  const apriModifica = (esercizio) => {
    setInModifica(esercizio);
    setForm({
      name: esercizio.name,
      muscle_group: esercizio.muscle_group ?? "altro",
      description: esercizio.description ?? "",
      image_url: esercizio.image_url ?? "",
    });
    setFormAperto(true);
  };

  const caricaImmagine = async (file) => {
    if (!file) return;
    setCaricamentoImmagine(true);
    try {
      // La stessa rotta dei documenti e del logo: in produzione scrive sul volume
      // persistente, e /uploads/* è servito anche al portale soci, che deve poterla vedere.
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      setForm((precedente) => ({ ...precedente, image_url: file_url }));
    } catch (err) {
      toast({ title: "Immagine non caricata", description: err.message, variant: "destructive" });
    }
    setCaricamentoImmagine(false);
  };

  const salva = async (evento) => {
    evento.preventDefault();
    setSalvataggio(true);
    try {
      if (inModifica) {
        await api.entities.Exercise.update(inModifica.id, form);
        toast({ title: `«${form.name}» aggiornato` });
      } else {
        await api.entities.Exercise.create(form);
        toast({ title: `«${form.name}» aggiunto al catalogo` });
      }
      setFormAperto(false);
      setInModifica(null);
      carica();
    } catch (err) {
      toast({ title: "Non è stato possibile salvare", description: err.message, variant: "destructive" });
    }
    setSalvataggio(false);
  };

  const elimina = async (esercizio) => {
    const usi = usoPerEsercizio.get(esercizio.id) ?? 0;
    const ok = await conferma({
      title: `Eliminare «${esercizio.name}»?`,
      // Le schede non si rompono — nome e gruppo sono copiati dentro ognuna — ma
      // l'esercizio sparisce dal catalogo e non si potrà più aggiungere a schede nuove.
      description: usi
        ? `È usato in ${usi} ${usi === 1 ? "scheda" : "schede"}. Quelle schede restano leggibili, ` +
          "ma l'esercizio non si potrà più aggiungere a una scheda nuova."
        : "Non è usato in nessuna scheda.",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.entities.Exercise.delete(esercizio.id);
      toast({ title: `«${esercizio.name}» eliminato` });
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
        title="Esercizi"
        description="Il catalogo da cui si compongono le schede: cosa è un esercizio, non come si esegue in una scheda."
      >
        {puoModificare && (
          <Button size="sm" onClick={apriNuovo}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuovo esercizio
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            className="pl-9"
            placeholder="Cerca per nome o descrizione"
            value={ricerca}
            onChange={(e) => setRicerca(e.target.value)}
            aria-label="Cerca un esercizio"
          />
        </div>
        <Select value={filtroGruppo} onValueChange={setFiltroGruppo}>
          <SelectTrigger className="sm:w-64" aria-label="Filtra per gruppo muscolare">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti i gruppi muscolari</SelectItem>
            {gruppiPerZona().map((zona) => (
              <SelectGroup key={zona.zona}>
                <SelectLabel>{zona.etichetta}</SelectLabel>
                {zona.gruppi.map((g) => (
                  <SelectItem key={g.codice} value={g.codice}>{g.etichetta}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visibili.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title={esercizi.length === 0 ? "Il catalogo è vuoto" : "Nessun esercizio corrisponde"}
          description={
            esercizi.length === 0
              ? "Aggiungi il primo esercizio: da qui si compongono tutte le schede."
              : "Prova a cambiare la ricerca o il gruppo muscolare."
          }
          action={
            esercizi.length === 0 && puoModificare ? (
              <Button size="sm" onClick={apriNuovo}>
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuovo esercizio
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-8">
          {perGruppo.map((zona) => (
            <section key={zona.zona}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                {zona.etichetta}
              </h2>
              <div className="space-y-5">
                {zona.gruppi.map((gruppo) => (
                  <div key={gruppo.codice}>
                    <h3 className="text-sm font-heading font-semibold mb-2">
                      {gruppo.etichetta}{" "}
                      <span className="text-muted-foreground font-normal">({gruppo.esercizi.length})</span>
                    </h3>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {gruppo.esercizi.map((esercizio) => {
                        const usi = usoPerEsercizio.get(esercizio.id) ?? 0;
                        return (
                          <Card key={esercizio.id} className="border-0 shadow-sm">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2.5 min-w-0">
                                  {esercizio.image_url && (
                                    <img
                                      src={esercizio.image_url}
                                      alt=""
                                      loading="lazy"
                                      className="w-10 h-10 rounded-lg object-cover bg-muted shrink-0"
                                    />
                                  )}
                                  <h4 className="font-medium text-sm min-w-0">{esercizio.name}</h4>
                                </div>
                                {puoModificare && (
                                  <div className="flex items-center gap-0.5 shrink-0 -mt-1 -mr-2">
                                    <Button
                                      variant="ghost" size="icon" className="h-7 w-7"
                                      aria-label={`Modifica ${esercizio.name}`}
                                      onClick={() => apriModifica(esercizio)}
                                    >
                                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                    </Button>
                                    <Button
                                      variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                      aria-label={`Elimina ${esercizio.name}`}
                                      onClick={() => elimina(esercizio)}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                              {esercizio.description && (
                                <p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">
                                  {esercizio.description}
                                </p>
                              )}
                              {usi > 0 && (
                                <Badge variant="outline" className="mt-2 text-[10px] font-normal">
                                  in {usi} {usi === 1 ? "scheda" : "schede"}
                                </Badge>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={formAperto} onOpenChange={(v) => { setFormAperto(v); if (!v) setInModifica(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{inModifica ? `Modifica «${inModifica.name}»` : "Nuovo esercizio"}</DialogTitle>
            <DialogDescription>
              Serie, ripetizioni e recupero non si impostano qui: cambiano da scheda a scheda,
              e si scrivono quando l'esercizio entra in una.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={salva} className="space-y-4">
            <div>
              <Label htmlFor="esercizio-nome">Nome *</Label>
              <Input
                id="esercizio-nome" required autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Panca piana con bilanciere"
              />
            </div>
            <div>
              <Label htmlFor="esercizio-gruppo">Gruppo muscolare *</Label>
              <Select value={form.muscle_group} onValueChange={(v) => setForm({ ...form, muscle_group: v })}>
                <SelectTrigger id="esercizio-gruppo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {gruppiPerZona().map((zona) => (
                    <SelectGroup key={zona.zona}>
                      <SelectLabel>{zona.etichetta}</SelectLabel>
                      {zona.gruppi.map((g) => (
                        <SelectItem key={g.codice} value={g.codice}>{g.etichetta}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="esercizio-immagine">Immagine</Label>
              <div className="flex items-center gap-3">
                {form.image_url ? (
                  <img
                    src={form.image_url}
                    alt=""
                    className="w-16 h-16 rounded-lg object-cover bg-muted shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <Input
                    id="esercizio-immagine" type="file" accept="image/*"
                    className="text-xs"
                    disabled={caricamentoImmagine}
                    onChange={(e) => caricaImmagine(e.target.files?.[0])}
                  />
                  {form.image_url && (
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="text-xs text-muted-foreground mt-1 h-7"
                      onClick={() => setForm({ ...form, image_url: "" })}
                    >
                      Togli l'immagine
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <Label htmlFor="esercizio-descrizione">Descrizione</Label>
              <Textarea
                id="esercizio-descrizione" rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Come si esegue, su cosa stare attenti. Il socio la legge dalla sua scheda."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={() => setFormAperto(false)}>Annulla</Button>
              <Button type="submit" disabled={salvataggio || !form.name.trim()}>
                {inModifica ? "Salva modifiche" : "Aggiungi al catalogo"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {dialogoConferma}
    </>
  );
}
