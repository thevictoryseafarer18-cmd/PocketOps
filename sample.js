// SAMPLE MODE: a deterministic, rule-based draft built from the reviewed text.
// It is NOT model output and is always labelled as such. No network is involved.

export function parseContext(text) {
  const out = { instruction: '', memories: [], items: [] };
  let cur = null;
  for (const line of String(text).split('\n')) {
    let m;
    if (line.startsWith('REQUEST:') || line === 'APPROVED PREFERENCES:' || line === 'SOURCE ITEMS:') { cur = null; continue; }
    if (line.startsWith('INSTRUCTION FROM USER:')) { out.instruction = line.slice(22).trim(); cur = null; continue; }
    if ((m = line.match(/^\[(M\d+)\] (.+)$/))) { out.memories.push({ tag: m[1], text: m[2] }); cur = null; continue; }
    if ((m = line.match(/^\[(S\d+)\] (TASK|NOTE|MESSAGE)(?: from ([^:]+))?: (.*?)(?: \(due (\d{4}-\d{2}-\d{2})\))?$/))) {
      cur = { tag: m[1], kind: m[2].toLowerCase(), from: m[3] || null, title: m[4], due: m[5] || null, body: '' };
      out.items.push(cur); continue;
    }
    if (cur) cur.body += (cur.body ? '\n' : '') + line;
  }
  out.items.forEach((i) => { i.body = i.body.trim(); });
  return out;
}

const firstSentence = (s) => (String(s).split(/(?<=[.!?])\s/)[0] || '').trim();

export function sampleDraft(task, parsed) {
  const prefs = parsed.memories.map((m) => m.text.toLowerCase()).join(' ');
  const concise = /concise|short|brief/.test(prefs) || /concise|short|brief/i.test(parsed.instruction);
  const friendly = /friendly|warm/.test(prefs) || /friendly|warm/i.test(parsed.instruction);
  const applied = parsed.memories.map((m) => `[${m.tag}]`).join(' ');
  const tasks = parsed.items.filter((i) => i.kind === 'task').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const notes = parsed.items.filter((i) => i.kind === 'note');

  if (task === 'briefing') {
    if (!tasks.length && !notes.length) return 'No tasks or notes were left in the reviewed text, so there is nothing to brief on.';
    const shown = concise ? tasks.slice(0, 3) : tasks;
    const out = [friendly ? 'Good morning! Here is your day at a glance.' : 'Daily briefing.', ''];
    if (shown.length) {
      out.push('Top priorities:');
      shown.forEach((t) => out.push(`- ${t.title}${t.due ? ` (due ${t.due})` : ''} [${t.tag}]`));
    }
    if (notes.length && !concise) {
      out.push('', 'Keep in mind:');
      notes.forEach((n) => out.push(`- ${n.title}: ${firstSentence(n.body)} [${n.tag}]`));
    }
    if (applied) out.push('', `(Sample mode applied your saved preferences ${applied}.)`);
    return out.join('\n');
  }

  const msg = parsed.items.find((i) => i.kind === 'message');
  if (!msg) return 'No message was left in the reviewed text, so there is nothing to reply to.';
  const first = (msg.from || 'there').split(/\s+/)[0];
  const support = parsed.items.filter((i) => i.kind !== 'message').slice(0, concise ? 2 : 4);
  const out = [friendly ? `Hi ${first}, thanks for reaching out!` : `Hello ${first},`, ''];
  out.push(`About "${msg.title}" [${msg.tag}]`);
  if (support.length) support.forEach((s) => out.push(`- ${s.title}${s.body ? `: ${firstSentence(s.body)}` : ''} [${s.tag}]`));
  else out.push('- (No supporting notes were included, so add the details you want to share.)');
  out.push('', concise ? 'Happy to share more if useful.' : 'Happy to share more detail or walk through any of this live if that would help.', '', 'Best,');
  if (applied) out.push('', `(Sample mode applied your saved preferences ${applied}.)`);
  return out.join('\n');
}
