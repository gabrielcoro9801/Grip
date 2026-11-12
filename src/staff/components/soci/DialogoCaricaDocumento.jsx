import React, { useEffect, useState } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { caricaFile } from "@/staff/lib/uploads";
import { TIPI_DOCUMENTO, motivoDocumentoNonValido } from "@/core/domain/anagrafica";

const FORMATI = "application/pdf,image/png,image/jpeg,image/webp";
const vuoto = (tipo) => ({ document_type: tipo, titolo: "", expiry_date: "", file: null });

/**
 * «Carica»: un documento di un socio, con il tipo già scelto da chi apre la finestra. La stessa
 * nella scheda del socio (DocumentiSocio, il «Carica» di ogni sezione) e in Da fare (Carica
 * documento, sull'avviso di un documento che scade).
 *
 * @param socioId   il socio a cui va il documento
 * @param tipo      il tipo (TIPI_DOCUMENTO) quando la finestra è aperta, null quando è chiusa
 * @param caricatoDa il nome di chi carica, per il registro del documento
 * @param onFatto   dopo il caricamento
 */
export default function DialogoCaricaDocumento({ socioId, tipo, caricatoDa = "", onChiudi, onFatto }) {
  const { toast } = useToast();
  const [modulo, setModulo] = useState(null); // { document_type, titolo, expiry_date, file }
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setModulo(tipo ? vuoto(tipo) : null); }, [tipo]);

  const salva = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const { file, ...dati } = modulo;
      const { file_url } = await caricaFile({ file });
      await api.entities.MemberDocument.create({
        ...dati,
        member_id: socioId,
        file_url,
        file_name: file.name,
        caricato_da: caricatoDa,
      });
      toast({ title: "Documento caricato" });
      onChiudi();
      onFatto?.();
    } catch (err) {
      toast({ title: "Documento non caricato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const motivo = modulo ? (modulo.file ? motivoDocumentoNonValido(modulo) : "Scegli il file da caricare.") : null;
  const tipoInModulo = TIPI_DOCUMENTO.find((t) => t.valore === modulo?.document_type);

  return (
    <Dialog open={Boolean(tipo)} onOpenChange={(aperto) => { if (!aperto && !salvando) onChiudi(); }}>
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
  );
}
