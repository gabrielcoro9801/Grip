import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { caricaAgenda, caricaCatalogo } from "@/core/api/portale";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitivi/tabs";
import { Button } from "@/ui/primitivi/button";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { ChevronDown, Repeat } from "lucide-react";
import { cn } from "@/ui/utils";
import { oggiIso, spostaGiorni } from "@/core/domain/giorni";
import { fasciaDelGiorno } from "@/core/domain/corsi";
import { formatData } from "@/core/domain/format";
import { usePalestra } from "@/member/components/Palestra";
import { Foglio, viva } from "@/member/components/lezioni";
import { CardLezione, useTocco, GIORNI } from "@/member/components/corsi";
import { FoglioFissa } from "@/member/components/fisse";

// Corsi (docs/piani/portale.md, D-3): «Calendario», la striscia dei 14 giorni con le lezioni del
// giorno per fasce, e «Per corso», le categorie a fisarmonica con gli orari. Si prenota con un
// tocco; il resto (lista d'attesa, la mia lezione) si apre in un foglio.

const GIORNI_STRISCIA = 14;
const FASCE = [["mattino", "Mattino"], ["pomeriggio", "Pomeriggio"], ["sera", "Sera"]];
const CHIAVE_APERTE = "grip_portale_categorie_aperte";

/** Le date dei 14 giorni, da oggi. */
const striscia = (oggi) => Array.from({ length: GIORNI_STRISCIA }, (_, i) => spostaGiorni(oggi, i));

function StrisciaGiorni({ giorni, scelto, onScegli, conPrenotazione }) {
  return (
    <div className="-mx-4 px-4 overflow-x-auto" role="group" aria-label="Giorno">
      <div className="flex gap-1.5 w-max pb-1">
        {giorni.map((g) => {
          const attivo = g === scelto;
          const [sett, num] = [formatData(g, "settimanaBreve"), formatData(g, "giornoNumero")];
          return (
            <button
              key={g} type="button" onClick={() => onScegli(g)} aria-pressed={attivo}
              aria-label={`${formatData(g, "estesaBreve")}${conPrenotazione.has(g) ? ", hai una prenotazione" : ""}`}
              className={cn(
                "w-12 h-16 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs border",
                attivo ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground",
              )}
            >
              <span className={cn("capitalize", !attivo && "text-muted-foreground")}>{sett}</span>
              <span className="text-base font-semibold tabular-nums">{num}</span>
              <span aria-hidden="true" className={cn("w-1.5 h-1.5 rounded-full", conPrenotazione.has(g) ? (attivo ? "bg-primary-foreground" : "bg-primary") : "bg-transparent")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ attivo, onClick, children, colore }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={attivo}
      className={cn(
        "min-h-11 px-3 rounded-full border text-sm whitespace-nowrap flex items-center gap-1.5",
        attivo ? "bg-primary/10 border-primary text-primary font-medium" : "bg-card border-border text-foreground",
      )}
    >
      {colore && <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ backgroundColor: colore }} />}
      {children}
    </button>
  );
}

function Calendario({ palestra, giornoIniziale }) {
  const oggi = oggiIso();
  const giorni = useMemo(() => striscia(oggi), [oggi]);
  const [scelto, setScelto] = useState(giorni.includes(giornoIniziale) ? giornoIniziale : oggi);
  const [agenda, setAgenda] = useState(null);
  const [errore, setErrore] = useState(null);
  const [categorie, setCategorie] = useState([]);
  const [soloConPosti, setSoloConPosti] = useState(false);

  // Un blocco di 14 giorni: la striscia intera, in una richiesta.
  const carica = useCallback(() => {
    setErrore(null);
    caricaAgenda({ dal: giorni[0], al: giorni.at(-1) }).then(setAgenda).catch(setErrore);
  }, [giorni]);
  useEffect(() => { carica(); }, [carica]);
  const { tocca, fogli, inCorso } = useTocco(carica, palestra);

  const tutte = useMemo(() => agenda?.giorni.flatMap((g) => g.lezioni) ?? [], [agenda]);
  const conPrenotazione = useMemo(() => new Set(tutte.filter((l) => viva(l.mia_prenotazione)).map((l) => l.data)), [tutte]);
  const categorieAgenda = useMemo(() => {
    const m = new Map();
    for (const l of tutte) if (l.categoria) m.set(l.categoria.id, l.categoria);
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [tutte]);

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!agenda) return <LoadingState minHeight="h-64" />;

  const delGiorno = tutte.filter((l) => l.data === scelto && !l.finita
    && (!categorie.length || categorie.includes(l.categoria?.id))
    && (!soloConPosti || !l.posti.al_completo || viva(l.mia_prenotazione)));
  const filtri = categorie.length > 0 || soloConPosti;
  const cambiaCategoria = (id) => setCategorie((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div className="space-y-4">
      <StrisciaGiorni giorni={giorni} scelto={scelto} onScegli={setScelto} conPrenotazione={conPrenotazione} />

      <div className="-mx-4 px-4 overflow-x-auto" role="group" aria-label="Filtri">
        <div className="flex gap-2 w-max">
          <Chip attivo={soloConPosti} onClick={() => setSoloConPosti((v) => !v)}>Solo con posti</Chip>
          {categorieAgenda.map((c) => (
            <Chip key={c.id} attivo={categorie.includes(c.id)} colore={c.colore} onClick={() => cambiaCategoria(c.id)}>{c.nome}</Chip>
          ))}
          {filtri && <Button variant="ghost" className="min-h-11" onClick={() => { setCategorie([]); setSoloConPosti(false); }}>Togli i filtri</Button>}
        </div>
      </div>

      <h2 className="text-base font-heading font-semibold first-letter:uppercase">{formatData(scelto, "estesaBreve")}</h2>
      {delGiorno.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {filtri ? "Nessuna lezione con questi filtri." : "Nessuna lezione in questo giorno."}
        </p>
      ) : (
        FASCE.map(([fascia, titolo]) => {
          const lezioni = delGiorno.filter((l) => fasciaDelGiorno(l.inizio) === fascia);
          if (!lezioni.length) return null;
          return (
            <section key={fascia} aria-label={titolo} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titolo}</h3>
              <ul className="space-y-2">
                {lezioni.map((l) => <CardLezione key={l.id} lezione={l} onTocca={tocca} inCorso={inCorso} />)}
              </ul>
            </section>
          );
        })
      )}
      {fogli}
    </div>
  );
}

const leggiAperte = () => { try { return JSON.parse(localStorage.getItem(CHIAVE_APERTE)); } catch { return null; } };
const salvaAperte = (ids) => { try { localStorage.setItem(CHIAVE_APERTE, JSON.stringify(ids)); } catch { /* niente: si riapre come prima */ } };

/** Il nome di un orario: «gio 12:15» per una sessione settimanale, la data per una singola. */
const nomeOrario = (o) => {
  const testo = `${o.giorno ? GIORNI[o.giorno]?.[1] ?? "" : formatData(o.prossima, "giorno")} ${o.inizio}`;
  return testo.charAt(0).toUpperCase() + testo.slice(1);
};

/** Il foglio di un orario: chi, dove, quanti posti, le prossime lezioni con il +, la fissa. */
function FoglioOrario({ orario, corso, palestra, onChiudi, onCambiato, onFissa }) {
  const [agenda, setAgenda] = useState(null);
  const carica = useCallback(() => {
    const oggi = oggiIso();
    caricaAgenda({ dal: oggi, al: spostaGiorni(oggi, 60), sessione: orario.sessione_id }).then(setAgenda).catch(() => setAgenda({ giorni: [] }));
  }, [orario.sessione_id]);
  useEffect(() => { carica(); }, [carica]);
  const { tocca, fogli, inCorso } = useTocco(() => { carica(); onCambiato(); }, palestra);
  const lezioni = (agenda?.giorni.flatMap((g) => g.lezioni) ?? []).filter((l) => !l.finita).slice(0, 8);
  const settimanale = orario.giorno && orario.ricorrenza !== "single";

  return (
    <Foglio
      aperto onChiudi={onChiudi}
      titolo={`${corso.nome} · ${settimanale ? `ogni ${GIORNI[orario.giorno][0]}` : formatData(orario.prossima, "estesaBreve")} ${orario.inizio}`}
      descrizione={[orario.sala?.nome, corso.istruttore?.nome, `${orario.capienza} posti`].filter(Boolean).join(" · ")}
    >
      {!agenda ? <LoadingState minHeight="h-24" /> : (
        <ul className="space-y-2">
          {lezioni.map((l) => <CardLezione key={l.id} lezione={l} onTocca={tocca} inCorso={inCorso} conGiorno />)}
        </ul>
      )}
      {settimanale && (orario.mia_fissa ? (
        <p className="text-sm text-primary flex items-center gap-2"><Repeat className="w-4 h-4" aria-hidden="true" /> È una tua prenotazione fissa: la trovi in Le mie lezioni.</p>
      ) : (
        <Button variant="outline" className="min-h-11" onClick={onFissa}>
          <Repeat className="w-4 h-4" aria-hidden="true" /> Prenota ogni {GIORNI[orario.giorno][0]}
        </Button>
      ))}
      {fogli}
    </Foglio>
  );
}

function PerCorso({ palestra }) {
  const [catalogo, setCatalogo] = useState(null);
  const [errore, setErrore] = useState(null);
  const [aperte, setAperte] = useState(null);
  const [orario, setOrario] = useState(null);
  // «Prenota ogni giovedì»: il foglio dell'orario lascia il posto a quello della fissa.
  const [fissaDa, setFissaDa] = useState(null);

  const carica = useCallback(() => {
    setErrore(null);
    caricaCatalogo().then((c) => {
      setCatalogo(c);
      // All'ingresso: quelle aperte l'ultima volta, o la categoria della mia ultima prenotazione.
      setAperte((a) => a ?? leggiAperte() ?? (c.categoria_recente ? [c.categoria_recente] : []));
    }).catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!catalogo) return <LoadingState minHeight="h-64" />;
  if (!catalogo.categorie.length) return <p className="text-sm text-muted-foreground py-6 text-center">Nessun corso in programma.</p>;

  const apriChiudi = (id) => setAperte((a) => {
    const nuove = a.includes(id) ? a.filter((x) => x !== id) : [...a, id];
    salvaAperte(nuove);
    return nuove;
  });

  return (
    <div className="space-y-2">
      {catalogo.categorie.map((cat) => {
        const aperta = aperte.includes(cat.id);
        const nOrari = cat.corsi.reduce((n, c) => n + c.orari.length, 0);
        return (
          <section key={cat.id} className="rounded-lg bg-card shadow-sm">
            <h2>
              <button
                type="button" onClick={() => apriChiudi(cat.id)} aria-expanded={aperta}
                className="w-full min-h-14 px-4 py-3 flex items-center gap-3 text-left"
              >
                <span aria-hidden="true" className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.colore }} />
                <span className="flex-1 min-w-0">
                  <span className="block font-heading font-semibold">{cat.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {cat.corsi.length} {cat.corsi.length === 1 ? "corso" : "corsi"} · {nOrari} {nOrari === 1 ? "orario" : "orari"}
                  </span>
                </span>
                <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform", aperta && "rotate-180")} aria-hidden="true" />
              </button>
            </h2>
            {aperta && (
              <div className="px-4 pb-4 space-y-4">
                {cat.corsi.map((corso) => (
                  <div key={corso.id}>
                    <p className="text-sm font-semibold">{corso.nome}</p>
                    {corso.istruttore && <p className="text-xs text-muted-foreground">{corso.istruttore.nome}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {corso.orari.map((o) => (
                        <Chip key={o.sessione_id} attivo={o.mia_fissa} onClick={() => setOrario({ orario: o, corso })}>
                          <span>{nomeOrario(o)}</span>
                          {o.mia_fissa && <span className="text-xs">· Fissa</span>}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {orario && (
        <FoglioOrario
          {...orario} palestra={palestra} onChiudi={() => setOrario(null)} onCambiato={carica}
          onFissa={() => { setFissaDa(orario); setOrario(null); }}
        />
      )}
      {fissaDa && (
        <FoglioFissa
          sessione={{ id: fissaDa.orario.sessione_id, corso: fissaDa.corso.nome, giorno: fissaDa.orario.giorno, inizio: fissaDa.orario.inizio }}
          onChiudi={() => setFissaDa(null)} onFatto={carica}
        />
      )}
    </div>
  );
}

export default function MemberCoursesCalendar() {
  const palestra = usePalestra();
  const [parametri] = useSearchParams();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-heading font-bold">Corsi</h1>
      {/* Si apre sui giorni, a partire da oggi: chi entra qui vuole sapere che cosa c'è e prenotare. */}
      <Tabs defaultValue="calendario">
        <TabsList className="w-full h-auto">
          <TabsTrigger value="calendario" className="flex-1">Calendario</TabsTrigger>
          <TabsTrigger value="categorie" className="flex-1">Per corso</TabsTrigger>
        </TabsList>
        <TabsContent value="calendario"><Calendario palestra={palestra} giornoIniziale={parametri.get("giorno")} /></TabsContent>
        <TabsContent value="categorie"><PerCorso palestra={palestra} /></TabsContent>
      </Tabs>
    </div>
  );
}
