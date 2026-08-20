import { api } from "@/api/client";
import {
  costruisciRigheScrittura,
  costruisciRigheSaldo,
  costruisciRigheRata,
} from "../../shared/scritture.js";

/**
 * Generazione delle scritture contabili a partire da una causale operativa.
 *
 * Qui resta solo l'orchestrazione: leggere quel che serve, chiamare il server, aggiornare
 * i record collegati. La costruzione delle righe — la parte che decide su quale conto va
 * quale importo — vive in `shared/scritture.js`, dove è una funzione pura e coperta da
 * test. Prima era mescolata a queste chiamate, e quindi verificabile solo a mano.
 *
 * I conti non si cercano più per numero ma per **ruolo** (`shared/contiSistema.js`): il
 * codice del conto appartiene all'associazione e al suo commercialista, e cambiarlo non
 * deve rompere niente.
 */

/**
 * Registra un'operazione generata da una causale operativa.
 *
 * @param {Object} params
 * @param {string} params.organization_id
 * @param {Object} params.causale causale operativa
 * @param {number} params.importo_lordo
 * @param {string} params.data data di competenza (YYYY-MM-DD)
 * @param {"cassa"|"banca"} params.metodo_liquidita
 * @param {string} [params.controparte_id]
 * @param {"cliente"|"fornitore"} [params.controparte_tipo]
 * @param {boolean} params.a_credito
 * @param {string} [params.data_scadenza]
 * @param {Array} params.accounts piano dei conti dell'organizzazione
 * @param {Object} [params.ritenuta] `{ importo }` se il compenso è soggetto a ritenuta
 * @returns {Promise<Object>} la scrittura creata, con imponibile e IVA scorporati
 */
export async function generateJournalEntry(params) {
  const {
    organization_id, causale, importo_lordo, data, metodo_liquidita,
    controparte_id, controparte_tipo, a_credito, data_scadenza,
    accounts, descrizione, tipo_origine, natura_fiscale, controparte_e_socio,
    ritenuta,
  } = params;

  const { imponibile, iva, righe, statoPagamento } = costruisciRigheScrittura({
    causale,
    importoLordo: importo_lordo,
    conti: accounts,
    aCredito: a_credito,
    metodoLiquidita: metodo_liquidita,
    controparteId: controparte_id,
    controparteTipo: controparte_tipo,
    ritenuta,
  });

  const entry = await api.accounting.createJournalEntry(
    {
      organization_id,
      data_competenza: data,
      data_cassa: a_credito ? undefined : data,
      descrizione: descrizione || causale.nome_visibile,
      causale: causale.nome_visibile,
      causale_operativa_id: causale.id,
      tipo_origine: tipo_origine || (causale.tipo === "entrata" ? "incasso_cliente" : "pagamento_fornitore"),
      stato: "confermata",
      stato_pagamento: statoPagamento,
      data_scadenza: a_credito ? data_scadenza : undefined,
      natura_fiscale,
    },
    righe.map((r) => ({
      ...r,
      controparte_e_socio: r.controparte_tipo ? controparte_e_socio : undefined,
    })),
  );

  return { ...entry, imponibile, iva };
}

/**
 * Salda una scrittura rimasta da incassare o da pagare: crea la registrazione del saldo e
 * segna l'originale come chiusa.
 */
export async function settleJournalEntry(originalEntry, accounts, metodo_liquidita, dataCassa) {
  // Il conto di credito/debito lo dice la causale; se la scrittura non ne ha una — perché
  // nata da un altro percorso — lo si ricava dalla riga che porta la controparte.
  const righeOriginali = await api.entities.JournalLine.filter({ journal_entry_id: originalEntry.id });

  let contoCreditoDebito = null;
  if (originalEntry.causale_operativa_id) {
    const causale = await api.entities.CausaleOperativa.get(originalEntry.causale_operativa_id);
    contoCreditoDebito = accounts.find((a) => a.id === causale?.conto_credito_debito_id) || null;
  }
  if (!contoCreditoDebito) {
    const rigaConControparte = righeOriginali.find((l) => l.controparte_id);
    if (rigaConControparte) contoCreditoDebito = accounts.find((a) => a.id === rigaConControparte.conto_id) || null;
  }
  if (!contoCreditoDebito) throw new Error("Conto credito/debito non trovato");

  const rigaSaldo = righeOriginali.find((l) => l.conto_id === contoCreditoDebito.id);
  const importoSaldo = Number(rigaSaldo?.dare) || Number(rigaSaldo?.avere) || 0;

  const righe = costruisciRigheSaldo({
    contoCreditoDebitoId: contoCreditoDebito.id,
    importo: importoSaldo,
    conti: accounts,
    metodoLiquidita: metodo_liquidita,
    daIncassare: originalEntry.stato_pagamento === "da_incassare",
  });

  const newEntry = await api.accounting.createJournalEntry(
    {
      organization_id: originalEntry.organization_id,
      data_competenza: dataCassa,
      data_cassa: dataCassa,
      descrizione: `Saldo: ${originalEntry.descrizione}`,
      causale: "Saldo",
      // Origine distinta da "manuale": è una scrittura generata dal sistema al saldo di un
      // credito o debito, non una registrazione digitata a mano.
      tipo_origine: "saldo",
      stato: "confermata",
      stato_pagamento: "saldata",
    },
    righe,
  );

  await api.accounting.markSettled(originalEntry.id, newEntry.id);
  return newEntry;
}

/** Registra il pagamento di una rata di finanziamento e segna la rata come pagata. */
export async function settleLoanInstallment(installment, loan, accounts, metodo_liquidita, dataPagamento) {
  const righe = costruisciRigheRata({
    quotaCapitale: installment.quota_capitale,
    quotaInteressi: installment.quota_interessi,
    conti: accounts,
    metodoLiquidita: metodo_liquidita,
  });

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
    righe,
  );

  await api.entities.LoanInstallment.update(installment.id, {
    stato_pagamento: "pagata",
    journal_entry_id: entry.id,
  });

  return entry;
}
