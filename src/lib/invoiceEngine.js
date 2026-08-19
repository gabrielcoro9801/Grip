import { api } from "@/api/client";
import jsPDF from "jspdf";
import moment from "moment";

/**
 * Fatture verso clienti terzi.
 *
 * Documento distinto dalla ricevuta: la ricevuta accompagna la quota di un socio, la
 * fattura una prestazione commerciale verso terzi — richiede partita IVA, aliquota
 * esposta e numerazione propria che riparte ogni esercizio.
 *
 * ATTENZIONE: questo genera il documento di cortesia in PDF. Per le prestazioni verso
 * soggetti con partita IVA la fattura elettronica in formato XML verso lo SdI è
 * obbligatoria: questo PDF non la sostituisce, la affianca in attesa che venga costruita.
 */

const fmt = (n) => Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function clientDisplayName(client) {
  if (!client) return "—";
  if (client.tipo === "azienda") return client.ragione_sociale || "—";
  return [client.nome, client.cognome].filter(Boolean).join(" ") || "—";
}

function hexToRgb(hex) {
  if (!hex || hex.length < 7) return [30, 64, 175];
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Costruisce il PDF della fattura. */
export function buildInvoicePdfBlob(invoice, organization, template) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 20;
  const [ar, ag, ab] = hexToRgb(template?.colore_accento || "#1e40af");
  let y = margin;

  // Intestazione dell'emittente
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(ar, ag, ab);
  doc.text(organization?.ragione_sociale || organization?.nome || "—", margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  if (organization?.indirizzo) { doc.text(organization.indirizzo, margin, y); y += 4; }
  if (organization?.piva_cf) { doc.text(`P.IVA / C.F. ${organization.piva_cf}`, margin, y); y += 4; }

  // Titolo e numero
  y += 8;
  doc.setDrawColor(ar, ag, ab);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30);
  doc.text("FATTURA", margin, y);
  doc.setFontSize(11);
  doc.text(`n. ${invoice.numero_progressivo}/${invoice.esercizio_fiscale}`, pageW - margin, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`Data ${moment(invoice.data_emissione).format("DD/MM/YYYY")}`, pageW - margin, y, { align: "right" });
  y += 10;

  // Intestatario
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text("DESTINATARIO", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(30);
  doc.text(invoice.cliente_name || "—", margin, y);
  y += 5;
  doc.setFontSize(9);
  doc.setTextColor(90);
  if (invoice.cliente_piva) { doc.text(`P.IVA / C.F. ${invoice.cliente_piva}`, margin, y); y += 4; }
  if (invoice.cliente_indirizzo) { doc.text(invoice.cliente_indirizzo, margin, y); y += 4; }
  y += 8;

  // Riga della prestazione
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y - 4, pageW - margin * 2, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(70);
  doc.text("DESCRIZIONE", margin + 2, y + 1);
  doc.text("IMPORTO", pageW - margin - 2, y + 1, { align: "right" });
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30);
  const descrizione = doc.splitTextToSize(invoice.descrizione || "Prestazione di servizi", pageW - margin * 2 - 40);
  doc.text(descrizione, margin + 2, y);
  doc.text(`€ ${fmt(invoice.imponibile)}`, pageW - margin - 2, y, { align: "right" });
  y += descrizione.length * 5 + 8;

  // Totali
  doc.setDrawColor(210);
  doc.setLineWidth(0.3);
  doc.line(pageW / 2, y, pageW - margin, y);
  y += 6;

  const voce = (etichetta, valore, grassetto = false) => {
    doc.setFont("helvetica", grassetto ? "bold" : "normal");
    doc.setFontSize(grassetto ? 11 : 10);
    doc.setTextColor(grassetto ? 30 : 90);
    doc.text(etichetta, pageW / 2 + 4, y);
    doc.text(`€ ${fmt(valore)}`, pageW - margin - 2, y, { align: "right" });
    y += grassetto ? 7 : 5.5;
  };

  voce("Imponibile", invoice.imponibile);
  voce(`IVA ${fmt(invoice.aliquota_iva)}%`, invoice.iva);
  doc.line(pageW / 2, y - 2, pageW - margin, y - 2);
  y += 3;
  voce("Totale", invoice.totale, true);

  // Piè di pagina
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(130);
  if (template?.nota_piede) {
    doc.text(doc.splitTextToSize(template.nota_piede, pageW - margin * 2), margin, y);
    y += 8;
  }
  doc.text(
    "Documento di cortesia. Non sostituisce la fattura elettronica trasmessa allo SdI.",
    margin, 285,
  );

  return doc.output("blob");
}

/**
 * Emette la fattura per una scrittura contabile di ricavo verso un cliente terzo.
 * Restituisce null se la scrittura non è fatturabile, così il chiamante può proseguire
 * senza doversi occupare del caso.
 */
export async function generateInvoiceForJournalEntry(journalEntryId, organization, accounts, extra = {}) {
  const entry = await api.entities.JournalEntry.get(journalEntryId);
  if (!entry) return null;

  // Una fattura già emessa non va rifatta: il numero è già stato consumato.
  const esistenti = await api.entities.Invoice.filter({ journal_entry_id: journalEntryId });
  if (esistenti.length > 0) return esistenti[0];

  const lines = await api.entities.JournalLine.filter({ journal_entry_id: journalEntryId });
  const rigaCliente = lines.find((l) => l.controparte_id && l.controparte_tipo === "cliente");
  if (!rigaCliente) return null;

  const client = await api.entities.Client.get(rigaCliente.controparte_id).catch(() => null);
  if (!client) return null;

  // Gli importi si ricavano dalle righe: il totale è quanto è entrato, l'IVA quella
  // effettivamente registrata.
  const totale = lines.reduce((s, l) => s + (Number(l.dare) || 0), 0);
  const rigaIva = lines.find((l) => l.importo_iva);
  const iva = Number(rigaIva?.importo_iva) || 0;
  const aliquota = Number(rigaIva?.aliquota_iva) || 0;

  const templates = await api.entities.ReceiptTemplate.filter({ organization_id: organization.id });
  const template = templates[0] || {};

  const invoice = await api.accounting.createInvoice({
    organization_id: organization.id,
    cliente_id: client.id,
    cliente_name: clientDisplayName(client),
    cliente_piva: client.codice_fiscale_piva || null,
    journal_entry_id: journalEntryId,
    data_emissione: entry.data_competenza,
    esercizio_fiscale: moment(entry.data_competenza).year(),
    descrizione: entry.descrizione || entry.causale,
    imponibile: totale - iva,
    iva,
    aliquota_iva: aliquota,
    totale,
    stato: "emessa",
    ...extra,
  });

  const blob = buildInvoicePdfBlob(invoice, organization, template);
  const file = new File([blob], `fattura-${invoice.numero_progressivo}-${invoice.esercizio_fiscale}.pdf`, { type: "application/pdf" });
  const { file_url } = await api.integrations.Core.UploadFile({ file });

  return await api.entities.Invoice.update(invoice.id, { pdf_url: file_url });
}
