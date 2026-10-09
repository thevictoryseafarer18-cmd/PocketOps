// Nebius Token Factory client (OpenAI-compatible Chat Completions). The API key is read from the
// server-side config and used ONLY in the Authorization header. It is never logged or returned.

export class NebiusError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

const scrub = (s, key) => {
  let out = String(s ?? '');
  if (key) out = out.split(key).join('[key]');
  return out.slice(0, 300);
};

async function request(cfg, path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: ctrl.signal
    });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* non-JSON body */ }
    if (!res.ok) {
      const detail = scrub(json?.error?.message || json?.message || raw, cfg.apiKey);
      if (res.status === 401 || res.status === 403) throw new NebiusError('auth', `Nebius rejected the API key (HTTP ${res.status}). Check NEBIUS_API_KEY. Note that keys and models are tied to a region/base URL.`, res.status);
      if (res.status === 404) throw new NebiusError('model_not_found', `Nebius returned 404. The model "${cfg.model}" may not exist in this region. Check NEBIUS_MODEL and NEBIUS_BASE_URL match (model IDs are region-scoped). ${detail}`, 404);
      if (res.status === 429) throw new NebiusError('rate_limited', 'Nebius rate limit reached. Wait a moment and retry.', 429);
      throw new NebiusError('upstream', `Nebius returned HTTP ${res.status}. ${detail}`, res.status);
    }
    if (!json) throw new NebiusError('bad_response', 'Nebius returned a response that was not JSON.', 502);
    return json;
  } catch (e) {
    if (e instanceof NebiusError) throw e;
    if (e.name === 'AbortError') throw new NebiusError('timeout', `The Nebius request timed out after ${Math.round(cfg.timeoutMs / 1000)}s.`, 504);
    throw new NebiusError('network', `Could not reach Nebius (${scrub(e.cause?.code || e.message, cfg.apiKey)}).`, 502);
  } finally {
    clearTimeout(timer);
  }
}

/** One chat completion. `system` and `user` are exactly the strings the user approved. */
export async function chat(cfg, { system, user }) {
  const started = Date.now();
  const json = await request(cfg, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens
    })
  });
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()) {
    throw new NebiusError('empty_response', 'The model returned no usable text (reasoning models can spend the whole token budget thinking). Try raising NEBIUS_MAX_TOKENS.', 502);
  }
  return { text: content, model: json.model || cfg.model, usage: json.usage || null, latencyMs: Date.now() - started };
}

/** GET /models. Sends no personal data, only the API key as auth. */
export async function listModels(cfg) {
  const json = await request(cfg, '/models', { method: 'GET' });
  return (json.data || []).map((m) => m.id).filter(Boolean);
}
