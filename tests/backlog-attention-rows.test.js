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
const os = require('node:os');
const { execSync, spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const SKILL_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');
const SHARED_DIR = path.join(__dirname, '..', 'plugin', 'skills', '_shared');

function read(...segments) {
  return readText(path.join(...segments));
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
      '| #{n} | bot:blocked | {createdAt, relative} | run /claude-tweaks:backlog refine #{n} to re-authorize after the failure — or, for a plan-review question awaiting an answer (`<!-- plan-review-question -->` comment), answer it on the record body first |',
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

// --- #2328: bot:parked joins bot:blocked as a needs-attention type ---

test('attention-mode.md: bot:parked gets its own fetch, merge, and rendered row alongside bot:blocked', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');

  assert.ok(
    source.includes("const botParkedRecords = records.filter((r) => r.labels.some((l) => l.name === 'bot:parked'));"),
    'expected botParkedRecords to be filtered from the session-scoped snapshot alongside botBlockedRecords',
  );
  assert.ok(
    source.includes('const { needsRecords, botBlockedRecords, botParkedRecords } = require'),
    'expected the merge script to destructure botParkedRecords from the filtered snapshot',
  );
  assert.ok(
    source.includes(
      '| #{n} | bot:parked | {createdAt, relative} | run /claude-tweaks:backlog refine #{n} to review the parked PR — grants are intact; resume once its checks are green |',
    ),
    'expected the bot:parked row with its own (non-re-authorize) refine launcher',
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

  // record #2328 widened this string once more to also name bot:parked.
  assert.ok(
    source.includes(
      'Nothing needs attention — no open record carries a\nneeds:* marker, solution:unjustified, an ungranted shaped:headless spec, bot:blocked, or\nbot:parked.',
    ),
    'expected the widened empty-state string naming needs:*/solution:unjustified/shaped:headless/bot:blocked/bot:parked',
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

test('attention-mode.md: needs:decision/bot:blocked/bot:parked/needs:* catch-all batch into one backlog refine line', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  assert.ok(
    source.includes('/claude-tweaks:backlog refine #{a},#{b},…'),
    'expected the batchable-target closing line naming a comma list',
  );
  // record #2328 inserted `bot:parked` into this list, alongside bot:blocked.
  assert.match(source, /`needs:decision`, `bot:blocked`,\s*\n?\s*`bot:parked`, and any other `needs:\*` catch-all/);
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

// --- #4849: the stuck:open-pr row (a granted record stuck behind an open PR) ---

const ROW = '| #{n} | stuck:open-pr | {createdAt, relative} | {stuckRemedy} |';
const NOTE = 'Note: the stuck:open-pr check could not run (exit {failed.code}) — records stuck behind an open PR are not shown';
const EMPTY_SENTENCE = 'No granted record is stuck behind an open PR.';
const CLI_CALL = 'bin/stuck-open-prs.js" --records "$ST_BACKLOG_ATTENTION_SNAPSHOT_RAW" > "$ST_BACKLOG_ATTENTION_STUCK"';
const STEP4_CONDITION = "only when Step 1's file shows the stuck check did not run";

// One assertion function for every prose pin of the row; each has a go-red control below.
function assertStuckRow(source) {
  assert.ok(source.includes('bin/stuck-open-prs.js" --records "$ST_BACKLOG_ATTENTION_SNAPSHOT_RAW"'), 'Step 1 runs the CLI over the snapshot');
  assert.ok(source.includes(CLI_CALL), 'Step 1 redirects the CLI into the stuck file');
  const stuckNames = [...source.matchAll(/ST_BACKLOG_ATTENTION_STUCK="\$\(node [^)]*--value ([\w.-]+)\)"/g)].map((m) => m[1]);
  assert.ok(stuckNames.length >= 2 && new Set(stuckNames).size === 1, 'Steps 1 and 2 resolve the same stuck filename');
  assert.ok(source.includes(ROW), 'the rendered row');
  assert.match(source, /`stuck:open-pr` rows are never batched/, 'stuck rows are never batched');
  assert.match(source, /could not run[^.]*note/, 'a failed CLI is a note, never an empty section');
  assert.ok(source.includes('prints `{"failed":{"code":…,"message":…}}` where a run prints `{"rows":…}`'), 'Step 1 keeps the could-not-run state in the stuck file');
  assert.ok(source.includes('The check ran only when that file parses to an object with a `rows` array'), 'the check-ran test is stated once, on the file');
  const step4 = source.slice(source.indexOf('## Step 4: Render'));
  assert.ok(step4.includes(NOTE), 'Step 4 template has a slot for the could-not-run note');
  assert.ok(step4.replace(/\s+/g, ' ').includes(STEP4_CONDITION), 'the note renders only when Step 1\'s file shows the check did not run');
  assert.ok(step4.indexOf(NOTE) < step4.indexOf('## Backlog — Needs Attention'), 'the note renders above the table');
  assert.ok(source.includes(`bot:parked. ${EMPTY_SENTENCE}\``), 'the empty-state message names a clear stuck check');
  assert.ok(source.includes(`When the stuck check could not run, drop the sentence \`${EMPTY_SENTENCE}\``), 'the sentence renders only when the check ran');
  assert.ok(step4.includes('row\'s recommended action is its `stuckRemedy`'), 'Step 4 names the ranked file\'s field, stuckRemedy');
}

test('AC3.1: attention-mode.md renders the stuck:open-pr row', () => assertStuckRow(read(SKILL_DIR, 'attention-mode.md')));

test('AC3.1 controls: removing any stuck:open-pr pin goes red on that pin', () => {
  const source = read(SKILL_DIR, 'attention-mode.md');
  const controls = [
    [ROW, /the rendered row/],
    [' > "$ST_BACKLOG_ATTENTION_STUCK"\n```', /redirects the CLI into the stuck file/, '\n```'],
    [CLI_CALL, /runs the CLI over the snapshot/],
    [`bot:parked. ${EMPTY_SENTENCE}\``, /names a clear stuck check/, 'bot:parked.`'],
    ["only when Step 1's file shows", /renders only when Step 1's file shows the check did not run/, "whenever Step 1's file shows"],
    ['`stuck:open-pr` rows are never batched', /stuck rows are never batched/],
    ['the check could not run, so the render carries one note', /a failed CLI is a note/],
    ['prints `{"failed":{"code":…,"message":…}}`', /keeps the could-not-run state in the stuck file/],
    ['The check ran only when that file parses to an object with a `rows` array', /check-ran test/],
    [NOTE, /slot for the could-not-run note/],
    [`When the stuck check could not run, drop the sentence \`${EMPTY_SENTENCE}\``, /renders only when the check ran/],
    ['row\'s recommended action is its `stuckRemedy`', /names the ranked file/],
  ];
  for (const [from, message, to = ''] of controls) {
    assert.ok(source.includes(from), `control target exists: ${from.slice(0, 40)}`);
    assert.throws(() => assertStuckRow(source.replace(from, to)), message, from.slice(0, 40));
  }
  // The two sides of the stuck filename must agree: changing one goes red.
  assert.throws(() => assertStuckRow(source.replace('--value backlog-attention-stuck.json', '--value backlog-attention-stuck-x.json')), /same stuck filename/);
  // The note slot must sit above the table, not just exist somewhere in Step 4.
  const moved = source.replace(`${NOTE}\n\n`, '').replace('## Backlog — Needs Attention\n\n| Record', `## Backlog — Needs Attention\n\n${NOTE}\n\n| Record`);
  assert.throws(() => assertStuckRow(moved), /above the table/);
});

// --- the merge that makes the row render, run the way a reader runs it (extract-and-run) ---

const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin').split(path.sep).join('/');
const SKIP_NO_BASH = spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0 ? false : 'bash not available';

function fences(source) {
  return [...source.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}
function stuckSnippets() {
  const all = fences(read(SKILL_DIR, 'attention-mode.md'));
  const merge = all.find((f) => f.includes('isTrustedComment') && f.includes('backlog-attention-stuck.json'));
  const rank = all.find((f) => f.includes('BAND_ORDER'));
  assert.ok(merge && rank, 'extraction is out of sync with attention-mode.md — update this test');
  return { merge, rank };
}

const labelsOf = (...names) => names.map((name) => ({ name }));
const STUCK_ROW = {
  number: 7, pr: 70, remedy: 'R7: run /claude-tweaks:dispatch resume #7', title: 'Stuck seven', createdAt: '2026-10-10T00:00:00Z', labels: labelsOf('auto:build', 'priority:high'),
};
// Two same-band records, the older filed first by the age key alone; #7 is high-band but the youngest, so the
// band key alone must put it first; #8 has no band and is older than #7, so a ranker that ignores the band fails.
const MEDIUM_OLD = {
  number: 9, pr: 90, remedy: 'R9', title: 'Medium old', createdAt: '2026-10-03T00:00:00Z', labels: labelsOf('auto:build', 'priority:medium'),
};
const MEDIUM_NEW = {
  number: 10, pr: 100, remedy: 'R10', title: 'Medium new', createdAt: '2026-10-05T00:00:00Z', labels: labelsOf('auto:build', 'priority:medium'),
};
const OVERLAP_ROW = {
  number: 8, pr: 80, remedy: 'R8', title: 'Overlap eight', createdAt: '2026-10-02T00:00:00Z', labels: labelsOf('auto:build', 'needs:definition'),
};

// Seeds a session dir like refine-mode's fold-in test, runs the merge and rank fences over it, and
// returns the ranked records. The stuck file content is the variable.
function runMergeAndRank({ merge, rank }, stuckFileText) {
  const sessionId = `attention-stuck-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dir = path.join(os.tmpdir(), `ct-session-${sessionId}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const needs = { ...OVERLAP_ROW, state: 'OPEN' };
  fs.writeFileSync(path.join(dir, 'backlog-attention-snapshot-filtered.json'), JSON.stringify({ needsRecords: [needs], botBlockedRecords: [], botParkedRecords: [] }));
  fs.writeFileSync(path.join(dir, 'backlog-attention-solution-unjustified.json'), '[]');
  fs.writeFileSync(path.join(dir, 'backlog-attention-shaped-headless.json'), '[]');
  fs.writeFileSync(path.join(dir, 'backlog-attention-stuck.json'), stuckFileText);
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_CODE_SESSION_ID: sessionId };
  try {
    execSync(merge, { encoding: 'utf8', shell: 'bash', stdio: ['ignore', 'pipe', 'pipe'], env });
    execSync(rank, { encoding: 'utf8', shell: 'bash', stdio: ['ignore', 'pipe', 'pipe'], env });
    return JSON.parse(fs.readFileSync(path.join(dir, 'backlog-attention-ranked.json'), 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The merge + rank behavior in one assertion function: rows join the records, carry stuckRemedy, and a
// file that is not a check that ran contributes nothing and breaks nothing.
function assertStuckMerge(snippets) {
  const ranked = runMergeAndRank(snippets, JSON.stringify({ rows: [MEDIUM_NEW, OVERLAP_ROW, STUCK_ROW, MEDIUM_OLD] }));
  const seven = ranked.find((r) => r.number === 7);
  assert.ok(seven, 'a stuck-only record gets its own row');
  assert.deepStrictEqual(seven.types, ['stuck:open-pr']);
  assert.strictEqual(seven.stuckRemedy, STUCK_ROW.remedy, 'the merged row carries stuckRemedy');
  assert.strictEqual(seven.title, 'Stuck seven');
  assert.strictEqual(seven.createdAt, STUCK_ROW.createdAt);
  assert.strictEqual(seven.priority, 'high', 'Step 3 ranks it by the copied labels');
  const eight = ranked.find((r) => r.number === 8);
  assert.deepStrictEqual(eight.types, ['needs:definition', 'stuck:open-pr'], 'a record in two sets is one row with both types');
  assert.strictEqual(eight.stuckRemedy, 'R8');
  assert.strictEqual(ranked.filter((r) => r.number === 8).length, 1);
  assert.deepStrictEqual(ranked.map((r) => r.number), [7, 9, 10, 8], 'band first (high, medium, none), then oldest first within a band');

  for (const text of ['{"failed":{"code":4,"message":"x"}}', '{}', '', 'not json', 'null', '{"rows":"x"}']) {
    const after = runMergeAndRank(snippets, text);
    assert.deepStrictEqual(after.map((r) => r.number), [8], `a check that did not run (${JSON.stringify(text)}) adds no row`);
    assert.deepStrictEqual(after[0].types, ['needs:definition']);
    assert.strictEqual(after[0].stuckRemedy, undefined);
  }
}

test('AC3.1: Step 2 and Step 3 turn the CLI\'s rows into ranked stuck:open-pr rows, and a failed check into none', { skip: SKIP_NO_BASH }, () => {
  assertStuckMerge(stuckSnippets());
});

test('AC3.1 controls: the merge assertion goes red when the loop, stuckRemedy, the rows guard, the band key or the age key is removed', { skip: SKIP_NO_BASH }, () => {
  const snippets = stuckSnippets();
  const mutations = [
    ['merge', 'for (const r of stuckRows)', 'for (const r of [])'],
    ['merge', 'stuckRemedy: r.remedy', 'stuckRemedy: undefined'],
    ['merge', 'existing.stuckRemedy = r.remedy', 'existing.stuckRemedy = undefined'],
    ['merge', 'if (Array.isArray(stuck.rows)) stuckRows = stuck.rows;', 'stuckRows = stuck.rows;'],
    // rank ignores the priority band: only the age key orders, so the older no-band record beats the younger high one
    ['rank', 'if (bandA !== bandB) return bandA - bandB;', ''],
    // age key inverted: the band key still orders, but the same-band pair comes out youngest first
    ['rank', 'return new Date(a.createdAt) - new Date(b.createdAt);', 'return new Date(b.createdAt) - new Date(a.createdAt);'],
  ];
  for (const [which, from, to] of mutations) {
    assert.ok(snippets[which].includes(from), `control target exists: ${from}`);
    assert.throws(() => assertStuckMerge({ ...snippets, [which]: snippets[which].replace(from, to) }), undefined, from);
  }
});
