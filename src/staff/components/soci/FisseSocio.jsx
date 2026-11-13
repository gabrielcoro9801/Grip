import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { useToast } from "@/ui/primitivi/use-toast";
import { nomeGiorno, hhmm } from "@/staff/lib/modificaEvento";
import { periodoFissa } from "@/staff/lib/fisse";
import FissaFormDialog from "@/staff/components/courses/FissaFormDialog";
import CancellaFissaDialog from "@/staff/components/courses/CancellaFissaDialog";
import { Pencil, Plus, Repeat } from "lucide-react";

/** La sessione di una fissa, come la vuole la finestra della fissa. */
const sessioneDella = (f) => ({ id: f.event_id, corso: f.corso, giorno: f.giorno, start_time: f.inizio, end_time: f.fine });

/**
 * Le prenotazioni fisse di un socio, nella sua scheda: quelle in corso, aggiungerne una per suo
 * conto, cambiarne il periodo, cancellarla da un giorno in poi. Le finestre sono le stesse di
 * Sessioni (FissaFormDialog, CancellaFissaDialog): qui il socio è fisso e la sessione si sceglie.
 *
 * Le lezioni le prenota il server con le regole di sempre: capienza, lista d'attesa, abbonamento
 * valido quel giorno.
 */
export default function FisseSocio({ socio, puoModificare }) {
  const { toast } = useToast();
  const [fisse, setFisse] = useState(null);
  const [sessioni, setSessioni] = useState([]);
  const [nuova, setNuova] = useState(false);
  const [inModifica, setInModifica] = useState(null);
  const [daCancellare, setDaCancellare] = useState(null);

  const carica = useCallback(() => {
    api.prenotazioniFisse.elenco({ member_id: socio.id }).then((r) => setFisse(r.fisse)).catch(() => setFisse([]));
  }, [socio.id]);
  useEffect(() => { carica(); }, [carica]);

  // Le sessioni che si possono prenotare fisse: quelle in corso.
  const apri = async () => {
    try {
      const { sessioni: inCorso } = await api.calendario.sessioni();
      setSessioni(inCorso);
      setNuova(true);
    } catch (err) {
      toast({ title: "Sessioni non caricate", description: err.message, variant: "destructive" });
    }
  };

  const giaConFissa = useMemo(() => new Set((fisse ?? []).map((f) => f.event_id)), [fisse]);
  const conSocio = useMemo(() => ({ id: socio.id, full_name: socio.full_name }), [socio.id, socio.full_name]);
  // Un oggetto fermo: la finestra si riempie di nuovo quando cambia la sessione.
  const sessioneInModifica = useMemo(() => (inModifica ? sessioneDella(inModifica) : null), [inModifica]);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-heading flex items-center gap-2"><Repeat className="w-4 h-4" aria-hidden="true" /> Prenotazioni fisse</CardTitle>
        {puoModificare && !socio.archiviato_il && (
          <Button size="sm" variant="outline" className="h-8" onClick={apri}><Plus className="w-3 h-3 mr-1" aria-hidden="true" /> Nuova</Button>
        )}
      </CardHeader>
      <CardContent>
        {fisse === null ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : fisse.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">Nessuna prenotazione fissa</p>
        ) : (
          <ul className="space-y-2">
            {fisse.map((f) => (
              <li key={f.id} className="p-3 rounded-lg bg-muted/50 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{f.corso}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.giorno ? `Ogni ${nomeGiorno(f.giorno)}` : "Date scelte"} · {hhmm(f.inizio)}–{hhmm(f.fine)} · {periodoFissa(f)}
                    {f.creata_da ? ` · attivata da ${f.creata_da}` : ""}
                  </p>
                </div>
                {puoModificare && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setInModifica(f)}>
                      <Pencil className="w-3 h-3 mr-1" aria-hidden="true" /> Modifica
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={() => setDaCancellare(f)}>Cancella</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {puoModificare && (
        <>
          <FissaFormDialog
            open={nuova} onClose={() => setNuova(false)}
            socio={conSocio} sessioni={sessioni} giaConFissa={giaConFissa} onSalvata={carica}
          />
          <FissaFormDialog
            open={!!inModifica} onClose={() => setInModifica(null)}
            socio={conSocio} sessione={sessioneInModifica} fissa={inModifica} onSalvata={carica}
          />
          <CancellaFissaDialog fissa={daCancellare} onClose={() => setDaCancellare(null)} onCancellata={carica} />
        </>
      )}
    </Card>
  );
}
