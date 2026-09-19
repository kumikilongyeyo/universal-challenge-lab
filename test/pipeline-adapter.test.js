import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPipelineAdapter } from '../src/browser/pipeline-adapter.js';

class FixtureAdapter extends BrowserPipelineAdapter {
  constructor({ verifyOn = 2 } = {}) {
    super({ id: 'fixture-browser-adapter', maxRounds: 3 });
    this.verifyOn = verifyOn;
  }
  async detect() { return { found: true, confidence: 0.9 }; }
  async extract(_, { round }) { return { round }; }
  async act(_, data) { return { attempted: true, round: data.round }; }
  async verify(_, action) { return action.round >= this.verifyOn; }
}

test('browser pipeline retries until verification succeeds', async () => {
  const adapter = new FixtureAdapter({ verifyOn: 2 });
  const result = await adapter.run({});
  assert.equal(result.success, true);
  assert.equal(result.rounds, 2);
  assert.deepEqual(result.trace.map((row) => row.stage), [
    'detect', 'extract', 'act', 'verify', 'extract', 'act', 'verify',
  ]);
});

test('browser pipeline stops when challenge is not detected', async () => {
  const adapter = new BrowserPipelineAdapter({ id: 'none' });
  const result = await adapter.run({});
  assert.equal(result.success, false);
  assert.equal(result.error, 'not_detected');
});
