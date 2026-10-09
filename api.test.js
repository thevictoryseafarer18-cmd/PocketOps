import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/env.js';

const SECRET = 'test-secret-key-do-not-leak-0123456789';
const NOW = new Date(2026, 9, 9);

/** A local mock of an OpenAI-compatible endpoint. It records what it receives. This is NOT the real Nebius service. */
function startMock(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rec = { method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null };
      seen.push(rec);
      handler(rec, res);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/v1` })));
}
const okChat = (text) => (rec, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (rec.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'nvidia/mock-nemotron' }, { id: 'other/model' }] }));
  res.end(JSON.stringify({ model: 'nvidia/mock-nemotron', choices: [{ message: { content: text } }], usage: { total_tokens: 42 } }));
};

async function boot({ configured, mock }) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pocketops-')), 'store.json');
  const store = new Store(file);
  const env = configured ? { NEBIUS_API_KEY: SECRET, NEBIUS_MODEL: 'nvidia/mock-nemotron', NEBIUS_BASE_URL: mock.url } : {};
  const app = createApp({ store, getConfig: () => loadConfig(env), now: () => NOW });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  return { call, file, store, close: () => server.close() };
}

test('sample mode: no key means no network call, output labelled SAMPLE', async () => {
  const t = await boot({ configured: false });
  await t.call('POST', '/api/demo/load', {});
  const items = (await t.call('GET', '/api/items')).json.items;
  const ids = items.filter((i) => i.kind === 'task').slice(0, 2).map((i) => i.id);
  const prep = (await t.call('POST', '/api/prepare', { task: 'briefing', itemIds: ids, memoryIds: [], instruction: 'short and friendly project update' })).json;
  assert.equal(prep.destination.mode, 'sample');
  const gen = await t.call('POST', '/api/generate', { pendingId: prep.pendingId, user: prep.user, approved: true });
  assert.equal(gen.status, 201);
  assert.equal(gen.json.result.label, 'SAMPLE DRAFT');
  assert.equal(gen.json.result.mode, 'sample');
  const calls = (await t.call('GET', '/api/calls')).json.calls;
  assert.equal(calls[0].sent, false);
  const status = (await t.call('GET', '/api/status')).json;
  assert.equal(status.configured, false);
  assert.equal(status.lastCall, null); // sample drafts never masquerade as a model call
  t.close();
});

test('live mode: sends exactly the approved (edited) text, key only in auth header, memory never auto-saved', async () => {
  const mock = await startMock(okChat('Hi Priya, quick update [S1].\nPREFERENCE_SUGGESTION: Prefers warm, brief replies.'));
  const t = await boot({ configured: true, mock });
  await t.call('POST', '/api/demo/load', {});
  const items = (await t.call('GET', '/api/items')).json.items;
  const msg = items.find((i) => i.kind === 'message' && i.from === 'Priya Raman');
  const note = items.find((i) => i.title === 'Atlas pilot notes');
  const prep = (await t.call('POST', '/api/prepare', { task: 'reply', itemIds: [msg.id, note.id], memoryIds: [], instruction: 'keep it short and friendly, project update' })).json;
  assert.equal(mock.seen.length, 0, 'prepare must not call the model');
  assert.match(prep.user, /priya\.raman@example\.com/);

  // user redacts contact info and removes the note, then approves
  const edited = prep.user.replace(/priya\.raman@example\.com \| \+1 \(555\) 010-0142/, '[REDACTED]').split('\n').filter((l) => !l.startsWith('[S2]') && !l.startsWith('Pilot teams like')).join('\n');

  const noApproval = await t.call('POST', '/api/generate', { pendingId: prep.pendingId, user: edited });
  assert.equal(noApproval.status, 400);
  assert.equal(noApproval.json.error.code, 'approval_required');
  assert.equal(mock.seen.length, 0, 'no call without approval');
  assert.equal((await t.call('POST', '/api/generate', { pendingId: 'p_bogus', user: edited, approved: true })).status, 404);

  const gen = await t.call('POST', '/api/generate', { pendingId: prep.pendingId, user: edited, approved: true });
  assert.equal(gen.status, 201);
  assert.equal(mock.seen.length, 1);
  const sent = mock.seen[0];
  assert.equal(sent.auth, `Bearer ${SECRET}`);
  assert.equal(sent.body.model, 'nvidia/mock-nemotron');
  assert.equal(sent.body.messages[1].content, edited, 'server sends byte-for-byte what the user approved');
  assert.doesNotMatch(JSON.stringify(sent.body), /priya\.raman@example\.com|555/);
  assert.doesNotMatch(sent.body.messages[1].content, /Atlas pilot notes/);

  const r = gen.json.result;
  assert.equal(r.label, 'DRAFT');
  assert.equal(r.model, 'nvidia/mock-nemotron');
  assert.deepEqual(r.provenance.items.map((i) => i.tag), ['S1'], 'provenance reflects the removed note');
  assert.ok(!r.draft.includes('PREFERENCE_SUGGESTION'));

  // suggestions exist but NOTHING is saved until approval
  assert.ok(r.suggestions.length >= 1);
  assert.equal((await t.call('GET', '/api/memories')).json.memories.length, 0);
  const local = r.suggestions.find((s) => s.source === 'suggested-locally');
  const approve = await t.call('POST', `/api/results/${r.id}/suggestions/${local.id}/approve`, { text: 'Prefers concise, friendly project updates.', appliesTo: 'all' });
  assert.equal(approve.status, 201);
  const mems = (await t.call('GET', '/api/memories')).json.memories;
  assert.equal(mems.length, 1);
  assert.equal(mems[0].source, 'suggested-locally');

  // a pending review is single-use
  assert.equal((await t.call('POST', '/api/generate', { pendingId: prep.pendingId, user: edited, approved: true })).status, 404);

  // the secret is never returned by the API nor written to the data file
  for (const p of ['/api/status', '/api/calls', '/api/export', `/api/results/${r.id}`]) assert.ok(!(await t.call('GET', p)).text.includes(SECRET), p);
  assert.ok(!fs.readFileSync(t.file, 'utf8').includes(SECRET));
  assert.equal(fs.statSync(t.file).mode & 0o777, 0o600);
  t.close(); mock.server.close();
});

test('later request reuses an approved memory; provenance tracks edit and delete', async () => {
  const mock = await startMock(okChat('Draft using preference [M1] and [S1].'));
  const t = await boot({ configured: true, mock });
  const mem = (await t.call('POST', '/api/memories', { text: 'Prefers concise, friendly project updates.', appliesTo: 'all' })).json.memory;
  await t.call('POST', '/api/demo/load', {});
  const task = (await t.call('GET', '/api/items')).json.items.find((i) => i.kind === 'task');
  const prep = (await t.call('POST', '/api/prepare', { task: 'briefing', itemIds: [task.id], memoryIds: [mem.id] })).json;
  assert.match(prep.user, /\[M1\] Prefers concise/);
  const r = (await t.call('POST', '/api/generate', { pendingId: prep.pendingId, user: prep.user, approved: true })).json.result;
  assert.equal(r.provenance.memories[0].state, 'unchanged');
  assert.equal((await t.call('GET', '/api/memories')).json.memories[0].useCount, 1);

  await t.call('PATCH', `/api/memories/${mem.id}`, { text: 'Prefers formal updates.' });
  assert.equal((await t.call('GET', `/api/results/${r.id}`)).json.result.provenance.memories[0].state, 'edited');
  assert.equal((await t.call('DELETE', `/api/memories/${mem.id}`)).status, 200);
  assert.equal((await t.call('GET', `/api/results/${r.id}`)).json.result.provenance.memories[0].state, 'deleted');
  assert.equal((await t.call('GET', '/api/memories')).json.memories.length, 0);
  t.close(); mock.server.close();
});

test('upstream failures surface as errors, create no draft, and never fake success', async () => {
  const mock = await startMock((rec, res) => { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { message: `bad key ${SECRET}` } })); });
  const t = await boot({ configured: true, mock });
  await t.call('POST', '/api/demo/load', {});
  const task = (await t.call('GET', '/api/items')).json.items.find((i) => i.kind === 'task');
  const prep = (await t.call('POST', '/api/prepare', { task: 'briefing', itemIds: [task.id], memoryIds: [] })).json;
  const gen = await t.call('POST', '/api/generate', { pendingId: prep.pendingId, user: prep.user, approved: true });
  assert.equal(gen.status, 502);
  assert.equal(gen.json.error.code, 'nebius_auth');
  assert.ok(!gen.text.includes(SECRET));
  assert.equal((await t.call('GET', '/api/results')).json.results.length, 0);
  const status = (await t.call('GET', '/api/status')).json;
  assert.equal(status.lastCall.status, 'error');
  // retry stays possible: pending still valid
  assert.equal((await t.call('GET', `/api/pending/${prep.pendingId}`)).status, 200);
  t.close(); mock.server.close();
});

test('cancel discards the pending review; models/check lists NVIDIA models without personal data', async () => {
  const mock = await startMock(okChat('x'));
  const t = await boot({ configured: true, mock });
  await t.call('POST', '/api/demo/load', {});
  const task = (await t.call('GET', '/api/items')).json.items.find((i) => i.kind === 'task');
  const prep = (await t.call('POST', '/api/prepare', { task: 'briefing', itemIds: [task.id], memoryIds: [] })).json;
  await t.call('DELETE', `/api/pending/${prep.pendingId}`);
  assert.equal((await t.call('GET', `/api/pending/${prep.pendingId}`)).status, 404);
  const chk = (await t.call('POST', '/api/models/check', {})).json;
  assert.equal(chk.available, true);
  assert.deepEqual(chk.nvidiaModels, ['nvidia/mock-nemotron']);
  assert.equal(mock.seen.length, 1);
  assert.equal(mock.seen[0].body, null);
  t.close(); mock.server.close();
});

test('validation: reply needs one message, memory text required, erase-all needs confirm', async () => {
  const t = await boot({ configured: false });
  await t.call('POST', '/api/demo/load', {});
  const items = (await t.call('GET', '/api/items')).json.items;
  assert.equal((await t.call('POST', '/api/prepare', { task: 'reply', itemIds: [items.find((i) => i.kind === 'task').id] })).status, 400);
  assert.equal((await t.call('POST', '/api/memories', { text: '  ' })).status, 400);
  assert.equal((await t.call('POST', '/api/erase-all', {})).status, 400);
  assert.equal((await t.call('POST', '/api/erase-all', { confirm: true })).status, 200);
  assert.equal((await t.call('GET', '/api/items')).json.items.length, 0);
  t.close();
});
