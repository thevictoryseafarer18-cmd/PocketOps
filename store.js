import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const id = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;
const nowIso = () => new Date().toISOString();
const empty = () => ({ version: 1, items: [], memories: [], results: [], calls: [] });

/**
 * Tiny JSON-file store. Everything the user saves lives in ONE plain-text JSON file on the machine
 * running the server (file mode 0600). It is NOT encrypted and has no user accounts.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = empty();
    this.load();
  }

  load() {
    if (!this.file) return; // in-memory (tests)
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...empty(), ...parsed };
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[pocketops] could not read ${this.file}: ${e.message}. Starting empty.`);
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  // ---- items (notes, tasks, messages) ----
  listItems() { return this.data.items; }
  getItem(i) { return this.data.items.find((x) => x.id === i); }
  addItem(fields) {
    const item = { id: id('i'), done: false, origin: 'user', createdAt: nowIso(), updatedAt: nowIso(), ...fields };
    this.data.items.push(item); this.save(); return item;
  }
  updateItem(i, patch) {
    const it = this.getItem(i); if (!it) return null;
    Object.assign(it, patch, { updatedAt: nowIso() }); this.save(); return it;
  }
  deleteItem(i) {
    const n = this.data.items.length;
    this.data.items = this.data.items.filter((x) => x.id !== i); this.save();
    return this.data.items.length < n;
  }
  removeDemoItems() {
    const n = this.data.items.length;
    this.data.items = this.data.items.filter((x) => x.origin !== 'demo'); this.save();
    return n - this.data.items.length;
  }

  // ---- memories (only ever created by an explicit user action) ----
  listMemories() { return this.data.memories; }
  getMemory(i) { return this.data.memories.find((x) => x.id === i); }
  addMemory({ text, appliesTo, source }) {
    const t = nowIso();
    const m = { id: id('m'), text, appliesTo, source, approvedAt: t, createdAt: t, updatedAt: t, useCount: 0, lastUsedAt: null };
    this.data.memories.push(m); this.save(); return m;
  }
  updateMemory(i, patch) {
    const m = this.getMemory(i); if (!m) return null;
    Object.assign(m, patch, { updatedAt: nowIso() }); this.save(); return m;
  }
  deleteMemory(i) {
    const n = this.data.memories.length;
    this.data.memories = this.data.memories.filter((x) => x.id !== i); this.save();
    return this.data.memories.length < n;
  }
  deleteAllMemories() { const n = this.data.memories.length; this.data.memories = []; this.save(); return n; }
  markMemoriesUsed(ids) {
    const t = nowIso();
    for (const m of this.data.memories) if (ids.includes(m.id)) { m.useCount += 1; m.lastUsedAt = t; }
    this.save();
  }

  // ---- results & call log ----
  addResult(r) { const res = { id: id('r'), createdAt: nowIso(), ...r }; this.data.results.unshift(res); this.data.results = this.data.results.slice(0, 50); this.save(); return res; }
  getResult(i) { return this.data.results.find((x) => x.id === i); }
  listResults() { return this.data.results; }
  deleteResult(i) { const n = this.data.results.length; this.data.results = this.data.results.filter((x) => x.id !== i); this.save(); return this.data.results.length < n; }
  addCall(c) { const call = { id: id('c'), at: nowIso(), ...c }; this.data.calls.unshift(call); this.data.calls = this.data.calls.slice(0, 100); this.save(); return call; }
  listCalls() { return this.data.calls; }
  clearCalls() { const n = this.data.calls.length; this.data.calls = []; this.save(); return n; }

  exportAll() { return JSON.parse(JSON.stringify(this.data)); }
  eraseAll() { this.data = empty(); this.save(); }
}
