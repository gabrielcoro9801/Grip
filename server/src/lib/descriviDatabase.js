/**
 * Su quale database sta per scrivere uno script, in chiaro e senza la password.
 *
 * Gli script di manutenzione si lanciano dal proprio PC (`railway run …`), che inietta le
 * variabili dell'ambiente remoto. Se l'iniezione non avviene — CLI non collegata, progetto
 * sbagliato — il comando riesce lo stesso, ma opera sul database di sviluppo: si resta
 * convinti di aver toccato la produzione, e ci si accorge del contrario molto dopo.
 * Stamparlo toglie il dubbio prima, non dopo.
 */
export function descriviDatabase() {
	try {
		const u = new URL(process.env.DATABASE_URL);
		return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
	} catch {
		return '(DATABASE_URL non leggibile)';
	}
}

/** Se l'indirizzo punta alla macchina locale: quasi sempre significa "non è la produzione". */
export function eDatabaseLocale() {
	try {
		return /^(localhost|127\.0\.0\.1)$/.test(new URL(process.env.DATABASE_URL).hostname);
	} catch {
		return false;
	}
}

/** Intestazione comune agli script che scrivono sul database. */
export function annunciaDatabase() {
	console.log(`Database: ${descriviDatabase()}`);
	if (eDatabaseLocale()) {
		console.log('⚠️  È un database locale. Per la produzione serve `railway run`.');
	}
	console.log('');
}
