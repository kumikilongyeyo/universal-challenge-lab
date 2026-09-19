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
import { providerCatalog } from './integrations/provider-catalog.js';
import { SourceForgeBridge } from './source-beast/forge-bridge.js';
import { SourceBeastWorkflow } from './source-beast/workflow.js';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const configuredOrigins = String(
  process.env.SOURCE_BEAST_ALLOWED_ORIGINS || 'https://yomu.yomuread.workers.dev',
).split(',').map((value) => value.trim()).filter(Boolean);

const registry = new AdapterRegistry()
  .register(textAdapter)
  .register(gridAdapter)
  .register(sliderAdapter)
  .register(powAdapter)
  .register(fallbackAdapter);

const policy = new PolicyStore();
const orchestrator = new AdaptiveOrchestrator({ registry, policy });
const forgeBridge = new SourceForgeBridge();
const sourceBeast = new SourceBeastWorkflow({ bridge: forgeBridge });
const history = [];

function originAllowed(origin) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(parsed.hostname) && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('access-control-allow-origin', origin);
  }
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') {
    res.setHeader('access-control-allow-private-network', 'true');
  }
}

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

function sourceBeastRunId(pathname, suffix = '') {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pathname.match(new RegExp(`^/api/source-beast/runs/([^/]+)${escaped}$`));
  return match ? decodeURIComponent(match[1]) : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    if (!originAllowed(req.headers.origin)) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.headers.origin && !originAllowed(req.headers.origin) && url.pathname.startsWith('/api/')) {
    return json(res, 403, { error: 'Origin not allowed by local Source Beast.' });
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/providers') {
      return json(res, 200, { providers: providerCatalog });
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, {
        name: 'Universal Challenge Lab',
        version: '0.3.1',
        mode: 'authorized-local-lab',
        adapters: registry.list().map((a) => a.id),
        historyCount: history.length,
        sourceBeast: true,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/source-beast/status') {
      try {
        const forge = await forgeBridge.health();
        return json(res, 200, {
          ok: true,
          service: 'source-beast',
          readyScore: sourceBeast.readyScore,
          allowedOrigins: configuredOrigins,
          forge: { connected: true, service: forge.service, version: forge.version },
        });
      } catch (error) {
        return json(res, 200, {
          ok: false,
          service: 'source-beast',
          readyScore: sourceBeast.readyScore,
          allowedOrigins: configuredOrigins,
          forge: { connected: false, error: error.message },
        });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/source-beast/runs') {
      return json(res, 200, { runs: sourceBeast.list() });
    }

    if (req.method === 'POST' && url.pathname === '/api/source-beast/test') {
      const input = await body(req);
      return json(res, 200, await sourceBeast.test(input.url));
    }

    const runId = sourceBeastRunId(url.pathname);
    if (req.method === 'GET' && runId) {
      return json(res, 200, sourceBeast.get(runId));
    }

    const openVerificationId = sourceBeastRunId(url.pathname, '/verification/open');
    if (req.method === 'POST' && openVerificationId) {
      return json(res, 200, await sourceBeast.openVerification(openVerificationId));
    }

    const checkVerificationId = sourceBeastRunId(url.pathname, '/verification/check');
    if (req.method === 'POST' && checkVerificationId) {
      return json(res, 200, await sourceBeast.verifyAndRetest(checkVerificationId));
    }

    const addId = sourceBeastRunId(url.pathname, '/add');
    if (req.method === 'POST' && addId) {
      return json(res, 200, await sourceBeast.add(addId));
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
  console.log(`Universal Challenge Lab + Source Beast running at http://${HOST}:${PORT}`);
  console.log('Source Beast delegates site forging, assisted verification and publishing to local Yomu Source Forge.');
  console.log(`Yomu web origins: ${configuredOrigins.join(', ')}`);
});
