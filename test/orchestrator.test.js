import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry } from '../src/core/adapter-registry.js';
import { PolicyStore } from '../src/core/policy-store.js';
import { AdaptiveOrchestrator } from '../src/core/orchestrator.js';
import { generateChallenge } from '../src/fixtures/generator.js';
import { textAdapter } from '../src/adapters/text-adapter.js';
import { gridAdapter } from '../src/adapters/grid-adapter.js';
import { sliderAdapter } from '../src/adapters/slider-adapter.js';
import { powAdapter } from '../src/adapters/pow-adapter.js';
import { fallbackAdapter } from '../src/adapters/fallback-adapter.js';

function build() {
  const registry = new AdapterRegistry()
    .register(textAdapter)
    .register(gridAdapter)
    .register(sliderAdapter)
    .register(powAdapter)
    .register(fallbackAdapter);
  const policy = new PolicyStore();
  return { policy, orchestrator: new AdaptiveOrchestrator({ registry, policy }) };
}

test('routes each fixture family to its intended adapter', async () => {
  const expected = {
    'text-transform': 'text-transform-v1',
    'semantic-grid': 'semantic-grid-v1',
    'slider-geometry': 'slider-geometry-v1',
    'proof-of-work': 'sha256-pow-v1',
  };
  const { orchestrator } = build();

  for (const [type, adapterId] of Object.entries(expected)) {
    const result = await orchestrator.run(generateChallenge(type, 0.2));
    assert.equal(result.success, true, type);
    assert.equal(result.adapterId, adapterId, type);
  }
});

test('falls back when the highest ranked adapter fails validation', async () => {
  const bad = {
    id: 'bad-high-confidence',
    detect: () => 1,
    solve: () => ({ success: true, answer: 'wrong' }),
    validate: () => false,
  };
  const good = {
    id: 'good-lower-confidence',
    detect: () => 0.8,
    solve: () => ({ success: true, answer: 42 }),
    validate: (_, result) => result.answer === 42,
  };
  const registry = new AdapterRegistry().register(bad).register(good);
  const policy = new PolicyStore();
  const orchestrator = new AdaptiveOrchestrator({ registry, policy });
  const challenge = { id: 'fixture', type: 'unit', features: {}, payload: {} };

  const result = await orchestrator.run(challenge);
  assert.equal(result.success, true);
  assert.equal(result.adapterId, 'good-lower-confidence');
  assert.deepEqual(result.attempts.map((a) => a.adapterId), ['bad-high-confidence', 'good-lower-confidence']);
});

test('policy learning penalizes repeated failed adapter outcomes', async () => {
  const unstable = {
    id: 'unstable',
    detect: () => 0.9,
    solve: () => ({ success: false }),
    validate: () => false,
  };
  const stable = {
    id: 'stable',
    detect: () => 0.82,
    solve: () => ({ success: true }),
    validate: () => true,
  };
  const registry = new AdapterRegistry().register(unstable).register(stable);
  const policy = new PolicyStore();
  const orchestrator = new AdaptiveOrchestrator({ registry, policy });
  const challenge = { id: 'learn', type: 'learnable', features: {}, payload: {} };

  for (let i = 0; i < 10; i += 1) await orchestrator.run(challenge);
  const ranking = orchestrator.rank(challenge);
  assert.equal(ranking[0].adapterId, 'stable');
  assert.ok(policy.get('unstable', 'learnable').ewma < policy.get('stable', 'learnable').ewma);
});
