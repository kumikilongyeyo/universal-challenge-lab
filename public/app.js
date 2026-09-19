const $ = (id) => document.getElementById(id);
const runButton = $('run');
const mutation = $('mutation');

mutation.addEventListener('input', () => {
  $('mutationValue').textContent = `${mutation.value}%`;
});

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

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
        <tr><td>${key}</td><td>${row.attempts}</td><td>${row.successes}</td><td>${Math.round(row.ewma * 100)}%</td></tr>
      `).join('')}</tbody>
    </table>`;
}

function renderHistory(runs) {
  const traces = runs.flatMap((run) => run.attempts.map((a) => ({ ...a, type: run.challengeType })));
  $('history').innerHTML = traces.slice(0, 18).map((a) => `
    <div class="attempt">
      <span class="dot ${a.valid ? 'ok' : ''}"></span>
      <div><strong>${a.adapterId}</strong><br><small>${a.type} · score ${Math.round(a.score * 100)}%</small></div>
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
  $('status').textContent = 'offline';
}

function renderProviders(providers) {
  const host = $('providerMatrix');
  if (!host) return;
  host.innerHTML = `<table><thead><tr><th>Provider</th><th>Status</th><th>Fixture</th></tr></thead><tbody>${providers.map((p) => `
    <tr><td>${p.name}</td><td>${p.status}</td><td>${p.fixture ? `<a href="${p.fixture}">open</a>` : 'authorized sandbox required'}</td></tr>
  `).join('')}</tbody></table>`;
}

try {
  const providerData = await request('/api/providers');
  renderProviders(providerData.providers);
} catch {
  const host = $('providerMatrix');
  if (host) host.innerHTML = '<p class="hint">Provider matrix unavailable.</p>';
}
