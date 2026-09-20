'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateGrantGate } = require('../plugin/bin/lib/issues/grant-gate.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readFlat = (rel) => read(rel).replace(/\s+/g, ' ');

// Fixed pre-change commit: "Archive record-231 and record-1011's materialized specs
// correctly" — the direct parent of #1488's squash-merge commit onto main, so it predates
// Tasks 5, 6, and 11's needs:*-generalizations alike. A fixed SHA (never HEAD) so this
// control can never become self-defeating the way Task 11's first draft did — see
// progress.md's Task 11 entry. Re-pinned 2026-08-27 (#1538): the original anchor
// (59dcf0971e) was a commit on #1488's own feature branch, so squash-merging that branch
// (#1499) rewrote history and orphaned it from main's ancestry. This anchor lands directly
// on main via a plain fast-forward merge, not a squashed branch tip, so it isn't subject to
// the same class of rewrite.
const BASE_SHA = 'd111b14742e935487e64a7afa7949cd24e71b8d8';

const readAtBase = (rel) =>
  execFileSync('git', ['show', `${BASE_SHA}:${rel}`], { cwd: ROOT, encoding: 'utf8' });
const readAtBaseFlat = (rel) => readAtBase(rel).replace(/\s+/g, ' ');

test('go-red control precondition: BASE_SHA is a real ancestor of HEAD', (t) => {
  // If this ever fails, BASE_SHA needs updating — the two go-red controls below would
  // otherwise be reading either a nonexistent commit or (worse) a descendant of HEAD.
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', BASE_SHA, 'HEAD'], { cwd: ROOT });
  } catch (err) {
    // #2532: a shallow/partial clone doesn't have BASE_SHA's object at all — git reports
    // "Not a valid commit name" rather than a plain non-zero exit, so this precondition can
    // tell "unreachable in a shallow clone" apart from a genuine non-ancestor and skip only
    // the former.
    if (/Not a valid (commit|object) name/.test(String(err.message))) {
      t.skip(
        `commit ${BASE_SHA} is not reachable in this checkout's git history — this ` +
          `precondition needs full history: ${String(err.message).split('\n')[0]}`,
      );
      return;
    }
    throw err;
  }
});

test('grant-gate.js denies a record carrying an arbitrary future needs:*-prefixed label, not just the two named today', () => {
  const result = evaluateGrantGate({
    record: { number: 999, labels: ['by:code-health', 'ready', 'risk:low', 'size:low', 'needs:something-not-yet-invented'], body: 'x' },
    policy: { ceiling: 'unattended', grantOriginationEnabled: true, sensitivePaths: [] },
  });
  assert.equal(result.grant, false);
  assert.equal(result.failedKey, 'needs-label');
});

test('next-mode.md EXCLUDE prefix check matches the same predicate shape as grant-gate.js', () => {
  const NEXT_MODE_FLAT = readFlat('plugin/skills/specify/next-mode.md');
  assert.ok(NEXT_MODE_FLAT.includes("l.name.startsWith('needs:')"), 'next-mode.md must use the identical needs: prefix-match shape grant-gate.js uses');
});

test('tidy/step-1-records.md worklist-rule paragraph names the same /^needs:/ prefix, github-issues side', () => {
  const STEP1_FLAT = readFlat('plugin/skills/tidy/step-1-records.md');
  assert.ok(STEP1_FLAT.includes('/^needs:/'), 'tidy worklist-rule paragraph must name the same needs: prefix pattern');
});

// Go-red controls: read the REAL pre-#1488 shape of each call site from a fixed,
// verifiably-ancestor commit (BASE_SHA above) — never a hand-typed "what it used to look
// like" literal (Task 10's mistake: tautological, can never fail) and never `git show
// HEAD:...` (Task 11's first-draft mistake: self-defeating once the change has landed,
// since HEAD for these files IS the post-change content from here forward). Each control
// proves the corresponding assertion above is capable of failing against real history.

test('go-red control: pre-change grant-gate.js has no needs: prefix check at all (real content @ BASE_SHA)', (t) => {
  // #2532: a shallow/partial clone doesn't have BASE_SHA's tree reachable — guard the read so
  // this one test degrades to a skip with the real git error, instead of a misleading
  // assertion failure.
  let GRANT_GATE_AT_BASE;
  try {
    GRANT_GATE_AT_BASE = readAtBase('plugin/bin/lib/issues/grant-gate.js');
  } catch (err) {
    t.skip(
      `commit ${BASE_SHA} is not reachable in this checkout's git history — this go-red control ` +
        `needs full history: ${String(err.message).split('\n')[0]}`,
    );
    return;
  }
  assert.ok(
    !GRANT_GATE_AT_BASE.includes("startsWith('needs:')"),
    'pre-change grant-gate.js must not already have a prefix check'
  );
  // Non-vacuity check: confirm this really is the old needs:definition-only gate, not an
  // unrelated file/version that merely happens to lack the string above.
  assert.ok(
    GRANT_GATE_AT_BASE.includes('facets.needsDefinition === true'),
    'pre-change grant-gate.js must still show the needs:definition-only gate it used to be'
  );
});

test('go-red control: pre-change next-mode.md EXCLUDE construction has no needs: prefix check at all (real content @ BASE_SHA)', (t) => {
  // #2532: same shallow-clone guard as the grant-gate.js control above.
  let NEXT_MODE_AT_BASE_FLAT;
  try {
    NEXT_MODE_AT_BASE_FLAT = readAtBaseFlat('plugin/skills/specify/next-mode.md');
  } catch (err) {
    t.skip(
      `commit ${BASE_SHA} is not reachable in this checkout's git history — this go-red control ` +
        `needs full history: ${String(err.message).split('\n')[0]}`,
    );
    return;
  }
  assert.ok(
    !NEXT_MODE_AT_BASE_FLAT.includes("startsWith('needs:')"),
    'pre-change next-mode.md must not already have a prefix check'
  );
  // Non-vacuity check: confirm this really is the old literal 5-item EXCLUDE set.
  assert.ok(
    NEXT_MODE_AT_BASE_FLAT.includes("EXCLUDE = new Set(['ready', 'needs:definition', 'parked', 'parent-issue', 'bot:in-progress'])"),
    'pre-change next-mode.md must still show the literal EXCLUDE set it used to be'
  );
});
