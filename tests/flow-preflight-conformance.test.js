'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { ADOPTION_NOTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'flow', 'preflight'));
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));

test('steps-and-gates.md calls flow-preflight.js --run exactly once in the adoption section, no longer invokes check-resume-freshness --run, still names the verb, and checks BLOCKED right after the call (#1931 AC5)', () => {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  assert.strictEqual((t.match(/flow-preflight\.js" --run/g) || []).length, 1);
  assert.strictEqual((t.match(/check-resume-freshness --run/g) || []).length, 0);
  assert.ok(t.includes('check-resume-freshness'), 'the verb is still cited by name (resume-freshness-citations pin)');
  const call = t.indexOf('flow-preflight.js" --run');
  const section = t.indexOf('### Adopting an inherited run directory');
  const next = t.indexOf('### Partial step lists');
  assert.ok(section < call && call < next, 'the call lives in the adoption section');
  const after = t.slice(call, call + 1200);
  assert.match(after, /freshness\.value\.verdict === 'BLOCKED'/, 'a literal check-and-stop on the freshness verdict follows the call');
  assert.match(after, /stop/i);
  assert.match(t, /inventory\.value\.status === 'MISMATCH'/);
  assert.match(t, /adoption\.value\.note/);
  assert.ok(Buffer.byteLength(t, 'utf8') <= CEILING_BYTES);
});

// #1931 I1: the CLI exits 3 (nothing written) for a missing/unanchored --run, so
// the module's case 4 is never reachable THROUGH it — the prose must give the
// reader a branch for each non-zero exit, or a code-3 run has no case at all.
test('the adoption section branches on the CLI\'s non-zero exits — 3 is case 4, 2 is a malformed invocation (#1931 I1)', () => {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  const section = t.slice(t.indexOf('### Adopting an inherited run directory'), t.indexOf('### Partial step lists'));
  assert.ok(section.length > 0, 'the adoption section bounds must still resolve');
  assert.match(section, /exit code 3/);
  assert.match(section, /exit code 2/);
  // Anchored to the I1 paragraph's OWN wording — the reason-mapping sentence.
  // `is not anchored to the main checkout` alone would be satisfied by case 4's
  // note literal, which predates this paragraph.
  assert.match(section, /`missing` → `does not exist`/);
  assert.match(section, /the reason the CLI's own stderr names/);
  assert.match(section, /passes no `--json`/);
  // Case 4's own bullet no longer claims the pack reports the reason — it never
  // runs far enough to write one.
  assert.doesNotMatch(section, /The pack reports which reason applied/);
});

test('the four adoption note literals in preflight.js equal the ones steps-and-gates.md renders (#1931 AC5)', () => {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  for (const n of [1, 2, 3, 4]) {
    assert.ok(t.includes('`' + ADOPTION_NOTES[n] + '`'), `case ${n} literal rendered verbatim in the prose`);
  }
});

test('manifesto.md renders the auto FYI table from preflight.levers and lists the pack as a source (#1931)', () => {
  const t = read('plugin/skills/flow/manifesto.md');
  assert.match(t, /preflight\.levers/);
  assert.match(t, /preflight\.json/);
  assert.match(t, /run-config/);
  assert.match(t, /`header`/);
  assert.match(t, /unresolved/);
  // #1931 C1: only case 1 has a config.yml to read — cases 2/3/5 compute the
  // levers fresh, so the do-not-re-resolve rule must not fire on them.
  assert.match(t, /adoption\.value\.case === 1/);
  assert.ok(Buffer.byteLength(t, 'utf8') <= CEILING_BYTES);
});

test('flow/SKILL.md names the pack in Step 3 and stays under the per-file ceiling (#1931 AC6)', () => {
  const t = read('plugin/skills/flow/SKILL.md');
  assert.match(t, /flow-preflight\.js/);
  assert.ok(Buffer.byteLength(t, 'utf8') <= CEILING_BYTES);
});
