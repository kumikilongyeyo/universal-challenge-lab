import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceBeastWorkflow } from '../src/source-beast/workflow.js';
import { SourceForgeError } from '../src/source-beast/forge-bridge.js';

function prepared(score = 94) {
  return {
    yomu: {
      descriptor: { id: 'demo', base: 'https://example.com/' },
      indexEntry: { id: 'demo' },
      validation: { combinedScore: score, combinedGrade: score >= 88 ? 'STRONG' : 'REVIEW' },
    },
  };
}

test('paste -> test -> ready -> add source', async () => {
  const calls = [];
  const bridge = {
    async prepare(url) { calls.push(['prepare', url]); return prepared(96); },
    async publish(yomu) { calls.push(['publish', yomu.descriptor.id]); return { sourceUrl: 'https://yomu.test/add-sources.html?auto=1', refresh: { ok: true } }; },
  };
  const flow = new SourceBeastWorkflow({ bridge });
  const tested = await flow.test('https://example.com');
  assert.equal(tested.state, 'ready');
  assert.equal(tested.score, 96);

  const added = await flow.add(tested.id);
  assert.equal(added.state, 'added');
  assert.equal(added.publish.ok, true);
  assert.deepEqual(calls.map((row) => row[0]), ['prepare', 'publish']);
});

test('challenge -> assisted verification -> automatic retest -> ready', async () => {
  let prepareCount = 0;
  const bridge = {
    async prepare() {
      prepareCount += 1;
      if (prepareCount === 1) {
        throw new SourceForgeError('Browser challenge', { status: 403, code: 'ACCESS_CHALLENGE' });
      }
      return prepared(92);
    },
    async openVerification() { return { opened: true, host: 'example.com', finalUrl: 'https://example.com/' }; },
    async verify() { return { ok: true }; },
    async publish() { return { sourceUrl: null }; },
  };
  const flow = new SourceBeastWorkflow({ bridge });
  const first = await flow.test('https://example.com');
  assert.equal(first.state, 'verification-required');

  const opened = await flow.openVerification(first.id);
  assert.equal(opened.state, 'verification-in-progress');

  const verified = await flow.verifyAndRetest(first.id);
  assert.equal(verified.state, 'ready');
  assert.equal(verified.score, 92);
  assert.equal(prepareCount, 2);
});

test('weak gauntlet result keeps Add Source locked', async () => {
  const bridge = { async prepare() { return prepared(77); } };
  const flow = new SourceBeastWorkflow({ bridge });
  const result = await flow.test('https://example.com');
  assert.equal(result.state, 'needs-review');
  await assert.rejects(() => flow.add(result.id), /full gauntlet/i);
});
