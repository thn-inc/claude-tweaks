'use strict';
// Pins #5370's pipeline verify rule in the prose that states it: every pipeline site runs the scoped
// invocation, pushes first so the PR's CI can answer, and handles exit 3 ("no verdict yet") by one re-run
// or `--local`. Reads live skill prose deliberately (the prose is the contract), and gives each fact list
// a go-red proof so a reworded paragraph fails here rather than passing on a coincidental match.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const VERIFICATION = 'plugin/skills/test/verification.md';
const BUILD = 'plugin/skills/build/SKILL.md';

// A paragraph found by its opening label; '' when absent, so the facts go missing rather than throw.
const para = (text, label) => lineStartingWith(text, label);
// Asserts every fact matches, then proves each one can go red on its own.
function pinned(text, facts) {
  const missing = missingFactsOf(facts);
  assert.deepEqual(missing(text), []);
  assertEachPatternGoesRed(text, facts, missing);
}

// The Re-verify scoping table: every pipeline site's Mode cell starts `scoped`.
const NOT_PIPELINE = ['Standalone `/claude-tweaks:test`', '`/claude-tweaks:review` Step 1.5 standalone auto-trigger', '`/claude-tweaks:test affected`'];
function scopingProblems(text) {
  const at = text.indexOf('### Re-verify scoping');
  const end = text.indexOf('**Scoped invocation.**', at);
  assert.ok(at !== -1 && end > at, 'the Re-verify scoping table and the Scoped invocation paragraph after it must exist');
  const rows = text.slice(at, end).split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Site |'));
  const cells = rows.map((l) => l.split(' | ').map((c) => c.replace(/^\| |\s*\|$/g, '')));
  const problems = [];
  const pipeline = cells.filter(([site]) => !NOT_PIPELINE.includes(site));
  if (pipeline.length !== 6) problems.push(`expected 6 pipeline rows, found ${pipeline.length}`);
  for (const [site, mode] of pipeline) if (!mode.startsWith('scoped')) problems.push(`${site}: ${mode}`);
  const standalone = cells.find(([site]) => site === NOT_PIPELINE[0]);
  if (!standalone || !standalone[1].includes('full without `localRuns`; scoped under it')) problems.push('Standalone row must read full without `localRuns`; scoped under it');
  return problems;
}

const PUSH_FACTS = [
  [/\*\*Push first, and exit 3 \(#5370\)\.\*\*/, 'labeled'],
  [/a `pr-first` worktree run pushes its branch immediately before each scoped invocation/, 'push before each scoped invocation'],
  [/`git -C "\{worktree-path\}" push origin \{branch\}`/, 'the push command'],
  [/the orchestrating session takes the Foreground rule's exception above/, 'the orchestrator\'s CI wait follows the Foreground exception'],
  [/a dispatched subagent, which cannot hold a Bash call past 600 s, runs the call with a 600 s timeout/, 'a subagent\'s 600 s call'],
  [/ended on the timeout with no check started \(no check rows, no `waiting for a test-suite slot` line\), runs the same command once more/, 'one repeat, and its signal'],
  [/the Foreground rule's one allowed repeat/, 'named as the one allowed repeat'],
  [/A call moved to the background instead of ended ends the unit `BLOCKED`/, 'a backgrounded call is BLOCKED'],
  [/when that call consults CI \(a scoped call without `--local`, under a declaration with a `ci` block\)/, 'the repeat applies only to a call that consults CI'],
  [/and so does a `--local` call that ends on its timeout or a repeat that also does/, 'a --local call or a second timeout ends BLOCKED'],
  [/when a run dir is set \(the Standalone path has none\), log one entry/, 'the AUTO entry needs a run dir'],
  [/A call that times out is never exit 3 and never triggers `--local`/, 'a timeout is not exit 3'],
  [/exits 3, which is never a test failure/, 'exit 3 is not a failure'],
  [/In a `pr-first` worktree run with a run dir set,/, 'push only in a pr-first worktree run'],
  [/on `head-not-pushed` push and re-run once/, 'head-not-pushed: push, re-run once'],
  [/every other scoped call takes the Standalone rule's no-push path below/, 'every other call never pushes'],
  [/on `no-open-pr-at-head` open or record the PR/, 'no-open-pr-at-head: open or record the PR'],
  [/On a second exit 3, or any other reason, re-run with `--local`/, 'second exit 3 or another reason: --local'],
  [/`AUTO \{time\} — Verification: no CI verdict for suite "\{suite\}" \(\{reason\}\); re-ran with --local on this machine\. Reversibility: high\.`/, 'the one AUTO entry naming the reason'],
  [/adds no stop in `auto` mode/, 'no auto-mode stop'],
  [/passes `--local` on its first call/, 'a run with no PR passes --local first'],
  [/`local-merge`, `current-branch`/, 'the no-PR integration models'],
  [/a parallel-wave member, which never pushes/, 'parallel-wave members'],
  [/a standalone run on a branch with no open PR/, 'standalone without an open PR'],
  [/a run on the integration branch itself/, 'a run on the integration branch'],
  [/a pre-push run/, 'pre-push runs'],
];

const STANDALONE_FACTS = [
  [/\*\*Standalone is always full — without `localRuns`\.\*\*/, 'labeled, keeping the old literal'],
  [/a standalone invocation runs the scoped invocation instead/, 'standalone is scoped under the key'],
  [/without the baseline flags \(Baseline adjudication below\)/, 'the standalone scoped run carries no baseline flags'],
  [/wherever this file says to run the full procedure for a project with that declaration/, 'the full-procedure override'],
  [/Standalone never pushes: with no open PR at the branch/, 'standalone never pushes'],
  [/`gh pr view --json state --jq \.state` prints no `OPEN`, exits non-zero, or `gh` is absent/, 'the PR probe'],
  [/its first call passes `--local`; with one, on exit 3 it re-runs once with `--local`/, 'no PR: --local first; a PR: one --local re-run'],
  [/`push the branch and re-run to take the suite from CI`/, 'the push hint'],
  [/It never stops without a verdict/, 'always a verdict'],
  [/`\/claude-tweaks:test full` \(`verify\.js --local`, no `--scope`\)/, 'the whole suite by name'],
];

const BUILD_FACTS = [
  [/\*\*Scoped, push first \(#5370\):\*\* with a declaration this run is `verification\.md`'s scoped invocation/, 'scoped with a declaration'],
  [/pushes immediately before it, after the catch-up below/, 'the push follows the catch-up'],
  [/handles exit 3 per that file's Push first paragraph/, 'the exit 3 pointer'],
];

test('AC1.1: every pipeline row of the scoping table is scoped, Build Common Step 5 included (#5370)', () => {
  assert.deepEqual(scopingProblems(read(VERIFICATION)), []);
});

test('AC1.2: reverting the Build row to full makes the scoping assertion name it', () => {
  const v = read(VERIFICATION);
  const mutated = v.replace('| scoped (the impact subset via', '| full (impact-selected via');
  assert.notEqual(mutated, v);
  assert.ok(scopingProblems(mutated).some((p) => p.startsWith('Build Common Step 5')));

  const polish = v.replace(/(\| Polish re-verify[^\n]*\| )scoped( \|)/, '$1full$2');
  assert.notEqual(polish, v);
  assert.ok(scopingProblems(polish).some((p) => p.startsWith('Polish re-verify')));

  const standalone = v.replace('full without `localRuns`; scoped under it', 'full');
  assert.notEqual(standalone, v);
  assert.ok(scopingProblems(standalone).some((p) => p.startsWith('Standalone row must read')));
});

test('AC1.1, AC3.2: the Push first paragraph states the push, exit 3 handling and the --local fallback (#5370)', () => {
  pinned(para(read(VERIFICATION), '**Push first, and exit 3 (#5370).**'), PUSH_FACTS);
});

test('the Standalone rule keeps "always full" for a project without the key and scopes it under the key (#5370)', () => {
  pinned(para(read(VERIFICATION), '**Standalone is always full — without `localRuns`.**'), STANDALONE_FACTS);
});

test('AC2.1: Common Step 5 is scoped and pushes first, after the catch-up (#5133, #5370)', () => {
  const b = read(BUILD);
  const start = b.indexOf('### Common Step 5:');
  const step5 = b.slice(start, b.indexOf('\n### ', start + 1));
  assert.ok(!step5.includes('needs HEAD pushed first'));
  pinned(step5, BUILD_FACTS);
});

test('the Foreground rule names the one allowed repeat, and the baseline lead-in sends pipeline sites to the scoped form (#5370)', () => {
  const v = read(VERIFICATION);
  pinned(para(v, '**Foreground rule.**'), [[/A dispatched subagent's single repeat of a CI wait that ended on its timeout \(the Push first paragraph below\) is not a second attempt: the first call has ended/, 'the one allowed repeat']]);
  const lead = v.split('\n').find((l) => l.includes('Every pipeline site — any invocation with'));
  assert.ok(lead, 'the baseline lead-in paragraph must exist');
  assert.ok(!lead.includes('full re-run inside a flow'));
  pinned(lead, [
    [/never `\/claude-tweaks:test full`, which passes no baseline flags/, 'full never baselines'],
    [/which no pipeline site runs \(pipeline sites append the same flags to the scoped invocation\)/, 'pipeline sites use the scoped form'],
  ]);
});

test("this repo's unscoped whole set carries --local (#5370)", () => {
  const v = read(VERIFICATION);
  const whole = v.split('\n').find((l) => l.includes('the whole set is `npm test -- --full`'));
  assert.ok(whole, 'the whole-set sentence must exist');
  assert.ok(whole.includes('run with `--local`'));
  const snippets = v.split('\n').filter((l) => /^ {4}node ".*bin\/verify\.js".*--baseline /.test(l));
  assert.equal(snippets.length, 1);
  assert.ok(snippets[0].includes(' --local --baseline origin/main'));
});

test('AC1.1: the pre-push sites and the whole-suite re-run pass --local (#5370)', () => {
  pinned(lineStartingWith(read('plugin/skills/_shared/express-lane.md'), '4. **Impacted tests.**'), [
    [/--scope \.claude-tweaks\/verify-scope\.json --local --integration-branch \{ref\}`/, 'the lane passes --local'],
    [/`--local` because the branch is not pushed until step 6/, 'why: pre-push'],
  ]);
  pinned(read('plugin/skills/build/dispatch.md').split('\n').find((l) => l.includes('**Affected-set testing (#5117).**')), [
    [/--scope \.claude-tweaks\/verify-scope\.json --local --integration-branch \{integration-branch\} --no-stamp`/, 'the affected set passes --local'],
    [/`--local` because these runs are pre-push/, 'why: pre-push'],
  ]);
  const flake = read('plugin/skills/test/flake-handling.md');
  pinned(lineStartingWith(flake, 'When a `tests`-family failure is not resolved by the runner'), [
    [/a red the runner took from CI \(`report\.json`'s top-level `ci` entry for that suite reads `used: true`\) skips both paths/, 'a CI red skips both re-run paths'],
    [/it stands as a \*\*regression\*\*, since an isolation pass on this machine would judge CI's verdict on another platform/, 'it stands as a regression'],
    [/That binds the agent's re-run only; the runner's own allowlisted flaky retry still re-runs locally and is unchanged/, 'the runner retry is unchanged'],
  ]);
  pinned(sectionOf(flake, '## Whole-suite re-run'), [
    [/the one local run the declaration allows is the `--local` fallback/, 'the --local fallback is the one local run'],
    [/a red from such a run is not a CI red, so the CI-red rule above does not apply to it/, 'a --local red is outside the CI-red rule'],
    [/A red from a `--local` run re-runs with `--local` added, inside that same fallback/, 'a local red re-runs with --local'],
    [/a scoped re-run would ask CI again and an unscoped one exits 2/, 'why --local'],
  ]);
});

test('AC4.1, AC4.3: /claude-tweaks:test full runs the whole suite here, no argument does not, and the hint and card name full (#5370)', () => {
  const s = read('plugin/skills/test/SKILL.md');
  // The text from a `### ` heading to the next `\n### ` (asserts the heading exists).
  const sub = (text, heading) => {
    const at = text.indexOf(`\n${heading}\n`);
    assert.notEqual(at, -1, `heading not found: ${heading}`);
    const next = text.indexOf('\n### ', at + 1);
    return next === -1 ? text.slice(at) : text.slice(at, next);
  };
  assert.ok(lineStartingWith(s, 'argument-hint:').includes('|all|full|skip-qa|'));
  assert.ok(lineStartingWith(read('plugin/skills/help/reference-card.md'), '| `/claude-tweaks:test` |').includes('all\\|full\\|skip-qa'));
  pinned(lineStartingWith(s, '| `full` |'), [
    [/every suite's full command on this machine \(`verify\.js --local`, no `--scope`\)/, 'full runs every full command here'],
    [/never skipped by Skip-if-recent/, 'never skipped'],
  ]);
  const WHOLE_FACTS = [
    [/Run `verification\.md` Step 2's run command with `--local` added and no `--scope`/, 'the command'],
    [/never passes `--no-stamp`/, 'it stamps'],
    [/Skip-if-recent does not apply/, 'never skipped'],
    [/a stamp CI wrote, or one from an impact subset, never stands in for a run here/, 'why'],
    [/It passes no baseline flags, with or without `\$PIPELINE_RUN_DIR`/, 'no baseline at the release tip'],
  ];
  pinned(sub(s, '### Whole suite here (`full`)'), WHOLE_FACTS);
  const bullet = lineStartingWith(s, '- `full` argument →');
  pinned(bullet, [[/none of the skips below apply/, 'full ignores the pipeline skips']]);
  const pipeline = s.slice(s.indexOf('**Pipeline behavior:**'));
  assert.ok(pipeline.indexOf(bullet) !== -1 && pipeline.indexOf(bullet) < pipeline.indexOf('- `VERIFICATION_PASSED=true` + no stories'), 'the full bullet leads the Pipeline behavior list');
  pinned(sectionOf(read(VERIFICATION), '### Skip-if-recent (for /flow pipelines)'), [
    [/`\/claude-tweaks:test full` never takes this skip, by signal or by stamp/, 'Skip-if-recent excludes full'],
  ]);
  pinned(sub(s, '### Standard suite (no arguments)'), [
    [/Under the declaration's `localRuns: "on-request"`, that procedure runs the scoped invocation, standalone too/, 'no argument is scoped under the key'],
    [/A `--local` fallback whose impact selection cannot narrow still runs what selection chose/, 'the named exception'],
  ]);
});
