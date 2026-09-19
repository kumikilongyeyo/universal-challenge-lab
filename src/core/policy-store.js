const DEFAULT_SCORE = 0.5;

export class PolicyStore {
  constructor(seed = {}) {
    this.state = structuredClone(seed);
  }

  key(adapterId, challengeType) {
    return `${adapterId}::${challengeType}`;
  }

  get(adapterId, challengeType) {
    const row = this.state[this.key(adapterId, challengeType)];
    if (!row) return { attempts: 0, successes: 0, ewma: DEFAULT_SCORE };
    return { ...row };
  }

  update(adapterId, challengeType, success) {
    const key = this.key(adapterId, challengeType);
    const prev = this.get(adapterId, challengeType);
    const alpha = 0.25;
    const observation = success ? 1 : 0;
    const next = {
      attempts: prev.attempts + 1,
      successes: prev.successes + observation,
      ewma: Number((alpha * observation + (1 - alpha) * prev.ewma).toFixed(4)),
    };
    this.state[key] = next;
    return { ...next };
  }

  bonus(adapterId, challengeType) {
    const row = this.get(adapterId, challengeType);
    const confidence = Math.min(1, row.attempts / 12);
    return (row.ewma - 0.5) * 0.35 * confidence;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  reset() {
    this.state = {};
  }
}
