#!/usr/bin/env node
// Collega Claude Code a graphify, il grafo del codice in graphify-out/.
// Lo lanciano gli hook di .claude/settings.json; non serve chiamarlo a mano.
//
//   guard <search|read|compact>  passa la chiamata a `graphify hook-guard`
//   avvio                        inizio sessione: dice se graphify manca, aggiorna se il codice è cambiato
//   aggiorna                     fine turno e git pull/checkout: aggiorna il grafo in background se il codice è cambiato
//   installa-git                 mette gli hook git post-merge/post-rewrite/post-checkout (lo fa già "avvio")
//   <altro>                     passa a graphify (query, path, explain, update...), anche se non è nel PATH
//
// Se graphify non è installato non blocca niente: esce in silenzio
// (all'avvio lo segnala a Claude, che lo dice all'utente).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'graphify-out');
const GRAPH = path.join(OUT, 'graph.json');
const LOCK = path.join(OUT, '.aggiorna.lock');
const LOG = path.join(OUT, '.aggiorna.log');
// Chiesto un altro aggiornamento mentre uno era in corso (es. pull --rebase: checkout e poi rewrite).
const ANCORA = path.join(OUT, '.aggiorna.ancora');
// Quando è partito l'ultimo aggiornamento riuscito. Serve perché graphify non riscrive
// graph.json se la struttura non cambia (es. solo commenti): la sua data resterebbe vecchia
// e ogni turno rilancerebbe l'aggiornamento per niente.
const FATTO = path.join(OUT, '.aggiorna.fatto');
// Gli hook git dopo un pull (merge o fast-forward), un pull --rebase e un cambio di branch.
const HOOK_GIT = ['post-merge', 'post-rewrite', 'post-checkout'];
const SEGNO = '# grip-graphify';
const BLOCCO_GIT = `${SEGNO}: aggiorna il grafo di graphify dopo pull e checkout (messo da .claude/hooks/graphify.mjs)
if command -v node >/dev/null 2>&1 && [ -f .claude/hooks/graphify.mjs ]; then node .claude/hooks/graphify.mjs aggiorna >/dev/null 2>&1 || true; fi
`;
// Le cartelle del codice: un file più recente del grafo vuol dire che il grafo è vecchio.
const CODICE = ['src', 'shared', 'server/src', 'server/drizzle', 'server/scripts', 'server/test'];
const ESTENSIONI = new Set(['.js', '.jsx', '.mjs', '.sql', '.json']);

function trovaGraphify() {
  const salvato = path.join(OUT, '.graphify_python');
  if (fs.existsSync(salvato)) {
    const py = fs.readFileSync(salvato, 'utf8').replace(/^﻿/, '').trim();
    if (py && fs.existsSync(py)) return [py, '-m', 'graphify'];
  }
  const nomi = process.platform === 'win32' ? ['graphify.exe', 'graphify.cmd'] : ['graphify'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const nome of nomi) {
      const p = path.join(dir, nome);
      if (dir && fs.existsSync(p)) return [p];
    }
  }
  // Windows con il Python install manager: gli script non stanno nel PATH.
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'Python');
    try {
      for (const d of fs.readdirSync(base).sort().reverse()) {
        const p = path.join(base, d, 'Scripts', 'graphify.exe');
        if (fs.existsSync(p)) return [p];
      }
    } catch { /* cartella assente */ }
  }
  return null;
}

// Conta anche la data delle cartelle: cambia quando un file viene cancellato o aggiunto.
function ultimaModifica(dir) {
  let max = 0;
  try { max = fs.statSync(dir).mtimeMs; } catch { return 0; }
  let voci;
  try { voci = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const v of voci) {
    if (v.name === 'node_modules' || v.name.startsWith('.')) continue;
    const p = path.join(dir, v.name);
    if (v.isDirectory()) max = Math.max(max, ultimaModifica(p));
    else if (ESTENSIONI.has(path.extname(v.name))) {
      try { max = Math.max(max, fs.statSync(p).mtimeMs); } catch { /* file sparito */ }
    }
  }
  return max;
}

function codiceCambiato() {
  let riferimento;
  try { riferimento = fs.statSync(GRAPH).mtimeMs; } catch { return true; }
  try { riferimento = Math.max(riferimento, fs.statSync(FATTO).mtimeMs); } catch { /* mai aggiornato da qui */ }
  return CODICE.some((d) => ultimaModifica(path.join(ROOT, d)) > riferimento);
}

function aggiornamentoInCorso() {
  try {
    // Un lucchetto più vecchio di 10 minuti è rimasto da un aggiornamento interrotto.
    return Date.now() - fs.statSync(LOCK).mtimeMs < 10 * 60 * 1000;
  } catch { return false; }
}

// Lancia l'aggiornamento staccato, così Claude non aspetta i ~15 secondi.
function aggiornaInBackground() {
  if (aggiornamentoInCorso()) { fs.writeFileSync(ANCORA, ''); return; }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  const figlio = spawn(process.execPath, [fileURLToPath(import.meta.url), 'esegui'], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
  });
  figlio.unref();
}

function esegui(cmd) {
  try {
    // Al massimo 3 giri: se durante l'aggiornamento ne è stato chiesto un altro, si rifà.
    for (let giro = 0; giro < 3; giro++) {
      fs.rmSync(ANCORA, { force: true });
      fs.writeFileSync(LOCK, String(process.pid)); // rinfresca la data del lucchetto
      // Un secondo indietro: un file salvato mentre l'aggiornamento parte resta "più nuovo".
      const inizio = new Date(Date.now() - 1000);
      const r = spawnSync(cmd[0], [...cmd.slice(1), 'update', '.'], {
        cwd: ROOT, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, GRAPHIFY_NO_AUTO_REFRESH: '1', PYTHONIOENCODING: 'utf-8' },
      });
      fs.writeFileSync(LOG, `${new Date().toISOString()} exit ${r.status}\n${r.stdout || ''}${r.stderr || ''}`);
      if (r.status === 0) {
        fs.writeFileSync(FATTO, inizio.toISOString());
        fs.utimesSync(FATTO, inizio, inizio);
      }
      if (!fs.existsSync(ANCORA)) break;
    }
  } finally {
    fs.rmSync(LOCK, { force: true });
    fs.rmSync(ANCORA, { force: true });
  }
}

// Gli hook git non viaggiano con il repo: li mette qui, su ogni pc, all'avvio della sessione.
// Un hook che c'è già non viene sostituito: il blocco gli si aggiunge in fondo.
function installaHookGit() {
  const r = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !r.stdout.trim()) return [];
  const dir = path.resolve(ROOT, r.stdout.trim());
  const messi = [];
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const nome of HOOK_GIT) {
      const p = path.join(dir, nome);
      const prima = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      if (prima?.includes(SEGNO)) continue;
      if (prima === null) fs.writeFileSync(p, `#!/bin/sh\n${BLOCCO_GIT}`);
      else fs.appendFileSync(p, `${prima.endsWith('\n') ? '' : '\n'}\n${BLOCCO_GIT}`);
      try { fs.chmodSync(p, 0o755); } catch { /* Windows */ }
      messi.push(nome);
    }
  } catch { /* cartella degli hook non scrivibile: niente aggiornamento al pull, il resto funziona */ }
  return messi;
}

const COME_INSTALLARE = `graphify non è installato su questa macchina, quindi il grafo del codice (graphify-out/) non è disponibile.
Di' all'utente, prima di tutto il resto, che per installarlo serve Python 3.10-3.13 (non 3.14+, mancano i pacchetti):
  Windows:  py install 3.13   poi   py -V:3.13 -m pip install "graphifyy[sql,pdf]"
  Mac/Linux: pipx install "graphifyy[sql,pdf]"   (oppure: uv tool install "graphifyy[sql,pdf]")
poi "graphify install" (installa la skill /graphify in Claude Code) e infine "/graphify ." in Claude Code nella cartella del progetto per costruire il grafo.
Fino ad allora leggi i file normalmente.`;

const [modo, sotto] = process.argv.slice(2);
const cmd = trovaGraphify();

if (modo === 'guard') {
  if (!cmd) process.exit(0);
  const r = spawnSync(cmd[0], [...cmd.slice(1), 'hook-guard', sotto], {
    cwd: ROOT, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, GRAPHIFY_NO_AUTO_REFRESH: '1' },
  });
  process.exit(r.status ?? 0);
} else if (modo === 'avvio') {
  if (cmd) installaHookGit();
  if (!cmd) {
    console.log(COME_INSTALLARE);
  } else if (!fs.existsSync(GRAPH)) {
    console.log('Il grafo di graphify non esiste ancora su questa macchina. Proponi all\'utente di eseguire "/graphify ." per costruirlo (codice e documenti); fino ad allora leggi i file normalmente.');
  } else if (codiceCambiato()) {
    aggiornaInBackground();
    console.log('Il codice è cambiato dall\'ultimo grafo (es. dopo un pull): graphify lo sta aggiornando in background, pronto tra circa 15 secondi.');
  }
} else if (modo === 'aggiorna') {
  if (cmd && fs.existsSync(GRAPH) && codiceCambiato()) aggiornaInBackground();
} else if (modo === 'installa-git') {
  const messi = installaHookGit();
  console.log(messi.length ? `hook git messi: ${messi.join(', ')}` : 'hook git già a posto');
} else if (modo === 'esegui') {
  if (cmd) esegui(cmd); else fs.rmSync(LOCK, { force: true });
} else if (modo) {
  // Qualsiasi altro comando passa a graphify così com'è: query, path, explain, update...
  if (!cmd) { console.error(COME_INSTALLARE); process.exit(1); }
  const r = spawnSync(cmd[0], [...cmd.slice(1), ...process.argv.slice(2)], {
    stdio: 'inherit', windowsHide: true,
    env: { ...process.env, GRAPHIFY_NO_AUTO_REFRESH: '1', PYTHONIOENCODING: 'utf-8' },
  });
  process.exit(r.status ?? 1);
} else {
  console.error('uso: node .claude/hooks/graphify.mjs <query|path|explain|update|...> oppure guard|avvio|aggiorna (hook)');
  process.exit(1);
}
