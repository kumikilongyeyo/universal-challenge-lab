const $ = (id) => document.getElementById(id);
const runButton = $('run');
const mutation = $('mutation');
let currentBeastRun = null;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

mutation.addEventListener('input', () => {
  $('mutationValue').textContent = `${mutation.value}%`;
});

async function request(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: text || 'Request failed' }; }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setHidden(id, hidden) {
  const node = $(id);
  if (node) node.classList.toggle('hidden', hidden);
}

function setStep(id, state) {
  const node = $(id);
  if (!node) return;
  node.classList.remove('active', 'done', 'warn');
  if (state) node.classList.add(state);
}

function renderBeast(run) {
  currentBeastRun = run;
  const state = run?.state || 'idle';
  const result = $('beastResult');
  result.className = `beast-result ${state}`;

  const labels = {
    idle: 'Ready when you are.',
    testing: 'Testing source…',
    'verification-required': 'Human verification required.',
    'verification-in-progress': 'Complete verification in the opened browser.',
    ready: 'Source ready to add.',
    'needs-review': 'Source needs more work.',
    'temporarily-blocked': 'Source is temporarily blocked.',
    failed: 'Source test failed.',
    adding: 'Adding source…',
    added: 'Source added.',
  };
  $('beastHeadline').textContent = labels[state] || state;
  $('beastMessage').textContent = run?.message || 'Paste a website URL above.';

  const meta = [];
  if (Number.isFinite(run?.score)) meta.push(`<span>Score <strong>${Math.round(run.score)}/100</strong></span>`);
  if (run?.grade) meta.push(`<span>Grade <strong>${escapeHtml(run.grade)}</strong></span>`);
  if (run?.provider) meta.push(`<span>Challenge <strong>${escapeHtml(run.provider)}</strong></span>`);
  $('beastMeta').innerHTML = meta.join('');

  setStep('stepTest', ['testing'].includes(state) ? 'active' : state === 'idle' ? null : 'done');
  if (['verification-required', 'verification-in-progress'].includes(state)) {
    setStep('stepVerify', 'active');
  } else if (run?.verification?.verified) {
    setStep('stepVerify', 'done');
  } else if (['ready', 'needs-review', 'adding', 'added'].includes(state)) {
    setStep('stepVerify', 'done');
  } else {
    setStep('stepVerify', null);
  }

  if (state === 'needs-review') setStep('stepGauntlet', 'warn');
  else if (['ready', 'adding', 'added'].includes(state)) setStep('stepGauntlet', 'done');
  else if (state === 'testing') setStep('stepGauntlet', 'active');
  else setStep('stepGauntlet', null);

  if (state === 'added') setStep('stepAdd', 'done');
  else if (state === 'ready' || state === 'adding') setStep('stepAdd', 'active');
  else setStep('stepAdd', null);

  setHidden('openVerification', state !== 'verification-required');
  setHidden('verifyRetry', !['verification-required', 'verification-in-progress'].includes(state));
  setHidden('addSource', state !== 'ready');

  const sourceUrl = run?.publish?.sourceUrl;
  const openYomu = $('openYomu');
  if (sourceUrl) {
    openYomu.href = sourceUrl;
    setHidden('openYomu', false);
  } else {
    openYomu.removeAttribute('href');
    setHidden('openYomu', true);
  }
}

function beastBusy(busy, label = 'Testing…') {
  const button = $('testSource');
  button.disabled = busy;
  button.textContent = busy ? label : 'Test source';
}

$('sourceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = $('sourceUrl').value.trim();
  if (!url) return;
  beastBusy(true);
  renderBeast({ state: 'testing', message: 'Running Source Forge and the reader gauntlet…' });
  try {
    const run = await request('/api/source-beast/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    renderBeast(run);
  } catch (error) {
    renderBeast({ state: 'failed', message: error.message });
  } finally {
    beastBusy(false);
  }
});

$('openVerification').addEventListener('click', async () => {
  if (!currentBeastRun?.id) return;
  const button = $('openVerification');
  button.disabled = true;
  button.textContent = 'Opening…';
  try {
    const run = await request(`/api/source-beast/runs/${encodeURIComponent(currentBeastRun.id)}/verification/open`, { method: 'POST' });
    renderBeast(run);
  } catch (error) {
    $('beastMessage').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Open verification';
  }
});

$('verifyRetry').addEventListener('click', async () => {
  if (!currentBeastRun?.id) return;
  const button = $('verifyRetry');
  button.disabled = true;
  button.textContent = 'Verifying + re-testing…';
  try {
    const run = await request(`/api/source-beast/runs/${encodeURIComponent(currentBeastRun.id)}/verification/check`, { method: 'POST' });
    renderBeast(run);
  } catch (error) {
    $('beastMessage').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Verify & retry';
  }
});

$('addSource').addEventListener('click', async () => {
  if (!currentBeastRun?.id) return;
  const button = $('addSource');
  button.disabled = true;
  button.textContent = 'Adding…';
  try {
    const run = await request(`/api/source-beast/runs/${encodeURIComponent(currentBeastRun.id)}/add`, { method: 'POST' });
    renderBeast(run);
  } catch (error) {
    $('beastMessage').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Add source';
  }
});

function renderPolicy(policy) {
  const rows = Object.entries(policy);
  if (!rows.length) {
    $('policy').innerHTML = '<p class="hint">No observations yet.</p>';
    return;
  }
  rows.sort((a, b) => b[1].attempts - a[1].attempts);
  $('policy').innerHTML = `
    <table>
      <thead><tr><th>Adapter × type</th><th>Attempts</th><th>Wins</th><th>EWMA</th></tr></thead>
      <tbody>${rows.slice(0, 14).map(([key, row]) => `
        <tr><td>${escapeHtml(key)}</td><td>${row.attempts}</td><td>${row.successes}</td><td>${Math.round(row.ewma * 100)}%</td></tr>
      `).join('')}</tbody>
    </table>`;
}

function renderHistory(runs) {
  const traces = runs.flatMap((run) => run.attempts.map((a) => ({ ...a, type: run.challengeType })));
  $('history').innerHTML = traces.slice(0, 18).map((a) => `
    <div class="attempt">
      <span class="dot ${a.valid ? 'ok' : ''}"></span>
      <div><strong>${escapeHtml(a.adapterId)}</strong><br><small>${escapeHtml(a.type)} · score ${Math.round(a.score * 100)}%</small></div>
      <span>${a.elapsedMs} ms</span>
    </div>`).join('') || '<p class="hint">Nothing yet.</p>';
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  runButton.textContent = 'Running…';
  try {
    const data = await request('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: $('type').value,
        mutation: Number(mutation.value) / 100,
        count: Number($('count').value),
      }),
    });
    $('successRate').textContent = `${Math.round(data.summary.successRate * 100)}%`;
    $('latency').textContent = `${data.summary.averageMs} ms`;
    $('attempts').textContent = data.summary.averageAttempts;
    const latest = data.runs.at(-1);
    $('latestText').textContent = latest?.success
      ? `${latest.challengeType} solved by ${latest.adapterId} after ${latest.attempts.length} attempt(s).`
      : latest?.error || 'No result.';
    renderPolicy(data.policy);
    renderHistory(data.runs.slice().reverse());
  } catch (error) {
    $('latestText').textContent = error.message;
  } finally {
    runButton.disabled = false;
    runButton.textContent = 'Run batch';
  }
});

$('reset').addEventListener('click', async () => {
  await request('/api/reset', { method: 'POST' });
  renderPolicy({});
  $('history').innerHTML = '<p class="hint">Nothing yet.</p>';
  $('successRate').textContent = '—';
  $('latency').textContent = '—';
  $('attempts').textContent = '—';
  $('latestText').textContent = 'Learning state cleared.';
});

try {
  const status = await request('/api/status');
  $('status').textContent = `${status.mode} · ${status.adapters.length} adapters`;
} catch {
  $('status').textContent = 'lab offline';
}

try {
  const beast = await request('/api/source-beast/status');
  $('beastStatus').textContent = beast.forge?.connected ? 'Source Forge connected' : 'Source Forge offline';
  $('beastStatus').classList.toggle('ok', Boolean(beast.forge?.connected));
  if (!beast.forge?.connected) {
    $('beastMessage').textContent = 'Start Yomu Source Forge on localhost:8790, then paste a website URL.';
  }
} catch {
  $('beastStatus').textContent = 'Source Beast offline';
}

function renderProviders(providers) {
  const host = $('providerMatrix');
  if (!host) return;
  host.innerHTML = `<table><thead><tr><th>Provider</th><th>Status</th><th>Fixture</th></tr></thead><tbody>${providers.map((p) => `
    <tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.status)}</td><td>${p.fixture ? `<a href="${escapeHtml(p.fixture)}">open</a>` : 'authorized sandbox required'}</td></tr>
  `).join('')}</tbody></table>`;
}

try {
  const providerData = await request('/api/providers');
  renderProviders(providerData.providers);
} catch {
  const host = $('providerMatrix');
  if (host) host.innerHTML = '<p class="hint">Provider matrix unavailable.</p>';
}
