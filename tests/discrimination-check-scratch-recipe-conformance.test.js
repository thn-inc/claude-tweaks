'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #4556: a reviewer proving a test discriminates (build's SDD task reviewers,
// review's lens 3f Vacuity-evidence diagnostic) needs a place to mutate that is
// not the shared worktree. subagent-dispatch-core.md carries the one guard-safe
// scratch-checkout recipe; scratch-worktree.md section 7 records the shapes it
// uses as live-verified. This suite pins both.

const ROOT = path.join(__dirname, '..');
const CORE = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'subagent-dispatch-core.md'));
const SCRATCH = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'scratch-worktree.md'));

const LENS = readText(path.join(ROOT, 'plugin', 'skills', 'review', 'step3-lens-dispatch.md'));

const HEADING = '## Discrimination checks in a scratch checkout';

// Slices md from `heading` to the next `## ` heading (or the end).
function sectionOf(md, heading) {
  const start = md.indexOf(heading);
  assert.notStrictEqual(start, -1, `${heading} missing`);
  const next = md.indexOf('\n## ', start + heading.length);
  return next === -1 ? md.slice(start) : md.slice(start, next);
}

const RECIPE_LITERALS = [
  'session-tmp-resolve.js',
  'worktree add --detach',
  'checkout {base-sha} -- {path}',
  'NODE_PATH="{worktree}/node_modules"',
  'never a link',
  'worktree remove --force',
  'before the status word',
  'worktree list',
  'No-git fallback',
  '#4556',
  'rev-parse HEAD',
  '{reviewed-sha}',
  'no evidence',
  'CommonJS',
  'show {base-sha}:{path}',
  'repo-relative path',
  'DONE_WITH_CONCERNS',
  'substitutes',
  'its own',
  'never under the run directory',
  'shows no entry for `{disc-path}`',
  'rm -r "{disc-path}"',
  'a control that stays green',
  'run it per step 4',
  'task, reviewer role and round',
  'never fall back to the shared tree',
  'no evidence, tear down',
  'otherwise tear down (step 6): the check has no evidence',
  'must print `{reviewed-sha}`',
  'Tear down before the status word',
  "READ-ONLY REVIEW line's Vacuity-evidence exception",
  'never Write/Edit',
  'already exists, report `BLOCKED`',
  'never write into or delete a path you did not create',
  'once the unmutated checkout passes a step 4 run',
  'a link leaves a path into the shared tree',
  'or the dispatcher says to take it outright',
  'a failed delete reports `DONE_WITH_CONCERNS`',
  'A failed teardown reports `DONE_WITH_CONCERNS`',
  'Never mutate the shared worktree in place',
  'Mutate only there',
  'only after a control has gone red in this same checkout',
  'making the mutated file throw at load',
  'has no evidence: tear down and report that',
];

// Outcome clauses: each must appear exactly once, so a reworded copy elsewhere cannot mask a mutated one.
const ONCE_LITERALS = [
  'never fall back to the shared tree',
  'no evidence, tear down',
  'otherwise tear down (step 6): the check has no evidence',
  'must print `{reviewed-sha}`',
  'Tear down before the status word',
  'A failed teardown reports `DONE_WITH_CONCERNS`',
  'only after a control has gone red in this same checkout',
  'has no evidence: tear down and report that',
];

// An affirmative link command (`ln -s "…"`, `ln -sfn {…}`, `mklink /J "…"`), as opposed to
// the prose ban, which names each form in backticks.
const LINK_COMMAND = /(?:^|[\s(])(?:ln -s\w*|mklink \/[JD])\s+["'{/]/;

function assertRecipe(section) {
  const flat = section.replace(/\s+/g, ' ');
  for (const literal of RECIPE_LITERALS) {
    assert.ok(flat.includes(literal), `recipe lost ${JSON.stringify(literal)}`);
  }
  for (const literal of ONCE_LITERALS) {
    assert.strictEqual(flat.split(literal).length - 1, 1, `${JSON.stringify(literal)} must appear exactly once`);
  }
  assert.ok(!LINK_COMMAND.test(flat), 'recipe must not carry an affirmative link command');
}

test('core carries the scratch-checkout recipe section after Read-only Reviewer Discipline (#4556)', () => {
  assert.strictEqual(CORE.split(HEADING).length - 1, 1, `${HEADING} must appear exactly once`);
  const at = CORE.indexOf(HEADING);
  const after = CORE.indexOf('## Read-only Reviewer Discipline');
  const before = CORE.indexOf('## Model Selection');
  assert.ok(after !== -1 && before !== -1, 'neighbouring headings missing');
  assert.ok(at > after, 'recipe must follow Read-only Reviewer Discipline');
  assert.ok(at < before, 'recipe must precede Model Selection');
  assertRecipe(sectionOf(CORE, HEADING));
});

// Frozen: the Read-only Reviewer Discipline section as it stood before #4556
// (the text the recipe is inserted after). It must fail the recipe pin.
const PRE_4556_CORE_TAIL = `## Read-only Reviewer Discipline

Applies only to dispatches whose job is to read and report: \`/claude-tweaks:review\` Step 3's
lens, debate, refutation, and gap-sweep agents. It never applies to an implementer, test, or QA
dispatch, whose job is to run things. Inline this line verbatim into every such prompt, outside
any byte-pinned Calibration/Output block:

\`READ-ONLY REVIEW: never run the project's test suites, builds, dev servers, or e2e runners — read and report only, since mechanical verification belongs to /claude-tweaks:test (a throwaway probe under your SCRATCH: path is fine; sole suite exception: one targeted test case, run in the foreground, when lens 3f's Vacuity-evidence diagnostic needs execution evidence).\`

Reading a test file is always fine; running the suite is not. A reviewer that starts the
project's suite or server races any server the same review started (\`/visual-review\`'s
ephemeral dev server), and it reports failures produced by the wrong harness rather than by the
diff. #3001 observed exactly this: a Fast-profile lens agent ran a full Playwright e2e suite in
the background on the framework's default ports.
`;

test('the recipe pin goes red without the section or with a dropped step (go-red)', () => {
  assert.throws(() => assertRecipe(PRE_4556_CORE_TAIL));
  const live = sectionOf(CORE, HEADING);
  assert.ok(live.includes('worktree remove --force'), 'live section must carry the teardown to mutate');
  assert.throws(() => assertRecipe(live.split('worktree remove --force').join('worktree remove')));
  // The run-provenance control (I3) and the fallback's run command (fm2) are each load-bearing.
  assert.throws(() => assertRecipe(live.split('a control that stays green').join('a run that stays green')));
  assert.throws(() => assertRecipe(live.split('run it per step 4').join('run the test there')));
  // Outcome clauses (steps 2, 4, 5): reword each to a permissive outcome, on the whitespace-flattened text
  // because step 2's clause wraps across lines.
  const flatLive = live.replace(/\s+/g, ' ');
  for (const [from, to] of [
    ['never fall back to the shared tree', 'fall back to the shared tree'],
    ['no evidence, tear down', 'proceed'],
    ['otherwise tear down (step 6): the check has no evidence', 'otherwise proceed anyway'],
    ['must print `{reviewed-sha}`', 'must print a SHA'],
    ['Tear down before the status word', 'Tear down when convenient'],
    ['A failed teardown reports `DONE_WITH_CONCERNS`', 'A failed teardown is ignored'],
    ['already exists, report `BLOCKED`', 'already exists, reuse it'],
    ['once the unmutated checkout passes a step 4 run', 'once the checkout exists'],
    ['Never mutate the shared worktree in place', 'Prefer not to mutate the shared worktree in place'],
    ['Mutate only there', 'Mutate anywhere'],
    ['only after a control has gone red in this same checkout', 'without any control'],
    ['making the mutated file throw at load', 'making the mutated file load'],
    ['has no evidence: tear down and report that', 'has evidence anyway'],
  ]) {
    assert.ok(flatLive.includes(from), `live section must carry ${JSON.stringify(from)} to mutate`);
    assert.throws(() => assertRecipe(flatLive.split(from).join(to)), undefined, `${from} -> ${to} must go red`);
  }
  // Any affirmative link command added to the section, quoted or not, goes red.
  for (const added of [
    'Also run: ln -s "{worktree}/node_modules" "{disc-path}/node_modules".',
    'Also run: ln -sfn {worktree}/node_modules {disc-path}/node_modules.',
    'On Windows: mklink /J "{disc-path}\\node_modules" "{worktree}\\node_modules".',
  ]) {
    assert.throws(() => assertRecipe(`${live}\n${added}\n`), undefined, `${added} must go red`);
  }
});

// Section 7 slicing, copied from scratch-worktree-shell-constraint-table.test.js.
function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

function section7Rows() {
  const start = SCRATCH.indexOf('## 7. Shell constraint');
  assert.notStrictEqual(start, -1, '## 7. Shell constraint heading missing');
  const lines = SCRATCH.slice(start).split('\n');
  const head = lines.findIndex((l) => l.trim().startsWith('| Shape'));
  assert.notStrictEqual(head, -1, 'no table header in section 7');
  const rows = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(splitRow(lines[i]));
  return rows;
}

function assertScratchRows(rows) {
  const passes = rows.filter((c) => c[0].includes('worktree add --detach') && c[2] === 'passes');
  assert.strictEqual(passes.length, 1, `expected one passes row for the scratch checkout, found ${passes.length}`);
  assert.strictEqual(passes[0][3], '—');
  assert.ok(passes[0][5].startsWith('2026-10-31 (#4556)'), `bad last-verified: ${passes[0][5]}`);

  const listing = rows.filter((c) => c[1].includes('ls "{wt}/node_modules"'));
  assert.strictEqual(listing.length, 1, `expected one node_modules listing row, found ${listing.length}`);
  assert.strictEqual(listing[0][2], 'permission-rule');
  assert.ok(listing[0][3].includes('has been denied'), `bad refusal wording: ${listing[0][3]}`);
  assert.ok(listing[0][4].includes('NODE_PATH'), `workaround must name NODE_PATH: ${listing[0][4]}`);
}

test('§7 records the scratch-checkout shapes as passes and the node_modules listing as permission-rule (#4556)', () => {
  assertScratchRows(section7Rows());
});

// Frozen: the last two section 7 rows as they stood before #4556 (git show
// 79382337e:plugin/skills/_shared/scratch-worktree.md). The row pin must reject them.
const PRE_4556_ROWS = [
  '| `test a = b` (`[ a = b ]` and `test -f package.json` pass) | `test a = b` | refused | "is too complex to verify that it stays inside the worktree" | Use `[ a = b ]` | 2026-10-20 (#3340); first #3340 |',
  '| Backslash-escaped space in a path argument (the same path double-quoted passes) | `ls /Users/me/Code\\ Workspaces/repo/README.md` | refused | "is too complex to verify that it stays inside the worktree" | Double-quote the path: `ls "/Users/me/Code Workspaces/repo/README.md"` | 2026-10-21 (#3783); first #3712 |',
].map(splitRow);

test('the §7 row pin goes red on the pre-#4556 table tail and on a flipped verdict (go-red)', () => {
  assert.strictEqual(PRE_4556_ROWS.every((c) => c.length === 6), true, 'frozen rows must parse to 6 cells');
  assert.throws(() => assertScratchRows(PRE_4556_ROWS));
  const live = section7Rows();
  const flipped = live.map((c) => (c[1].includes('ls "{wt}/node_modules"') ? c.map((x, i) => (i === 2 ? 'refused' : x)) : c));
  assert.notDeepStrictEqual(flipped, live, 'the mutation must change a row');
  assert.throws(() => assertScratchRows(flipped));
});

function assertLens(line) {
  assert.ok(line.includes('**Discrimination checks in a scratch checkout**'), 'lens sentence must cite the core recipe by heading');
  assert.ok(line.includes('never mutate the shared tree as a substitute'), 'lens sentence must keep the no-substitute ban');
  assert.ok(!line.includes('a temporary `git worktree`'), 'lens sentence must drop the bare temporary worktree');
}

test('lens 3f\'s Vacuity-evidence sentence cites the core recipe and drops the bare temporary worktree (#4556)', () => {
  const line = LENS.split('\n').find((l) => l.startsWith('- **Vacuity-evidence diagnostic'));
  assert.ok(line, 'lens 3f must carry a Vacuity-evidence diagnostic bullet');
  assertLens(line);
});

// Frozen: the lens 3f mutation sentence as it stood before #4556.
const PRE_4556_LENS =
  'Make any such mutation in a throwaway copy — under the agent\'s `SCRATCH:` directory or a temporary `git worktree` — never in the shared tree other lens agents are reading — and remove it before the status word (delete the `SCRATCH:` directory; `git worktree remove` a temporary worktree, not merely its directory). When neither can be created, the finding has no evidence: never mutate the shared tree as a substitute.';

test('the lens pin goes red on the pre-#4556 sentence (go-red)', () => {
  assert.throws(() => assertLens(PRE_4556_LENS));
});

// The dispatcher-side paste instruction lives in the lens procedure blockquote (where the
// file's other inline-verbatim instructions sit), not in the bullet the lens agent reads.
function assertLensDispatcher(md) {
  const line = md.split('\n').find((l) => l.startsWith('> **Lens 3f scratch checkout.**'));
  assert.ok(line, 'lens procedure must carry a "Lens 3f scratch checkout" dispatcher paragraph');
  for (const literal of [
    '**Discrimination checks in a scratch checkout**',
    "lens 3f's prompt",
    '`{plugin-root}`',
    '`{worktree}`',
    '`{base-sha}`',
    '`{reviewed-sha}`',
    '`{id}`',
    '_shared/scope-resolution.md',
    'No-git fallback',
    '`git merge-base {base} HEAD`',
    'HEAD when the scope is uncommitted work',
    'tell 3f to skip steps 2–3 and take the No-git fallback outright',
  ]) {
    assert.ok(line.includes(literal), `dispatcher paragraph lost ${JSON.stringify(literal)}`);
  }
}

test('the lens procedure tells the dispatcher how to fill the recipe and what uncommitted scope does (#4556)', () => {
  assertLensDispatcher(LENS);
});

test('the dispatcher-paragraph pin goes red without the paragraph or without the uncommitted-scope clause (go-red)', () => {
  const live = LENS.split('\n').filter((l) => !l.startsWith('> **Lens 3f scratch checkout.**')).join('\n');
  assert.notStrictEqual(live, LENS, 'the mutation must remove the paragraph');
  assert.throws(() => assertLensDispatcher(live));
  assert.throws(() => assertLensDispatcher(LENS.split('_shared/scope-resolution.md').join('the scope rules')));
  for (const [from, to] of [
    ['`git merge-base {base} HEAD`', "this review's `{base}`"],
    ['HEAD when the scope is uncommitted work', 'the same'],
    ['tell 3f to skip steps 2–3 and take the No-git fallback outright', 'put the No-git fallback instruction into 3f\'s prompt yourself'],
  ]) {
    assert.ok(LENS.includes(from), `live lens file must carry ${JSON.stringify(from)} to mutate`);
    assert.throws(() => assertLensDispatcher(LENS.split(from).join(to)), undefined, `${from} -> ${to} must go red`);
  }
});
