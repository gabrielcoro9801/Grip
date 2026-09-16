import React, { useState } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { caricaFile } from "@/staff/lib/uploads";
import { logAction } from "@/staff/lib/auditLog";
import { formatData, giorniAllaData } from "@/core/domain/format";
import { TIPI_DOCUMENTO, nomeDocumento, motivoDocumentoNonValido } from "@/core/domain/anagrafica";
import { FileText, Plus, ExternalLink } from "lucide-react";

const FORMATI = "application/pdf,image/png,image/jpeg,image/webp";

function BadgeScadenza({ scadenza }) {
  const giorni = giorniAllaData(scadenza);
  if (giorni === null) return null;
  const tono = giorni < 0
    ? "bg-destructive/10 text-destructive border-destructive/30"
    : giorni < 30
      ? "bg-warning/10 text-warning border-warning/30"
      : "bg-success/10 text-success border-success/30";
  return (
    <Badge variant="outline" className={`text-xs ${tono}`}>
      {giorni < 0 ? "Scaduto" : `${giorni}g residui`}
    </Badge>
  );
}

/**
 * I documenti di un socio, in tre sezioni: certificato medico, documento di identità, altri.
 *
 * I primi due si aspettano: se mancano la sezione lo dice, perché senza certificato non ci si
 * allena e senza documento non si tessera. Gli altri si caricano quando servono, e una sezione
 * vuota non segnala niente.
 *
 * Prima la finestra "Carica" salvava solo il nome del file, senza file: il documento risultava
 * presente e non si poteva aprire. Ora il file si carica davvero.
 */
export default function DocumentiSocio({ socio, documenti, puoModificare, staffUser, onCambio }) {
  const { toast } = useToast();
  const [modulo, setModulo] = useState(null); // { document_type, titolo, expiry_date, notes, file }
  const [salvando, setSalvando] = useState(false);

  const apri = (tipo) => setModulo({ document_type: tipo, titolo: "", expiry_date: "", notes: "", file: null });

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

  const motivo = modulo ? (modulo.file ? motivoDocumentoNonValido(modulo) : "Scegli il file da caricare.") : null;
  const tipoInModulo = TIPI_DOCUMENTO.find((t) => t.valore === modulo?.document_type);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-heading flex items-center gap-2"><FileText className="w-4 h-4" /> Documenti</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {TIPI_DOCUMENTO.map((tipo) => {
          const elenco = documenti
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
                        <p className="text-sm font-medium truncate">{nomeDocumento(doc)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {doc.file_name || "Nessun file"} · caricato il {formatData(doc.created_date, "giornoBreve")}
                          {doc.expiry_date ? ` · scade il ${formatData(doc.expiry_date, "breve")}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <BadgeScadenza scadenza={doc.expiry_date} />
                        {doc.file_url && (
                          <Button asChild size="sm" variant="outline" className="h-8">
                            <a href={doc.file_url} target="_blank" rel="noreferrer">
                              <ExternalLink className="w-3 h-3 mr-1" aria-hidden="true" /> Apri
                            </a>
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
              <div>
                <Label htmlFor="doc-note">Note</Label>
                <Input id="doc-note" value={modulo.notes} onChange={(e) => setModulo({ ...modulo, notes: e.target.value })} />
              </div>
              {motivo && <p className="text-xs text-muted-foreground">{motivo}</p>}
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
