'use strict';
// Pins record #1489's widening of backlog/attention-mode.md (needs:* +
// bot:blocked via the session-scoped record-queue-fetch snapshot, the
// three-launcher render collapse, the breaker banner + tidy row), the new
// refine-record.md #N/--reset-breaker resolver, SKILL.md's routing update,
// and the carried work-record-permission-matrix.md row edit (Task 2 review).
// Each assertion is a literal-string pin, not a structural re-derivation —
// per skill-prose-conformance-tests, every `doesNotMatch` string below was
// spot-checked to have actually existed in the pre-#1489 file (base commit
// 7ce21b0d5) so a revert of the fix would turn these tests red.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');
const SHARED_DIR = path.join(__dirname, '..', 'plugin', 'skills', '_shared');

function read(...segments) {
  return fs.readFileSync(path.join(...segments), 'utf8');
}

test('attention-mode.md: needs:*/bot:blocked come from the session-scoped snapshot, not a --label fetch', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.match(
    source,
    /_shared\/record-queue-fetch\.md.{0,40}Session-scoped record snapshot/s,
    'expected a citation of record-queue-fetch.md\'s Session-scoped record snapshot section',
  );
  assert.doesNotMatch(
    source,
    /gh issue list --state open --label needs:definition/,
    'the pre-#1489 dedicated needs:definition --label fetch must be gone — needs:* now comes from the snapshot',
  );
});

test('attention-mode.md: solution:unjustified and ready+shaped:headless direct fetches survive byte-level', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.ok(
    source.includes(
      'gh issue list --state open --label solution:unjustified --json number,title,createdAt,labels --limit 200 > "$ST_BACKLOG_ATTENTION_SOLUTION_UNJUSTIFIED"',
    ),
    'the solution:unjustified single-label fetch line must survive byte-for-byte',
  );
  assert.ok(
    source.includes(
      'gh issue list --state open --label ready --label shaped:headless --json number,title,createdAt,labels --limit 200 > "$ST_BACKLOG_ATTENTION_SHAPED_HEADLESS"',
    ),
    'the ready+shaped:headless two-label fetch line must survive byte-for-byte',
  );
});

test('attention-mode.md: render collapses to the three launchers (specify/challenge/refine)', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');

  // needs:decision rows quote the captured **Proposed:** line.
  assert.match(source, /\*\*Proposed:\*\*/, 'expected a **Proposed:** reference for needs:decision rows');

  // The refine #{n} catch-all is stated as the permanent default for any
  // future needs:* marker.
  assert.match(
    source,
    /`refine #\{n\}` catch-all is the \*\*permanent default\*\*/,
    'expected the refine catch-all to be stated as the permanent default',
  );

  // bot:blocked gets its own row with the refine launcher.
  assert.ok(
    source.includes(
      '| #{n} | bot:blocked | {createdAt, relative} | run /claude-tweaks:backlog refine #{n} to re-authorize after the failure |',
    ),
    'expected the bot:blocked row with its refine re-authorize launcher',
  );

  // Amendment: solution:unjustified's launcher is /claude-tweaks:challenge,
  // never the refine launcher (the pre-#1489 text used refine here).
  assert.ok(
    source.includes(
      '| #{n} | solution:unjustified | {createdAt, relative} | run /claude-tweaks:challenge #{n} for the evidence-or-accept-risk verdict on the flag |',
    ),
    'expected the solution:unjustified row to launch /claude-tweaks:challenge, not refine',
  );
  assert.doesNotMatch(
    source,
    /solution:unjustified \| \{createdAt, relative\} \| run \/claude-tweaks:backlog refine #\{n\} to grant despite the flag/,
    'the pre-#1489 refine-launcher wording for solution:unjustified must be gone',
  );
});

test('attention-mode.md: breaker banner (fail-open + launcher) and tidy row (anchored glob + launcher)', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');

  assert.match(
    source,
    /read failure or the degraded shape omits the banner entirely, never renders a false-positive/,
    'expected the fail-open omission sentence for the breaker banner',
  );
  assert.ok(
    source.includes('run /claude-tweaks:backlog refine --reset-breaker'),
    'expected the --reset-breaker launcher on the breaker banner line',
  );

  assert.match(
    source,
    /\[IL-127\]|Anchoring section/,
    'expected the tidy row\'s glob resolution to cite IL-127 / the Anchoring section',
  );
  assert.ok(
    source.includes('run /claude-tweaks:tidy --approve'),
    'A4/#1493: /claude-tweaks:tidy --approve now ships -- the tidy row must launch it directly',
  );
});

test('attention-mode.md: AC5 empty-state widening and the dedupe Anti-Patterns row', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');

  assert.ok(
    source.includes(
      'Nothing needs attention — no open record carries a\nneeds:* marker, solution:unjustified, an ungranted shaped:headless spec, or bot:blocked.',
    ),
    'expected the widened empty-state string naming needs:*/solution:unjustified/shaped:headless/bot:blocked',
  );

  assert.ok(
    source.includes(
      '| A separate row per matched type for a record carrying two or more of the classifications | Dedupe by issue number and render one row with a concatenated Type/Recommended action, however many types matched |',
    ),
    'expected the dedupe Anti-Patterns row to survive byte-for-byte',
  );
});

test('attention-mode.md: A5 shaped:headless launcher points at the sweep\'s Grant lane, not refine #{n}', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');

  assert.ok(
    source.includes(
      '| #{n} | shaped:headless (no grant) | {createdAt, relative} | run /claude-tweaks:backlog refine to grant via the sweep\'s Grant lane (spec was headlessly shaped — no human has reviewed it) |',
    ),
    'expected the shaped:headless row to point at bare refine\'s Grant lane, not refine #{n}',
  );
  assert.doesNotMatch(
    source,
    /shaped:headless \(no grant\)[^|]*\|[^|]*\|[^|]*\| run \/claude-tweaks:backlog refine #\{n\} to grant/,
    'the pre-#1489 refine #{n}-to-grant wording for shaped:headless must be gone from the table row',
  );
});

// --- #1884: Batch launchers block, between the table and "Pick up next" ---

test('attention-mode.md: Batch launchers heading exists between the table and Pick up next, citing tidy\'s Yours grouping rule', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.match(source, /### Batch launchers/, 'expected a "### Batch launchers" heading');
  assert.match(
    source,
    /tidy\/step-6-auto\.md.{0,40}Yours grouping/s,
    'expected a citation of tidy\'s Yours grouping section, not a restated key derivation',
  );
  const headingIdx = source.indexOf('### Batch launchers');
  const pickUpNextIdx = source.indexOf('Pick up next: #{n}');
  assert.ok(headingIdx > 0 && pickUpNextIdx > headingIdx, 'Batch launchers must sit between the table and Pick up next');
});

test('attention-mode.md: needs:decision/bot:blocked/needs:* catch-all batch into one backlog refine line', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.ok(
    source.includes('/claude-tweaks:backlog refine #{a},#{b},…'),
    'expected the batchable-target closing line naming a comma list',
  );
  assert.match(source, /`needs:decision`, `bot:blocked`,\s*\n?\s*and any other `needs:\*` catch-all/);
});

test('attention-mode.md: shaped:headless (no grant) rows key on the ref-less bare refine line, a distinct group from the batchable one', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.match(
    source,
    /distinct from the batchable[\s\S]{0,20}`backlog refine` group below even though both cite the same skill\+mode/,
    'expected the Grant lane to be stated as a distinct group from the batchable backlog-refine group',
  );
  assert.ok(
    source.includes('closes with one line, `/claude-tweaks:backlog refine`'),
    'expected the ref-less closing line for the Grant lane group',
  );
});

test('attention-mode.md: needs:definition and solution:unjustified are never batched, and a dual-type row lands in both paste blocks', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.match(source, /`needs:definition` and `solution:unjustified` are never batched/);
  assert.match(source, /specify\/SKILL\.md.{0,20}batch branch/);
  assert.match(source, /single-ref only by its[\s\S]{0,20}`argument-hint`/);
  assert.ok(
    source.includes(
      "a `needs:definition + solution:unjustified` row's number appears in both the `specify`\npaste block and the `challenge` paste block, never elided into one.",
    ),
    'expected the dual-type-row contributes-to-both-blocks rule',
  );
});

test('attention-mode.md: empty ranked table omits the Batch launchers block too', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.ok(
    source.includes('omit both the Batch launchers block and the "Pick up next" line'),
    'expected the empty-state paragraph to also omit the Batch launchers block',
  );
});

test('refine-record.md exists and carries the #N resolver + --reset-breaker + shim-with-removal-condition contract', () => {
  const filePath = path.join(SKILL_DIR, 'refine-record.md');
  assert.ok(fs.existsSync(filePath), 'refine-record.md must exist');
  const source = read(filePath);

  assert.match(
    source,
    /Decision-comment template|<!-- needs-decision:/,
    'expected a citation of work-record.md\'s Decision-comment template / marker',
  );
  assert.match(
    source,
    /merge-lane-reset\.md/,
    'expected a citation of merge-lane-reset.md for --reset-breaker',
  );
  assert.doesNotMatch(
    source,
    /Reset it\?/,
    'refine-record.md must not duplicate merge-lane-reset.md\'s own question text',
  );
  assert.match(
    source,
    /backlog-refine-human-only/,
    'expected the backlog-refine-human-only compatibility shim to be documented',
  );
  assert.match(
    source,
    /removal condition/i,
    'expected the shim to carry a stated removal condition',
  );
});

// Superseded by #1887: refine-mode.md's Step 4 now reads refine-record.md for
// the Resolve lane on every invocation (whole-queue or #N-filtered) — the two
// files are folded into one procedure, not routed apart by SKILL.md. See the
// #1887 block below for the live pins.
test('refine-mode.md Step 4 reads refine-record.md for the Resolve lane; SKILL.md still routes --reset-breaker there', () => {
  const refineModeSource = read(SKILL_DIR, 'refine-mode.md');
  const skillSource = read(SKILL_DIR, 'SKILL.md');

  assert.match(
    refineModeSource,
    /refine-record\.md/,
    'refine-mode.md Step 4 must cite refine-record.md for the Resolve lane\'s render/write mechanics (#1887)',
  );
  assert.match(
    skillSource,
    /refine-record\.md/,
    'SKILL.md must still route the standalone --reset-breaker form to refine-record.md',
  );
});

test('backlog SKILL.md: argument-hint carries #N[,#M...] and --reset-breaker; no stale dispatch-next backtick reference', () => {
  const source = read(SKILL_DIR, 'SKILL.md');
  const hintLine = source.split('\n').find((l) => l.startsWith('argument-hint:'));
  assert.ok(hintLine, 'expected an argument-hint frontmatter line');
  assert.ok(hintLine.includes('#N[,#M...]'), 'argument-hint must include #N[,#M...]');
  assert.ok(hintLine.includes('--reset-breaker'), 'argument-hint must include --reset-breaker');

  assert.doesNotMatch(
    source,
    /`\/claude-tweaks:dispatch next`/,
    'no backtick-quoted `/claude-tweaks:dispatch next` reference should remain (row-7 carry pin)',
  );
});

test('work-record-permission-matrix.md: /backlog refine row Adds parked and Removes needs:decision', () => {
  const source = read(SHARED_DIR, 'work-record-permission-matrix.md');
  const line = source.split('\n').find((l) => l.startsWith('| **`/backlog refine`**'));
  assert.ok(line, 'expected the /backlog refine matrix row');

  // Split the markdown table row into its data cells (Actor, Adds, Removes,
  // Never) so the `parked`/`needs:decision` pins are checked against the
  // specific column they belong in, not merely "somewhere on the line" —
  // discriminates against the pre-edit row, where neither string appeared in
  // its respective column. `\|` (GFM's mandatory escape for a literal pipe
  // inside a table cell — this row's Actor cell carries `--source routine\|sweep`
  // in an inline code span since #1490's matrix merge) is not a column
  // separator; mask it before splitting so it isn't mistaken for one.
  const ESCAPED_PIPE_PLACEHOLDER = '\u0001';
  const cells = line
    .replace(/\\\|/g, ESCAPED_PIPE_PLACEHOLDER)
    .split('|')
    .map((c) => c.trim().split(ESCAPED_PIPE_PLACEHOLDER).join('\\|'))
    .filter((c) => c.length > 0);
  assert.strictEqual(cells.length, 4, `expected 4 data cells (Actor/Adds/Removes/Never), got ${cells.length}`);
  const [, adds, removes] = cells;

  assert.match(adds, /`parked`/, 'expected `parked` in the Adds column');
  assert.match(
    adds,
    /the `#N` park choice via `refine-record\.md`, human-confirmed/,
    'expected the parked-Adds rationale clause',
  );

  assert.match(removes, /`needs:decision`/, 'expected `needs:decision` in the Removes column');
  assert.match(
    removes,
    /the `#N` batch-apply, gated on zero unresolved `needs-decision:\*` comments per `_shared\/work-record\.md`'s resolution rule/,
    'expected the needs:decision-Removes rationale clause',
  );

  // Discriminate: `parked` must land in Adds, not Removes (Removes carries no
  // `parked` clause at all — this row's pre-edit Removes was just `ready`
  // (flag back), `bot:blocked` (re-grant strip)). `needs:decision` itself
  // already legitimately appears in Adds pre-edit (a distinct, older clause
  // about grant-check refusal) — so the discriminator for the carried edit
  // is the Removes-specific rationale clause itself, which only this edit
  // could have introduced and which must not also appear in Adds.
  assert.doesNotMatch(removes, /`parked`/, '`parked` belongs in Adds, not Removes');
  assert.doesNotMatch(
    adds,
    /the `#N` batch-apply, gated on zero unresolved `needs-decision:\*` comments/,
    'the Removes-specific needs:decision rationale must not also appear in Adds',
  );
});
