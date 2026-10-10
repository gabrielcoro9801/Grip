// Le persone della palestra con la loro fase e i loro segnali, calcolati in blocco.
//
// Le regole stanno in shared/segnali.js; qui si raccolgono i dati con poche query aggregate —
// abbonamenti, documenti, ultimo ingresso e conteggi a 4 e 12 settimane, prenotazioni recenti,
// ultimo contatto del diario — e si passa ogni persona al motore, in memoria. Lo leggono Oggi,
// l'elenco dei soci, la scheda e la dashboard: un solo conto per tutti.
//
// ponytail: tutto in memoria, per palestra; regge migliaia di persone. Una vista materializzata
// solo se le misure lo chiederanno.
import { and, count, eq, gte, inArray, lte, max, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
	persone, members, trattative, memberDocuments, ingressi, bookings, sessions, attivita,
} from '../db/schema/index.js';
import { iscrizioniPerSocio } from './iscrizioni.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { soglieEnte } from './impostazioni.js';
import { segnaliPersona, esitoPrenotazione, TIPI_CONTATTO } from '../../../shared/segnali.js';
import { STATI_APERTI } from '../../../shared/lead.js';
import { oggiIso, spostaGiorni } from '../../../shared/giorni.js';

// La mezzanotte di un giorno a Roma, come istante: i conteggi "delle ultime 4 settimane" partono da lì.
const mezzanotteRoma = (giorno) => sql`((${giorno})::date)::timestamp AT TIME ZONE 'Europe/Rome'`;
// Le iscrizioni finite da più di così non cambiano più la fase di nessuno.
const GIORNI_STORICO_ABBONAMENTI = 400;

const raggruppa = (righe, chiave) => {
	const m = new Map();
	for (const r of righe) {
		if (!m.has(r[chiave])) m.set(r[chiave], []);
		m.get(r[chiave]).push(r);
	}
	return m;
};

/**
 * Le persone con la loro situazione di oggi: i soci (anche ex) e i contatti con una trattativa.
 * Con `personaId`, una sola.
 *
 * @returns {{ oggi, soglie, persone: [{ persona_id, socio_id, trattativa_id, nome, telefono, email,
 *   codice_socio, archiviato_il, fase, segnali, ultimo_ingresso, ingressi_4, media_4, scadenza,
 *   abbonamento, valido }] }}
 */
export async function situazioni({ personaId = null, conn = db, adesso = new Date() } = {}) {
	const oggi = oggiIso(adesso);
	const soglie = await soglieEnte(conn);
	const dal4 = spostaGiorni(oggi, -27);
	const dal12 = spostaGiorni(oggi, -83);

	const anagrafiche = await conn.select({
		persona_id: persone.id, nome: persone.fullName, nome_proprio: persone.nome, telefono: persone.telefono, email: persone.email,
		socio_id: members.id, codice_socio: members.codiceSocio, archiviato_il: members.archiviatoIl,
		date_of_birth: members.dateOfBirth, created_date: members.createdDate, foto_url: members.fotoUrl,
	}).from(persone).leftJoin(members, eq(members.personaId, persone.id))
		.where(personaId ? eq(persone.id, personaId) : undefined);
	const idSoci = anagrafiche.map((a) => a.socio_id).filter(Boolean);
	// Con una persona sola si legge solo quello che è suo.
	const suoi = (colonna) => (personaId ? inArray(colonna, idSoci.length ? idSoci : ['00000000-0000-0000-0000-000000000000']) : undefined);

	const [elencoTrattative, iscrizioni, documenti, conteggi, misurati, prenotazioni, recenti, contatti] = await Promise.all([
		conn.select().from(trattative)
			.where(and(ne(trattative.stato, 'iscritto'), personaId ? eq(trattative.personaId, personaId) : undefined)),
		// Con le date dopo le sospensioni (lib/iscrizioni.js).
		iscrizioniPerSocio(personaId ? idSoci : null, { conn, fineDal: spostaGiorni(oggi, -GIORNI_STORICO_ABBONAMENTI) }),
		conn.select({
			id: memberDocuments.id, member_id: memberDocuments.memberId, file_name: memberDocuments.fileName,
			document_type: memberDocuments.documentType, created_date: memberDocuments.createdDate, expiry_date: memberDocuments.expiryDate,
		}).from(memberDocuments).where(suoi(memberDocuments.memberId)),
		conn.select({
			member_id: ingressi.memberId, ultimo: max(ingressi.entratoAlle), totale: count(),
			quattro: sql`count(*) filter (where ${ingressi.entratoAlle} >= ${mezzanotteRoma(dal4)})`.mapWith(Number),
			dodici: sql`count(*) filter (where ${ingressi.entratoAlle} >= ${mezzanotteRoma(dal12)})`.mapWith(Number),
			// Per i segnali del bancone di chi è già entrato oggi, dal tornello: com'era prima di oggi.
			oggi: sql`count(*) filter (where ${ingressi.entratoAlle} >= ${mezzanotteRoma(oggi)})`.mapWith(Number),
			prima: sql`max(${ingressi.entratoAlle}) filter (where ${ingressi.entratoAlle} < ${mezzanotteRoma(oggi)})`.mapWith((v) => (v ? oggiIso(new Date(v)) : null)),
		}).from(ingressi).where(suoi(ingressi.memberId)).groupBy(ingressi.memberId),
		// Una palestra che non registra gli ingressi non ha assenti: avrebbe solo soci "mai entrati".
		conn.select({ id: ingressi.id }).from(ingressi).where(gte(ingressi.entratoAlle, mezzanotteRoma(dal4))).limit(1),
		conn.select({ member_id: bookings.memberId, data: sessions.date, inizio: sessions.startTime, fine: sessions.endTime })
			.from(bookings).innerJoin(sessions, eq(bookings.sessionId, sessions.id))
			.where(and(
				eq(bookings.status, 'confirmed'), eq(sessions.status, 'active'),
				gte(sessions.date, dal4), lte(sessions.date, oggi), suoi(bookings.memberId),
			)),
		conn.select({ member_id: ingressi.memberId, alle: ingressi.entratoAlle })
			.from(ingressi).where(and(gte(ingressi.entratoAlle, mezzanotteRoma(dal4)), suoi(ingressi.memberId))),
		conn.select({
			persona_id: attivita.personaId,
			ultimo: sql`max(${attivita.createdDate}) filter (where ${inArray(attivita.tipo, TIPI_CONTATTO)})`.mapWith((v) => (v ? oggiIso(new Date(v)) : null)),
			rimandato_al: sql`max(${attivita.esito}) filter (where ${attivita.tipo} = 'rimando')`,
			// Istanti, non giorni: richiesta e telefonata possono essere dello stesso giorno.
			riscontro: sql`max(${attivita.createdDate}) filter (where ${inArray(attivita.tipo, TIPI_CONTATTO)} and ${attivita.esito} is distinct from 'nessuna_risposta')`,
			richiesta: sql`max(${attivita.createdDate}) filter (where ${attivita.tipo} = 'richiesta_rinnovo')`,
		}).from(attivita).where(personaId ? eq(attivita.personaId, personaId) : undefined).groupBy(attivita.personaId),
	]);

	const trattativaDi = new Map();
	for (const t of elencoTrattative) {
		const prima = trattativaDi.get(t.personaId);
		const aperta = STATI_APERTI.includes(t.stato);
		// L'aperta, se c'è (una sola per persona); altrimenti l'ultima chiusa.
		if (!prima || (aperta && !STATI_APERTI.includes(prima.stato)) || (!STATI_APERTI.includes(prima.stato) && String(t.statoDal) > String(prima.statoDal))) {
			trattativaDi.set(t.personaId, t);
		}
	}
	const iscrizioniDi = iscrizioni;
	const documentiDi = raggruppa(documenti, 'member_id');
	const prenotazioniDi = raggruppa(prenotazioni, 'member_id');
	const recentiDi = raggruppa(recenti, 'member_id');
	const conteggiDi = new Map(conteggi.map((c) => [c.member_id, c]));
	const contattiDi = new Map(contatti.map((c) => [c.persona_id, c]));
	const misura = misurati.length > 0;

	const elenco = [];
	for (const a of anagrafiche) {
		const trattativa = trattativaDi.get(a.persona_id) ?? null;
		if (!a.socio_id && !trattativa) continue;
		const c = conteggiDi.get(a.socio_id);
		const ingressiSocio = a.socio_id && misura
			? {
				ultimo: c?.ultimo ? oggiIso(new Date(c.ultimo)) : null, quattro: c?.quattro ?? 0, dodici: c?.dodici ?? 0, totale: Number(c?.totale ?? 0),
				prima: c?.prima ?? null, oggi: c?.oggi ?? 0,
			}
			: null;
		const istanti = (recentiDi.get(a.socio_id) ?? []).map((r) => r.alle);
		const noShow = misura
			? (prenotazioniDi.get(a.socio_id) ?? []).filter((p) => esitoPrenotazione(p, istanti, adesso) === 'no_show').length
			: 0;
		const diario = contattiDi.get(a.persona_id);
		const { fase, segnali, copertura } = segnaliPersona({
			socio: a.socio_id ? { created_date: a.created_date, archiviato_il: a.archiviato_il, date_of_birth: a.date_of_birth } : null,
			trattativa: trattativa ? translateToSnakeCase(trattative, trattativa) : null,
			iscrizioni: iscrizioniDi.get(a.socio_id) ?? [],
			documenti: documentiDi.get(a.socio_id) ?? [],
			ingressi: ingressiSocio, noShow,
			contatti: {
				ultimo: diario?.ultimo ?? null, rimandatoAl: diario?.rimandato_al ?? null,
				riscontro: diario?.riscontro ?? null, richiestaRinnovo: diario?.richiesta ?? null,
			},
			oggi, soglie,
		});
		elenco.push({
			persona_id: a.persona_id, socio_id: a.socio_id, trattativa_id: trattativa?.id ?? null,
			nome: a.nome, nome_proprio: a.nome_proprio, telefono: a.telefono, email: a.email, codice_socio: a.codice_socio, archiviato_il: a.archiviato_il,
			// Per le comunicazioni (lib/invii.js): un minore non riceve fuori dal portale.
			nascita: a.date_of_birth ?? null,
			fase, segnali,
			ultimo_ingresso: c?.ultimo ? oggiIso(new Date(c.ultimo)) : null,
			ingressi_4: ingressiSocio ? ingressiSocio.quattro : null,
			media_4: ingressiSocio ? Math.round((ingressiSocio.dodici / 3) * 10) / 10 : null,
			scadenza: copertura?.scadenza ?? null,
			// L'ultima scadenza passata: le tile dell'elenco mostrano "scaduto il…" a chi non ha rinnovato.
			ultima_fine: copertura?.ultimaFine ?? null,
			// Non firmata: la firma la mette la rotta che la manda al browser (routes/segnali.js).
			foto_url: a.foto_url ?? null,
			abbonamento: copertura?.riferimento?.plan_name ?? null,
			valido: Boolean(copertura?.valido),
			sospensione: copertura?.sospensione ? { dal: copertura.sospensione.dal, al: copertura.sospensione.al } : null,
			// Entrato oggi, dal tornello o registrato a mano: i segnali del bancone gli valgono ancora.
			entrato_oggi: Boolean(c?.oggi),
		});
	}
	return { oggi, soglie, persone: elenco };
}
