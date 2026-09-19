import test from 'node:test';
import assert from 'node:assert/strict';
import { upstreamCatalog } from '../src/integrations/upstream-catalog.js';

test('upstream catalog makes code-import status explicit', () => {
  assert.ok(upstreamCatalog.length >= 3);
  assert.ok(upstreamCatalog.every((item) => item.url.startsWith('https://github.com/')));
  assert.ok(upstreamCatalog.every((item) => item.importedCode === false));
});
