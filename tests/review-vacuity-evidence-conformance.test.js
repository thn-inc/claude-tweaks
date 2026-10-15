'use strict';
// tests/review-vacuity-evidence-conformance.test.js — pins #3124's two
// review rules: lens 3f vacuity claims need execution evidence (and a
// pair-agreed one without it is downgraded to unconfirmed), and a fix that
// removes test cases or assertions never auto-applies.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REVIEW = path.join(__dirname, '..', 'plugin', 'skills', 'review');
const lensDispatch = fs.readFileSync(path.join(REVIEW, 'step3-lens-dispatch.md'), 'utf8');
const routing = fs.readFileSync(path.join(REVIEW, 'step3-routing.md'), 'utf8');

function sectionOf(md, heading) {
  const start = md.indexOf(`\n${heading}\n`);
  assert.ok(start !== -1, `heading not found: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const rest = md.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

test('lens 3f carries a vacuity-evidence diagnostic requiring observed execution', () => {
  const lens3f = sectionOf(lensDispatch, '### 3f: Test Quality');
  const line = lens3f.split('\n').find((l) => /Vacuity-evidence diagnostic/.test(l));
  assert.ok(line, 'lens 3f must carry a **Vacuity-evidence diagnostic** bullet');
  assert.match(line, /cannot fail/);
  assert.match(line, /vacuous/);
  assert.match(line, /observed/);
  assert.match(line, /mutat/);
  assert.match(line, /docstring/);
});

test('the vacuity bullet sits directly after the Discrimination diagnostic', () => {
  const lens3f = sectionOf(lensDispatch, '### 3f: Test Quality');
  const bullets = lens3f.split('\n').filter((l) => l.startsWith('- '));
  const disc = bullets.findIndex((l) => /Discrimination diagnostic/.test(l));
  assert.ok(disc !== -1, 'Discrimination diagnostic bullet must exist');
  assert.match(bullets[disc + 1], /Vacuity-evidence diagnostic/);
});

test('the Reproduction dispatch section downgrades an unevidenced lens 3f vacuity finding', () => {
  const lines = lensDispatch.split('\n');
  const idx = lines.findIndex((l) => /^> - \*\*Lens 3f vacuity findings need execution evidence/.test(l));
  assert.ok(idx !== -1, 'Reproduction dispatch blockquote must carry the lens 3f downgrade bullet');
  const bullet = lines[idx];
  assert.match(bullet, /categorise-reproduction/);
  assert.match(bullet, /`unconfirmed`/);
  assert.match(bullet, /reproduction agreement overridden, no execution evidence/);
  assert.match(bullet, /Direct-verification override does not lift/);
  const onlyOne = lines.findIndex((l) => /^> - Findings present in only one agent's output/.test(l));
  assert.ok(onlyOne !== -1 && onlyOne < idx, 'the downgrade bullet must follow the reproduction bullets');
});

test('step3-routing lists the lens 3f no-execution-evidence source among unconfirmed sources', () => {
  const start = routing.indexOf('**`unconfirmed` findings can originate from several sources**');
  assert.ok(start !== -1, 'unconfirmed-sources list must exist');
  const list = routing.slice(start, routing.indexOf('**Effort-tier surfacing.**', start));
  assert.match(list, /^- Vacuity claim without execution evidence \(lens 3f/m);
});
