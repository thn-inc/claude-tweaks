'use strict';
// Pins #1887's fold-in of `refine #N[,#M...]`'s per-record decision resolver into
// `refine-mode.md`'s whole-queue sweep as a Resolve lane (#N becomes a filter, not
// a separate mode). Discrimination note: `refine-mode.md` never mentioned
// "refine-record.md" and never contained the word "Resolve" as a lane name before
// this record (confirmed by grep against the pre-#1887 file); each assertion below
// pins text this change actually introduced.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'plugin', 'skills', 'backlog');
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));

function read(...segments) {
  return fs.readFileSync(path.join(...segments), 'utf8');
}

// --- (1) SKILL.md routing: one procedure, #N a filter ---

test('backlog/SKILL.md: refine #N[,#M...] loads the same refine-mode.md sweep, narrowed by filter — no longer a separate mode', () => {
  const source = read(SKILL_DIR, 'SKILL.md');
  assert.ok(
    source.includes('the same whole-queue sweep as bare `refine` (`refine-mode.md`), narrowed to the named record(s)'),
    'expected the #N[,#M...] row to route to refine-mode.md, not a separate mode',
  );
  assert.ok(
    source.includes('one procedure, `#N` a filter over it, never a separate mode (#1887)'),
    'expected the row to state #N is a filter, never a separate mode',
  );
  // --reset-breaker stays the standalone form it is today (untouched by #1887).
  assert.ok(
    source.includes(
      '`refine --reset-breaker` → the standalone merge-lane circuit-breaker reset — human-present only, never invoked by a scheduled Routine.',
    ),
    'expected --reset-breaker to remain the standalone form, unchanged',
  );
});

// --- (2) refine-mode.md Step 4 precedence names Resolve first ---

test('refine-mode.md Step 4: precedence names Resolve first, ahead of Re-authorize', () => {
  const source = read(SKILL_DIR, 'refine-mode.md');
  assert.ok(
    source.includes(
      'One lane per record, precedence: Resolve → Re-authorize → Grant → Flag-back → Needs-decision →\nPriority → Dependency repair → Needs you.',
    ),
    'expected Resolve first in the Step 4 precedence line',
  );
});

// --- (3) refine-mode.md Step 4 reads refine-record.md for the Resolve lane; the
// file no longer claims the sweep never loads it ---

test('refine-mode.md Step 4 cites refine-record.md for the Resolve lane\'s render/write mechanics', () => {
  const source = read(SKILL_DIR, 'refine-mode.md');
  assert.match(
    source,
    /refine-lanes\.md.{0,400}points at.{0,20}`refine-record\.md`'s own batch-table render and Step 4's per-choice\s*\nwrite mechanics/s,
    'expected Step 4 to cite refine-record.md for the Resolve lane',
  );
});

test('refine-record.md no longer claims refine-mode.md\'s whole-queue sweep never loads it', () => {
  const source = read(SKILL_DIR, 'refine-record.md');
  assert.doesNotMatch(
    source,
    /`refine-mode\.md`'s whole-queue sweep never loads\s*\nthis file, and this file never runs that sweep/,
    'the pre-#1887 never-loaded-by-the-sweep claim must be gone',
  );
  assert.ok(
    source.includes(
      "`refine-mode.md` Step 4 reads this file for the Resolve lane on **every** `refine` invocation —\nwhole-queue (bare `refine`) or `#N[,#M...]`-filtered",
    ),
    'expected refine-record.md to state it is read from Step 4 on every invocation',
  );
  // Retitled, per the deliverable.
  assert.match(source, /^# Backlog Refine — Resolve Lane and Breaker Reset$/m, 'expected the retitled heading');
});

// --- (4) refine-lanes.md gains the Resolve heading, pointer, and the stated
// one-lane-per-record exception for Resolve/Re-authorize ---

test('refine-lanes.md: Resolve heading exists, points at refine-record.md, and states the Resolve/Re-authorize exception', () => {
  const source = read(SKILL_DIR, 'refine-lanes.md');
  assert.match(source, /^## Resolve$/m, 'expected a "## Resolve" heading');
  const resolveSection = source.slice(source.indexOf('## Resolve'), source.indexOf('## Re-authorize'));
  assert.match(
    resolveSection,
    /Read `refine-record\.md` in this skill's\s*\ndirectory for the row shape/,
    'expected the Resolve section to point at refine-record.md rather than restate its mechanics',
  );
  assert.ok(
    source.includes(
      'Resolve and Re-authorize are the one stated\nexception to this rule (#1887):** resolving a decision proposal never resolves a co-occurring\n`bot:blocked`, and vice versa (independent axes), so a record carrying both renders once in\n*each* lane',
    ),
    'expected the stated exception to the one-lane-per-record rule',
  );
});

// --- (5) refine-headless.md states the Resolve skip and its summary line ---

test('refine-headless.md: Resolve is listed among human-present-only lanes, and Step 5 names the skipped-Resolve summary line', () => {
  const source = read(SKILL_DIR, 'refine-headless.md');
  assert.ok(
    source.includes(
      '**Resolve** (#1887 — resolving an\nexisting proposal is a human decision in every render, whole-queue or `#N`-filtered, never\nmachine-applied here), Re-authorize,',
    ),
    'expected Resolve listed as human-present-only alongside Re-authorize',
  );
  assert.match(source, /\*\*Resolve-lane skip line \(#1887\)\.\*\*/, 'expected the Resolve-lane skip line heading in Step 5');
  assert.ok(
    source.includes('run /claude-tweaks:backlog refine` as the\ndrain command'),
    'expected the skip line to name the drain command',
  );
});

// --- (6) refine-closing-summary.md carries the skipped-rows lines ---

test('refine-closing-summary.md: filter/posture exclusion lines name the #N-filter case and point to refine-headless.md for the posture case', () => {
  const source = read(SKILL_DIR, 'refine-closing-summary.md');
  assert.match(source, /\*\*Filter\/posture exclusion lines \(#1887\)\*\*/);
  assert.ok(
    source.includes('run /claude-tweaks:backlog refine to sweep the whole\n     queue.'),
    'expected the #N-filter exclusion line to name the bare refine command',
  );
  assert.ok(
    source.includes("this line is\n     \`refine-headless.md\`'s own Resolve-skip line"),
    'expected the posture-skip case to point at refine-headless.md rather than duplicate it',
  );
});

// --- (7) refine-mode.md stays under the per-file lazy-load ceiling ---

test('refine-mode.md stays under the per-file ceiling after the #1887 additions', () => {
  const bytes = fs.statSync(path.join(SKILL_DIR, 'refine-mode.md')).size;
  assert.ok(bytes < CEILING_BYTES, `refine-mode.md is ${bytes} bytes — must stay under the ${CEILING_BYTES}-byte ceiling`);
});

// --- (8) attention-mode.md's shaped:headless clause updated to say the filtered
// form grants too, not "no grant path" ---

test('attention-mode.md: shaped:headless row states refine #{n} would now also grant, not "no grant path"', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.doesNotMatch(
    source,
    /the per-record resolver has no grant path for a `shaped:headless`-only row: `refine-record\.md`'s own\nfetch reads only decision comments/,
    'the pre-#1887 "no grant path" claim must be gone from the per-row explanation',
  );
  assert.ok(
    source.includes(
      "Since #1887, `refine #{n}` *would* also grant it — `#N` now filters `refine-mode.md`'s whole\nsweep, Grant lane included",
    ),
    'expected the corrected explanation that the filtered form now grants too',
  );
});
