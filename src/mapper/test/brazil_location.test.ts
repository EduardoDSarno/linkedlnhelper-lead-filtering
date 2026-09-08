import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBrazilRegion } from '../brazil_location.js';

test('resolves a UF code to its state name', () => {
  assert.deepEqual(resolveBrazilRegion('GO'), { state: 'Goiás', uf: 'GO' });
  assert.deepEqual(resolveBrazilRegion('sp'), { state: 'São Paulo', uf: 'SP' });
});

test('resolves a full state name regardless of accents or casing', () => {
  assert.deepEqual(resolveBrazilRegion('Goiás'), { state: 'Goiás', uf: 'GO' });
  assert.deepEqual(resolveBrazilRegion('goias'), { state: 'Goiás', uf: 'GO' });
  assert.deepEqual(resolveBrazilRegion('SANTA CATARINA'), {
    state: 'Santa Catarina',
    uf: 'SC',
  });
});

test('does not resolve a city, a country, or a two-letter non-UF fragment', () => {
  assert.equal(resolveBrazilRegion('Goiânia'), undefined);
  assert.equal(resolveBrazilRegion('Brasil'), undefined);
  assert.equal(resolveBrazilRegion('XX'), undefined);
});
