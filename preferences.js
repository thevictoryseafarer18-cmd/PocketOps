// Preference suggestion helpers. Suggestions are only ever PROPOSALS; code here never saves anything.

const ADJ = [
  ['concise', /\b(concise|short|brief|succinct|to the point|crisp)\b/i],
  ['friendly', /\b(friendly|warm|upbeat|casual|kind)\b/i],
  ['professional', /\b(formal|professional)\b/i],
  ['bulleted', /\b(bullets?|bulleted)\b/i]
];

const SENSITIVE = /@|\d{6,}|https?:\/\//i;

/** Local (rule-based, no network) detection from the user's own instruction text. */
export function detectPreference(instruction, task, existingMemories = []) {
  const text = String(instruction || '');
  const adjs = ADJ.filter(([, re]) => re.test(text)).map(([a]) => a);
  if (!adjs.length) return null;
  let noun; let appliesTo;
  if (/\b(update|status|progress)\b/i.test(text)) { noun = 'project updates'; appliesTo = 'all'; }
  else if (task === 'reply') { noun = 'replies'; appliesTo = 'reply'; }
  else { noun = 'daily briefings'; appliesTo = 'briefing'; }
  const phrase = adjs.length > 1 ? `${adjs.slice(0, -1).join(', ')}, ${adjs.at(-1)}` : adjs[0];
  const proposal = `Prefers ${phrase} ${noun}.`;
  const covered = existingMemories.some((m) => adjs.every((a) => m.text.toLowerCase().includes(a)));
  if (covered) return null;
  return { text: proposal, appliesTo, source: 'suggested-locally' };
}

export function cleanSuggestion(raw) {
  let s = String(raw || '').split('\n')[0].trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (s.length < 8 || s.length > 160) return null;
  if (SENSITIVE.test(s)) return null; // never propose a memory that looks like contact data or links
  return s;
}

/** Splits raw model output into the draft and an optional suggested preference. */
export function parseModelOutput(raw) {
  let text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
  let suggestion = null;
  const m = text.match(/^\s*PREFERENCE_SUGGESTION:\s*(.+)$/im);
  if (m) {
    suggestion = cleanSuggestion(m[1]);
    text = text.replace(/^\s*PREFERENCE_SUGGESTION:.*$/gim, '').trim();
  }
  return { draft: text, suggestion };
}

export function sameText(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
