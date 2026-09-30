// Caricato prima di ogni test del frontend (`npm test`, con `--import`).
//
// I test girano nel fuso della macchina: su un server in UTC gli errori di date che in
// Italia spostano le lezioni di un giorno non si vedrebbero nemmeno. Si fissa il fuso in
// cui la palestra lavora, su qualunque macchina, anche su Windows dove `TZ=… node` negli
// script npm non funziona.
process.env.TZ = 'Europe/Rome';
