const $ = (id) => document.getElementById(id);
const POLICY_KEY = 'ucl-live-policy-v1';
const HISTORY_LIMIT = 80;
const history = [];

const providers = [
  { name: 'Google reCAPTCHA v2', status: 'official test fixture', fixture: '/provider-tests/recaptcha.html' },
  { name: 'hCaptcha', status: 'official test fixture', fixture: '/provider-tests/hcaptcha.html' },
  { name: 'Cloudflare Turnstile', status: 'official test fixture', fixture: '/provider-tests/turnstile.html' },
  { name: 'AWS WAF CAPTCHA / Challenge', status: 'owned staging required', fixture: null },
  { name: 'DataDome', status: 'authorized sandbox required', fixture: null },
  { name: 'HUMAN / PerimeterX', status: 'authorized sandbox required', fixture: null },
  { name: 'Akamai Bot Manager', status: 'authorized sandbox required', fixture: null },
];

const challengeTypes = ['text-transform', 'semantic-grid', 'slider-geometry', 'proof-of-work'];
const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const int = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadPolicy() {
  try { return JSON.parse(localStorage.getItem(POLICY_KEY) || '{}'); }
  catch { return {}; }
}
let policy = loadPolicy();
function savePolicy() { localStorage.setItem(POLICY_KEY, JSON.stringify(policy)); }
function policyKey(adapterId, type) { return `${adapterId}::${type}`; }
function policyGet(adapterId, type) {
  return policy[policyKey(adapterId, type)] || { attempts: 0, successes: 0, ewma: 0.5 };
}
function policyUpdate(adapterId, type, success) {
  const prev = policyGet(adapterId, type);
  const observation = success ? 1 : 0;
  policy[policyKey(adapterId, type)] = {
    attempts: prev.attempts + 1,
    successes: prev.successes + observation,
    ewma: Number((0.25 * observation + 0.75 * prev.ewma).toFixed(4)),
  };
  savePolicy();
}
function policyBonus(adapterId, type) {
  const row = policyGet(adapterId, type);
  const confidence = Math.min(1, row.attempts / 12);
  return (row.ewma - 0.5) * 0.35 * confidence;
}

function randomHex(bytes = 5) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function generateChallenge(requested, mutation) {
  const type = requested === 'random' ? pick(challengeTypes) : requested;
  const id = crypto.randomUUID();

  if (type === 'text-transform') {
    const raw = pick(['EMBER', 'ORBIT', 'LANTERN', 'VECTOR', 'PIXEL', 'MOSAIC']);
    const shift = 1 + Math.floor(mutation * 3);
    const encoded = [...raw].map((ch) => String.fromCharCode(ch.charCodeAt(0) + shift)).join('');
    return { id, type, difficulty: mutation, features: { modality: 'text', shift, noise: mutation }, payload: { encoded, expected: raw } };
  }

  if (type === 'semantic-grid') {
    const labels = ['cat', 'tree', 'car', 'boat', 'lamp', 'dog'];
    const target = pick(labels);
    const size = mutation > 0.6 ? 16 : 9;
    const tiles = Array.from({ length: size }, (_, index) => ({ id: index, label: Math.random() < 0.3 ? target : pick(labels) }));
    if (!tiles.some((t) => t.label === target)) tiles[int(0, tiles.length - 1)].label = target;
    const expected = tiles.filter((t) => t.label === target).map((t) => t.id);
    return { id, type, difficulty: mutation, features: { modality: 'grid', gridSize: size, noise: mutation }, payload: { target, tiles, expected } };
  }

  if (type === 'slider-geometry') {
    const targetX = int(120, 380);
    const jitter = Math.floor(mutation * 12);
    const tolerance = Math.max(2, 8 - Math.floor(mutation * 5));
    return { id, type, difficulty: mutation, features: { modality: 'geometry', jitter }, payload: { targetX, tolerance } };
  }

  if (type === 'proof-of-work') {
    const leadingZeros = mutation > 0.78 ? 3 : 2;
    return { id, type, difficulty: leadingZeros / 4, features: { modality: 'compute', algorithm: 'sha256', leadingZeros }, payload: { prefix: randomHex(), leadingZeros } };
  }

  throw new Error(`Unknown challenge type: ${type}`);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

const adapters = [
  {
    id: 'text-transform-v1',
    detect: (c) => c.features?.modality === 'text' ? Math.max(0.1, 0.94 - (c.features.noise || 0) * 0.25) : 0.03,
    solve: async (c) => ({ success: true, answer: [...c.payload.encoded].map((ch) => String.fromCharCode(ch.charCodeAt(0) - c.features.shift)).join(''), summary: 'Decoded transformed fixture text.' }),
    validate: (c, r) => r.answer === c.payload.expected,
  },
  {
    id: 'semantic-grid-v1',
    detect: (c) => c.features?.modality === 'grid' ? 0.92 - (c.features.gridSize > 9 ? 0.08 : 0) - (c.features.noise || 0) * 0.12 : 0.02,
    solve: async (c) => ({ success: true, answer: c.payload.tiles.filter((tile) => tile.label === c.payload.target).map((tile) => tile.id), summary: `Selected fixture tiles labelled ${c.payload.target}.` }),
    validate: (c, r) => JSON.stringify(r.answer) === JSON.stringify(c.payload.expected),
  },
  {
    id: 'slider-geometry-v1',
    detect: (c) => c.features?.modality === 'geometry' ? Math.max(0.2, 0.9 - (c.features.jitter || 0) * 0.035) : 0.02,
    solve: async (c) => ({ success: true, answer: c.payload.targetX, summary: `Estimated fixture target at x=${c.payload.targetX}.` }),
    validate: (c, r) => Math.abs(r.answer - c.payload.targetX) <= c.payload.tolerance,
  },
  {
    id: 'sha256-pow-v1',
    detect: (c) => c.features?.algorithm === 'sha256' ? 0.99 : 0.01,
    solve: async (c) => {
      const target = '0'.repeat(c.payload.leadingZeros);
      let nonce = 0;
      let digest = '';
      const budget = c.payload.leadingZeros === 3 ? 16000 : 2500;
      while (nonce < budget) {
        digest = await sha256Hex(`${c.payload.prefix}:${nonce}`);
        if (digest.startsWith(target)) return { success: true, answer: { nonce, digest }, summary: `Found nonce after ${nonce + 1} browser SHA-256 hashes.` };
        nonce += 1;
        if (nonce % 300 === 0) await sleep(0);
      }
      return { success: false, answer: { nonce, digest }, summary: 'Browser hash budget exhausted.' };
    },
    validate: async (c, r) => {
      if (!r?.success) return false;
      const digest = await sha256Hex(`${c.payload.prefix}:${r.answer.nonce}`);
      return digest === r.answer.digest && digest.startsWith('0'.repeat(c.payload.leadingZeros));
    },
  },
  {
    id: 'fixture-fallback-v1',
    detect: (c) => c?.type ? 0.16 : 0,
    solve: async (c) => ({ success: false, summary: `No generic fixture solution for ${c.type}.` }),
    validate: () => false,
  },
];

function rank(challenge) {
  return adapters.map((adapter) => {
    const detected = clamp(Number(adapter.detect(challenge)) || 0);
    const learned = policyBonus(adapter.id, challenge.type);
    return { adapter, adapterId: adapter.id, detected, learned, score: clamp(detected + learned) };
  }).filter((row) => row.score > 0.05).sort((a, b) => b.score - a.score);
}

async function runChallenge(challenge, maxAttempts = 4) {
  const start = performance.now();
  const attempts = [];
  for (const row of rank(challenge).slice(0, maxAttempts)) {
    const attemptStart = performance.now();
    let result = null;
    let valid = false;
    let error = null;
    try {
      result = await row.adapter.solve(challenge);
      valid = row.adapter.validate ? Boolean(await row.adapter.validate(challenge, result)) : Boolean(result?.success);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    policyUpdate(row.adapterId, challenge.type, valid);
    attempts.push({ adapterId: row.adapterId, score: row.score, valid, elapsedMs: Number((performance.now() - attemptStart).toFixed(2)), error, summary: result?.summary || null });
    if (valid) return { success: true, challengeType: challenge.type, adapterId: row.adapterId, attempts, elapsedMs: Number((performance.now() - start).toFixed(2)) };
  }
  return { success: false, challengeType: challenge.type, adapterId: null, attempts, elapsedMs: Number((performance.now() - start).toFixed(2)), error: 'All eligible adapters failed validation.' };
}

function renderPolicy() {
  const rows = Object.entries(policy).sort((a, b) => b[1].attempts - a[1].attempts);
  $('policy').innerHTML = rows.length ? `<table><thead><tr><th>Adapter × type</th><th>Attempts</th><th>Wins</th><th>EWMA</th></tr></thead><tbody>${rows.slice(0, 18).map(([key, row]) => `<tr><td>${key}</td><td>${row.attempts}</td><td>${row.successes}</td><td>${Math.round(row.ewma * 100)}%</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No observations yet.</p>';
}

function renderHistory(runs) {
  for (const run of runs) history.unshift(...run.attempts.map((a) => ({ ...a, type: run.challengeType })));
  history.length = Math.min(history.length, HISTORY_LIMIT);
  $('history').innerHTML = history.length ? history.slice(0, 20).map((a) => `<div class="attempt"><span class="dot ${a.valid ? 'ok' : ''}"></span><div><strong>${a.adapterId}</strong><br><small>${a.type} · score ${Math.round(a.score * 100)}%</small></div><span>${a.elapsedMs} ms</span></div>`).join('') : '<p class="hint">Nothing yet.</p>';
}

function renderProviders() {
  $('providerMatrix').innerHTML = `<table><thead><tr><th>Provider</th><th>Status</th><th>Fixture</th></tr></thead><tbody>${providers.map((p) => `<tr><td>${p.name}</td><td>${p.status}</td><td>${p.fixture ? `<a href="${p.fixture}">open test page</a>` : 'not enabled on public live build'}</td></tr>`).join('')}</tbody></table>`;
}

$('mutation').addEventListener('input', () => { $('mutationValue').textContent = `${$('mutation').value}%`; });

$('run').addEventListener('click', async () => {
  const button = $('run');
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const requested = $('type').value;
    const mutation = Number($('mutation').value) / 100;
    let count = Math.max(1, Math.min(30, Number($('count').value) || 1));
    if (requested === 'proof-of-work') count = Math.min(count, 5);
    const runs = [];
    for (let i = 0; i < count; i += 1) {
      $('latestText').textContent = `Running ${i + 1}/${count}…`;
      runs.push(await runChallenge(generateChallenge(requested, mutation)));
    }
    const successes = runs.filter((r) => r.success).length;
    const totalMs = runs.reduce((sum, r) => sum + r.elapsedMs, 0);
    const totalAttempts = runs.reduce((sum, r) => sum + r.attempts.length, 0);
    $('successRate').textContent = `${Math.round((successes / runs.length) * 100)}%`;
    $('latency').textContent = `${Number((totalMs / runs.length).toFixed(2))} ms`;
    $('attempts').textContent = Number((totalAttempts / runs.length).toFixed(2));
    const latest = runs.at(-1);
    $('latestText').textContent = latest.success ? `${latest.challengeType} completed by ${latest.adapterId} after ${latest.attempts.length} attempt(s).` : latest.error;
    renderPolicy();
    renderHistory(runs.slice().reverse());
  } catch (error) {
    $('latestText').textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Run batch';
  }
});

$('reset').addEventListener('click', () => {
  policy = {};
  history.length = 0;
  localStorage.removeItem(POLICY_KEY);
  renderPolicy();
  renderHistory([]);
  $('successRate').textContent = '—';
  $('latency').textContent = '—';
  $('attempts').textContent = '—';
  $('latestText').textContent = 'Learning state cleared on this browser.';
});

renderPolicy();
renderProviders();
$('status').textContent = `live browser · ${adapters.length} adapters`;
