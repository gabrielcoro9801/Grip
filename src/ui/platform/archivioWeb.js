/**
 * L'archivio del browser: `localStorage`, vestito con l'interfaccia asincrona che core/ si
 * aspetta (vedi `src/core/session/archivio.js`).
 *
 * È il pezzo che sta fuori da core/ proprio perché è l'unico che sa dove ci si trova. Il
 * gemello per un'app su telefono sarà un file di queste stesse dimensioni, costruito su
 * SecureStore, e core/ non se ne accorgerà.
 *
 * Le promesse qui si risolvono subito — `localStorage` è sincrono — ma la forma asincrona è
 * ciò che permette all'altro adattatore di esistere.
 */
export const archivioWeb = {
	async leggi(chiave) {
		return localStorage.getItem(chiave);
	},
	async scrivi(chiave, valore) {
		localStorage.setItem(chiave, valore);
	},
	async cancella(chiave) {
		localStorage.removeItem(chiave);
	},
};
