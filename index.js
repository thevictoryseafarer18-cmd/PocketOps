import path from 'node:path';
import { loadDotEnv, loadConfig, publicConfig } from './env.js';
import { Store } from './store.js';
import { createApp } from './app.js';

loadDotEnv();
const file = path.resolve(process.cwd(), process.env.POCKETOPS_DATA_FILE || 'data/store.json');
const store = new Store(file);
const app = createApp({ store });

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  const cfg = publicConfig(loadConfig());
  console.log(`PocketOps listening on http://${host}:${port}`);
  console.log(`Storage: ${file} (plain JSON, not encrypted)`);
  if (cfg.configured) console.log(`Nebius Token Factory: configured, model ${cfg.model}, endpoint ${cfg.endpointHost}`);
  else console.log(`Nebius Token Factory: NOT configured (missing: ${cfg.missing.join(', ')}). Running in sample mode. See .env.example.`);
});
