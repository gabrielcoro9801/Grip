// Hook Stop: se sono cambiati i file che decidono quali pagine stanno fuori dal login,
// ferma la fine del turno e chiede a Claude di ricontrollare public/robots.txt e public/sitemap.xml.
//
// Non rigenera i due file da solo: cosa è pubblico lo dice chi legge le rotte, non un parser.
// Scatta una volta per ogni cambiamento: l'impronta dei file si salva prima di bloccare.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RADICE = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const IMPRONTA = path.join(RADICE, '.claude', '.sito-pubblico.impronta');
// Rotte dei due router, i due gusci HTML, gli ingressi di Vite e il fallback di Fastify che sceglie il guscio.
const FILE = [
  'src/staff/App.jsx',
  'src/member/App.jsx',
  'index.html',
  'member.html',
  'vite.config.js',
  'server/src/app.js',
];

function impronta() {
  const h = crypto.createHash('sha1');
  for (const f of FILE) {
    h.update(f);
    try { h.update(fs.readFileSync(path.join(RADICE, f))); } catch { h.update('assente'); }
  }
  return h.digest('hex');
}

let ingresso = {};
try { ingresso = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* senza stdin: si va avanti */ }

const ora = impronta();
let prima = null;
try { prima = fs.readFileSync(IMPRONTA, 'utf8').trim(); } catch { /* primo avvio */ }
fs.writeFileSync(IMPRONTA, ora);

// Primo avvio, nulla di cambiato, o Claude sta già rispondendo a questo blocco: si lascia finire.
if (!prima || prima === ora || ingresso.stop_hook_active) process.exit(0);

console.log(JSON.stringify({
  decision: 'block',
  reason: `Sono cambiati i file che definiscono le pagine del sito (${FILE.join(', ')}). `
    + 'Controlla se è cambiato l\'elenco delle pagine raggiungibili senza login. Se sì, aggiorna public/robots.txt '
    + '(righe Allow) e public/sitemap.xml (righe <url>) in modo che coincidano. Se no, non toccare nulla e dillo in una riga.',
}));
