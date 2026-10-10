// Le iscrizioni dei soci come le legge chiunque: con le date dopo le sospensioni.
//
// Una sospensione non riscrive la scadenza (shared/abbonamenti.js, conSospensioni): la allunga a
// ogni lettura. Per questo chi decide se un socio entra, prenota o va seguito legge le iscrizioni
// da qui e non dalla tabella: letta nuda, un'iscrizione sospesa sembrerebbe scaduta prima, e i
// giorni fermi sembrerebbero coperti.
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { subscriptions, sospensioni } from '../db/schema/index.js';
import { conSospensioni } from '../../../shared/abbonamenti.js';

const colonne = {
	id: subscriptions.id, member_id: subscriptions.memberId, plan_id: subscriptions.planId, plan_name: subscriptions.planName,
	start_date: subscriptions.startDate, end_date: subscriptions.endDate, price_paid: subscriptions.pricePaid,
	created_date: subscriptions.createdDate,
};

/**
 * Le iscrizioni dei soci indicati (tutti, con `memberIds` null), con le date di oggi.
 *
 * @param fineDal lascia fuori le iscrizioni finite prima di quel giorno: dopo le sospensioni, perché
 *   una vecchia iscrizione sospesa fa slittare il rinnovo che le viene dietro
 * @returns Map<member_id, iscrizioni[]>, dalla più vecchia
 */
export async function iscrizioniPerSocio(memberIds = null, { conn = db, fineDal = null } = {}) {
	if (memberIds && !memberIds.length) return new Map();
	const diChi = (colonna) => (memberIds ? inArray(colonna, memberIds) : undefined);
	// Una dopo l'altra, non insieme: `conn` può essere una transazione, cioè una connessione sola.
	// ponytail: tutte le iscrizioni dei soci chiesti, filtrate dopo; regge anni di storico per palestra.
	const righe = await conn.select(colonne).from(subscriptions).where(diChi(subscriptions.memberId)).orderBy(asc(subscriptions.startDate));
	const ferme = await conn.select({ id: sospensioni.id, member_id: sospensioni.memberId, dal: sospensioni.dal, al: sospensioni.al, nota: sospensioni.nota })
		.from(sospensioni).where(diChi(sospensioni.memberId));
	const per = (elenco) => {
		const m = new Map();
		for (const r of elenco) m.set(r.member_id, [...(m.get(r.member_id) ?? []), r]);
		return m;
	};
	const iscrizioni = per(righe);
	const sospese = per(ferme);
	const recenti = (elenco) => (fineDal ? elenco.filter((i) => !i.end_date || i.end_date >= fineDal) : elenco);
	return new Map([...iscrizioni].map(([id, suoi]) => [id, recenti(conSospensioni(suoi, sospese.get(id) ?? []))]));
}

/** Le iscrizioni di un socio, con le date di oggi. */
export async function iscrizioniDelSocio(memberId, conn = db) {
	return (await iscrizioniPerSocio([memberId], { conn })).get(memberId) ?? [];
}

/** Le sospensioni di un socio, dalla prima. */
export function sospensioniDelSocio(memberId, conn = db) {
	return conn.select().from(sospensioni).where(eq(sospensioni.memberId, memberId)).orderBy(asc(sospensioni.dal));
}
