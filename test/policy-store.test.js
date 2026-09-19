import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyStore } from '../src/core/policy-store.js';

test('EWMA moves toward observed outcomes', () => {
  const store = new PolicyStore();
  const before = store.get('a', 'x').ewma;
  store.update('a', 'x', true);
  const afterWin = store.get('a', 'x').ewma;
  store.update('a', 'x', false);
  const afterLoss = store.get('a', 'x').ewma;
  assert.ok(afterWin > before);
  assert.ok(afterLoss < afterWin);
});
