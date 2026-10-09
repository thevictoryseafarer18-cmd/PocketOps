import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, publicConfig } from './env.js';
import { buildContext, tagsPresent, MAX_ITEMS } from './context.js';
import { detectPreference, parseModelOutput, sameText } from './preferences.js';
import { parseContext, sampleDraft } from './sample.js';
import { demoItems } from './demoData.js';
import * as defaultNebius from './nebius.js';
import { NebiusError } from './nebius.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_CONTEXT_CHARS = 20000;
const TASKS = ['briefing', 'reply'];
const SCOPES = ['all', 'briefing', 'reply'];
const KINDS = ['note', 'task', 'message'];
const MEMORY_SOURCES = ['user-written', 'suggested-locally', 'suggested-by-model'];

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (msg, code = 'bad_request') => new HttpError(400, code, msg);
const notFound = (what) => new HttpError(404, 'not_found', `${what} not found`);

const str = (v, max, { required = false, name = 'field' } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters)`);
  return s;
};
const dateOrNull = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('due must be YYYY-MM-DD');
  return v;
};
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export function createApp({ store, getConfig = () => loadConfig(), nebius = defaultNebius, now = () => new Date() }) {
  const app = express();
  const pending = new Map(); // in-memory only: contains personal context, never written to disk

  const sweep = () => { const t = Date.now(); for (const [k, v] of pending) if (v.expiresAt < t) pending.delete(k); };

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(PUBLIC_DIR));

  // ---------- status ----------
  const lastLiveCall = () => {
    const c = store.listCalls().find((x) => x.sent);
    return c ? { at: c.at, status: c.status, latencyMs: c.latencyMs ?? null, model: c.model, errorCode: c.errorCode ?? null } : null;
  };

  app.get('/api/status', (req, res) => {
    const cfg = getConfig();
    res.json({
      mode: cfg.configured ? 'live' : 'sample',
      ...publicConfig(cfg),
      lastCall: lastLiveCall(),
      counts: { items: store.listItems().length, memories: store.listMemories().length },
      storage: { kind: 'json-file', encrypted: false, file: store.file ? path.relative(process.cwd(), store.file) || store.file : '(in memory)' }
    });
  });

  app.post('/api/models/check', asyncH(async (req, res) => {
    const cfg = getConfig();
    if (!cfg.configured) throw new HttpError(400, 'not_configured', `Missing configuration: ${cfg.missing.join(', ')}.`);
    try {
      const ids = await nebius.listModels(cfg);
      const nvidia = ids.filter((m) => /nvidia|nemotron/i.test(m)).sort();
      res.json({ ok: true, model: cfg.model, available: ids.includes(cfg.model), nvidiaModels: nvidia, totalModels: ids.length,
        note: 'This request sent only your API key to Nebius, no notes, tasks or memories.' });
    } catch (e) { throw asNebiusHttp(e); }
  }));

  // ---------- items ----------
  const itemFields = (b, partial = false) => {
    const kind = b.kind;
    if (!partial && !KINDS.includes(kind)) throw bad('kind must be note, task or message');
    const f = {};
    if (!partial || b.title !== undefined) f.title = str(b.title, 140, { required: true, name: 'title' });
    if (!partial || b.body !== undefined) f.body = str(b.body, 4000, { name: 'body' });
    if (!partial || b.due !== undefined) f.due = dateOrNull(b.due);
    if (!partial || b.from !== undefined) f.from = str(b.from, 80, { name: 'from' }) || null;
    if (b.done !== undefined) f.done = !!b.done;
    if (!partial) f.kind = kind;
    return f;
  };

  app.get('/api/items', (req, res) => res.json({ items: store.listItems() }));
  app.post('/api/items', (req, res) => {
    const f = itemFields(req.body || {});
    if (f.kind !== 'task') f.due = null;
    if (f.kind !== 'message') f.from = null;
    res.status(201).json({ item: store.addItem(f) });
  });
  app.patch('/api/items/:id', (req, res) => {
    const it = store.getItem(req.params.id); if (!it) throw notFound('Item');
    const f = itemFields(req.body || {}, true);
    if (it.kind !== 'task') delete f.due;
    if (it.kind !== 'message') delete f.from;
    res.json({ item: store.updateItem(it.id, f) });
  });
  app.delete('/api/items/:id', (req, res) => {
    if (!store.deleteItem(req.params.id)) throw notFound('Item');
    res.json({ ok: true });
  });
  app.post('/api/demo/load', (req, res) => {
    if (store.listItems().some((i) => i.origin === 'demo')) return res.json({ added: 0, note: 'Demo data is already loaded.' });
    const added = demoItems(now()).map((i) => store.addItem(i));
    res.status(201).json({ added: added.length });
  });
  app.delete('/api/demo', (req, res) => res.json({ removed: store.removeDemoItems() }));

  // ---------- memories ----------
  const memoryText = (v) => str(v, 200, { required: true, name: 'memory text' });
  app.get('/api/memories', (req, res) => res.json({ memories: store.listMemories() }));
  // Creating a memory is an explicit user action: the UI only calls this from Save/Add buttons.
  app.post('/api/memories', (req, res) => {
    const b = req.body || {};
    const appliesTo = SCOPES.includes(b.appliesTo) ? b.appliesTo : 'all';
    res.status(201).json({ memory: store.addMemory({ text: memoryText(b.text), appliesTo, source: 'user-written' }) });
  });
  app.patch('/api/memories/:id', (req, res) => {
    const m = store.getMemory(req.params.id); if (!m) throw notFound('Memory');
    const b = req.body || {}; const patch = {};
    if (b.text !== undefined) patch.text = memoryText(b.text);
    if (b.appliesTo !== undefined) { if (!SCOPES.includes(b.appliesTo)) throw bad('invalid scope'); patch.appliesTo = b.appliesTo; }
    res.json({ memory: store.updateMemory(m.id, patch) });
  });
  app.delete('/api/memories/:id', (req, res) => {
    if (!store.deleteMemory(req.params.id)) throw notFound('Memory');
    res.json({ ok: true });
  });
  app.delete('/api/memories', (req, res) => res.json({ removed: store.deleteAllMemories() }));

  // ---------- step 1: prepare (NO model call) ----------
  app.post('/api/prepare', (req, res) => {
    sweep();
    const b = req.body || {};
    if (!TASKS.includes(b.task)) throw bad('task must be briefing or reply');
    const ids = Array.isArray(b.itemIds) ? [...new Set(b.itemIds)] : [];
    const memIds = Array.isArray(b.memoryIds) ? [...new Set(b.memoryIds)] : [];
    const items = ids.map((i) => store.getItem(i)).filter(Boolean);
    const memories = memIds.map((i) => store.getMemory(i)).filter(Boolean);
    if (items.length > MAX_ITEMS) throw bad(`Select at most ${MAX_ITEMS} items to keep the context small.`);
    if (b.task === 'reply' && items.filter((i) => i.kind === 'message').length !== 1) throw bad('Choose exactly one message to reply to.');
    if (b.task === 'briefing' && !items.length) throw bad('Select at least one task or note for the briefing.');
    if (b.task === 'briefing' && items.some((i) => i.kind === 'message')) throw bad('Messages are only used for replies.');
    const ctx = buildContext({ task: b.task, items, memories, instruction: str(b.instruction, 600, { name: 'instruction' }), now: now() });
    const pid = `p_${crypto.randomBytes(8).toString('hex')}`;
    const rec = { id: pid, task: b.task, system: ctx.system, user: ctx.user, tags: ctx.tags, expiresAt: Date.now() + PENDING_TTL_MS };
    pending.set(pid, rec);
    res.status(201).json(pendingView(rec, cfgView()));
  });

  const cfgView = () => publicConfig(getConfig());
  const totals = () => ({ items: store.listItems().length, memories: store.listMemories().length });
  const pendingView = (p, cfg) => ({
    pendingId: p.id, task: p.task, system: p.system, user: p.user, tags: p.tags,
    expiresAt: new Date(p.expiresAt).toISOString(),
    destination: { mode: cfg.configured ? 'live' : 'sample', host: cfg.endpointHost, model: cfg.model, missing: cfg.missing },
    totals: totals()
  });

  app.get('/api/pending/:id', (req, res) => {
    sweep();
    const p = pending.get(req.params.id); if (!p) throw notFound('This review (it may have expired or been cancelled)');
    res.json(pendingView(p, cfgView()));
  });
  app.delete('/api/pending/:id', (req, res) => { pending.delete(req.params.id); res.json({ ok: true, sent: false }); });

  // ---------- step 2: generate (only after explicit approval of the exact text) ----------
  app.post('/api/generate', asyncH(async (req, res) => {
    sweep();
    const b = req.body || {};
    if (b.approved !== true) throw new HttpError(400, 'approval_required', 'Explicit approval of the reviewed context is required.');
    const p = pending.get(b.pendingId);
    if (!p) throw new HttpError(404, 'review_expired', 'This review expired or was cancelled. Prepare the request again.');
    const user = typeof b.user === 'string' ? b.user.trim() : '';
    if (!user) throw bad('The context is empty. Nothing to send.');
    if (user.length > MAX_CONTEXT_CHARS) throw bad(`The context is too long (max ${MAX_CONTEXT_CHARS} characters).`);

    const cfg = getConfig();
    const used = tagsPresent(user, p.tags);
    const usedMemories = used.filter((t) => t.type === 'memory');
    const usedItems = used.filter((t) => t.type === 'item');
    const live = cfg.configured;
    const call = {
      task: p.task, mode: live ? 'live' : 'sample', sent: live, model: live ? cfg.model : null,
      endpointHost: live ? publicConfig(cfg).endpointHost : null,
      chars: user.length, memoryCount: usedMemories.length, itemCount: usedItems.length, sentText: user
    };

    let draft; let rawSuggestion = null; let usage = null; let model = null; let latencyMs = null;
    if (live) {
      try {
        const out = await nebius.chat(cfg, { system: p.system, user });
        const parsed = parseModelOutput(out.text);
        if (!parsed.draft) throw new NebiusError('empty_response', 'The model returned no usable text.', 502);
        draft = parsed.draft; rawSuggestion = parsed.suggestion; usage = out.usage; model = out.model; latencyMs = out.latencyMs;
      } catch (e) {
        store.addCall({ ...call, status: 'error', errorCode: e.code || 'error' });
        throw asNebiusHttp(e);
      }
    } else {
      draft = sampleDraft(p.task, parseContext(user));
    }

    // Provenance is computed from what actually remained in the approved text.
    const snapMem = usedMemories.map((t) => ({ tag: t.tag, id: t.id, text: store.getMemory(t.id)?.text ?? t.label }));
    const snapItems = usedItems.map((t) => {
      const it = store.getItem(t.id);
      return { tag: t.tag, id: t.id, kind: it?.kind || t.label.split(':')[0], title: it?.title || t.label.replace(/^[^:]*:\s*/, ''), origin: it?.origin || 'user' };
    });
    const notIncluded = { items: Math.max(0, store.listItems().length - snapItems.length), memories: Math.max(0, store.listMemories().length - snapMem.length) };

    // Suggestions (never saved here). Dedupe against existing memories.
    const existing = store.listMemories();
    const suggestions = [];
    const local = detectPreference(parseContext(user).instruction, p.task, existing);
    if (local) suggestions.push(local);
    if (rawSuggestion && !existing.some((m) => sameText(m.text, rawSuggestion)) && !suggestions.some((s) => sameText(s.text, rawSuggestion))) {
      suggestions.push({ text: rawSuggestion, appliesTo: 'all', source: 'suggested-by-model' });
    }
    suggestions.forEach((s, i) => { s.id = `s${i + 1}`; s.status = 'open'; });

    const result = store.addResult({
      task: p.task, mode: call.mode, model, label: live ? 'DRAFT' : 'SAMPLE DRAFT',
      draft, suggestions, provenance: { memories: snapMem, items: snapItems, notIncluded }, sentText: user, usage, latencyMs
    });
    store.addCall({ ...call, status: live ? 'ok' : 'sample', latencyMs, usage, resultId: result.id });
    store.markMemoriesUsed(usedMemories.map((t) => t.id));
    pending.delete(p.id);
    res.status(201).json({ result: viewResult(result) });
  }));

  function asNebiusHttp(e) {
    if (e instanceof HttpError) return e;
    if (e instanceof NebiusError) return new HttpError(e.code === 'auth' || e.code === 'model_not_found' ? 502 : (e.status && e.status >= 400 ? 502 : 502), `nebius_${e.code}`, e.message);
    return e;
  }

  // ---------- results ----------
  function viewResult(r) {
    const memories = r.provenance.memories.map((m) => {
      const cur = store.getMemory(m.id);
      return { ...m, state: !cur ? 'deleted' : (cur.text !== m.text ? 'edited' : 'unchanged'), currentText: cur?.text ?? null };
    });
    const items = r.provenance.items.map((i) => ({ ...i, exists: !!store.getItem(i.id) }));
    return { ...r, provenance: { ...r.provenance, memories, items } };
  }
  app.get('/api/results', (req, res) => res.json({ results: store.listResults().map((r) => ({ id: r.id, task: r.task, mode: r.mode, label: r.label, createdAt: r.createdAt, model: r.model, preview: r.draft.slice(0, 120) })) }));
  app.get('/api/results/:id', (req, res) => {
    const r = store.getResult(req.params.id); if (!r) throw notFound('Result');
    res.json({ result: viewResult(r) });
  });
  app.delete('/api/results/:id', (req, res) => { if (!store.deleteResult(req.params.id)) throw notFound('Result'); res.json({ ok: true }); });

  // Suggestion approval: the only code path that turns a suggestion into a memory. Called from a user click.
  app.post('/api/results/:id/suggestions/:sid/approve', (req, res) => {
    const r = store.getResult(req.params.id); if (!r) throw notFound('Result');
    const s = r.suggestions.find((x) => x.id === req.params.sid); if (!s) throw notFound('Suggestion');
    if (s.status !== 'open') throw bad('This suggestion was already handled.');
    const b = req.body || {};
    const text = memoryText(b.text ?? s.text);
    const appliesTo = SCOPES.includes(b.appliesTo) ? b.appliesTo : s.appliesTo;
    const memory = store.addMemory({ text, appliesTo, source: MEMORY_SOURCES.includes(s.source) ? s.source : 'user-written' });
    s.status = 'saved'; s.memoryId = memory.id; store.save();
    res.status(201).json({ memory, result: viewResult(r) });
  });
  app.post('/api/results/:id/suggestions/:sid/dismiss', (req, res) => {
    const r = store.getResult(req.params.id); if (!r) throw notFound('Result');
    const s = r.suggestions.find((x) => x.id === req.params.sid); if (!s) throw notFound('Suggestion');
    if (s.status === 'open') { s.status = 'dismissed'; store.save(); }
    res.json({ result: viewResult(r) });
  });

  // ---------- activity / data controls ----------
  app.get('/api/calls', (req, res) => res.json({ calls: store.listCalls() }));
  app.delete('/api/calls', (req, res) => res.json({ removed: store.clearCalls() }));
  app.get('/api/export', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="pocketops-export.json"');
    res.json(store.exportAll());
  });
  app.post('/api/erase-all', (req, res) => {
    if (req.body?.confirm !== true) throw bad('confirm must be true');
    store.eraseAll(); pending.clear(); res.json({ ok: true });
  });

  // ---------- errors ----------
  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route' } }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'Invalid JSON body' } });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'Request too large' } });
    console.error('[pocketops] unexpected error:', err.message); // message only: never log request bodies
    res.status(500).json({ error: { code: 'internal', message: 'Unexpected server error' } });
  });

  return app;
}
