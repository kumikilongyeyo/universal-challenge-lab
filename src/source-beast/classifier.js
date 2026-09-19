const text = (value) => String(value ?? '').toLowerCase();

function normalizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return {};
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]));
}

const PROVIDERS = [
  ['turnstile', /turnstile|cf-turnstile|challenges\.cloudflare\.com/],
  ['cloudflare', /cloudflare|cf-ray|cf-chl|challenge-platform/],
  ['hcaptcha', /hcaptcha|h-captcha/],
  ['recaptcha', /recaptcha|g-recaptcha/],
  ['datadome', /datadome|captcha-delivery\.com/],
  ['perimeterx-human', /perimeterx|human security|_px\b|px-captcha/],
  ['akamai-bot-manager', /akamai|akamai bot|abck|bm_sz/],
  ['aws-waf', /aws.?waf|x-amzn-waf|awswaf/],
];

function retryAfterSeconds(headers) {
  const raw = headers['retry-after'];
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export function classifySourceEvidence(input = {}) {
  const fabric = input.fabricResult && typeof input.fabricResult === 'object' ? input.fabricResult : {};
  const headers = normalizeHeaders(input.headers || fabric.headers);
  const status = Number(input.status ?? fabric.status ?? 0) || 0;
  const combined = [
    input.bodySample,
    input.message,
    fabric.message,
    fabric.route,
    fabric.failureKind,
    headers.server,
    headers['cf-ray'],
    headers['x-datadome'],
    headers['x-amzn-waf-action'],
  ].map(text).join('\n');

  const signals = [];
  let provider = null;
  for (const [id, pattern] of PROVIDERS) {
    if (pattern.test(combined)) {
      provider ||= id;
      signals.push(`provider:${id}`);
    }
  }

  if (status) signals.push(`http:${status}`);
  if (fabric.browserRequired === true) signals.push('fabric:browser-required');
  if (text(fabric.failureKind).includes('browser-required')) signals.push('fabric:browser-required');

  if (status === 429) {
    return {
      state: 'temporarily-blocked',
      route: 'retry-later',
      provider,
      confidence: 0.98,
      retryAfterSeconds: retryAfterSeconds(headers) ?? 900,
      signals: [...new Set(signals.concat('rate-limited'))],
    };
  }

  if (status >= 500) {
    return {
      state: 'temporarily-blocked',
      route: 'retry-later',
      provider,
      confidence: 0.92,
      retryAfterSeconds: 300,
      signals: [...new Set(signals.concat('upstream-server-error'))],
    };
  }

  const authRequired = status === 401 || /\b(login|sign[ -]?in|authentication required|unauthorized)\b/.test(combined);
  if (authRequired) {
    return {
      state: 'manual-only',
      route: 'authentication-required',
      provider,
      confidence: 0.9,
      retryAfterSeconds: null,
      signals: [...new Set(signals.concat('authentication-required'))],
    };
  }

  const challenge = fabric.browserRequired === true
    || text(fabric.failureKind).includes('browser-required')
    || /captcha|challenge|verify you are human|checking your browser|access challenge|bot verification/.test(combined)
    || provider != null;

  if (challenge) {
    return {
      state: 'verification-required',
      route: 'human-verification',
      provider,
      confidence: provider ? 0.96 : 0.82,
      retryAfterSeconds: null,
      signals: [...new Set(signals.concat('interactive-challenge'))],
    };
  }

  if (status === 403) {
    return {
      state: 'verification-required',
      route: 'human-review',
      provider: null,
      confidence: 0.68,
      retryAfterSeconds: null,
      signals: [...new Set(signals.concat('blocked-unclassified'))],
    };
  }

  if (status >= 400) {
    return {
      state: 'temporarily-blocked',
      route: 'retry-later',
      provider,
      confidence: 0.7,
      retryAfterSeconds: 600,
      signals: [...new Set(signals.concat('http-error'))],
    };
  }

  return {
    state: 'ready',
    route: 'normal-fetch',
    provider: null,
    confidence: 0.85,
    retryAfterSeconds: null,
    signals: [...new Set(signals)],
  };
}
