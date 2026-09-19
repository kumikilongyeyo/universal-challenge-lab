import crypto from 'node:crypto';
import { classifySourceEvidence } from './classifier.js';
import { SourceSessionStore } from './session-store.js';

function normalizeUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Source URL must use http or https.');
  url.hash = '';
  return url.toString();
}

export class SourceBeastService {
  constructor({ orchestrator, sessionStore = new SourceSessionStore(), now = () => Date.now() } = {}) {
    if (!orchestrator) throw new TypeError('SourceBeastService requires an orchestrator.');
    this.orchestrator = orchestrator;
    this.sessionStore = sessionStore;
    this.now = now;
    this.verifications = new Map();
  }

  async analyze(input = {}) {
    const url = normalizeUrl(input.url);
    const session = this.sessionStore.get(url);
    if (session) {
      return {
        url,
        state: 'ready-session',
        route: 'reuse-human-session',
        autoHandled: false,
        sessionRef: session.sessionRef,
        expiresAt: new Date(session.expiresAt).toISOString(),
        signals: ['human-session-active'],
      };
    }

    if (input.challenge?.scope === 'lab-fixture') {
      const solved = await this.orchestrator.run(input.challenge);
      if (solved.success) {
        return {
          url,
          state: 'ready',
          route: 'universal-adapter',
          autoHandled: true,
          adapterId: solved.adapterId,
          challengeType: solved.challengeType,
          result: solved.result,
          signals: ['lab-fixture-auto-handled'],
        };
      }
    }

    const classification = classifySourceEvidence(input);
    if (classification.state !== 'verification-required') {
      return { url, autoHandled: false, ...classification };
    }

    const verification = this.#ensureVerification(url, classification, input);
    return {
      url,
      autoHandled: false,
      ...classification,
      verification,
    };
  }

  #ensureVerification(url, classification, input) {
    const origin = new URL(url).origin;
    const existing = [...this.verifications.values()].find((ticket) => ticket.origin === origin && ticket.status === 'pending');
    if (existing) return this.#publicTicket(existing);

    const ticket = {
      id: crypto.randomUUID(),
      origin,
      url,
      status: 'pending',
      provider: classification.provider,
      route: classification.route,
      signals: classification.signals,
      createdAt: this.now(),
      updatedAt: this.now(),
      note: String(input.note || ''),
    };
    this.verifications.set(ticket.id, ticket);
    return this.#publicTicket(ticket);
  }

  #publicTicket(ticket) {
    return {
      id: ticket.id,
      origin: ticket.origin,
      url: ticket.url,
      status: ticket.status,
      provider: ticket.provider,
      route: ticket.route,
      signals: [...ticket.signals],
      createdAt: new Date(ticket.createdAt).toISOString(),
      updatedAt: new Date(ticket.updatedAt).toISOString(),
      note: ticket.note,
    };
  }

  listVerifications({ status = null } = {}) {
    return [...this.verifications.values()]
      .filter((ticket) => !status || ticket.status === status)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((ticket) => this.#publicTicket(ticket));
  }

  completeVerification(id, { sessionRef, ttlSeconds = 21_600, expiresAt = null, metadata = {} } = {}) {
    const ticket = this.verifications.get(id);
    if (!ticket) throw new Error('Verification ticket not found.');
    const session = this.sessionStore.put(ticket.url, { sessionRef, ttlSeconds, expiresAt, metadata });
    ticket.status = 'completed';
    ticket.updatedAt = this.now();
    ticket.sessionExpiresAt = session.expiresAt;
    return {
      ticket: this.#publicTicket(ticket),
      state: 'ready-session',
      sessionRef: session.sessionRef,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  failVerification(id, { note = '' } = {}) {
    const ticket = this.verifications.get(id);
    if (!ticket) throw new Error('Verification ticket not found.');
    ticket.status = 'failed';
    ticket.updatedAt = this.now();
    if (note) ticket.note = String(note);
    return this.#publicTicket(ticket);
  }

  invalidateSession(url) {
    return { invalidated: this.sessionStore.invalidate(url) };
  }

  state(url) {
    const normalized = normalizeUrl(url);
    const session = this.sessionStore.get(normalized);
    if (session) {
      return {
        url: normalized,
        state: 'ready-session',
        sessionRef: session.sessionRef,
        expiresAt: new Date(session.expiresAt).toISOString(),
      };
    }
    const origin = new URL(normalized).origin;
    const pending = [...this.verifications.values()].find((ticket) => ticket.origin === origin && ticket.status === 'pending');
    if (pending) return { url: normalized, state: 'verification-required', verification: this.#publicTicket(pending) };
    return { url: normalized, state: 'unknown' };
  }
}
