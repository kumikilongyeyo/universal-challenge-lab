/**
 * A browser-adapter lifecycle inspired by common open-source solver runners:
 * detect -> extract -> act -> verify -> retry.
 *
 * This base class is provider-neutral and is meant for local fixtures or owned
 * staging pages passed through AuthorizedBrowserRunner.
 */
export class BrowserPipelineAdapter {
  constructor({ id, maxRounds = 3 }) {
    if (!id) throw new TypeError('BrowserPipelineAdapter requires an id.');
    this.id = id;
    this.maxRounds = maxRounds;
  }

  async detect() { return { found: false, confidence: 0 }; }
  async extract() { return {}; }
  async act() { return { attempted: false }; }
  async verify() { return false; }

  async run(page) {
    const trace = [];
    const detection = await this.detect(page);
    trace.push({ stage: 'detect', ...detection });
    if (!detection?.found) return { success: false, trace, error: 'not_detected' };

    for (let round = 1; round <= this.maxRounds; round += 1) {
      const extracted = await this.extract(page, { round });
      trace.push({ stage: 'extract', round, ok: extracted != null });
      if (extracted == null) continue;

      const action = await this.act(page, extracted, { round });
      trace.push({ stage: 'act', round, attempted: Boolean(action?.attempted) });

      const verified = Boolean(await this.verify(page, action, { round }));
      trace.push({ stage: 'verify', round, verified });
      if (verified) return { success: true, rounds: round, trace };
    }

    return { success: false, rounds: this.maxRounds, trace, error: 'max_rounds_exceeded' };
  }
}
