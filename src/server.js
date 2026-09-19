import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdapterRegistry } from './core/adapter-registry.js';
import { PolicyStore } from './core/policy-store.js';
import { AdaptiveOrchestrator } from './core/orchestrator.js';
import { generateChallenge } from './fixtures/generator.js';
import { textAdapter } from './adapters/text-adapter.js';
import { gridAdapter } from './adapters/grid-adapter.js';
import { sliderAdapter } from './adapters/slider-adapter.js';
import { powAdapter } from './adapters/pow-adapter.js';
import { fallbackAdapter } from './adapters/fallback-adapter.js';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const registry = new AdapterRegistry()
  .register(textAdapter)
  .register(gridAdapter)
  .register(sliderAdapter)
  .register(powAdapter)
  .register(fallbackAdapter);

const policy = new PolicyStore();
const orchestrator = new AdaptiveOrchestrator({ registry, policy });
const history = [];

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request body too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

function mime(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
  })[extname(path)] || 'application/octet-stream';
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const resolved = normalize(join(PUBLIC, relative));
  if (!resolved.startsWith(PUBLIC)) return false;
  try {
    const data = await readFile(resolved);
    res.writeHead(200, { 'content-type': mime(resolved) });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, {
        name: 'Universal Challenge Lab',
        version: '0.1.0',
        mode: 'authorized-local-lab',
        adapters: registry.list().map((a) => a.id),
        historyCount: history.length,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const input = await body(req);
      const count = Math.max(1, Math.min(100, Number(input.count || 1)));
      const mutation = Math.max(0, Math.min(1, Number(input.mutation || 0)));
      const type = String(input.type || 'random');
      const runs = [];

      for (let i = 0; i < count; i += 1) {
        const challenge = generateChallenge(type, mutation);
        const result = await orchestrator.run(challenge);
        const record = {
          at: new Date().toISOString(),
          mutation,
          difficulty: challenge.difficulty,
          ...result,
        };
        runs.push(record);
        history.unshift(record);
      }

      if (history.length > 500) history.length = 500;
      return json(res, 200, {
        runs,
        policy: policy.snapshot(),
        summary: summarize(runs),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/history') {
      return json(res, 200, { history: history.slice(0, 100), policy: policy.snapshot() });
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      history.length = 0;
      policy.reset();
      return json(res, 200, { ok: true });
    }

    if (await serveStatic(req, res, url.pathname)) return;
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

function summarize(runs) {
  const successes = runs.filter((r) => r.success).length;
  const totalMs = runs.reduce((sum, r) => sum + r.elapsedMs, 0);
  const attempts = runs.reduce((sum, r) => sum + r.attempts.length, 0);
  return {
    total: runs.length,
    successes,
    successRate: runs.length ? Number((successes / runs.length).toFixed(4)) : 0,
    averageMs: runs.length ? Number((totalMs / runs.length).toFixed(2)) : 0,
    averageAttempts: runs.length ? Number((attempts / runs.length).toFixed(2)) : 0,
  };
}

server.listen(PORT, HOST, () => {
  console.log(`Universal Challenge Lab running at http://${HOST}:${PORT}`);
  console.log('Scope: local fixtures and official provider test modes only.');
});
