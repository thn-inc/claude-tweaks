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
const path = require('node:path');
const { VERDICT_STEPS, verdictText } = require('../plugin/bin/lib/dispatch/merge-verdict');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const FLAT = collapse(fs.readFileSync(path.join(ROOT, 'plugin/skills/wrap-up/auto-merge-short-circuit.md'), 'utf8'));

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

test('the refusal line resolves the console to leave-open (carries merge-check AND needs-human)', () => {
  const m = FLAT.match(/--text "(#\{n\} merge-check verdict not confirmed[^"]*)"/);
  assert.ok(m, 'refusal log line missing');
  assert.match(m[1], /needs-human/);
  assert.match(m[1], /merge-check/);
  assert.doesNotMatch(PRE_CHANGE, /merge-check verdict not confirmed/);
});

test('pr-first: the backstop precedes the _shared/pr-first-merge.md invocation', () => {
  assertPinned(
    /\*\*`integration-model: pr-first` \(`_shared\/integration-model\.md`\):\*\* run the Verdict backstop above first[\s\S]{0,300}?run `_shared\/pr-first-merge\.md`'s procedure now/,
    'pr-first branch ordering',
  );
});

test('local-merge: the backstop precedes the merge, and the dispatch-claim relay', () => {
  assertPinned(
    /\*\*`integration-model: local-merge`:\*\* run the Verdict backstop above first[\s\S]{0,300}?before merging, clear this run's worktree/,
    'local-merge branch ordering',
  );
  assertPinned(
    /\*\*`integration-model: local-merge`:\*\* the checkout restriction is real — run the Verdict backstop above first/,
    'dispatch-claim local-merge relay ordering',
  );
  const backstop = FLAT.indexOf('**Verdict backstop — re-read before any merge (#2941).**');
  const merge = FLAT.indexOf('git merge --no-ff {branch} -m "$SUBJECT_TITLE');
  const prFirst = FLAT.indexOf("run `_shared/pr-first-merge.md`'s procedure now");
  assert.ok(backstop > -1 && backstop < merge && backstop < prFirst, 'backstop paragraph must precede both merge calls');
});
