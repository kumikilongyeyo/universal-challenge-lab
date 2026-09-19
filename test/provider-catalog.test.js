import test from 'node:test';
import assert from 'node:assert/strict';
import { providerCatalog } from '../src/integrations/provider-catalog.js';

test('provider matrix covers the planned provider families', () => {
  const ids = new Set(providerCatalog.map((p) => p.id));
  for (const id of ['recaptcha-v2', 'hcaptcha', 'turnstile', 'aws-waf', 'datadome', 'perimeterx-human', 'akamai-bot-manager']) {
    assert.ok(ids.has(id), id);
  }
});

test('no provider catalog entry claims production auto-solving', () => {
  assert.ok(providerCatalog.every((provider) => provider.automatedSolve === false));
});
