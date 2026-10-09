import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://api.tokenfactory.nebius.com/v1';

/** Minimal .env loader (no dependency). Never overrides variables already set in the shell. */
export function loadDotEnv(file = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

function validBaseUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol === 'https:') return true;
    // plain http only for loopback (used by the local mock in tests)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Reads config from env on every call. The returned object contains the secret — never serialize it. */
export function loadConfig(env = process.env) {
  const apiKey = (env.NEBIUS_API_KEY || '').trim();
  const model = (env.NEBIUS_MODEL || '').trim();
  const baseUrl = (env.NEBIUS_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const missing = [];
  if (!apiKey || /^(your-|replace|changeme|<)/i.test(apiKey)) missing.push('NEBIUS_API_KEY');
  if (!model) missing.push('NEBIUS_MODEL');
  if (!validBaseUrl(baseUrl)) missing.push('NEBIUS_BASE_URL (must be an https URL)');
  return {
    apiKey,
    model,
    baseUrl,
    maxTokens: num(env.NEBIUS_MAX_TOKENS, 1500),
    temperature: Number.isFinite(Number(env.NEBIUS_TEMPERATURE)) && env.NEBIUS_TEMPERATURE !== undefined && env.NEBIUS_TEMPERATURE !== '' ? Number(env.NEBIUS_TEMPERATURE) : 0.3,
    timeoutMs: num(env.NEBIUS_TIMEOUT_MS, 60000),
    missing,
    configured: missing.length === 0
  };
}

/** Safe-to-expose view of config (no secret). */
export function publicConfig(cfg) {
  let host = '';
  try { host = new URL(cfg.baseUrl).host; } catch { /* ignore */ }
  return { configured: cfg.configured, missing: cfg.missing, model: cfg.model || null, endpointHost: host };
}
