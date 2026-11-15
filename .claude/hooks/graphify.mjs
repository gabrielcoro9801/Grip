#!/usr/bin/env node
// Collega Claude Code a graphify, il grafo del codice in graphify-out/.
// Lo lanciano gli hook di .claude/settings.json; non serve chiamarlo a mano.
//
//   guard <search|read|compact>  passa la chiamata a `graphify hook-guard`
//   avvio                        inizio sessione: dice se graphify manca, aggiorna se il codice è cambiato
//   aggiorna                     fine turno: aggiorna il grafo in background se il codice è cambiato
//   <altro>                      passa a graphify (query, path, explain, update...), anche se non è nel PATH
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

function ultimaModifica(dir) {
  let max = 0;
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
  let grafo;
  try { grafo = fs.statSync(GRAPH).mtimeMs; } catch { return true; }
  return CODICE.some((d) => ultimaModifica(path.join(ROOT, d)) > grafo);
}

function aggiornamentoInCorso() {
  try {
    // Un lucchetto più vecchio di 10 minuti è rimasto da un aggiornamento interrotto.
    return Date.now() - fs.statSync(LOCK).mtimeMs < 10 * 60 * 1000;
  } catch { return false; }
}

// Lancia l'aggiornamento staccato, così Claude non aspetta i ~15 secondi.
function aggiornaInBackground() {
  if (aggiornamentoInCorso()) return;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  const figlio = spawn(process.execPath, [fileURLToPath(import.meta.url), 'esegui'], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
  });
  figlio.unref();
}

function esegui(cmd) {
  try {
    const r = spawnSync(cmd[0], [...cmd.slice(1), 'update', '.'], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GRAPHIFY_NO_AUTO_REFRESH: '1', PYTHONIOENCODING: 'utf-8' },
    });
    fs.writeFileSync(LOG, `${new Date().toISOString()} exit ${r.status}\n${r.stdout || ''}${r.stderr || ''}`);
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
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
