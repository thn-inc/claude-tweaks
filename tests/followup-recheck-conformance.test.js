'use strict';
// Pins the follow-up re-check wiring prose (#6284): the wrap-up sub-file (own set, judge dispatch, multi-spec
// approve branch), its citation from both consoles (before proposal bundling in the single-spec one, under the
// multi-spec file's Read rail), the approve branch at each console's Q# create step, and the post-merge
// `execute` calls (pr-first Step 4.0c, local-merge step 7). Every claim is proved on a copy with only its own
// pinned text stripped, and every `recheck-followups.js` call the prose carries uses only flags its verb accepts.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'skill-audit', 'budgets'));

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (p) => readText(path.join(SKILLS, p));

const RECHECK = read('wrap-up/followup-recheck.md');
const CONSOLE = read('wrap-up/review-console.md');
const EXECUTION = read('_shared/console-execution.md');
const POST_MERGE = read('_shared/pr-first-merge-post-merge.md');
const LOCAL_FINISH = read('_shared/local-merge-auto-finish.md');
const MULTISPEC = read('flow/multispec-review-console.md');
const MERGE_MODE = read('wrap-up/merge-mode.md');
const CLOSE_OUT = read('dispatch/close-out.md');
const WORKTREE_MERGE = read('flow/worktree-merge.md');
const USAGE_SRC = readText(path.join(ROOT, 'plugin', 'bin', 'recheck-followups.js'));

// The text between a start marker and the next end marker (or the end of the text); '' when the start is absent.
function slice(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) return '';
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return j < 0 ? text.slice(i) : text.slice(i, j);
}

const consoleStep7 = (t) => slice(t, '\n7. `Q#` queue writes', '\n8. ');
const localStep7 = (t) => slice(t, '\n7. **Push**', '\n8. ');
const step40c = (t) => slice(t, '### Step 4.0c', '\n### ');
const multispecWhen1 = (t) => slice(t, '\n1. Read `manifest.yml`', '\n2. ');
const multispecApproval2 = (t) => slice(t, '\n2. For each `Q#` queue write', '\n3. ');
const worktreeStep6 = (t) => slice(t, '\n6. **Push the base branch once', '\n### ');

// The judge output template, inlined verbatim in followup-recheck.md's dispatch prompt.
const JUDGE_TEMPLATE = [
  'RECORD: #{n}',
  'ITEM {k}: satisfied | not-satisfied | cant-tell',
  'QUOTE {k}: {verbatim line(s) from one hunk — only for satisfied}',
  '...',
  'STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED',
].join('\n');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// [name, text, region-of(text), pattern, message]
const CLAIMS = [
  ['recheck-own', RECHECK, (t) => t, /`--own`[^\n]*`run-state\.json`[^\n]*`manifest\.yml`[^\n]*filed as #/, 'followup-recheck.md does not source --own from run-state/manifest targets plus `filed as #` lines'],
  ['recheck-multispec-approve', RECHECK, (t) => t, /parent `Q#` row[^\n]*step 2[^\n]*approve --run "?\{parent\}"?[^\n]*never `gh issue create`/, 'followup-recheck.md lacks the multi-spec parent Q# row approve branch'],
  ['recheck-template', RECHECK, (t) => t, new RegExp(`\`\`\`\\n${escape(JUDGE_TEMPLATE)}\\n\`\`\``), 'followup-recheck.md does not inline the judge output template verbatim'],
  ['recheck-status', RECHECK, (t) => t, /trailing `STATUS:` line/, 'followup-recheck.md does not require a trailing STATUS: line'],
  ['recheck-tier', RECHECK, (t) => t, /\[Use: Standard\]/, 'followup-recheck.md does not name the [Use: Standard] profile'],
  ['recheck-never-not-satisfied', RECHECK, (t) => t, /[Nn]ever (?:read|treat)[^\n]*unavailable, failed, empty or unparseable[^\n]*`not-satisfied`/, 'followup-recheck.md does not forbid reading a failed judge reply as not-satisfied'],
  ['recheck-candidates', RECHECK, (t) => t, /bin\/recheck-followups\.js" candidates --run "\{run-dir\}" --records-json "\{snapshot\}" --base "\{base\}" --own \{own\}/, 'followup-recheck.md lacks the full candidates call'],
  ['recheck-skip', RECHECK, (t) => t, /log-decision\.js" --run "\{run-dir\}" --status SKIP --section "\/wrap-up" --step "Follow-up re-check"[^\n]*condition: recheck-followups\.js candidates exited \{code\}/, 'followup-recheck.md lacks the retry-then-SKIP Degrade-trace line'],
  ['recheck-stage', RECHECK, (t) => t, /bin\/recheck-followups\.js" stage --run "\{run-dir\}" --verdicts "\{verdicts\}"/, 'followup-recheck.md lacks the stage call'],
  ['recheck-dry-run', RECHECK, (t) => t, /Skip it under `--dry-run`/, 'followup-recheck.md does not skip under --dry-run'],
  ['console-section', CONSOLE, (t) => slice(t, '## Follow-up re-check', '\n## '), /Read `followup-recheck\.md` and follow it/, 'review-console.md lacks the Follow-up re-check section citing followup-recheck.md'],
  ['console-step7', CONSOLE, consoleStep7, /`followup-recheck-\*` item is never created as a record[^\n]*bin\/recheck-followups\.js" approve --run "\{item-run-dir\}" --id '\{name\}'` instead \(the CLI derives the PR from the run itself/, 'review-console.md step 7 lacks the followup-recheck- approve branch'],
  ['execution', EXECUTION, (t) => t, /ticked `followup-recheck-\*` `Q#` row[^\n]*recheck-followups\.js" approve --run "\{item-run-dir\}" --id '\{name\}' --item \{q-id\}`[^\n]*never `gh issue create`/, 'console-execution.md lacks the ticked followup-recheck- approve branch with --item {q-id}'],
  ['post-merge-4.0c', POST_MERGE, step40c, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/recheck-followups\.js" execute --run "\$PIPELINE_RUN_DIR"/, 'Step 4.0c lacks the execute call'],
  ['post-merge-4.0c-next', POST_MERGE, step40c, /Then continue to Step 4\.1\./, 'Step 4.0c does not continue to Step 4.1'],
  ['post-merge-4.0b-next', POST_MERGE, (t) => slice(t, '### Step 4.0b', '\n### '), /Then continue to Step 4\.0c\./, 'Step 4.0b does not continue to Step 4.0c'],
  ['merge-mode-4.0c', MERGE_MODE, (t) => slice(t, '3. On `merged`:', '\n'), /then Step 4\.0b \(`\{pr-number\}` = `\{pr\}`\), then Step 4\.0c, then Step 4\.1\./, 'merge-mode step 3 does not run Step 4.0c between Step 4.0b and Step 4.1'],
  ['close-out-4.0c', CLOSE_OUT, (t) => slice(t, '7. **On `merged`', '\n## '), /then Step 4\.0b \(`\{pr-number\}` = `\{number\}`\), then Step 4\.0c,/, 'dispatch close-out step 7 does not run Step 4.0c after Step 4.0b'],
  ['worktree-merge-6', WORKTREE_MERGE, worktreeStep6, /once per step 1 `\{run-dir\}` whose merge commit was recorded — the same scope as Step 4\.0b[^\n]*run `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/recheck-followups\.js" execute --run "\{run-dir\}" --local-merged`/, 'worktree-merge.md step 6 lacks the execute --local-merged call scoped to run dirs with a recorded merge commit'],
  ['multispec-step2', MULTISPEC, multispecApproval2, /create the record \(a `followup-recheck-\*` item: `approve`, see step 1\) — `gh issue create`/, 'multispec On-approval step 2 lacks the followup-recheck- approve exception'],
  ['recheck-multispec-pr', RECHECK, (t) => t, /The CLI derives the PR: the bundle PR's number from the parent `run-state\.json`'s `pr\.number` under `pr-first`[^\n]*`local` under `local-merge`/, 'followup-recheck.md does not say the CLI derives the multi-spec PR'],
  ['recheck-pr-derived', RECHECK, (t) => t, /`approve` derives the PR from the run itself[^\n]*A `--pr` that disagrees exits 2/, 'followup-recheck.md does not say approve derives the PR and refuses a disagreeing --pr'],
  ['recheck-hash', RECHECK, (t) => t, /hash no longer matches, and `execute` holds the item `proposal-changed`/, 'followup-recheck.md does not say a re-staged file holds as proposal-changed'],
  ['recheck-unattended-approve', RECHECK, (t) => t, /At `unattended`[^\n]*`console-residue\.js --run` lists it with a paste-ready `approve` line, then its `execute` line/, 'followup-recheck.md does not name the unattended residue approve path'],
  ['recheck-local-proof', RECHECK, (t) => t, /landed only when `--local-merged` is passed and the approval's recorded head commit is an ancestor of the local integration branch/, 'followup-recheck.md does not state the local-merge ancestry proof'],
  ['recheck-residue-only-paths', RECHECK, (t) => slice(t, 'These merge paths run no `execute`', '\n\nAn approval'), /auto-merge-short-circuit\.md[^\n]*settle-and-merge\.md[\s\S]*driver\/merge\.js/, 'followup-recheck.md does not list the residue-only merge paths'],
  ['recheck-merge-mode-already-merged', RECHECK, (t) => t, /`wrap-up\/merge-mode\.md`'s Already merged path runs it too/, 'followup-recheck.md does not name merge mode\'s Already merged path'],
  ['console-unattended-recheck', CONSOLE, (t) => slice(t, '- Every `Q#`/`M#` item resolves to `Apply`', '\n'), /nor a `followup-recheck-\*` row — it resolves `pending` at every tier, and the residue carries its paste-ready `approve` command/, 'review-console.md unattended Q# bullet lacks the followup-recheck- pending exception'],
  ['merge-mode-already-merged-4.0c', MERGE_MODE, (t) => slice(t, '## Already merged', '\n## '), /Then run Step 4\.0c[^\n]*bin\/recheck-followups\.js" execute --run "\$PIPELINE_RUN_DIR"/, 'merge-mode Already merged does not run Step 4.0c'],
  ['recheck-residue-by-design', RECHECK, (t) => t, /hands off to `\/superpowers:finishing-a-development-branch` with no post-merge step[^\n]*runs none: its approvals stay residue by design/, 'followup-recheck.md does not state the finishing-branch local-merge path is residue by design'],
  ['local-finish', LOCAL_FINISH, localStep7, /bin\/recheck-followups\.js" execute --run "\$RUN_DIR" --local-merged/, 'local-merge-auto-finish.md step 7 lacks execute --local-merged'],
  ['multispec', MULTISPEC, multispecWhen1, /`wrap-up\/followup-recheck\.md`[^\n]*parent `Q#` row[^\n]*step 2[^\n]*approve/, 'multispec step 1 lacks the followup-recheck.md pointer naming the parent Q# row and the step-2 approve branch'],
];

for (const [name, text, region, re, msg] of CLAIMS) {
  test(`pinned: ${name}`, () => {
    assert.ok(re.test(region(text)), msg);
    const mutated = text.replace(new RegExp(re.source, 'g'), '');
    assert.notEqual(mutated, text, `${name}: the strip changed nothing`);
    assert.ok(!re.test(region(mutated)), `${name}: control still matches after the strip`);
  });
}

test('review console runs the re-check before proposal bundling and before narrowing', () => {
  const order = (t) => ['## Follow-up re-check', '## Proposal bundling', '## Ledger narrowing'].map((h) => t.indexOf(h));
  const check = (t) => {
    const [r, b, n] = order(t);
    assert.ok(r >= 0 && b >= 0 && n >= 0, 'a console section heading is missing');
    assert.ok(r < b && b < n, 'Follow-up re-check must precede Proposal bundling, which precedes Ledger narrowing');
  };
  check(CONSOLE);
  // Permutation control: move the re-check section after bundling.
  const section = slice(CONSOLE, '## Follow-up re-check', '\n## ');
  const moved = CONSOLE.replace(section, '').replace('## Ledger narrowing', `${section}\n## Ledger narrowing`);
  assert.notEqual(moved, CONSOLE);
  assert.throws(() => check(moved), { message: /must precede Proposal bundling/ });
});

test('Step 4.0c sits between Step 4.0b and Step 4.1', () => {
  const check = (t) => {
    const [b, c, d] = ['### Step 4.0b', '### Step 4.0c', '### Step 4.1'].map((h) => t.indexOf(h));
    assert.ok(b >= 0 && c >= 0 && d >= 0, 'a post-merge step heading is missing');
    assert.ok(b < c && c < d, 'Step 4.0c must sit between Step 4.0b and Step 4.1');
  };
  check(POST_MERGE);
  const section = step40c(POST_MERGE);
  const moved = POST_MERGE.replace(section, '').replace('## Step 5', `${section}\n## Step 5`);
  assert.notEqual(moved, POST_MERGE);
  assert.throws(() => check(moved), { message: /between Step 4\.0b and Step 4\.1/ });
});

test('local-merge step 7 runs execute after the Step 4.0b sentence', () => {
  const step = localStep7(LOCAL_FINISH);
  const b = step.indexOf('Step 4.0b');
  const e = step.indexOf('recheck-followups.js" execute');
  assert.ok(b >= 0 && e > b, 'execute must follow the Step 4.0b sentence inside step 7');
});

// Each flag a prose call passes must be one its verb's USAGE line names.
function verbFlags(verb) {
  const usage = slice(USAGE_SRC, 'const USAGE = ', ';\n');
  const line = usage.split('\n').find((l) => l.includes(`recheck-followups.js ${verb} `));
  assert.ok(line, `no USAGE line for ${verb}`);
  return new Set(line.match(/--[a-z][a-z-]*/g));
}
function badFlags(texts) {
  const bad = [];
  for (const t of texts) {
    for (const m of t.matchAll(/recheck-followups\.js" (candidates|stage|approve|execute)([^`\n]*)/g)) {
      const allowed = verbFlags(m[1]);
      for (const f of m[2].match(/--[a-z][a-z-]*/g) || []) if (!allowed.has(f)) bad.push(`${m[1]} ${f}`);
    }
  }
  return bad;
}
test('every prose recheck-followups.js call passes only flags its verb accepts', () => {
  const texts = [RECHECK, CONSOLE, EXECUTION, POST_MERGE, LOCAL_FINISH, WORKTREE_MERGE];
  const calls = texts.join('\n').match(/recheck-followups\.js" (candidates|stage|approve|execute)/g) || [];
  assert.ok(calls.length >= 6, `expected at least 6 prose calls, found ${calls.length}`);
  assert.deepStrictEqual(badFlags(texts), []);
  // Control: a renamed flag is caught.
  assert.deepStrictEqual(badFlags([RECHECK.replace('--verdicts "{verdicts}"', '--verdict "{verdicts}"')]), ['stage --verdict']);
});

// AC9.1: below the Read rail (52,500 B, owned by budgets.js — tests/skill-size-single-source.test.js).
test('AC9.1: multispec-review-console.md stays below the Read rail', () => {
  const bytes = Buffer.byteLength(MULTISPEC);
  assert.ok(bytes < RAIL_BYTES, `multispec-review-console.md is ${bytes} B, not below the Read rail`);
});
