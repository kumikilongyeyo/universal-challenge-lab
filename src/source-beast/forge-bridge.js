const DEFAULT_FORGE_URL = 'http://127.0.0.1:8790';
const DEFAULT_YOMU_URL = 'https://yomu.yomuread.workers.dev';

function normalizeBase(raw, fallback) {
  const url = new URL(String(raw || fallback));
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Bridge URL must use http or https.');
  return url.toString().replace(/\/$/, '');
}

export class SourceForgeError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = 'SourceForgeError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export class SourceForgeBridge {
  constructor({
    baseUrl = process.env.YOMU_SOURCE_FORGE_URL || DEFAULT_FORGE_URL,
    yomuUrl = process.env.YOMU_APP_URL || DEFAULT_YOMU_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 120_000,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('SourceForgeBridge requires fetch.');
    this.baseUrl = normalizeBase(baseUrl, DEFAULT_FORGE_URL);
    this.yomuUrl = normalizeBase(yomuUrl, DEFAULT_YOMU_URL);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #request(pathname, { method = 'GET', body = null, timeoutMs = this.timeoutMs } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { error: text || `HTTP ${response.status}` }; }

    if (!response.ok) {
      throw new SourceForgeError(data.error || `Source Forge returned HTTP ${response.status}`, {
        status: Number(data.status || response.status) || response.status,
        code: data.code || null,
        body: data,
      });
    }
    return data;
  }

  health() {
    return this.#request('/api/health', { timeoutMs: 8_000 });
  }

  config() {
    return this.#request('/api/config', { timeoutMs: 10_000 });
  }

  prepare(url) {
    return this.#request('/api/source/prepare', {
      method: 'POST',
      body: { url, accessMode: 'auto' },
    });
  }

  openVerification(url) {
    return this.#request('/api/access/assist', {
      method: 'POST',
      body: { url },
      timeoutMs: 45_000,
    });
  }

  verify(url) {
    return this.#request('/api/access/verify', {
      method: 'POST',
      body: { url },
      timeoutMs: 60_000,
    });
  }

  publish(yomu) {
    return this.#request('/api/yomu/publish', {
      method: 'POST',
      body: { yomu, yomuUrl: this.yomuUrl },
    });
  }
}
