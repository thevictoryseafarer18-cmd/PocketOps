// Simple pattern-based detector for sensitive-looking text. It is a convenience, NOT a guarantee:
// the user is always the final judge of what is sent. Works in the browser and in Node tests.

const PATTERNS = [
  { type: 'email', label: 'email address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'url', label: 'link', re: /https?:\/\/[^\s)]+/gi },
  {
    type: 'phone', label: 'phone number', re: /(?<![\w-])\+?\d[\d ().-]{7,}\d(?![\w-])/g,
    accept: (s) => { const d = s.replace(/\D/g, '').length; return d >= 9 && d <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(s); }
  },
  { type: 'number', label: 'long number', re: /\b\d{9,}\b/g }
];

/** @returns {Array<{type:string,label:string,start:number,end:number,text:string}>} non-overlapping matches */
export function findSensitive(text) {
  const all = [];
  for (const p of PATTERNS) {
    for (const m of String(text).matchAll(p.re)) {
      if (p.accept && !p.accept(m[0])) continue;
      all.push({ type: p.type, label: p.label, start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const m of all) if (!out.length || m.start >= out[out.length - 1].end) out.push(m);
  return out;
}

export function redactMatches(text, matches) {
  let out = String(text);
  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, m.start)}[REDACTED-${m.type.toUpperCase()}]${out.slice(m.end)}`;
  }
  return out;
}

export function summarize(matches) {
  const by = {};
  for (const m of matches) by[m.label] = (by[m.label] || 0) + 1;
  return by;
}

export const approxTokens = (text) => Math.ceil(String(text).length / 4);
