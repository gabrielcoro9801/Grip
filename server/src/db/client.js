import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

// PostgreSQL restituisce i valori `numeric` come stringhe, perché in generale possono
// eccedere la precisione di un numero JavaScript. Tutto il codice contabile però li
// somma e li formatta come numeri (`s + l.dare`, `importo.toFixed(2)`): senza questa
// conversione le somme diventerebbero concatenazioni di stringhe e le formattazioni
// solleverebbero errori. Gli importi qui sono al più numeric(12,2), quindi ampiamente
// dentro il range in cui un numero JavaScript è esatto.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
