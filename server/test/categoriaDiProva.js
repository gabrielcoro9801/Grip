// I corsi hanno una categoria obbligatoria (migrazione 0062): un file di test che crea corsi se ne
// crea una sua, e la cancella alla fine, dopo i corsi. Ogni file di test gira in un processo suo:
// l'elenco qui sotto è di quel file soltanto.
import { inArray } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { categories } from '../src/db/schema/index.js';

const create = [];

/** L'id di una categoria nuova, da cancellare con `togliCategorieDiProva` dopo i corsi. */
export async function categoriaDiProva() {
	const [c] = await db.insert(categories).values({ name: `Categoria di prova ${Date.now()}-${create.length}` }).returning();
	create.push(c.id);
	return c.id;
}

export async function togliCategorieDiProva() {
	if (create.length) await db.delete(categories).where(inArray(categories.id, create.splice(0)));
}
