import crypto from 'node:crypto';
import { classifySourceEvidence } from './classifier.js';
import { SourceForgeError } from './forge-bridge.js';

function normalizeUrl(rawUrl) {
  const url = new URL(String(rawUrl || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Source URL must use http or https.');
  url.hash = '';
  return url.toString();
}

function scoreOf(prepared) {
  const validation = prepared?.yomu?.validation || {};
  return Number(validation.combinedScore ?? validation.score ?? 0) || 0;
}

function gradeOf(prepared) {
  const validation = prepared?.yomu?.validation || {};
  return validation.combinedGrade || validation.grade || null;
}

function publicRun(run) {
  return {
    id: run.id,
    url: run.url,
    state: run.state,
    message: run.message,
    createdAt: new Date(run.createdAt).toISOString(),
    updatedAt: new Date(run.updatedAt).toISOString(),
    score: run.score ?? null,
    grade: run.grade ?? null,
    provider: run.provider ?? null,
    signals: run.signals ? [...run.signals] : [],
    verification: run.verification ? { ...run.verification } : null,
    publish: run.publish ? { ...run.publish } : null,
  };
}

export class SourceBeastWorkflow {
  constructor({ bridge, now = () => Date.now(), readyScore = 88 } = {}) {
    if (!bridge) throw new TypeError('SourceBeastWorkflow requires a Source Forge bridge.');
    this.bridge = bridge;
    this.now = now;
    this.readyScore = readyScore;
    this.runs = new Map();
  }

  get(id) {
    const run = this.runs.get(id);
    if (!run) throw new Error('Source Beast run not found.');
    return publicRun(run);
  }

  list() {
    return [...this.runs.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
      .map(publicRun);
  }

  async test(rawUrl, { id = null } = {}) {
    const url = normalizeUrl(rawUrl);
    const existing = id ? this.runs.get(id) : null;
    const run = existing || {
      id: crypto.randomUUID(),
      url,
      state: 'testing',
      message: 'Testing source…',
      createdAt: this.now(),
      updatedAt: this.now(),
      prepared: null,
      score: null,
      grade: null,
      provider: null,
      signals: [],
      verification: null,
      publish: null,
    };

    run.url = url;
    run.state = 'testing';
    run.message = 'Testing catalog, titles, chapters, reader pages and images…';
    run.updatedAt = this.now();
    run.publish = null;
    this.runs.set(run.id, run);

    try {
      const prepared = await this.bridge.prepare(url);
      run.prepared = prepared;
      run.score = scoreOf(prepared);
      run.grade = gradeOf(prepared);
      run.provider = null;
      run.signals = ['forge:prepared', `gauntlet:${run.score}`];
      run.verification = null;

      if (run.score >= this.readyScore) {
        run.state = 'ready';
        run.message = `Source passed the full gauntlet at ${run.score}/100 and is ready to add.`;
      } else {
        run.state = 'needs-review';
        run.message = `Source reached the gauntlet but scored ${run.score}/100. Add Source stays locked until it reaches ${this.readyScore}+.`;
      }
    } catch (error) {
      this.#applyFailure(run, error);
    }

    run.updatedAt = this.now();
    return publicRun(run);
  }

  #applyFailure(run, error) {
    run.prepared = null;
    run.score = null;
    run.grade = null;

    const sourceError = error instanceof SourceForgeError ? error : null;
    const classification = classifySourceEvidence({
      status: sourceError?.status || error?.status || 0,
      message: error?.message || String(error),
      fabricResult: {
        failureKind: sourceError?.code || error?.code || null,
        message: error?.message || String(error),
        browserRequired: ['ACCESS_BLOCKED', 'ACCESS_CHALLENGE'].includes(sourceError?.code || error?.code),
      },
    });

    run.provider = classification.provider;
    run.signals = classification.signals;

    if (classification.state === 'verification-required') {
      run.state = 'verification-required';
      run.message = 'This source needs human verification before Yomu can finish the gauntlet.';
      run.verification = {
        status: 'required',
        provider: classification.provider,
        opened: false,
        verified: false,
      };
      return;
    }

    run.state = classification.state === 'temporarily-blocked' ? 'temporarily-blocked' : 'failed';
    run.message = error?.message || 'Source test failed.';
    run.verification = null;
  }

  async openVerification(id) {
    const run = this.runs.get(id);
    if (!run) throw new Error('Source Beast run not found.');
    if (!['verification-required', 'verification-in-progress'].includes(run.state)) {
      throw new Error(`Verification is not required while source is ${run.state}.`);
    }

    const opened = await this.bridge.openVerification(run.url);
    run.state = 'verification-in-progress';
    run.message = 'Visible browser opened. Complete the site verification there, then click Verify & retry.';
    run.verification = {
      ...(run.verification || {}),
      status: 'in-progress',
      opened: true,
      verified: false,
      host: opened.host || new URL(run.url).host,
      finalUrl: opened.finalUrl || run.url,
    };
    run.updatedAt = this.now();
    return publicRun(run);
  }

  async verifyAndRetest(id) {
    const run = this.runs.get(id);
    if (!run) throw new Error('Source Beast run not found.');
    if (!['verification-required', 'verification-in-progress'].includes(run.state)) {
      throw new Error(`Verification cannot be checked while source is ${run.state}.`);
    }

    try {
      await this.bridge.verify(run.url);
      run.verification = {
        ...(run.verification || {}),
        status: 'verified',
        opened: true,
        verified: true,
      };
      run.updatedAt = this.now();
      return await this.test(run.url, { id: run.id });
    } catch (error) {
      this.#applyFailure(run, error);
      if (run.verification) {
        run.verification.status = 'required';
        run.verification.verified = false;
      }
      run.updatedAt = this.now();
      return publicRun(run);
    }
  }

  async add(id) {
    const run = this.runs.get(id);
    if (!run) throw new Error('Source Beast run not found.');
    if (run.state !== 'ready' || !run.prepared?.yomu) {
      throw new Error('Source must pass the full gauntlet before it can be added.');
    }

    run.state = 'adding';
    run.message = 'Publishing source and refreshing Yomu…';
    run.updatedAt = this.now();

    try {
      const published = await this.bridge.publish(run.prepared.yomu);
      run.state = 'added';
      run.message = 'Source published, Yomu refreshed, and the source is ready to enable.';
      run.publish = {
        ok: true,
        sourceUrl: published.sourceUrl || null,
        install: published.install || null,
        refresh: published.refresh || null,
      };
    } catch (error) {
      run.state = 'ready';
      run.message = `Source passed, but publishing failed: ${error.message}`;
      run.publish = { ok: false, error: error.message };
    }

    run.updatedAt = this.now();
    return publicRun(run);
  }
}
