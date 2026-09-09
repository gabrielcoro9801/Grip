import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Paperclip, Download, Trash2, Upload, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import moment from "moment";
import { formatData } from "@/lib/format";

/**
 * Documenti allegati a una scrittura contabile.
 *
 * Una scrittura può averne più d'uno: una registrazione aggregata — gli stipendi del mese,
 * un pagamento cumulativo a un fornitore — porta con sé un documento per ciascuna delle
 * voci che la compongono. È così che il registro resta leggibile senza perdere il dettaglio.
 */
export default function AllegatiScrittura({ entry, caricatoDa, onChange }) {
  const { toast } = useToast();
  const [allegati, setAllegati] = useState([]);
  const [aperto, setAperto] = useState(false);
  const [caricamento, setCaricamento] = useState(false);
  const [descrizione, setDescrizione] = useState("");
  const inputFile = useRef(null);

  const carica = useCallback(async () => {
    if (!entry?.id) return;
    const a = await api.entities.JournalAttachment.filter({ journal_entry_id: entry.id }, "created_date");
    setAllegati(a);
  }, [entry?.id]);

  useEffect(() => { if (aperto) carica(); }, [aperto, carica]);
  useEffect(() => { carica(); }, [carica]);

  const allega = async (file) => {
    if (!file) return;
    setCaricamento(true);
    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      await api.entities.JournalAttachment.create({
        journal_entry_id: entry.id,
        file_url,
        file_name: file.name,
        descrizione: descrizione || null,
        caricato_da: caricatoDa || null,
      });
      setDescrizione("");
      if (inputFile.current) inputFile.current.value = "";
      await carica();
      onChange?.();
      toast({ title: "Documento allegato" });
    } catch (err) {
      toast({ title: "Allegato non caricato", description: err.message, variant: "destructive" });
    }
    setCaricamento(false);
  };

  const rimuovi = async (a) => {
    try {
      await api.entities.JournalAttachment.delete(a.id);
      await carica();
      onChange?.();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setAperto(true)}
        title={allegati.length ? `${allegati.length} documenti allegati` : "Allega un documento"}
      >
        <Paperclip className="w-3.5 h-3.5" />
        {allegati.length > 0 && <span className="ml-1">{allegati.length}</span>}
      </Button>

      <Dialog open={aperto} onOpenChange={setAperto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Documenti della registrazione</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {entry?.descrizione || entry?.causale} — {formatData(entry?.data_competenza)}
            </p>

            {allegati.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nessun documento allegato</p>
            ) : (
              <div className="space-y-2">
                {allegati.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg border border-border">
                    <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{a.descrizione || a.file_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {a.descrizione ? `${a.file_name} · ` : ""}
                        {formatData(a.created_date)}
                        {a.caricato_da ? ` · ${a.caricato_da}` : ""}
                      </p>
                    </div>
                    <a href={a.file_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-7 w-7"><Download className="w-3.5 h-3.5" /></Button>
                    </a>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => rimuovi(a)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 pt-3 border-t border-border">
              <div>
                <Label className="text-xs">Descrizione (facoltativa)</Label>
                <Input
                  value={descrizione}
                  onChange={(e) => setDescrizione(e.target.value)}
                  placeholder="es. Cedolino Mario Rossi"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Utile quando la registrazione ha più documenti: distingue a cosa si riferisce ciascuno.
                </p>
              </div>
              <input
                ref={inputFile}
                type="file"
                className="hidden"
                accept=".pdf,image/*"
                onChange={(e) => allega(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={caricamento}
                onClick={() => inputFile.current?.click()}
              >
                <Upload className="w-4 h-4 mr-1" />
                {caricamento ? "Caricamento…" : "Allega documento"}
              </Button>
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                PDF o immagini, fino a 10 MB.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
