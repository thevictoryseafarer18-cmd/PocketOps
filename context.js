// Builds the EXACT text that may be sent to the hosted model. Nothing here talks to the network.

export const MAX_ITEMS = 15;
export const MAX_BODY = 700;

export const SYSTEM_PROMPTS = {
  briefing: [
    'You are PocketOps, a personal workflow assistant. You write DRAFTS only: the user reviews everything, and nothing is sent or executed on their behalf.',
    'Use ONLY the information in the user message. Do not invent facts, names, dates or commitments. If something is missing, say so briefly.',
    'Cite the source items you rely on with their tags, for example [S1]. Apply the approved preferences (tags like [M1]) when they are relevant. Plain text only, no tables.',
    'Task: write a daily briefing under 180 words: a one-line summary, then "Top priorities" (max 3), "Due soon", and "Heads-up" if the sources justify it.',
    'After the draft, if and only if the user\'s instruction reveals a stable, reusable style preference that is NOT already listed under approved preferences, add one final line in exactly this form: PREFERENCE_SUGGESTION: <one short sentence, no names or personal details>. Otherwise do not add that line.'
  ].join('\n'),
  reply: [
    'You are PocketOps, a personal workflow assistant. You write DRAFTS only: the user reviews everything, and nothing is sent or executed on their behalf.',
    'Use ONLY the information in the user message. Do not invent facts, names, dates or commitments. If something is missing, say so briefly.',
    'Cite the source items you rely on with their tags, for example [S2]. Apply the approved preferences (tags like [M1]) when they are relevant. Plain text only.',
    'Task: write a short reply (under 120 words) to the message marked MESSAGE. Greet the sender by first name. Do not promise anything the sources do not support.',
    'After the draft, if and only if the user\'s instruction reveals a stable, reusable style preference that is NOT already listed under approved preferences, add one final line in exactly this form: PREFERENCE_SUGGESTION: <one short sentence, no names or personal details>. Otherwise do not add that line.'
  ].join('\n')
};

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Prevent user text from forging tag headers such as "[S1]" at the start of a line.
const safeBody = (s) => clip(String(s || '').trim(), MAX_BODY).replace(/^\[([SM]\d+)\]/gm, '($1)');

const KIND_ORDER = { message: 0, task: 1, note: 2 };

export function localISODate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function orderItems(items) {
  return [...items].sort((a, b) => {
    const k = (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
    if (k) return k;
    return (a.due || '9999').localeCompare(b.due || '9999');
  });
}

/**
 * @returns {{system:string,user:string,tags:Array<{tag:string,type:'item'|'memory',id:string,label:string}>}}
 */
export function buildContext({ task, items, memories, instruction = '', now = new Date() }) {
  if (!SYSTEM_PROMPTS[task]) throw new Error('unknown task');
  const ordered = orderItems(items).slice(0, MAX_ITEMS);
  const tags = [];
  const lines = [];

  if (task === 'briefing') {
    const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    lines.push(`REQUEST: Daily briefing for ${date}.`);
  } else {
    lines.push('REQUEST: Draft a short reply to the MESSAGE below.');
  }
  const instr = clip(oneLine(instruction), 400);
  if (instr) lines.push(`INSTRUCTION FROM USER: ${instr}`);

  lines.push('', 'APPROVED PREFERENCES:');
  if (!memories.length) lines.push('(none selected)');
  memories.forEach((m, idx) => {
    const tag = `M${idx + 1}`;
    tags.push({ tag, type: 'memory', id: m.id, label: m.text });
    lines.push(`[${tag}] ${oneLine(m.text)}`);
  });

  lines.push('', 'SOURCE ITEMS:');
  ordered.forEach((it, idx) => {
    const tag = `S${idx + 1}`;
    tags.push({ tag, type: 'item', id: it.id, label: `${it.kind}: ${it.title}` });
    const title = oneLine(it.title).replace(/[:()]/g, ' ').replace(/\s+/g, ' ').trim();
    let head = `[${tag}] ${it.kind.toUpperCase()}`;
    if (it.kind === 'message' && it.from) head += ` from ${oneLine(it.from).replace(/:/g, '')}`;
    head += `: ${title}`;
    if (it.kind === 'task' && it.due) head += ` (due ${it.due})`;
    lines.push(head);
    const body = safeBody(it.body);
    if (body) lines.push(body);
  });

  return { system: SYSTEM_PROMPTS[task], user: lines.join('\n'), tags };
}

/** Which tags still appear as headers in the (possibly edited/redacted) text. */
export function tagsPresent(text, tags) {
  const found = new Set();
  for (const m of String(text).matchAll(/^\[([SM]\d+)\]/gm)) found.add(m[1]);
  return tags.filter((t) => found.has(t.tag));
}
