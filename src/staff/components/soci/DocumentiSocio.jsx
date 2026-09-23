import React, { useMemo, useState } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { useConfirm } from "@/ui/ConfirmDialog";
import { caricaFile } from "@/staff/lib/uploads";
import { logAction } from "@/staff/lib/auditLog";
import { formatData, giorniAllaData } from "@/core/domain/format";
import {
  TIPI_DOCUMENTO,
  nomeDocumento,
  motivoDocumentoNonValido,
  conStatoDocumenti,
  etichettaStatoDocumento,
} from "@/core/domain/anagrafica";
import { Archive, ArrowDown, ArrowUp, FileText, Plus, Trash2 } from "lucide-react";

const FORMATI = "application/pdf,image/png,image/jpeg,image/webp";

const TONO_STATO = {
  valido: "bg-success/10 text-success border-success/30",
  in_scadenza: "bg-warning/10 text-warning border-warning/30",
  scaduto: "bg-destructive/10 text-destructive border-destructive/30",
  archiviato: "bg-muted text-muted-foreground border-border",
};

/** Il bollino colorato: quattro stati, e per quello in scadenza anche quanto manca. */
function BollinoStato({ stato, giorni }) {
  const testo = stato === "in_scadenza" ? `In scadenza (${giorni}g)` : etichettaStatoDocumento(stato);
  return <Badge variant="outline" className={`text-xs whitespace-nowrap ${TONO_STATO[stato]}`}>{testo}</Badge>;
}

/** La riga sotto il nome: solo la scadenza, che è l'unica cosa che si va a cercare. */
function rigaScadenza(doc) {
  return doc.expiry_date
    ? `Scade il ${formatData(doc.expiry_date, "breve")}`
    : "Documento senza data di scadenza";
}

/** Il nome del documento apre il file; senza file resta testo, perché non c'è niente da aprire. */
function NomeDocumento({ doc }) {
  if (!doc.file_url) return <p className="text-sm font-medium truncate">{nomeDocumento(doc)}</p>;
  return (
    <a
      href={doc.file_url}
      target="_blank"
      rel="noreferrer"
      title="Apri il documento"
      className="block text-sm font-medium truncate text-primary hover:underline"
    >
      {nomeDocumento(doc)}
    </a>
  );
}

// Come si ordina l'archivio. Le date si confrontano come stringhe ISO, che si ordinano da
// sole senza passare da `Date`: qui arrivano dal JSON dell'API, e "2026-01-09" < "2026-01-10"
// è già vero così.
//
// `predefinito` è il verso che si ottiene al primo clic su una colonna: per un nome si parte
// dalla A, per una data dalla più recente, che è quello che si cerca quando si apre l'archivio.
const ORDINAMENTI = {
  nome: {
    etichetta: "Documento",
    predefinito: "asc",
    versi: { asc: "A-Z", desc: "Z-A" },
    confronta: (a, b) => nomeDocumento(a).localeCompare(nomeDocumento(b), "it"),
  },
  caricamento: {
    etichetta: "Caricato il",
    predefinito: "desc",
    versi: { asc: "dal più vecchio", desc: "dal più recente" },
    confronta: (a, b) => String(a.created_date ?? "").localeCompare(String(b.created_date ?? "")),
  },
  scadenza: {
    etichetta: "Scaduto il",
    predefinito: "desc",
    versi: { asc: "dal più lontano", desc: "dal più recente" },
    confronta: (a, b) => String(a.expiry_date ?? "").localeCompare(String(b.expiry_date ?? "")),
  },
};

/** Il verso che si ottiene cliccando una colonna: si inverte se è già quella che ordina. */
function prossimoVerso(campo, ordine) {
  if (ordine.campo !== campo) return ORDINAMENTI[campo].predefinito;
  return ordine.verso === "asc" ? "desc" : "asc";
}

/** Un'intestazione della tabella su cui si clicca per ordinare, e che dice come sta ordinando. */
function IntestazioneOrdinabile({ campo, ordine, onOrdina }) {
  const { etichetta, versi } = ORDINAMENTI[campo];
  const attivo = ordine.campo === campo;
  const Freccia = attivo && ordine.verso === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={attivo ? (ordine.verso === "asc" ? "ascending" : "descending") : "none"}
      className="text-left font-medium p-0"
    >
      <button
        type="button"
        onClick={() => onOrdina(campo)}
        title={`Ordina ${versi[prossimoVerso(campo, ordine)]}`}
        aria-label={`${etichetta}: ordina ${versi[prossimoVerso(campo, ordine)]}`}
        className="w-full flex items-center gap-1 px-3 py-2 hover:text-foreground transition-colors"
      >
        {etichetta}
        <Freccia className={`w-3 h-3 ${attivo ? "opacity-100" : "opacity-25"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

/**
 * I documenti di un socio, in tre sezioni: certificato medico, documento di identità, altri.
 *
 * I primi due si aspettano: se mancano la sezione lo dice, perché senza certificato non ci si
 * allena e senza documento non si tessera. Gli altri si caricano quando servono, e una sezione
 * vuota non segnala niente.
 *
 * Quello che è scaduto e sostituito esce di qui e finisce in archivio, dietro il pulsante in
 * alto: la regola sta in `shared/anagrafica.js`, insieme al motivo per cui certificato e
 * documento di identità scaduti restano in vista finché non ne arriva uno nuovo.
 */
export default function DocumentiSocio({ socio, documenti, puoModificare, staffUser, onCambio }) {
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [modulo, setModulo] = useState(null); // { document_type, titolo, expiry_date, file }
  const [salvando, setSalvando] = useState(false);
  const [archivioAperto, setArchivioAperto] = useState(false);
  const [ordine, setOrdine] = useState({ campo: "caricamento", verso: "desc" });

  const conStato = useMemo(() => conStatoDocumenti(documenti, giorniAllaData), [documenti]);
  const inVista = conStato.filter((d) => d.stato !== "archiviato");
  const archiviati = useMemo(() => {
    const { confronta } = ORDINAMENTI[ordine.campo];
    const segno = ordine.verso === "asc" ? 1 : -1;
    return conStato.filter((d) => d.stato === "archiviato").sort((a, b) => segno * confronta(a, b));
  }, [conStato, ordine]);

  const ordinaPer = (campo) => setOrdine((corrente) => ({ campo, verso: prossimoVerso(campo, corrente) }));

  const apri = (tipo) => setModulo({ document_type: tipo, titolo: "", expiry_date: "", file: null });

  const salva = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const { file, ...dati } = modulo;
      const { file_url } = await caricaFile({ file });
      await api.entities.MemberDocument.create({
        ...dati,
        member_id: socio.id,
        file_url,
        file_name: file.name,
        caricato_da: staffUser?.nome || "",
      });
      await logAction(staffUser, "create", "member", `Documento — ${socio.full_name}`, socio.id, nomeDocumento(dati));
      toast({ title: "Documento caricato" });
      setModulo(null);
      onCambio();
    } catch (err) {
      toast({ title: "Documento non caricato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const elimina = async (doc) => {
    const ok = await conferma({
      title: `Eliminare «${nomeDocumento(doc)}»?`,
      description: "Il documento sparisce dalla scheda e dal portale del socio. Non si può recuperare.",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.entities.MemberDocument.delete(doc.id);
      await logAction(staffUser, "delete", "member", `Documento — ${socio.full_name}`, socio.id, nomeDocumento(doc));
      toast({ title: "Documento eliminato" });
      onCambio();
    } catch (err) {
      toast({ title: "Non è stato possibile eliminare", description: err.message, variant: "destructive" });
    }
  };

  const motivo = modulo ? (modulo.file ? motivoDocumentoNonValido(modulo) : "Scegli il file da caricare.") : null;
  const tipoInModulo = TIPI_DOCUMENTO.find((t) => t.valore === modulo?.document_type);

  return (
    <Card className="border-0 shadow-sm">
      {dialogoConferma}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-heading flex items-center gap-2"><FileText className="w-4 h-4" /> Documenti</CardTitle>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setArchivioAperto(true)}>
            <Archive className="w-3 h-3 mr-1" aria-hidden="true" /> Archivio
            {archiviati.length > 0 && <span className="ml-1 text-muted-foreground">({archiviati.length})</span>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {TIPI_DOCUMENTO.map((tipo) => {
          const elenco = inVista
            .filter((d) => d.document_type === tipo.valore)
            .sort((a, b) => String(b.created_date).localeCompare(String(a.created_date)));
          return (
            <section key={tipo.valore} aria-labelledby={`doc-${tipo.valore}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 id={`doc-${tipo.valore}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {tipo.etichetta}
                </h3>
                {puoModificare && (
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => apri(tipo.valore)}>
                    <Plus className="w-3 h-3 mr-1" /> Carica
                  </Button>
                )}
              </div>
              {elenco.length === 0 ? (
                tipo.atteso
                  ? <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">Mancante</p>
                  : <p className="text-sm text-muted-foreground">Nessun documento</p>
              ) : (
                <ul className="space-y-2">
                  {elenco.map((doc) => (
                    <li key={doc.id} className="p-3 rounded-lg bg-muted/50 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <NomeDocumento doc={doc} />
                        <p className="text-xs text-muted-foreground truncate">{rigaScadenza(doc)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <BollinoStato stato={doc.stato} giorni={doc.giorni_alla_scadenza} />
                        {puoModificare && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            aria-label={`Elimina ${nomeDocumento(doc)}`}
                            onClick={() => elimina(doc)}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </CardContent>

      <Dialog open={archivioAperto} onOpenChange={setArchivioAperto}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Archivio documenti — {socio.full_name}</DialogTitle>
          </DialogHeader>
          {archiviati.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nessun documento in archivio: ci finiscono quando scadono e ne arriva uno nuovo.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <IntestazioneOrdinabile campo="nome" ordine={ordine} onOrdina={ordinaPer} />
                    <IntestazioneOrdinabile campo="caricamento" ordine={ordine} onOrdina={ordinaPer} />
                    <IntestazioneOrdinabile campo="scadenza" ordine={ordine} onOrdina={ordinaPer} />
                    <th scope="col" className="w-20 px-3 py-2"><span className="sr-only">Azioni</span></th>
                  </tr>
                </thead>
                <tbody>
                  {archiviati.map((doc) => (
                    <tr key={doc.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{nomeDocumento(doc)}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatData(doc.created_date, "breve")}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatData(doc.expiry_date, "breve")}</td>
                      <td className="px-3 py-2 text-right">
                        {doc.file_url && (
                          <Button asChild size="sm" variant="outline" className="h-8">
                            <a href={doc.file_url} target="_blank" rel="noreferrer">Apri</a>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!modulo} onOpenChange={(aperto) => !aperto && setModulo(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Carica — {tipoInModulo?.etichetta}</DialogTitle></DialogHeader>
          {modulo && (
            <form onSubmit={salva} className="space-y-3">
              {modulo.document_type === "altro" && (
                <div>
                  <Label htmlFor="doc-titolo">Che documento è *</Label>
                  <Input id="doc-titolo" required placeholder="Es. Contratto, Modulo tesseramento" value={modulo.titolo} onChange={(e) => setModulo({ ...modulo, titolo: e.target.value })} />
                </div>
              )}
              <div>
                <Label htmlFor="doc-file">File *</Label>
                <Input id="doc-file" type="file" accept={FORMATI} required onChange={(e) => setModulo({ ...modulo, file: e.target.files?.[0] ?? null })} />
                <p className="text-xs text-muted-foreground mt-1">PDF o immagine</p>
              </div>
              <div>
                <Label htmlFor="doc-scadenza">Data di scadenza{tipoInModulo?.scadenza ? " *" : ""}</Label>
                <Input id="doc-scadenza" type="date" required={tipoInModulo?.scadenza} value={modulo.expiry_date} onChange={(e) => setModulo({ ...modulo, expiry_date: e.target.value })} />
              </div>
              {/* `motivo` non si scrive: gli asterischi dicono già cosa manca, e il pulsante
                  spento lo conferma. Resta a tenere spento il pulsante. */}
              <Button type="submit" className="w-full" disabled={Boolean(motivo) || salvando}>
                {salvando ? "Caricamento..." : "Carica documento"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
