const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));

export class AdaptiveOrchestrator {
  constructor({ registry, policy }) {
    this.registry = registry;
    this.policy = policy;
  }

  rank(challenge) {
    return this.registry
      .list()
      .map((adapter) => {
        const detected = clamp(Number(adapter.detect(challenge)) || 0);
        const learned = this.policy.bonus(adapter.id, challenge.type);
        return {
          adapter,
          adapterId: adapter.id,
          detected,
          learned,
          score: clamp(detected + learned),
        };
      })
      .filter((row) => row.score > 0.05)
      .sort((a, b) => b.score - a.score);
  }

  async run(challenge, { maxAttempts = 4 } = {}) {
    const startedAt = performance.now();
    const ranking = this.rank(challenge);
    const attempts = [];

    for (const row of ranking.slice(0, maxAttempts)) {
      const attemptStarted = performance.now();
      let result;
      let valid = false;
      let error = null;

      try {
        result = await row.adapter.solve(challenge);
        valid = typeof row.adapter.validate === 'function'
          ? Boolean(await row.adapter.validate(challenge, result))
          : Boolean(result?.success);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      const elapsedMs = Number((performance.now() - attemptStarted).toFixed(2));
      this.policy.update(row.adapterId, challenge.type, valid);
      attempts.push({
        adapterId: row.adapterId,
        score: Number(row.score.toFixed(4)),
        detected: Number(row.detected.toFixed(4)),
        learned: Number(row.learned.toFixed(4)),
        valid,
        elapsedMs,
        error,
        summary: result?.summary ?? null,
      });

      if (valid) {
        return {
          success: true,
          challengeId: challenge.id,
          challengeType: challenge.type,
          adapterId: row.adapterId,
          attempts,
          elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
          result,
        };
      }
    }

    return {
      success: false,
      challengeId: challenge.id,
      challengeType: challenge.type,
      adapterId: null,
      attempts,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      error: ranking.length ? 'All eligible adapters failed validation.' : 'No eligible adapter detected this challenge.',
    };
  }
}
