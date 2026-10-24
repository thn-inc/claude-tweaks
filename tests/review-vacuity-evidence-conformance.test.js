'use strict';
// tests/review-vacuity-evidence-conformance.test.js — pins #3124's two
// review rules: lens 3f vacuity claims need execution evidence (and a
// pair-agreed one without it is downgraded to unconfirmed), and a fix that
// removes test cases or assertions never auto-applies.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const REVIEW = path.join(__dirname, '..', 'plugin', 'skills', 'review');
const lensDispatch = readText(path.join(REVIEW, 'step3-lens-dispatch.md'));
const routing = readText(path.join(REVIEW, 'step3-routing.md'));

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
  assert.match(line, /throwaway copy/);
  assert.match(line, /never in the shared tree/);
  assert.match(line, /`git worktree remove`/);
  assert.match(line, /never mutate the shared tree as a substitute/);
  assert.match(line, /errored or crashed/);
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
  assert.match(bullet, /Reading source alone never lifts this downgrade: the only way back/);
  assert.match(bullet, /re-confirmed by executed run: \{command\} → \{observed output\}\. Confirmed\./);
  const onlyOne = lines.findIndex((l) => /^> - Findings present in only one agent's output/.test(l));
  assert.ok(onlyOne !== -1 && onlyOne < idx, 'the downgrade bullet must follow the reproduction bullets');
});

test('the retired Direct-verification override paragraph is gone; the downgrade bullet alone keeps lens 3f vacuity findings on an executed run', () => {
  const para = lensDispatch.split('\n').find((l) => l.startsWith('> **Direct-verification override.**'));
  assert.equal(para, undefined, 'the Direct-verification override paragraph must stay retired');
  assert.doesNotMatch(lensDispatch, /direct[- ]verification/i);
  const bullet = lensDispatch.split('\n').find((l) => /^> - \*\*Lens 3f vacuity findings need execution evidence/.test(l));
  assert.match(bullet, /re-confirmed by executed run/);
});

test('step3-routing lists the lens 3f no-execution-evidence source among unconfirmed sources', () => {
  const start = routing.indexOf('**`unconfirmed` findings can originate from several sources**');
  assert.ok(start !== -1, 'unconfirmed-sources list must exist');
  const end = routing.indexOf('**Effort-tier surfacing.**', start);
  assert.ok(end !== -1, 'end-of-list anchor must exist');
  const list = routing.slice(start, end);
  assert.match(list, /^- Vacuity claim without execution evidence \(lens 3f/m);
});

const contract = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'auto-mode-contract.md'));

test('step3-routing states test-removal fixes route STAGED at every ceiling, over the prose-exempt bump', () => {
  const auto = sectionOf(routing, '## Auto mode (severity-based routing)');
  const para = auto.split('\n').find((l) => l.startsWith('**Test-removal fixes never auto-apply.**'));
  assert.ok(para, 'Auto mode must carry a **Test-removal fixes never auto-apply.** paragraph');
  for (const ceiling of ['`none`', '`low`', '`medium`']) assert.ok(para.includes(ceiling), `must name ceiling ${ceiling}`);
  assert.match(para, /STAGED/);
  assert.match(para, /prose-exempt bump/);
  assert.match(para, /KEPT-PROMPT/);
  assert.match(para, /test-removal override — staged/);
  assert.match(para, /counts as a removal unless the two match one-to-one as the same case/);
  const prose = auto.indexOf('Also resolve `review-auto-apply-prose-exempt`');
  assert.ok(prose !== -1 && prose < auto.indexOf(para), 'the override follows the prose-exempt paragraph');
});

test('the ceiling-keyed table is followed by a pointer to the test-removal override', () => {
  const auto = sectionOf(routing, '## Auto mode (severity-based routing)');
  const after = auto.slice(auto.indexOf('| **Low** |'));
  const nextPara = after.split('\n\n')[1];
  assert.match(nextPara, /test-removal override/);
});

test('the auto-mode contract row for /review Step 3 Routing names the test-removal override', () => {
  const row = contract.split('\n').find((l) => l.startsWith('| Code review findings (`/review` Step 3 Routing)'));
  assert.ok(row, 'contract row must exist');
  assert.match(row, /removes test cases or assertions/);
  assert.match(row, /removes test cases or assertions → `STAGED` at every ceiling, `KEPT-PROMPT` when critical/);
});

test('review-vacuity: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const FILE = path.join(REVIEW, 'step3-routing.md');
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  const auto = sectionOf(text, '## Auto mode (severity-based routing)');
  assert.match(auto.slice(auto.indexOf('| **Low** |')).split('\n\n')[1], /test-removal override/);
});
