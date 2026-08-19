import { api } from "@/api/client";

/**
 * Motore di generazione scrittura contabile da causale operativa.
 * Genera JournalEntry + JournalLine bilanciate in partita doppia.
 *
 * @param {Object} params
 * @param {string} params.organization_id
 * @param {Object} params.causale - CausaleOperativa object
 * @param {number} params.importo_lordo
 * @param {string} params.data - data competenza (YYYY-MM-DD)
 * @param {string} params.metodo_liquidita - "cassa" | "banca"
 * @param {string} [params.controparte_id]
 * @param {string} [params.controparte_tipo] - "cliente" | "fornitore"
 * @param {boolean} params.a_credito
 * @param {string} [params.data_scadenza]
 * @param {Array} params.accounts - ChartOfAccount[] dell'organizzazione
 * @param {string} [params.descrizione]
 * @param {string} [params.tipo_origine]
 * @returns {Promise<Object>} JournalEntry creata
 */
export async function generateJournalEntry(params) {
  const {
    organization_id, causale, importo_lordo, data, metodo_liquidita,
    controparte_id, controparte_tipo, a_credito, data_scadenza,
    accounts, descrizione, tipo_origine,
    natura_fiscale, controparte_e_socio,
    // { importo, conto_id } quando il pagamento è soggetto a ritenuta d'acconto.
    ritenuta,
  } = params;

  // 1. Scorpora IVA
  let imponibile = importo_lordo;
  let iva = 0;
  if (causale.gestisce_iva && causale.aliquota_iva_default) {
    imponibile = importo_lordo / (1 + causale.aliquota_iva_default / 100);
    iva = importo_lordo - imponibile;
  }

  // 2. Lookup conti
  const findAccount = (codice) => accounts.find(a => a.codice === codice);
  const contoLiquidita = metodo_liquidita === "banca" ? findAccount("2.2") : findAccount("2.1");
  const contoIVAdebito = findAccount("4.3");
  const contoContropartita = accounts.find(a => a.id === causale.conto_contropartita_id);
  const contoCreditoDebito = causale.conto_credito_debito_id
    ? accounts.find(a => a.id === causale.conto_credito_debito_id)
    : null;

  if (!contoContropartita) throw new Error("Conto contropartita non trovato");

  const isEntrata = causale.tipo === "entrata";
  const lines = [];

  // Sui compensi a professionisti una quota non va al fornitore ma all'erario. Il costo
  // resta intero — la ritenuta non è uno sconto — mentre il lato avere si divide fra chi
  // riceve davvero il denaro e l'erario, a cui lo si versa per conto suo.
  const importoRitenuta = ritenuta?.importo > 0 ? ritenuta.importo : 0;
  const daPagare = importo_lordo - importoRitenuta;
  if (importoRitenuta > 0 && !ritenuta.conto_id) {
    throw new Error("Manca il conto su cui registrare la ritenuta d'acconto");
  }
  const rigaRitenuta = () => ({ conto_id: ritenuta.conto_id, avere: importoRitenuta });

  // 3. Costruisci righe
  if (!a_credito) {
    // Movimento di liquidità
    if (isEntrata) {
      lines.push({ conto_id: contoLiquidita.id, dare: importo_lordo });
      lines.push({ conto_id: contoContropartita.id, avere: imponibile, controparte_tipo, controparte_id });
      if (iva > 0) lines.push({ conto_id: contoIVAdebito.id, avere: iva, importo_iva: iva, aliquota_iva: causale.aliquota_iva_default });
    } else {
      lines.push({ conto_id: contoContropartita.id, dare: importo_lordo, controparte_tipo, controparte_id, importo_iva: iva > 0 ? iva : undefined, aliquota_iva: iva > 0 ? causale.aliquota_iva_default : undefined });
      lines.push({ conto_id: contoLiquidita.id, avere: daPagare });
      if (importoRitenuta > 0) lines.push(rigaRitenuta());
    }
  } else {
    // Movimento a credito/debito
    if (isEntrata) {
      lines.push({ conto_id: contoCreditoDebito.id, dare: importo_lordo, controparte_tipo, controparte_id });
      lines.push({ conto_id: contoContropartita.id, avere: imponibile });
      if (iva > 0) lines.push({ conto_id: contoIVAdebito.id, avere: iva, importo_iva: iva, aliquota_iva: causale.aliquota_iva_default });
    } else {
      lines.push({ conto_id: contoContropartita.id, dare: importo_lordo, importo_iva: iva > 0 ? iva : undefined, aliquota_iva: iva > 0 ? causale.aliquota_iva_default : undefined });
      // Al fornitore si deve solo il netto: la ritenuta è già un debito verso l'erario,
      // che si versa con l'F24 indipendentemente da quando si paga il fornitore.
      lines.push({ conto_id: contoCreditoDebito.id, avere: daPagare, controparte_tipo, controparte_id });
      if (importoRitenuta > 0) lines.push(rigaRitenuta());
    }
  }

  // 4. Crea JournalEntry
  const stato_pagamento = a_credito
    ? (isEntrata ? "da_incassare" : "da_pagare")
    : "saldata";

  // 5. Scrive testata e righe insieme: il numero di protocollo lo assegna il server.
  const entry = await api.accounting.createJournalEntry(
    {
      organization_id,
      data_competenza: data,
      data_cassa: a_credito ? undefined : data,
      descrizione: descrizione || causale.nome_visibile,
      causale: causale.nome_visibile,
      causale_operativa_id: causale.id,
      tipo_origine: tipo_origine || (isEntrata ? "incasso_cliente" : "pagamento_fornitore"),
      stato: "confermata",
      stato_pagamento,
      data_scadenza: a_credito ? data_scadenza : undefined,
      natura_fiscale,
    },
    lines.map(l => ({
      conto_id: l.conto_id,
      dare: l.dare || 0,
      avere: l.avere || 0,
      controparte_tipo: l.controparte_tipo,
      controparte_id: l.controparte_id,
      controparte_e_socio: l.controparte_tipo ? controparte_e_socio : undefined,
      importo_iva: l.importo_iva,
      aliquota_iva: l.aliquota_iva,
    }))
  );

  return { ...entry, imponibile, iva };
}

/**
 * Salda una JournalEntry in stato da_incassare o da_pagare.
 * Crea una nuova JournalEntry di saldo e aggiorna l'originale.
 *
 * @param {Object} originalEntry - JournalEntry da saldare
 * @param {Array} accounts - ChartOfAccount[] dell'organizzazione
 * @param {string} metodo_liquidita - "cassa" | "banca"
 * @param {string} dataCassa - data effettiva (YYYY-MM-DD)
 * @returns {Promise<Object>} nuova JournalEntry di saldo
 */
export async function settleJournalEntry(originalEntry, accounts, metodo_liquidita, dataCassa) {
  const findAccount = (codice) => accounts.find(a => a.codice === codice);
  const contoLiquidita = metodo_liquidita === "banca" ? findAccount("2.2") : findAccount("2.1");

  // Recupera la causale per trovare il conto credito/debito
  let contoCreditoDebitoId = null;
  if (originalEntry.causale_operativa_id) {
    const causale = await api.entities.CausaleOperativa.get(originalEntry.causale_operativa_id);
    contoCreditoDebitoId = causale?.conto_credito_debito_id;
  }

  // Fallback: cerca il conto credito/debito dalle righe originali
  const originalLines = await api.entities.JournalLine.filter({ journal_entry_id: originalEntry.id });

  let contoCreditoDebito = null;
  if (contoCreditoDebitoId) {
    contoCreditoDebito = accounts.find(a => a.id === contoCreditoDebitoId);
  }
  if (!contoCreditoDebito) {
    // Cerca la riga con controparte (il conto di credito/debito)
    const lineWithControparte = originalLines.find(l => l.controparte_id);
    if (lineWithControparte) {
      contoCreditoDebito = accounts.find(a => a.id === lineWithControparte.conto_id);
    }
  }
  if (!contoCreditoDebito) throw new Error("Conto credito/debito non trovato");

  const isDaIncassare = originalEntry.stato_pagamento === "da_incassare";
  const importoSaldo = originalLines.find(l => l.conto_id === contoCreditoDebito.id)?.dare
    || originalLines.find(l => l.conto_id === contoCreditoDebito.id)?.avere || 0;

  const lines = [];
  if (isDaIncassare) {
    lines.push({ conto_id: contoLiquidita.id, dare: importoSaldo });
    lines.push({ conto_id: contoCreditoDebito.id, avere: importoSaldo });
  } else {
    lines.push({ conto_id: contoCreditoDebito.id, dare: importoSaldo });
    lines.push({ conto_id: contoLiquidita.id, avere: importoSaldo });
  }

  const newEntry = await api.accounting.createJournalEntry(
    {
      organization_id: originalEntry.organization_id,
      data_competenza: dataCassa,
      data_cassa: dataCassa,
      descrizione: `Saldo: ${originalEntry.descrizione}`,
      causale: `Saldo`,
      // Origine distinta da "manuale": è una scrittura generata dal sistema al saldo di
      // un credito o debito, non una registrazione digitata a mano.
      tipo_origine: "saldo",
      stato: "confermata",
      stato_pagamento: "saldata",
    },
    lines.map(l => ({
      conto_id: l.conto_id,
      dare: l.dare || 0,
      avere: l.avere || 0,
    }))
  );

  await api.accounting.markSettled(originalEntry.id, newEntry.id);

  return newEntry;
}

/**
 * Registra il pagamento di una rata di prestito.
 * Dare 4.2 (Debiti v/banche) = quota_capitale + Dare 7.5 (Interessi passivi) = quota_interessi / Avere Cassa/Banca = totale
 */
export async function settleLoanInstallment(installment, loan, accounts, metodo_liquidita, dataPagamento) {
  const findAccount = (codice) => accounts.find(a => a.codice === codice);
  const contoLiquidita = metodo_liquidita === "banca" ? findAccount("2.2") : findAccount("2.1");
  const contoDebitiBanche = findAccount("4.2");
  const contoInteressi = findAccount("7.5");

  const totale = (installment.quota_capitale || 0) + (installment.quota_interessi || 0);

  const lines = [
    { conto_id: contoDebitiBanche.id, dare: installment.quota_capitale || 0 },
    { conto_id: contoInteressi.id, dare: installment.quota_interessi || 0 },
    { conto_id: contoLiquidita.id, avere: totale },
  ];

  const entry = await api.accounting.createJournalEntry(
    {
      organization_id: loan.organization_id,
      data_competenza: dataPagamento,
      data_cassa: dataPagamento,
      descrizione: `Rata ${installment.numero_rata} — ${loan.ente_finanziatore}`,
      causale: "Pagamento rata prestito",
      tipo_origine: "rata_prestito",
      stato: "confermata",
      stato_pagamento: "saldata",
    },
    lines.map(l => ({
      conto_id: l.conto_id,
      dare: l.dare || 0,
      avere: l.avere || 0,
    }))
  );

  await api.entities.LoanInstallment.update(installment.id, {
    stato_pagamento: "pagata",
    journal_entry_id: entry.id,
  });

  return entry;
}