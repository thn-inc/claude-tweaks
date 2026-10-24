'use strict';
// Conformance suite for record #2941: wrap-up/auto-merge-short-circuit.md's singleton fast lane
// merged PR #2938 with no merge-check verdict ever produced — prose discipline alone. This pins
// the #2429-equivalent mechanical backstop: the passing verdict is logged at Layer 2, and a
// one-read re-check of decisions.md (plugin/bin/lib/dispatch/merge-verdict.js) sits before the
// merge call on both the pr-first and local-merge branches.
//
// Live-corpus read (skill-prose-conformance-tests: a documented convention this project wants
// enforced). Go-red proof [IL-105]: each pattern also runs against a frozen pre-change excerpt.
// Whitespace collapsed on haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { VERDICT_STEPS, verdictText } = require('../plugin/bin/lib/dispatch/merge-verdict');
const { formatEntry } = require('../plugin/bin/lib/log-decision/append');
const { resolveAll } = require('../plugin/bin/lib/console/resolve');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const SHORT_CIRCUIT_PATH = path.join(ROOT, 'plugin/skills/wrap-up/auto-merge-short-circuit.md');
const SETTLE_AND_MERGE_PATH = path.join(ROOT, 'plugin/skills/dispatch/settle-and-merge.md');
const RAW_SHORT_CIRCUIT = readText(SHORT_CIRCUIT_PATH);
const FLAT = collapse(RAW_SHORT_CIRCUIT);
const PLUGIN_DIR = path.join(ROOT, 'plugin').split(path.sep).join('/');

// Frozen pre-change excerpts — Layer 2, the pr-first branch opener, and the local-merge branch
// opener exactly as they read before #2941.
const PRE_CHANGE = collapse([
  '2. **Content judgment** — invoke `/claude-tweaks:assess-agent-autonomy` in `merge-check` mode '
  + '(`Skill(skill: "claude-tweaks:assess-agent-autonomy", args: "merge-check #{n} --pack {run-dir}/wrap-up-pack.json")`), '
  + 'which weighs the diff\'s content, `/review`\'s findings, and a test-exclusion-aware blast-radius summary holistically. '
  + 'The verdict must be `auto-merge` to proceed.',
  '**Dispatch-claim branch — check this before merging anything.**',
  '**`integration-model: local-merge`:** the checkout restriction is real — do not run the merge procedure below. '
  + 'Stop here instead: report `OUTCOME: ready-to-merge` per `task-prompt.md`\'s second-call template',
  '**`integration-model: pr-first` (`_shared/integration-model.md`):** run `_shared/pr-first-merge.md`\'s procedure now',
  '**`integration-model: local-merge`:** before merging, clear this run\'s worktree assignment',
  'git merge --no-ff {branch} -m "$SUBJECT_TITLE',
].join('\n\n'));

function assertPinned(pattern, label) {
  assert.match(FLAT, pattern, `${label}: missing from live prose`);
  assert.doesNotMatch(PRE_CHANGE, pattern, `${label}: pattern matches the pre-change text — cannot go red`);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('Layer 2 logs the passing verdict through log-decision.js, byte-matching the module marker', () => {
  const pattern = new RegExp(
    `--step "${esc(VERDICT_STEPS.shortCircuit)}" --reversibility n/a --text "${esc(verdictText('{n}'))}"`,
  );
  assertPinned(pattern, 'passing-verdict log step');
  assert.ok(!/needs-human/.test(verdictText('{n}')), 'passing line must not contain needs-human');
});

test('the Verdict backstop re-reads decisions.md through the shared module', () => {
  assertPinned(/\*\*Verdict backstop — re-read before any merge \(#2941\)\.\*\*/, 'backstop heading');
  assertPinned(
    /require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/dispatch\/merge-verdict\.js'\)[\s\S]{0,200}?confirmFromFile\(process\.argv\[1\], process\.argv\.slice\(2\)\)[\s\S]{0,200}?"\$PIPELINE_RUN_DIR\/decisions\.md" \{n\}/,
    'backstop one-read snippet',
  );
});

test('the refusal line resolves the console to leave-open (run through resolveAll, not a copy of its matcher)', (t) => {
  const m = FLAT.match(/--step "([^"]+)" --reversibility n\/a --text "(#\{n\} merge-check verdict not confirmed[^"]*)"/);
  assert.ok(m, 'refusal log line missing');
  assert.doesNotMatch(PRE_CHANGE, /merge-check verdict not confirmed/);
  const text = m[2].replace('{n}', '7').replace('{latest}', 'none').replace('{detail}', '');
  const consoleDeps = {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    gitApplyCheck: () => ({ ok: true }),
    readGrants: (numbers) => Object.fromEntries(numbers.map((n) => [n, { labels: ['auto:merge'], pendingSince: null }])),
    now: () => Date.parse('2026-10-16T12:00:00Z'),
  };
  const mergeFor = (decisions) => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-refusal-console-'));
    t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(runDir, 'work'));
    fs.mkdirSync(path.join(runDir, 'staged'));
    fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
    fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
    return resolveAll({ runDir, policy: 'console-auto', deps: consoleDeps }).merge;
  };
  // Control: the same granted run with no refusal line merges, so leave-open below is the refusal's doing.
  assert.strictEqual(mergeFor('## /wrap-up\n').resolution, 'merge');
  const refusal = formatEntry({ status: 'AUTO', now: new Date(), step: m[1], text });
  const merge = mergeFor(`## /wrap-up\n${refusal}\n`);
  assert.strictEqual(merge.resolution, 'leave-open');
  assert.match(merge.reason, /merge-check verdict not confirmed/);
});

test('pr-first: the backstop precedes the _shared/pr-first-merge.md invocation', () => {
  assertPinned(
    /\*\*`integration-model: pr-first` \(`_shared\/integration-model\.md`\):\*\* run the Verdict backstop above first[\s\S]{0,300}?run `_shared\/pr-first-merge\.md`'s procedure now/,
    'pr-first branch ordering',
  );
});

test('the backstop runs once before acceptance labeling and ledger deletion, not only before the merge calls (final fix wave, #2941)', () => {
  const backstop = FLAT.indexOf('**Verdict backstop — re-read before any merge (#2941).**');
  const labeling = FLAT.indexOf('**Both layers pass — acceptance labeling runs first, before the merge.**');
  assert.ok(backstop > -1 && labeling > -1, 'both headings must be located');
  assert.ok(backstop < labeling, 'the backstop must precede acceptance labeling and ledger deletion, not just the merge calls');
});

test('local-merge: the backstop precedes the merge, and the dispatch-call relay', () => {
  assertPinned(
    /\*\*`integration-model: local-merge`:\*\* run the Verdict backstop above first[\s\S]{0,300}?before merging, clear this run's worktree/,
    'local-merge branch ordering',
  );
  assertPinned(
    /\*\*`integration-model: local-merge`:\*\* the checkout restriction is real — run the Verdict backstop above first/,
    'dispatch-call local-merge relay ordering',
  );
  const backstop = FLAT.indexOf('**Verdict backstop — re-read before any merge (#2941).**');
  const merge = FLAT.indexOf('git merge --no-ff {branch} -F "{subject-dir}/message.txt"');
  const prFirst = FLAT.indexOf("run `_shared/pr-first-merge.md`'s procedure now");
  assert.ok(backstop > -1 && backstop < merge && backstop < prFirst, 'backstop paragraph must precede both merge calls');
});

// #2941 review fix (finding 3): the backstop used to be unconditional, so an agent that had just
// logged a genuine needs-human verdict would run it anyway and log a spurious second refusal line.
test('the backstop paragraph states it is skipped when Layer 2 already returned needs-human', () => {
  assertPinned(
    new RegExp(esc("**Verdict backstop — re-read before any merge (#2941).** Skip this backstop entirely when Layer 2's verdict was `needs-human` — go straight to \"Any layer fails\" below, whose own needs-human log line is already the record; the backstop guards only the path that is about to proceed to a merge.")),
    'backstop needs-human skip sentence',
  );
});

// #2941 review fix (finding 2): the refusal line had no slot for the snippet's own error= output
// or a crash/non-zero exit, so a read failure read identically to "merge-check never ran."
test('the refusal template carries a {detail} slot alongside {latest}, with its derivation documented', () => {
  assertPinned(/latest: \{latest\}\{detail\}\) — treated as needs-human/, 'refusal template detail slot');
  assertPinned(
    /`\{detail\}` is `, error: \{error\}` when the snippet printed `error=`, `, snippet exited \{code\} with no output` on a non-zero exit with no `\{n\}=` line, otherwise empty\./,
    'detail derivation sentence',
  );
});

// #2941 review fix (finding 5): extract-and-run (docs/skill-authoring.md, "Executable snippets in
// skill prose", per tests/backlog-overview-foldin-no-truncation.test.js) -- proves the backstop
// snippet this file and settle-and-merge.md both ship actually runs and produces the expected
// output, not just that its text is present.
function extractConfirmSnippetBody(raw, label) {
  const anchor = 'confirmFromFile(process.argv[1], process.argv.slice(2))';
  const anchorIdx = raw.indexOf(anchor);
  assert.ok(anchorIdx > -1, `${label}: confirmFromFile call not found -- extraction out of sync with the live file`);
  const openIdx = raw.lastIndexOf('node -e "', anchorIdx);
  assert.ok(openIdx > -1, `${label}: opening node -e "..." not found`);
  const bodyStart = openIdx + 'node -e "'.length;
  const closeMatch = /\n[ \t]*"/.exec(raw.slice(bodyStart));
  assert.ok(closeMatch, `${label}: closing quote not found`);
  const body = raw.slice(bodyStart, bodyStart + closeMatch.index);
  return body.split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_DIR);
}

function runConfirmSnippet(body, decisionsPath, n) {
  return execFileSync(process.execPath, ['-e', body, decisionsPath, String(n)], { encoding: 'utf8' });
}

for (const [label, filePath] of [
  ['auto-merge-short-circuit.md', SHORT_CIRCUIT_PATH],
  ['settle-and-merge.md', SETTLE_AND_MERGE_PATH],
]) {
  test(`${label}'s backstop snippet, executed verbatim, confirms a passing verdict and refuses an empty log`, (t) => {
    const raw = fs.readFileSync(filePath, 'utf8');
    const body = extractConfirmSnippetBody(raw, label);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-verdict-snippet-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const decisionsPath = path.join(dir, 'decisions.md');

    fs.writeFileSync(decisionsPath, `${formatEntry({ status: 'AUTO', now: new Date(), step: VERDICT_STEPS.shortCircuit, text: verdictText(2941) })}\n`);
    const pass = runConfirmSnippet(body, decisionsPath, 2941);
    assert.match(pass, /^2941=1 latest=auto-merge$/m);

    fs.writeFileSync(decisionsPath, '');
    const empty = runConfirmSnippet(body, decisionsPath, 2941);
    assert.match(empty, /^2941=0 latest=none$/m);
  });
}
