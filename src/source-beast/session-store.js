function originOf(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Source URL must use http or https.');
  return url.origin;
}

export class SourceSessionStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.sessions = new Map();
  }

  get(rawUrl) {
    const origin = originOf(rawUrl);
    const session = this.sessions.get(origin) || null;
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(origin);
      return null;
    }
    return { ...session };
  }

  put(rawUrl, { sessionRef, ttlSeconds = 21_600, expiresAt = null, metadata = {} } = {}) {
    if (!sessionRef || typeof sessionRef !== 'string') throw new TypeError('sessionRef is required.');
    const origin = originOf(rawUrl);
    const resolvedExpiry = expiresAt == null
      ? this.now() + Math.max(60, Number(ttlSeconds) || 21_600) * 1000
      : Number(new Date(expiresAt));
    if (!Number.isFinite(resolvedExpiry) || resolvedExpiry <= this.now()) throw new TypeError('expiresAt must be in the future.');

    const session = {
      origin,
      sessionRef,
      verifiedAt: this.now(),
      expiresAt: resolvedExpiry,
      metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
    };
    this.sessions.set(origin, session);
    return { ...session };
  }

  invalidate(rawUrl) {
    return this.sessions.delete(originOf(rawUrl));
  }

  snapshot() {
    const rows = [];
    for (const [origin, session] of this.sessions) {
      if (session.expiresAt <= this.now()) {
        this.sessions.delete(origin);
        continue;
      }
      rows.push({
        origin,
        verifiedAt: new Date(session.verifiedAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        sessionRefPresent: true,
        metadata: { ...session.metadata },
      });
    }
    return rows;
  }
}
