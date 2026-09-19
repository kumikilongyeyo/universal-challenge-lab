import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthorizedTarget } from '../src/core/target-policy.js';

test('allows loopback and .test targets', () => {
  assert.equal(assertAuthorizedTarget('http://127.0.0.1:4173').hostname, '127.0.0.1');
  assert.equal(assertAuthorizedTarget('https://captcha-lab.test/path').hostname, 'captcha-lab.test');
});

test('rejects arbitrary public targets', () => {
  assert.throws(() => assertAuthorizedTarget('https://example.com'), /Target blocked/);
  assert.throws(() => assertAuthorizedTarget('https://some-live-site.net'), /Target blocked/);
});
