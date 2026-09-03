'use strict';
// Minimal unit suite verifying the Sanguine System data layer (Vuf).
// Runs under `npm run test:unit` (node:test). The original internal suite is
// not part of the public release; this smoke suite keeps the declared
// `test:unit` script green against the committed parser/server modules.

const { test } = require('node:test');
const assert = require('node:assert');

const parsers = require('../lib/parsers');
const fs = require('fs');
const path = require('path');

test('parsers module exports the required parser domains', () => {
  for (const key of [
    'slugify', 'parseCharacter', 'parseLocation', 'parseEvent',
    'parseWorldState', 'cityScaffold', 'buildCityMd', 'parseCityMd',
  ]) {
    assert.equal(typeof parsers[key], 'function', `expected function parsers.${key}`);
  }
});

test('slugify folds cyrillic and strips diacritics to ascii slugs', () => {
  assert.equal(parsers.slugify('Москва'), 'moskva');
  assert.equal(parsers.slugify('Düsseldorf'), 'dusseldorf');
  assert.equal(parsers.slugify('Жаркое Дерби'), 'zharkoe_derbi');
  assert.equal(parsers.slugify('  Hello, World!  '), 'hello_world');
});

test('parseTable splits a markdown table into headers and rows', () => {
  const lines = [
    '| Name | Role |',
    '| ---- | ---- |',
    '| Alice | Prince |',
    '| Bob | Sheriff |',
  ];
  const res = parsers.parseTable(lines);
  assert.ok(res, 'parseTable returns truthy for a valid table');
  assert.deepEqual(res.headers, ['Name', 'Role']);
  assert.equal(res.rows.length, 2);
  assert.deepEqual(res.rows[0], ['Alice', 'Prince']);
  assert.deepEqual(res.rows[1], ['Bob', 'Sheriff']);
});

test('cityScaffold produces a city with files and keepDirs', () => {
  const scaffold = parsers.cityScaffold({ display: 'Прага', districts: 'Старе Место, Градчаны' });
  assert.ok(scaffold && typeof scaffold === 'object', 'cityScaffold returns an object');
  assert.ok(Array.isArray(scaffold.keepDirs), 'keepDirs is an array');
  assert.ok(scaffold.files && typeof scaffold.files === 'object', 'files map present');
  const cityMd = scaffold.files['city.md'] || '';
  assert.ok(cityMd.includes('Прага'), 'city.md mentions the city display name');
  assert.ok(scaffold.keepDirs.some((d) => String(d).startsWith('characters/')), 'character lineages scaffolded');
  assert.ok(scaffold.keepDirs.some((d) => String(d).startsWith('chronicles')), 'chronicles scaffolded');
  assert.ok(scaffold.keepDirs.some((d) => String(d).startsWith('rules')), 'rules scaffolded');
});

test('parseCharacter reads a minimal character card', () => {
  const md = [
    '# Vlad',
    '',
    '- **Клан:** Toreador',
    '- **Статус:** active',
    '',
    '## Биография',
    '',
    'Одинокий музыкант ночного клуба.',
  ].join('\n');
  const card = parsers.parseCharacter(md, 'vlad');
  assert.ok(card && typeof card === 'object', 'parseCharacter returns an object');
  assert.equal(card.name, 'Vlad');
  assert.equal(card.clan, 'Toreador');
});

test('system schema validator exists and is loadable', () => {
  const root = path.join(__dirname, '..', '..');
  const schemaMd = path.join(root, 'system', 'schema', 'card_schema.md');
  const validator = path.join(root, 'system', 'schema', 'validate_cards.js');
  assert.ok(fs.existsSync(schemaMd), 'system/schema/card_schema.md exists');
  assert.ok(fs.existsSync(validator), 'system/schema/validate_cards.js exists');
});
