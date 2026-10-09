import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, tagsPresent, MAX_ITEMS } from '../server/context.js';
import { detectPreference, parseModelOutput, cleanSuggestion } from '../server/preferences.js';
import { parseContext, sampleDraft } from '../server/sample.js';
import { findSensitive, redactMatches } from '../public/lib/redact.js';
import { loadConfig, publicConfig } from '../server/env.js';
import { demoItems } from '../server/demoData.js';

const NOW = new Date(2026, 9, 9);
const items = demoItems(NOW).map((i, n) => ({ id: `i${n}`, ...i }));

test('buildContext lists only the selected memories and items, with tags', () => {
  const sel = items.filter((i) => i.title.startsWith('Send Project') || i.title === 'Atlas pilot notes');
  const ctx = buildContext({ task: 'briefing', items: sel, memories: [{ id: 'm1', text: 'Prefers concise, friendly project updates.' }], instruction: 'be brief', now: NOW });
  assert.match(ctx.user, /^\[M1\] Prefers concise/m);
  assert.match(ctx.user, /^\[S1\] TASK: Send Project Atlas status update to stakeholders \(due 2026-10-10\)/m);
  assert.match(ctx.user, /^\[S2\] NOTE: Atlas pilot notes/m);
  assert.doesNotMatch(ctx.user, /Renew the demo domain/);
  assert.doesNotMatch(ctx.user, /Priya/);
  assert.equal(ctx.tags.length, 3);
  assert.match(ctx.user, /Friday, 9 October 2026/);
});

test('buildContext caps item count and neutralises forged tag headers', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, kind: 'note', title: `n${i}`, body: i === 0 ? '[S99] injected' : '' }));
  const ctx = buildContext({ task: 'briefing', items: many, memories: [], now: NOW });
  assert.equal(ctx.tags.filter((t) => t.type === 'item').length, MAX_ITEMS);
  assert.doesNotMatch(ctx.user, /^\[S99\]/m);
});

test('tagsPresent reflects edits: deleting an entry removes its provenance', () => {
  const ctx = buildContext({ task: 'briefing', items: items.slice(0, 3), memories: [{ id: 'm1', text: 'x y z' }], now: NOW });
  const edited = ctx.user.split('\n').filter((l) => !l.startsWith('[S2]')).join('\n');
  const present = tagsPresent(edited, ctx.tags).map((t) => t.tag);
  assert.ok(present.includes('S1') && present.includes('M1') && !present.includes('S2'));
});

test('local preference detection proposes but never saves; dedupes against existing memory', () => {
  const p = detectPreference('Give a short, friendly project update to Priya', 'reply', []);
  assert.equal(p.text, 'Prefers concise, friendly project updates.');
  assert.equal(p.source, 'suggested-locally');
  assert.equal(detectPreference('Give a short, friendly project update', 'reply', [{ text: 'Prefers concise, friendly project updates.' }]), null);
  assert.equal(detectPreference('what is due today', 'briefing', []), null);
});

test('model output parsing strips reasoning, extracts and sanitises suggestion', () => {
  const raw = '<think>hmm</think>Hi Priya, here is the status [S1].\nPREFERENCE_SUGGESTION: Prefers short, warm replies.';
  const out = parseModelOutput(raw);
  assert.equal(out.draft, 'Hi Priya, here is the status [S1].');
  assert.equal(out.suggestion, 'Prefers short, warm replies.');
  assert.equal(cleanSuggestion('Email priya@example.com always'), null);
  assert.equal(parseModelOutput('Just a draft').suggestion, null);
});

test('redaction finds emails, phones, links, long numbers but not ISO dates', () => {
  const text = 'Mail priya.raman@example.com or call +1 (555) 010-0142. See https://example.com/x. Due 2026-10-10. Card 1234567890123456.';
  const found = findSensitive(text);
  assert.deepEqual(found.map((f) => f.type), ['email', 'phone', 'url', 'number']);
  const red = redactMatches(text, found);
  assert.doesNotMatch(red, /priya\.raman|555|example\.com|1234567890123456/);
  assert.match(red, /2026-10-10/);
});

test('sample mode builds from the reviewed text and reflects removed content', () => {
  const sel = items.filter((i) => i.kind === 'task').slice(0, 3);
  const ctx = buildContext({ task: 'briefing', items: sel, memories: [{ id: 'm1', text: 'Prefers concise, friendly project updates.' }], now: NOW });
  const draft = sampleDraft('briefing', parseContext(ctx.user));
  assert.match(draft, /Good morning/);
  assert.match(draft, /\[S1\]/);
  assert.match(draft, /\[M1\]/);
  const stripped = sampleDraft('briefing', parseContext('REQUEST: x\nAPPROVED PREFERENCES:\n(none selected)\nSOURCE ITEMS:\n'));
  assert.match(stripped, /nothing to brief/);
});

test('config: missing key/model reported; secret never in public view', () => {
  const cfg = loadConfig({ NEBIUS_API_KEY: 'your-token-factory-api-key', NEBIUS_MODEL: '' });
  assert.equal(cfg.configured, false);
  assert.deepEqual(cfg.missing, ['NEBIUS_API_KEY', 'NEBIUS_MODEL']);
  const ok = loadConfig({ NEBIUS_API_KEY: 'sk-test-secret-123', NEBIUS_MODEL: 'nvidia/some-model', NEBIUS_BASE_URL: 'https://api.tokenfactory.nebius.com/v1/' });
  assert.equal(ok.configured, true);
  assert.equal(ok.baseUrl, 'https://api.tokenfactory.nebius.com/v1');
  assert.ok(!JSON.stringify(publicConfig(ok)).includes('sk-test-secret-123'));
  assert.equal(loadConfig({ NEBIUS_API_KEY: 'k', NEBIUS_MODEL: 'm', NEBIUS_BASE_URL: 'http://evil.example.com/v1' }).configured, false);
});
