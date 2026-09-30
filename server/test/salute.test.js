// Il controllo di salute che Railway interroga a ogni rilascio.
//
// Rispondeva "ok" anche con il database irraggiungibile, e un server che non poteva leggere né
// scrivere niente risultava sano. Ora risponde "ok" solo se il database risponde.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/client.js';

let app;

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
});

after(async () => {
	await app.close();
	await pool.end();
});

test('con il database raggiungibile, /health lo dice in JSON', async () => {
	const res = await app.inject({ method: 'GET', url: '/health' });
	assert.equal(res.statusCode, 200, res.body);
	const corpo = res.json();
	assert.equal(corpo.ok, true);
	assert.equal(corpo.database, true);
	assert.ok(corpo.entities > 0);
});
