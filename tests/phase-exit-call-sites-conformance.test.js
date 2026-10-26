'use strict';
// tests/phase-exit-call-sites-conformance.test.js — #4026: every pipeline phase exit is one
// `bin/phase-exit.js` call (push, bookkeeping backfill, checklist flip and merge-state read in
// one process), and the CLIs that log their own decisions.md entries are named once, in
// `_shared/auto-decision-log.md`. Reads the live skill prose: the call sites and the envelope
// routing list are the declared contract the CLI is driven by, and a new phase exit that
// restates the old push / pr-checklist.js / pr-merge-state.js sequence must go red here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const collapse = (s) => s.replace(/\s+/g, ' ');

const PHASE_EXIT_LABEL = '**Phase exit (any run with a run dir, `_shared/integration-model.md`):**';
// The one call rule every site states the same way as git-discipline.md: called in any model or
// mode, pushing only under pr-first in worktree mode.
const PUSH_RULE = 'it pushes only under `pr-first` in `worktree` mode';
const SITES = [
  { file: 'plugin/skills/build/SKILL.md', anchor: PHASE_EXIT_LABEL, phase: 'build' },
  { file: 'plugin/skills/test/SKILL.md', anchor: PHASE_EXIT_LABEL, phase: 'test' },
  { file: 'plugin/skills/review/code-mode-steps.md', anchor: PHASE_EXIT_LABEL, phase: 'review' },
  { file: 'plugin/skills/flow/steps-and-gates.md', anchor: PHASE_EXIT_LABEL, phase: 'polish' },
  { file: 'plugin/skills/wrap-up/execution-and-verification.md', anchor: PHASE_EXIT_LABEL, phase: 'wrap-up' },
  { file: 'plugin/skills/flow/multispec-parallel-waves.md', anchor: "Once the wave's last member has merged", phase: 'build' },
];
const BANNED = ['push origin', 'bin/pr-checklist.js', 'bin/pr-merge-state.js'];
const CITES = ['_shared/git-discipline.md', '_shared/pr-checklist-refresh.md'];

// The phase-exit paragraph: from its (unique) anchor to the next blank line or list item.
function phaseExitUnit(text, site) {
  const start = text.indexOf(site.anchor);
  assert.notEqual(start, -1, `${site.file}: phase-exit anchor ${JSON.stringify(site.anchor)} not found`);
  assert.equal(text.indexOf(site.anchor, start + 1), -1, `${site.file}: the phase-exit anchor must be unique`);
  const rest = text.slice(start);
  const end = rest.slice(1).search(/\n[ \t]*\n|\n[ \t]*(?:[-*]|\d+\.) /);
  return collapse(end === -1 ? rest : rest.slice(0, end + 1));
}

// Shared by the positive tests and every go-red control below.
function assertPhaseExitSite(text, site) {
  const unit = phaseExitUnit(text, site);
  const calls = unit.split('bin/phase-exit.js" --run').length - 1;
  assert.equal(calls, 1, `${site.file}: names exactly one bin/phase-exit.js" --run invocation (found ${calls})`);
  assert.match(
    unit,
    new RegExp(`bin/phase-exit\\.js" --run "[^"]+" --phase ${site.phase} --worktree "[^"]+"`),
    `${site.file}: the invocation passes --phase ${site.phase} and --worktree`,
  );
  for (const banned of BANNED) {
    assert.ok(!unit.includes(banned), `${site.file}: no separate ${banned} invocation in the phase-exit paragraph`);
  }
  for (const cite of CITES) assert.ok(unit.includes(cite), `${site.file}: the phase-exit paragraph cites ${cite}`);
  assert.ok(unit.includes(PUSH_RULE), `${site.file}: the phase-exit paragraph states the one call rule (${PUSH_RULE})`);
  assert.ok(!unit.includes('A no-op under `local-merge`'), `${site.file}: no "A no-op under local-merge" rule contradicting the call-in-any-model rule`);
}

for (const site of SITES) {
  test(`AC2.1: every phase-exit call site names one phase-exit.js invocation — ${site.file} (--phase ${site.phase})`, () => {
    assertPhaseExitSite(read(site.file), site);
  });
}

test('AC2.1 go-red control: deleting the invocation from one call site makes the shared assertion throw', () => {
  const site = SITES[2];
  const original = read(site.file);
  const mutated = original.replace(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/phase-exit\.js" --run [^`]*`/, 'the phase exit');
  assert.notEqual(mutated, original, 'the control must actually remove the invocation');
  assert.throws(() => assertPhaseExitSite(mutated, site), { message: /names exactly one bin\/phase-exit\.js" --run invocation \(found 0\)/ });
});

test('AC2.1 go-red control: a separate pr-checklist.js call, a push, or the wrong --phase makes the shared assertion throw', () => {
  const site = SITES[1];
  const original = read(site.file);
  const at = original.indexOf(site.anchor);
  const withChecklist = `${original.slice(0, at)}${site.anchor} then \`node "\${CLAUDE_PLUGIN_ROOT}/bin/pr-checklist.js" --run "{run-dir}" --phase test\`${original.slice(at + site.anchor.length)}`;
  assert.notEqual(withChecklist, original);
  assert.throws(() => assertPhaseExitSite(withChecklist, site), { message: /no separate bin\/pr-checklist\.js invocation/ });
  const withPush = `${original.slice(0, at)}${site.anchor} \`git -C "{worktree-path}" push origin {branch}\`${original.slice(at + site.anchor.length)}`;
  assert.throws(() => assertPhaseExitSite(withPush, site), { message: /no separate push origin invocation/ });
  const wrongPhase = original.replace('--phase test --worktree', '--phase review --worktree');
  assert.notEqual(wrongPhase, original, 'the control must actually change the --phase value');
  assert.throws(() => assertPhaseExitSite(wrongPhase, site), { message: /passes --phase test and --worktree/ });
});

test('AC2.1 go-red control: a site that drops the call rule, or restores "A no-op under local-merge", makes the shared assertion throw', () => {
  const site = SITES[4];
  const original = read(site.file);
  const noRule = original.replace(PUSH_RULE, 'it pushes');
  assert.notEqual(noRule, original);
  assert.throws(() => assertPhaseExitSite(noRule, site), { message: /states the one call rule/ });
  const noOp = original.replace(`${PUSH_RULE}.`, `${PUSH_RULE}. A no-op under \`local-merge\` or \`current-branch\` mode.`);
  assert.notEqual(noOp, original);
  assert.throws(() => assertPhaseExitSite(noOp, site), { message: /no "A no-op under local-merge" rule/ });
});

test('AC2.1 go-red control: the paragraph unit stops at the next blank line, so a later paragraph never satisfies it', () => {
  const site = { file: 'fixture.md', anchor: PHASE_EXIT_LABEL, phase: 'test' };
  const fixture = `${PHASE_EXIT_LABEL} push the branch.\n\nLater: \`node "\${CLAUDE_PLUGIN_ROOT}/bin/phase-exit.js" --run "$PIPELINE_RUN_DIR" --phase test --worktree "{worktree-path}"\` (${PUSH_RULE}) per _shared/git-discipline.md and _shared/pr-checklist-refresh.md.\n`;
  assert.throws(() => assertPhaseExitSite(fixture, site), { message: /\(found 0\)/ });
  assert.doesNotThrow(() => assertPhaseExitSite(fixture.replace('push the branch.\n\nLater:', 'push the branch. Later:'), site));
});

// --- missing-facts predicates: each fact is proved to go red on its own ---

function missingFacts(text, facts) {
  const flat = collapse(text);
  return facts.filter((f) => !f.re.test(flat)).map((f) => f.name);
}

function assertEachFactGoesRed(text, facts) {
  const flat = collapse(text);
  for (const f of facts) {
    const stripped = flat.replace(f.re, '');
    assert.notEqual(stripped, flat, `${f.name}: the strip must remove something`);
    assert.deepEqual(missingFacts(stripped, facts), [f.name], `${f.name}: stripping its match must report exactly itself`);
  }
}

const AUTO_DECISION_LOG = read('plugin/skills/_shared/auto-decision-log.md');
const LOG_FACTS = [
  { name: 'entries form', re: /`bin\/log-decision\.js --run <run-dir> --entries <file> \[--section "\/<skill>"\]` appends many entries under one lock/ },
  { name: 'batch at phase end', re: /Batch the model-judged entries a phase accumulates into one `--entries` call at phase end, before its `bin\/phase-exit\.js` call/ },
  { name: 'session-tmp path', re: /bin\/session-tmp-resolve\.js" DECISION_ENTRIES=decision-entries-\{run-id\}-\{phase\}\.json/ },
  { name: 'Write tool, never the shell', re: /write the JSON with the Write tool — never through the shell/ },
  { name: 'CLIs self-log', re: /A bin CLI given `--run` appends the entry for a decision it reports as data itself, through `lib\/log-decision\/append\.js`/ },
  { name: 'never re-log', re: /A skill never re-logs an entry a CLI already wrote/ },
  { name: 'hand-log only on a failed append', re: /hand-logs it with `log-decision\.js` only when the CLI reports the append failed — in its envelope \(`logged: false` on a state that logs, `logFailed: true`, a `logFailures` element\) or in a stderr line naming the failed `decisions\.md` append/ },
  { name: 'delete-ledger stderr signal', re: /`hooks\.js delete-ledger`'s `decisions\.md append failed … hand-log …`/ },
  { name: '(a) failed invocation', re: /\(a\) an entry reporting a CLI's own failed invocation/ },
  { name: '(b) before the run dir exists', re: /\(b\) a CLI that runs before the run directory exists \(`preflight-records\.js`\)/ },
  { name: '(c) read-only fact pack', re: /\(c\) a read-only fact pack \(`flow-preflight\.js`, `wrap-up-pack\.js`\)/ },
  { name: '(d) many-site resolver', re: /\(d\) a resolver called from many sites where no entry is owed \(`resolve-policy\.js`, `resolve-profile\.js`\)/ },
  { name: '(e) caller retry state', re: /\(e\) an entry whose text depends on the caller's own retry state/ },
  { name: '(f) node -e lib module', re: /\(f\) a lib module run through `node -e`, which is not a bin CLI/ },
];

test('auto-decision-log.md documents --entries and the self-logging rule', () => {
  assert.deepEqual(missingFacts(AUTO_DECISION_LOG, LOG_FACTS), []);
});

test('go-red control: each --entries / self-logging fact goes red on its own', () => {
  assertEachFactGoesRed(AUTO_DECISION_LOG, LOG_FACTS);
});

// The CLIs the self-logging paragraph names, each pinned to the source that really appends
// through lib/log-decision/append (phase-exit.js appends from its lib module).
const SELF_LOGGING_SOURCES = {
  'phase-exit.js': ['plugin/bin/phase-exit.js', 'plugin/bin/lib/phase-exit/phase-exit.js'],
  'pr-merge-state.js': ['plugin/bin/pr-merge-state.js'],
  'pr-checklist.js': ['plugin/bin/pr-checklist.js'],
  'pr-checks.js': ['plugin/bin/pr-checks.js'],
  'set-config.js --set': ['plugin/bin/set-config.js'],
  'closing-links.js': ['plugin/bin/closing-links.js'],
  'verify-run-bookends.js': ['plugin/bin/verify-run-bookends.js'],
  'console-filings.js': ['plugin/bin/console-filings.js'],
  'reflect-apply.js': ['plugin/bin/reflect-apply.js', 'plugin/bin/lib/console/reflect-apply.js'],
  'review-coordination.js resolve-tiebreak': ['plugin/bin/review-coordination.js'],
  'hooks.js delete-ledger': ['plugin/bin/hooks.js'],
};

function listedSelfLoggers(text) {
  const flat = collapse(text);
  const m = /#4026 moved these ones there: (.*?)\. A skill never re-logs/.exec(flat);
  assert.ok(m, 'the self-logging paragraph lists the CLIs #4026 moved to lib/log-decision/append.js');
  return [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
}

// Over comment-stripped source: a file that only names the require or formatEntry( in a comment appends nothing.
function assertSourcesAppendThroughLib(name, raws) {
  const src = raws.map((raw) => {
    const stripped = stripComments(raw);
    const verdict = stripperVerdict(raw, stripped);
    assert.equal(verdict, 'ok', `${name}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    return stripped;
  }).join('\n');
  assert.match(src, /require\(['"][./]*(?:lib\/)?log-decision\/append['"]\)/, `${name}: its source requires lib/log-decision/append`);
  assert.match(src, /formatEntry\(/, `${name}: its source formats a decisions.md entry`);
}
const assertAppendsThroughLib = (name, files) => assertSourcesAppendThroughLib(name, files.map((f) => read(f)));

test('the self-logging CLI list names exactly the pinned CLIs, and each appends through lib/log-decision/append', () => {
  assert.deepEqual(listedSelfLoggers(AUTO_DECISION_LOG), Object.keys(SELF_LOGGING_SOURCES));
  for (const [name, files] of Object.entries(SELF_LOGGING_SOURCES)) assertAppendsThroughLib(name, files);
});

test('go-red control: a listed CLI that does not append, or an unpinned name in the list, makes the pin throw', () => {
  assert.throws(() => assertAppendsThroughLib('resolve-policy.js', ['plugin/bin/resolve-policy.js']), { message: /requires lib\/log-decision\/append/ });
  assert.throws(
    () => assertSourcesAppendThroughLib('commented', ["'use strict';\n// const { formatEntry } = require('./lib/log-decision/append'); formatEntry(\n/* require('./lib/log-decision/append') */\n"]),
    { message: /requires lib\/log-decision\/append/ },
  );
  const extra = AUTO_DECISION_LOG.replace('`hooks.js delete-ledger`.', '`hooks.js delete-ledger`, `resolve-policy.js`.');
  assert.notEqual(extra, AUTO_DECISION_LOG);
  assert.notDeepEqual(listedSelfLoggers(extra), Object.keys(SELF_LOGGING_SOURCES));
});

const GIT_DISCIPLINE = read('plugin/skills/_shared/git-discipline.md');
const phaseExitSection = (text) => {
  const start = text.indexOf('## Phase exit — one `phase-exit.js` call');
  const end = text.indexOf('### Post-push merge-state check');
  assert.ok(start !== -1 && end > start, 'the Phase exit section precedes the Post-push merge-state check');
  return text.slice(start, end);
};
const ROUTING_FACTS = [
  { name: 'the one invocation', re: /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/phase-exit\.js" --run "\$PIPELINE_RUN_DIR" --phase \{build\|test\|review\|polish\|wrap-up\} --worktree "\{worktree-path\}" --fixes \{n\}\[,\{m\}\.\.\.\]/ },
  { name: 'call in any model, push only under pr-first', re: /Call it at every phase exit of a run with a run dir — any model or mode; it pushes only under `pr-first` in `worktree` mode/ },
  { name: 'help is the sub-step reference', re: /are in `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/phase-exit\.js" --help`/ },
  { name: 'call sites cite the list', re: /every call site cites this list rather than restating it/ },
  { name: 'pushed routes mergeState', re: /`push\.state: 'pushed'` — route `mergeState` per the Post-push merge-state check below/ },
  { name: 'failed push needs nothing', re: /`push\.state: 'failed'` — nothing: the CLI logged it, and the next phase exit's push retries/ },
  { name: 'no recorded PR opens it, then re-runs', re: /`push\.state: 'skipped'` with a `reason` naming no recorded PR — run `_shared\/pr-early-run-lifecycle\.md`'s push-and-open-draft-PR procedure, then re-run `phase-exit\.js`/ },
  { name: 'push-skipped route owns checklist no-pr', re: /Ignore the `checklist\.action: 'no-pr'` that comes with it: this route owns it, and the re-run flips the row/ },
  { name: 'failed worktree stamp runs record-worktree by hand', re: /`bookkeeping\.worktree: 'failed'` on a live run dir — run `record-worktree` by hand \(`build\/worktree-setup\.md` Step 4\.5\), then re-run `phase-exit\.js`/ },
  { name: 'a second record-worktree failure logs a SKIP', re: /If that `record-worktree` fails too, log one `SKIP` with `log-decision\.js` naming the CLI's `bookkeeping\.detail` \(class \(a\)/ },
  { name: 'checklist no-pr / gh-absent', re: /`checklist\.action: 'no-pr'` with any other push state — `_shared\/pr-checklist-refresh\.md`'s degraded-run recovery; `'gh-absent'` — its MCP branch/ },
  { name: 'sub-CLI crash proceeds', re: /`checklist\.exit` or `mergeState\.exit` `null` with an `error` \(the sub-CLI threw\) — proceed: the next phase exit re-runs both, and the pre-merge refresh re-flips the row/ },
  { name: 'logFailures hand-logged', re: /`logFailures` — hand-log each `decision` element/ },
  { name: 'local-merge / current-branch need nothing but a failed worktree', re: /`route` `local-merge` or `current-branch` — nothing more, except a `bookkeeping\.worktree: 'failed'`/ },
  { name: 'parallel-wave members never call it', re: /Under `MULTISPEC_PARALLEL_WAVE=1` a member never calls it: write one `SKIP` entry naming the marker instead/ },
];

test('git-discipline.md: the Phase exit section is the one phase-exit.js call and routes every envelope branch', () => {
  assert.deepEqual(missingFacts(phaseExitSection(GIT_DISCIPLINE), ROUTING_FACTS), []);
});

test('go-red control: each envelope-routing fact goes red on its own', () => {
  assertEachFactGoesRed(phaseExitSection(GIT_DISCIPLINE), ROUTING_FACTS);
});

// The build SKIP text lives only in lib/phase-exit/phase-exit.js's SKIP_TEXT; a prose copy would
// drift from it unwatched, so git-discipline.md names the SKIP without restating its text.
const SKIP_TEXT_TAIL = 'fallback: no phase-exit push, one push at finish';
function assertNoSkipTextCopy(text) {
  assert.ok(!collapse(text).includes(SKIP_TEXT_TAIL), 'git-discipline.md restates phase-exit.js\'s SKIP text');
}

test('git-discipline.md does not restate the build SKIP text phase-exit.js writes', () => {
  assert.ok(read('plugin/bin/lib/phase-exit/phase-exit.js').includes(SKIP_TEXT_TAIL), 'the ban tracks the live SKIP_TEXT');
  assertNoSkipTextCopy(GIT_DISCIPLINE);
  assert.throws(() => assertNoSkipTextCopy(`${GIT_DISCIPLINE}\ntext \`condition: x → ${SKIP_TEXT_TAIL}\``), /restates/);
});
