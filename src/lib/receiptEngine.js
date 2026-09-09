import { api } from "@/api/client";
import jsPDF from "jspdf";
import moment from "moment";
import { formatData } from "@/lib/format";

function loadImageAsDataUrl(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function clientDisplayName(client) {
  if (!client) return "—";
  if (client.tipo === "azienda") return client.ragione_sociale || "—";
  return [client.nome, client.cognome].filter(Boolean).join(" ") || "—";
}

function hexToRgb(hex) {
  if (!hex || hex.length < 7) return [30, 64, 175];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

/**
 * Determina se mostrare il dettaglio IVA in ricevuta.
 */
export function shouldShowIva(organization, template) {
  if (template?.mostra_iva_override != null) return template.mostra_iva_override;
  return !!organization?.gestione_iva;
}

/**
 * Costruisce il blob PDF della ricevuta.
 * @param {Object} receipt
 * @param {Object} organization
 * @param {Object} template
 * @param {Object} member
 */
export async function buildReceiptPdfBlob(receipt, organization, template, member) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 20;
  const accent = template?.colore_accento || "#1e40af";
  const [ar, ag, ab] = hexToRgb(accent);
  const showIva = shouldShowIva(organization, template) && receipt.tipo_documento === "ricevuta_fiscale";

  // Header band
  doc.setFillColor(ar, ag, ab);
  doc.rect(0, 0, pageW, 35, "F");

  // Logo
  if (organization?.logo_url) {
    const logoData = await loadImageAsDataUrl(organization.logo_url);
    if (logoData) {
      try { doc.addImage(logoData, "PNG", margin, 6, 24, 22); } catch { /* skip */ }
    }
  }

  // Ragione sociale + anagrafica
  let hy = 12;
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(organization?.ragione_sociale || organization?.nome || "", pageW - margin, hy, { align: "right" });
  hy += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  if (organization?.indirizzo) { doc.text(organization.indirizzo, pageW - margin, hy, { align: "right" }); hy += 4; }
  if (showIva && organization?.piva_cf) { doc.text(`P.IVA/C.F.: ${organization.piva_cf}`, pageW - margin, hy, { align: "right" }); hy += 4; }

  // Title
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(receipt.tipo_documento === "ricevuta_semplice" ? "RICEVUTA" : "RICEVUTA FISCALE", margin, 50);

  // Meta
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`N. ${receipt.numero_progressivo}/${receipt.esercizio_fiscale}`, pageW - margin, 48, { align: "right" });
  doc.text(`Data: ${formatData(receipt.data_emissione)}`, pageW - margin, 54, { align: "right" });

  // Cliente
  let y = 65;
  doc.setDrawColor(ar, ag, ab);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("CLIENTE", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.text(member?.full_name || receipt.cliente_name || "—", margin, y);
  y += 10;

  // Tabella importo
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y, pageW - 2 * margin, 10, "F");
  doc.setFont("helvetica", "bold");
  doc.text("Descrizione", margin + 2, y + 6.5);
  doc.text("Importo", pageW - margin - 2, y + 6.5, { align: "right" });
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.text(receipt.plan_name || "Quota/Abbonamento associativo", margin + 2, y);
  doc.text(`€ ${Number(receipt.importo_lordo || 0).toFixed(2)}`, pageW - margin - 2, y, { align: "right" });
  y += 8;

  if (showIva) {
    doc.text("Imponibile", margin + 2, y);
    doc.text(`€ ${Number(receipt.imponibile || 0).toFixed(2)}`, pageW - margin - 2, y, { align: "right" });
    y += 6;
    doc.text(`IVA (${receipt.aliquota_iva || 0}%)`, margin + 2, y);
    doc.text(`€ ${Number(receipt.iva || 0).toFixed(2)}`, pageW - margin - 2, y, { align: "right" });
    y += 6;
  }

  // Totale
  doc.setDrawColor(ar, ag, ab);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("TOTALE", margin, y);
  doc.text(`€ ${Number(receipt.importo_lordo || 0).toFixed(2)}`, pageW - margin, y, { align: "right" });

  // Nota a piè di pagina
  if (template?.nota_piede) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    const noteLines = doc.splitTextToSize(template.nota_piede, pageW - 2 * margin);
    doc.text(noteLines, margin, 275);
  }

  return doc.output("blob");
}

/**
 * Recupera o crea il ReceiptTemplate per l'organizzazione.
 */
export async function getOrCreateReceiptTemplate(organizationId) {
  const existing = await api.entities.ReceiptTemplate.filter({ organization_id: organizationId });
  if (existing.length > 0) return existing[0];
  return await api.entities.ReceiptTemplate.create({ organization_id: organizationId });
}

/**
 * Genera automaticamente una Receipt per una JournalEntry incasso_cliente saldata.
 * @param {string} journalEntryId
 * @param {Object} organization
 * @param {Array} accounts
 * @param {Object} extraData - campi aggiuntivi (subscription_id, plan_name, ecc.)
 */
export async function generateReceiptForJournalEntry(journalEntryId, organization, accounts, extraData = {}) {
  const entry = await api.entities.JournalEntry.get(journalEntryId);
  if (!entry || entry.tipo_origine !== "incasso_cliente") return null;
  if (entry.stato !== "confermata" || entry.stato_pagamento !== "saldata") return null;

  // Recupera righe
  const lines = await api.entities.JournalLine.filter({ journal_entry_id: journalEntryId });

  // Evita duplicati / promuovi bozza
  const existing = await api.entities.Receipt.filter({ journal_entry_id: journalEntryId });
  if (existing.length > 0) {
    const prev = existing[0];
    if (prev.stato === "emessa") return prev; // già completa
    // Promuovi la bozza a emessa (credito saldato)
    return await promoteDraftReceipt(prev, entry, organization, lines);
  }

  const controparteLine = lines.find(l => l.controparte_id && l.controparte_tipo === "cliente");
  if (!controparteLine) return null;
  const client = await api.entities.Client.get(controparteLine.controparte_id);
  const member = { id: client?.id, full_name: clientDisplayName(client) };

  // Calcola importi
  const importo_lordo = lines.reduce((s, l) => s + (l.dare || 0), 0);
  const ivaLine = lines.find(l => l.importo_iva);
  const iva = ivaLine?.importo_iva || 0;
  const aliquota_iva = ivaLine?.aliquota_iva || 0;
  const imponibile = iva > 0 ? importo_lordo - iva : importo_lordo;

  // Tipo documento
  const isForfettario = organization.regime_fiscale === "forfettario" && !organization.gestione_iva;
  const tipo_documento = isForfettario ? "ricevuta_semplice" : "ricevuta_fiscale";

  // Il numero progressivo lo assegna il server, in transazione: è un documento fiscale e
  // due ricevute con lo stesso numero sono un problema che si scopre solo a un controllo.
  const esercizio_fiscale = moment(entry.data_competenza).year();

  // Template
  const templates = await api.entities.ReceiptTemplate.filter({ organization_id: organization.id });
  const template = templates[0] || {};

  // Il socio è un record distinto dal cliente anagrafico a cui è intestata la ricevuta:
  // va risolto seguendo il collegamento, altrimenti la ricevuta non comparirebbe nel
  // portale soci, che la cerca per member_id. Un cliente può non essere un socio (es.
  // un'azienda che affitta una sala), nel qual caso il campo resta vuoto.
  const linkedMembers = await api.entities.Member.filter({ cliente_id: member.id });
  const linkedMemberId = linkedMembers[0]?.id ?? null;

  // Crea receipt
  const receipt = await api.accounting.createReceipt({
    organization_id: organization.id,
    cliente_id: member.id,
    cliente_name: member.full_name,
    journal_entry_id: journalEntryId,
    esercizio_fiscale,
    tipo_documento,
    data_emissione: entry.data_competenza,
    importo_lordo,
    imponibile,
    iva: organization.gestione_iva ? iva : 0,
    aliquota_iva: organization.gestione_iva ? aliquota_iva : 0,
    stato: "emessa",
    versione: 1,
    // backward compat
    member_id: linkedMemberId,
    member_name: member.full_name,
    amount: importo_lordo,
    date: entry.data_competenza,
    payment_status: "paid",
    ...extraData,
  });

  // Genera e carica PDF
  const pdfBlob = await buildReceiptPdfBlob(receipt, organization, template, member);
  const pdfFile = new File([pdfBlob], `ricevuta-${receipt.numero_progressivo}-${esercizio_fiscale}.pdf`, { type: "application/pdf" });
  const { file_url } = await api.integrations.Core.UploadFile({ file: pdfFile });

  return await api.entities.Receipt.update(receipt.id, { pdf_url: file_url });
}

/**
 * Promuove una ricevuta bozza (credito) a emessa con numero e PDF.
 */
async function promoteDraftReceipt(draft, entry, organization, lines) {
  const controparteLine = lines.find(l => l.controparte_id && l.controparte_tipo === "cliente");
  const client = draft.cliente_id ? await api.entities.Client.get(draft.cliente_id) : null;
  const member = client ? { id: client.id, full_name: clientDisplayName(client) } : { full_name: draft.cliente_name };

  const importo_lordo = draft.importo_lordo || lines.reduce((s, l) => s + (l.dare || 0), 0);
  const ivaLine = lines.find(l => l.importo_iva);
  const iva = ivaLine?.importo_iva || 0;
  const aliquota_iva = ivaLine?.aliquota_iva || 0;
  const imponibile = iva > 0 ? importo_lordo - iva : importo_lordo;

  const isForfettario = organization.regime_fiscale === "forfettario" && !organization.gestione_iva;
  const tipo_documento = isForfettario ? "ricevuta_semplice" : "ricevuta_fiscale";

  const esercizio_fiscale = moment(entry.data_competenza).year();

  const templates = await api.entities.ReceiptTemplate.filter({ organization_id: organization.id });
  const template = templates[0] || {};

  // La bozza prende il numero solo ora, all'emissione: è il momento in cui diventa un
  // documento fiscale. Lo assegna il server, in transazione.
  const updated = await api.accounting.issueReceipt(draft.id, {
    esercizio_fiscale,
    tipo_documento,
    data_emissione: entry.data_competenza,
    importo_lordo,
    imponibile,
    iva: organization.gestione_iva ? iva : 0,
    aliquota_iva: organization.gestione_iva ? aliquota_iva : 0,
    stato: "emessa",
    payment_status: "paid",
    date: entry.data_competenza,
    amount: importo_lordo,
  });

  const pdfBlob = await buildReceiptPdfBlob(updated, organization, template, member);
  const pdfFile = new File([pdfBlob], `ricevuta-${updated.numero_progressivo}-${esercizio_fiscale}.pdf`, { type: "application/pdf" });
  const { file_url } = await api.integrations.Core.UploadFile({ file: pdfFile });

  return await api.entities.Receipt.update(draft.id, { pdf_url: file_url });
}

/**
 * Rigenera il PDF di una Receipt esistente senza cambiare numero_progressivo.
 */
export async function regenerateReceiptPdf(receiptId, organization) {
  let receipt = await api.entities.Receipt.get(receiptId);
  const client = receipt.cliente_id
    ? await api.entities.Client.get(receipt.cliente_id)
    : null;
  const member = client
    ? { id: client.id, full_name: clientDisplayName(client) }
    : { full_name: receipt.cliente_name || receipt.member_name };
  const templates = await api.entities.ReceiptTemplate.filter({ organization_id: organization.id });
  const template = templates[0] || {};

  const pdfBlob = await buildReceiptPdfBlob(receipt, organization, template, member);
  const pdfFile = new File([pdfBlob], `ricevuta-${receipt.numero_progressivo}-${receipt.esercizio_fiscale}.pdf`, { type: "application/pdf" });
  const { file_url } = await api.integrations.Core.UploadFile({ file: pdfFile });

  receipt = await api.entities.Receipt.update(receiptId, {
    pdf_url: file_url,
    versione: (receipt.versione || 1) + 1,
    rigenerata_il: new Date().toISOString(),
  });
  return receipt;
}