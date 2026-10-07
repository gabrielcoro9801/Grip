import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/primitivi/tabs";
import CoursesByCategory from "@/member/components/CoursesByCategory";
import CoursesByCalendar from "@/member/components/CoursesByCalendar";
import { caricaAgenda, prenotaLezione, disdiciPrenotazione, caricaFisse, prenotaFisso, terminaFissa } from "@/core/api/portale";
import { FisseContext, LeMieFisse } from "@/member/components/fisse";
import { useToast } from "@/ui/primitivi/use-toast";
import { LoadingState } from "@/ui/Spinner";
import { oggiIso, spostaGiorni } from "@/core/domain/giorni";

/**
 * Da sette richieste a una.
 *
 * Questa schermata chiedeva corsi, categorie, istruttori, eventi, lezioni, sale e — la
 * peggiore — fino a cinquecento prenotazioni **di tutti i soci**, per poi incrociarle a mano
 * e contare i posti liberi. Il conto dei posti lo fa il server e manda un numero; delle
 * prenotazioni altrui non arriva più niente, che su una lista di chi frequenta cosa non è un
 * dettaglio.
 *
 * L'incrocio che resta qui sotto non è più un incrocio: è solo la traduzione della risposta
 * nella forma che le schede sullo schermo usano già.
 */
export default function MemberCoursesCalendar() {
  const { toast } = useToast();
  const [lezioni, setLezioni] = useState([]);
  const [fisse, setFisse] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // Due mesi: il calendario si sfoglia una settimana per volta, e chiedere solo i
      // prossimi giorni farebbe trovare vuote le settimane più avanti. Restano comunque le
      // lezioni di un intervallo dichiarato, non "le ultime cinquecento" come prima.
      // "Oggi" è quello di Roma, lo stesso del server: con `toISOString()` (UTC), fra
      // mezzanotte e le due l'agenda partiva da ieri.
      const oggi = oggiIso();
      const [agenda, mieFisse] = await Promise.all([caricaAgenda({ dal: oggi, al: spostaGiorni(oggi, 60) }), caricaFisse()]);
      setLezioni(agenda.giorni.flatMap((g) => g.lezioni));
      setFisse(mieFisse);
    } catch {
      // La schermata resta vuota con il suo messaggio: un errore qui non deve far cadere
      // l'intera pagina.
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const enrichedSessions = useMemo(
    () => lezioni.map((l) => ({
      id: l.id,
      date: l.data,
      start_time: String(l.inizio ?? "").slice(0, 5),
      end_time: String(l.fine ?? "").slice(0, 5),
      capacity: l.posti.capienza,
      _course: l.corso && { id: l.corso.id, name: l.corso.nome, description: l.corso.descrizione },
      _category: l.categoria && { id: l.categoria.id, name: l.categoria.nome, color: l.categoria.colore },
      _instructor: l.istruttore && { id: l.istruttore.id, full_name: l.istruttore.nome },
      _room: l.sala && { id: l.sala.id, name: l.sala.nome },
      _posti: l.posti,
      // Perché non si può prenotare (senza abbonamento quel giorno, o già finita), o null.
      _motivoNonPrenotabile: l.motivo_non_prenotabile ?? null,
      // Finita: resta in agenda, ma non si prenota né si disdice più.
      _finita: Boolean(l.finita),
      // Fino a quando si disdice da sé, e il perché se il termine è passato.
      _disdettaFinoA: l.disdetta_fino_a ?? null,
      _motivoDisdettaChiusa: l.motivo_disdetta_chiusa ?? null,
      // La serie della lezione, se lo è: { id, mia_fissa }.
      _serie: l.serie ?? null,
      _miaPrenotazione: l.mia_prenotazione && {
        id: l.mia_prenotazione.id,
        status: l.mia_prenotazione.stato,
        waitlist_position: l.mia_prenotazione.posizione_attesa,
      },
    })),
    [lezioni]
  );

  const handleBook = async (session) => {
    setActionLoading(true);
    try {
      const { prenotazione } = await prenotaLezione(session.id);
      if (prenotazione.stato === "confirmed") {
        toast({ title: "Prenotazione confermata", description: session._course?.name });
      } else {
        toast({ title: "Aggiunto alla lista d'attesa", description: `${session._course?.name} — posizione #${prenotazione.posizione_attesa}` });
      }
      loadData();
    } catch (err) {
      toast({ title: "Prenotazione non riuscita", description: err.message, variant: "destructive" });
    }
    setActionLoading(false);
  };

  const handleCancel = async (bookingId) => {
    setActionLoading(true);
    try {
      await disdiciPrenotazione(bookingId);
      toast({ title: "Prenotazione annullata" });
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setActionLoading(false);
  };

  // "Prenota tutte" e "disdici tutte" restano una richiesta per lezione: ognuna è una
  // decisione a sé — c'è posto? si finisce in lista? — e il server la prende dentro una
  // transazione sua. Quello che si riporta è quante ne sono andate a buon fine.
  const handleBookAll = async (sessionsToBook) => {
    setActionLoading(true);
    let riuscite = 0;
    let inAttesa = 0;
    const falliti = [];
    for (const session of sessionsToBook) {
      try {
        const { prenotazione } = await prenotaLezione(session.id);
        if (prenotazione.stato === "waitlisted") inAttesa += 1;
        else riuscite += 1;
      } catch (err) {
        falliti.push(err.message);
      }
    }
    await loadData();
    setActionLoading(false);
    return { ok: falliti.length === 0, booked: riuscite, waitlisted: inAttesa, errors: falliti };
  };

  const handleCancelAll = async (bookingsToCancel) => {
    setActionLoading(true);
    let disdette = 0;
    const falliti = [];
    for (const prenotazione of bookingsToCancel) {
      try {
        await disdiciPrenotazione(prenotazione.id);
        disdette += 1;
      } catch (err) {
        falliti.push(err.message);
      }
    }
    await loadData();
    setActionLoading(false);
    return { ok: falliti.length === 0, cancelled: disdette, errors: falliti };
  };

  // Prenota fisso nel giorno della lezione cliccata. Il server dice quante ne ha prenotate, quante
  // in lista d'attesa e quante sono rimaste senza abbonamento: il socio lo legge subito.
  const handlePrenotaFisso = async (session, giorno) => {
    setActionLoading(true);
    try {
      const esito = await prenotaFisso(session._serie.id, [giorno]);
      const parti = [`${esito.prenotate} ${esito.prenotate === 1 ? "lezione prenotata" : "lezioni prenotate"}`];
      if (esito.in_attesa) parti.push(`${esito.in_attesa} in lista d'attesa`);
      if (esito.senza_abbonamento) parti.push(`${esito.senza_abbonamento} oltre il tuo abbonamento`);
      toast({ title: `Prenotazione fissa: ${session._course?.name}`, description: parti.join(", ") });
      loadData();
    } catch (err) {
      toast({ title: "Prenotazione fissa non riuscita", description: err.message, variant: "destructive" });
    }
    setActionLoading(false);
  };

  const handleTermina = async (fissa) => {
    setActionLoading(true);
    try {
      const esito = await terminaFissa(fissa.id);
      toast({
        title: `Prenotazione fissa terminata: ${fissa.corso}`,
        description: esito.rimaste
          ? `${esito.disdette} lezioni disdette; ${esito.rimaste} sono oltre il termine di disdetta e restano prenotate.`
          : `${esito.disdette} ${esito.disdette === 1 ? "lezione disdetta" : "lezioni disdette"}.`,
      });
      loadData();
    } catch (err) {
      toast({ title: "Non è stato possibile terminarla", description: err.message, variant: "destructive" });
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <LoadingState minHeight="h-64" />
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Corsi</h1>
        <p className="text-sm text-muted-foreground">Prenota i tuoi corsi</p>
      </div>
      <LeMieFisse fisse={fisse} onTermina={handleTermina} />
      <FisseContext.Provider value={{ prenotaFisso: handlePrenotaFisso, inCorso: actionLoading }}>
      <Tabs defaultValue="categorie">
        <TabsList className="w-full">
          <TabsTrigger value="categorie" className="flex-1">Categorie</TabsTrigger>
          <TabsTrigger value="calendario" className="flex-1">Calendario</TabsTrigger>
        </TabsList>
        <TabsContent value="categorie">
          <CoursesByCategory
            enrichedSessions={enrichedSessions}
            onBook={handleBook}
            onCancel={handleCancel}
            onBookAll={handleBookAll}
            onCancelAll={handleCancelAll}
            actionLoading={actionLoading}
          />
        </TabsContent>
        <TabsContent value="calendario">
          <CoursesByCalendar
            enrichedSessions={enrichedSessions}
            onBook={handleBook}
            onCancel={handleCancel}
            actionLoading={actionLoading}
          />
        </TabsContent>
      </Tabs>
      </FisseContext.Provider>
    </div>
  );
}