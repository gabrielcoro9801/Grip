// Lettura dei parametri fiscali lato server.
//
// Le aliquote di legge cambiano nel tempo e l'applicazione registra anche operazioni con
// competenza passata: il valore da applicare è quello in vigore alla data dell'operazione,
// non quello corrente.
import { db } from '../db/client.js';
import { parametriFiscali } from '../db/schema/index.js';
import { valoreAllaData } from '../../../shared/parametriFiscali.js';

/** Il valore in vigore alla data. Solleva se per quella data non è noto. */
export async function parametroFiscale(chiave, data) {
	const righe = await db.select().from(parametriFiscali);
	return valoreAllaData(
		righe.map((r) => ({ chiave: r.chiave, valore: r.valore, valido_dal: r.validoDal, note: r.note })),
		chiave,
		data,
	);
}
