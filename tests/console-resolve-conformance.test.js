'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));

test('review-console.md calls console-resolve.js --run exactly once, inside the short-circuit section, and stays under the ceiling (#1932 AC7)', () => {
  const t = read('plugin/skills/wrap-up/review-console.md');
  assert.strictEqual((t.match(/console-resolve\.js" --run/g) || []).length, 1);
  const section = t.indexOf('## Auto-resolution short-circuit');
  const next = t.indexOf('## Present a real stop');
  const call = t.indexOf('console-resolve.js" --run');
  assert.ok(section < call && call < next, 'the call lives in the short-circuit section');
  assert.match(t, /exit code 4/);
  assert.match(t, /exit code 5/);
  assert.match(t, /exit codes 2 and 3/);
  assert.match(t, /HARD-GATE/);
  assert.match(t, /--dry-run/);
  assert.ok(Buffer.byteLength(t, 'utf8') <= CEILING_BYTES);
});

test('auto-merge-short-circuit.md logs the needs-human verdict the resolver reads (#1932 decision 3)', () => {
  const t = read('plugin/skills/wrap-up/auto-merge-short-circuit.md');
  assert.match(t, /assess-agent-autonomy verdict needs-human/);
  assert.ok(Buffer.byteLength(t, 'utf8') <= CEILING_BYTES);
});

test('settle-and-merge.md logs the needs-human verdict the resolver reads (#1932 C1)', () => {
  const t = read('plugin/skills/dispatch/settle-and-merge.md');
  assert.match(t, /assess-agent-autonomy verdict needs-human/);
  assert.ok(Buffer.byteLength(t, 'utf8') <= CEILING_BYTES);
});

test('autonomy-ceiling.md names console-resolve.js as consoleAutoResolve\'s execution (#1932)', () => {
  const t = read('plugin/skills/_shared/autonomy-ceiling.md');
  assert.match(t, /console-resolve\.js/);
  // #1932 I5: the executor sentence is scoped — the reconciler-side caller
  // keeps bin/lib/reconcile/console-execute.js.
  assert.match(t, /reconciler-side caller keeps/);
  assert.match(t, /console-execute\.js/);
  assert.ok(Buffer.byteLength(t, 'utf8') <= CEILING_BYTES);
});

test('ceremony-derive.js no longer scopes its derivation to a headless firing (#1932 M1)', () => {
  assert.ok(!read('plugin/bin/lib/dispatch/ceremony-derive.js').includes('for a headless firing'));
});

test('wrap-up/SKILL.md did not grow past its pre-#1932 size (#1932 AC7)', () => {
  assert.ok(Buffer.byteLength(read('plugin/skills/wrap-up/SKILL.md'), 'utf8') <= 40893);
});

// --- #2007: multispec-review-console.md's short-circuit fans console-resolve.js out over
// each spec-{N}/ dir plus the parent, mirroring review-console.md's single-call shape
// instead of a hand-rolled per-item resolution loop. Go-red proof [IL-105]: the retired-clause
// pattern is also asserted to match the frozen pre-#2007 excerpt below (the bytes the change
// replaced), so a green doesNotMatch on the live file proves the pattern can actually fail.

// Frozen bytes of the pre-#2007 "Auto-resolution short-circuit" paragraph
// (plugin/skills/flow/multispec-review-console.md before #2007), copied verbatim from the
// pre-change file rather than re-derived from memory of the fix.
const PRE_2007_MULTISPEC_SHORT_CIRCUIT = 'When granted: render every section below as an informational report (nothing dropped), rows stamped `AUTO-RESOLVED`; resolve every item per its stated default with **zero** `AskUserQuestion` calls — batch sections and `Q#`/`M#` as if Approve all had been chosen; `U#` resolves to **filed**, the one exception to its default (same rule as the single-spec short-circuit). Execute via "On approval" below; log one `AUTO {time} — Review Console: auto-resolved {item}. Reversibility: {…}.` line per item to the originating spec\'s `decisions.md` (or the parent\'s, for a parent-level item) instead of a user answer, retain every `staged/` file as a revert artifact rather than consuming it, and send **one** consolidated `PushNotification` for the whole run, not per spec/item, at the same point the single-spec short-circuit sends its FYI.';

const RETIRED_PER_ITEM_LOG_CLAUSE = /log one `AUTO \{time\} — Review Console: auto-resolved \{item\}/;

test('the frozen pre-#2007 excerpt actually carries the retired per-item logging clause (proves the absence check can go red)', () => {
  assert.match(PRE_2007_MULTISPEC_SHORT_CIRCUIT, RETIRED_PER_ITEM_LOG_CLAUSE, 'fixture must contain the retired clause, or the live doesNotMatch below is vacuous');
});

test('multispec-review-console.md fans console-resolve.js out over each spec dir plus the parent (#2007)', () => {
  const t = read('plugin/skills/flow/multispec-review-console.md');
  const section = t.indexOf('## Auto-resolution short-circuit');
  const next = t.indexOf('## Console-on-PR');
  assert.ok(section > 0 && next > section);
  const body = t.slice(section, next);

  // Exactly one call, and it lives inside this section.
  assert.strictEqual((body.match(/console-resolve\.js" --run/g) || []).length, 1);

  // The retired hand-rolled per-item resolution loop no longer appears.
  assert.doesNotMatch(body, RETIRED_PER_ITEM_LOG_CLAUSE, 'the retired per-item logging clause must not reappear');
  assert.doesNotMatch(body, /rows stamped `AUTO-RESOLVED`; resolve every item per its stated default/, 'the retired manual-stamp-and-resolve clause must not reappear');

  // The fan-out iterates spec dirs plus the parent — never a single call over the whole tree.
  assert.match(body, /spec-\{N\}/, 'must name the per-spec directory pattern');
  assert.match(body, /plus once more over the parent run dir itself/, 'must call once more over the parent, mirroring the manifest-driven engine call above');
  assert.match(body, /N\+1 calls, never a single call over the whole tree/, 'must state the fan-out shape explicitly');

  // The bundle-level merge decision is never wired from any per-call merge.resolution field.
  assert.match(body, /bundle-level branch-finish\/merge decision is never read from any individual call's own `merge\.resolution` field/, 'must state the bundle merge decision is independent of any single call\'s merge field');

  assert.ok(Buffer.byteLength(t, 'utf8') <= CEILING_BYTES);
});
