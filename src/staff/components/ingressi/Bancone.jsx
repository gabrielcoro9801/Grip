import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Card, CardContent } from "@/ui/primitivi/card";
import { AvatarSocio } from "@/staff/components/soci/FotoSocio";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatDataOra } from "@/core/domain/format";
import LettoreQr from "./LettoreQr";
import { Camera, CheckCircle2, AlertTriangle, XCircle, Search, ScanLine } from "lucide-react";

// Il semaforo: colore di stato, icona ed etichetta insieme, mai il colore da solo.
const SEMAFORO = {
  verde: { etichetta: "In regola", icona: CheckCircle2, classi: "border-success/40 bg-success/10", testo: "text-success" },
  giallo: { etichetta: "Entra, ma c'è da sistemare", icona: AlertTriangle, classi: "border-warning/40 bg-warning/10", testo: "text-warning" },
  rosso: { etichetta: "Non in regola", icona: XCircle, classi: "border-destructive/40 bg-destructive/10", testo: "text-destructive" },
};
const ESITI = { ammesso: "In regola", ammesso_con_avvisi: "Con avvisi", ammesso_in_deroga: "In deroga" };
const TONO_ESITO = { ammesso: "text-success", ammesso_con_avvisi: "text-warning", ammesso_in_deroga: "text-destructive" };
// Chi è entrato da poco non si registra di nuovo: un telefono letto due volte resta un ingresso.
const MINUTI_DOPPIO = 15;
const ora = (quando) => new Date(quando).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

/**
 * Il bancone: si legge il QR (lettore USB, fotocamera) o si cerca il socio per nome, si vede chi è
 * e se è in regola, e l'ingresso si registra. Verde e giallo da soli; rosso solo se la reception
 * decide di farlo entrare lo stesso (deroga), oppure "Non entra".
 */
export default function Bancone({ puoRegistrare }) {
  const { toast } = useToast();
  const campo = useRef(null);
  const [codice, setCodice] = useState("");
  const [fotocamera, setFotocamera] = useState(false);
  const [scheda, setScheda] = useState(null); // la risposta di verifica
  const [esito, setEsito] = useState(null); // { registrato, alle, doppio }
  const [lavoro, setLavoro] = useState(false);
  const [oggi, setOggi] = useState([]);
  const [soci, setSoci] = useState(null);
  const [cerca, setCerca] = useState("");

  const caricaOggi = useCallback(() => api.ingressi.elenco().then((r) => setOggi(r.ingressi)).catch(() => {}), []);
  useEffect(() => { caricaOggi(); }, [caricaOggi]);
  const rifocalizza = () => setTimeout(() => campo.current?.focus(), 50);

  const registra = async (risposta, deroga = false) => {
    if (!puoRegistrare) return;
    const recente = risposta.ultimo_ingresso && (Date.now() - new Date(risposta.ultimo_ingresso).getTime()) < MINUTI_DOPPIO * 60_000;
    if (recente && !deroga) { setEsito({ doppio: true, alle: risposta.ultimo_ingresso }); return; }
    try {
      const { ingresso } = await api.ingressi.registra({ member_id: risposta.socio.id, metodo: risposta.metodo, deroga });
      setEsito({ registrato: true, alle: ingresso.entrato_alle, esito: ingresso.esito });
      caricaOggi();
    } catch (err) {
      toast({ title: "Ingresso non registrato", description: err.message, variant: "destructive" });
    }
  };

  const verifica = async (corpo) => {
    setLavoro(true);
    setEsito(null);
    try {
      const risposta = await api.ingressi.verifica(corpo);
      if (!risposta.valido) {
        setScheda({ valido: false, motivo: risposta.motivo });
      } else {
        setScheda(risposta);
        if (risposta.semaforo !== "rosso") await registra(risposta);
      }
    } catch (err) {
      toast({ title: "Verifica non riuscita", description: err.message, variant: "destructive" });
    }
    setLavoro(false);
    setCodice("");
    rifocalizza();
  };

  const daFotocamera = useCallback((letto) => { setFotocamera(false); verifica({ codice: letto }); }, []);

  // La ricerca per nome: per chi ha il telefono scarico o non usa il portale.
  useEffect(() => {
    if (cerca.trim().length < 2 || soci) return;
    api.entities.Member.list().then((m) => setSoci(m.filter((s) => !s.archiviato_il))).catch(() => setSoci([]));
  }, [cerca, soci]);
  const trovati = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    if (t.length < 2 || !soci) return [];
    return soci.filter((s) => `${s.full_name} ${s.codice_socio}`.toLowerCase().includes(t)).slice(0, 6);
  }, [cerca, soci]);

  const stato = scheda?.valido ? SEMAFORO[scheda.semaforo] : null;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-6">
      <div className="space-y-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <form onSubmit={(e) => { e.preventDefault(); if (codice.trim()) verifica({ codice }); }} className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                {/* Sempre a fuoco: i lettori USB scrivono qui e premono Invio. */}
                <Input
                  ref={campo} autoFocus value={codice} onChange={(e) => setCodice(e.target.value)}
                  placeholder="QR o codice del socio" className="pl-9 font-mono" aria-label="Codice QR"
                />
              </div>
              <Button type="submit" disabled={lavoro || !codice.trim()}>Verifica</Button>
              <Button type="button" variant="outline" onClick={() => setFotocamera((f) => !f)} aria-pressed={fotocamera}>
                <Camera className="w-4 h-4 mr-1" /> Fotocamera
              </Button>
            </form>
            {fotocamera && <LettoreQr onCodice={daFotocamera} onChiudi={() => setFotocamera(false)} />}
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="…oppure cerca per nome" className="pl-9" aria-label="Cerca socio per nome" />
              {trovati.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
                  {trovati.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                        onClick={() => { setCerca(""); verifica({ member_id: s.id }); }}
                      >
                        {s.full_name} <span className="text-xs text-muted-foreground font-mono">{s.codice_socio}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {scheda && !scheda.valido && (
          <div className={`rounded-xl border-2 p-5 ${SEMAFORO.rosso.classi}`} role="status">
            <p className="font-semibold flex items-center gap-2 text-destructive"><XCircle className="w-5 h-5" aria-hidden="true" /> {scheda.motivo}</p>
          </div>
        )}

        {stato && (
          <div className={`rounded-xl border-2 p-5 space-y-4 ${stato.classi}`} role="status" aria-live="polite">
            <div className="flex items-center gap-4">
              <AvatarSocio socio={{ full_name: scheda.socio.nome, foto_url: scheda.socio.foto_url }} size="lg" />
              <div className="min-w-0">
                <p className={`text-sm font-semibold flex items-center gap-1.5 ${stato.testo}`}><stato.icona className="w-4 h-4" aria-hidden="true" /> {stato.etichetta}</p>
                <Link to={`/crm/soci/${scheda.socio.id}`} className="text-2xl font-heading font-bold hover:underline">{scheda.socio.nome}</Link>
                <p className="text-xs text-muted-foreground font-mono">{scheda.socio.codice_socio}</p>
              </div>
            </div>
            {scheda.avvisi.length > 0 && (
              <ul className="space-y-1.5">
                {scheda.avvisi.map((a) => (
                  <li key={a.codice} className="text-sm flex items-start gap-2">
                    {a.gravita === "rosso"
                      ? <XCircle className="w-4 h-4 mt-0.5 text-destructive shrink-0" aria-hidden="true" />
                      : <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" aria-hidden="true" />}
                    <span><span className="font-medium">{a.titolo}.</span> {a.testo}</span>
                  </li>
                ))}
              </ul>
            )}
            {scheda.lezioni_oggi.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Oggi: {scheda.lezioni_oggi.map((l) => `${l.corso} alle ${l.inizio}${l.stato === "waitlisted" ? " (in lista d'attesa)" : ""}`).join(", ")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {esito?.registrato && <p className="text-sm font-medium">Ingresso registrato alle {ora(esito.alle)}.</p>}
              {esito?.doppio && (
                <>
                  <p className="text-sm">Già registrato alle {ora(esito.alle)}.</p>
                  {puoRegistrare && <Button size="sm" variant="outline" onClick={() => registra({ ...scheda, ultimo_ingresso: null })}>Registra di nuovo</Button>}
                </>
              )}
              {!esito && scheda.semaforo === "rosso" && puoRegistrare && (
                <>
                  <Button size="sm" variant="destructive" onClick={() => registra(scheda, true)}>Fai entrare comunque</Button>
                  <Button size="sm" variant="outline" onClick={() => { setScheda(null); rifocalizza(); }}>Non entra</Button>
                </>
              )}
              {!puoRegistrare && <p className="text-sm text-muted-foreground">Il tuo ruolo verifica, ma non registra gli ingressi.</p>}
            </div>
          </div>
        )}
      </div>

      <Card className="border-0 shadow-sm self-start">
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold mb-2">Ingressi di oggi <span className="text-muted-foreground font-normal">({oggi.length})</span></h2>
          {oggi.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ancora nessuno.</p>
          ) : (
            <ul className="divide-y divide-border max-h-[28rem] overflow-y-auto">
              {oggi.map((i) => (
                <li key={i.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <Link to={`/crm/soci/${i.member_id}`} className="truncate hover:underline">{i.nome}</Link>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs ${TONO_ESITO[i.esito]}`} title={formatDataOra(i.entrato_alle)}>{ESITI[i.esito]}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{ora(i.entrato_alle)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
