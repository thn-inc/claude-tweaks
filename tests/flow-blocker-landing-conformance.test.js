// tests/flow-blocker-landing-conformance.test.js
// #4553 — /flow stops before claiming when a closed out-of-run blocker's closing
// commit never reached the integration branch. Pins the multi-spec prose that
// applies bin/preflight-records.js --blocker-landing's verdicts.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const FLOW_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'flow');
const ORDERING = path.join(FLOW_DIR, 'multispec-dependency-ordering.md');
const MULTI_SPEC = path.join(FLOW_DIR, 'multi-spec.md');
const PREFLIGHT_FAILURE = path.join(FLOW_DIR, 'multispec-preflight-failure.md');

const OUT_OF_RUN_HEADING = '## Targets with a dependency on a target NOT in the run';

const outOfRunSection = (text) => {
  const at = text.indexOf(OUT_OF_RUN_HEADING);
  return at === -1 ? '' : text.slice(at);
};
// Odd-indexed chunks of a split on the fence lines are the fenced blocks.
const fencedBlocks = (section) => section.split(/^```.*$/m).filter((_, i) => i % 2 === 1);
const verdictRow =(section, verdict) => section.split('\n').find((l) => l.startsWith(`| \`${verdict}\` |`)) || '';

// Each helper returns its assertions' own messages so a go-red control can match
// the throw to the clause it deleted.
function assertVerdictTable(text) {
  const section = outOfRunSection(text);
  assert.ok(section, 'out-of-run section present');
  assert.match(section, /--blocker-landing/, 'the section names the --blocker-landing call');
  assert.match(section, /^\| `open` \|.*hard fail/m, 'open row is a hard fail');
  assert.match(section, /^\| `unlanded` \|.*hard fail/m, 'unlanded row is a hard fail');
  assert.match(section, /^\| `landed` \|.*satisfied/m, 'landed row is satisfied');
  assert.match(section, /^\| `not-applicable` \|.*satisfied/m, 'not-applicable row is satisfied');
  assert.match(section, /^\| `undetermined` \|.*proceed/m, 'undetermined row proceeds');
}

function assertUnlandedCard(text) {
  const section = outOfRunSection(text);
  const unlanded = verdictRow(section, 'unlanded');
  assert.match(unlanded, /before Step 2\.8/, 'the unlanded row stops before Step 2.8');
  const card = fencedBlocks(section).find((b) => b.includes('#{n}')) || '';
  assert.ok(card, 'unlanded stop card is a fenced block naming #{n}');
  assert.match(card, /#\{blocker\}/, 'card names the blocker');
  assert.match(card, /\{commit\}/, 'card names the closing commit');
  assert.match(card, /origin\/\{integration-branch\}/, 'card names origin/{integration-branch}');
  const lines = card.split('\n');
  assert.ok(lines.includes('git merge {commit}'), 'escape 1: git merge {commit} on its own line');
  assert.ok(lines.some((l) => l.startsWith('gh api -X DELETE')), 'escape 2: gh api -X DELETE on its own line');
  assert.match(section, /cherry-picked landing reads `unlanded`/, 'cherry-pick caveat present');
}

function assertUndeterminedSkip(text) {
  const section = outOfRunSection(text);
  assert.match(verdictRow(section, 'undetermined'), /proceed/, 'undetermined proceeds');
  assert.match(section, /one `SKIP` per blocker/, 'one SKIP per blocker');
  const skipLine = section.split('\n').find((l) => l.includes('bin/log-decision.js'));
  assert.ok(skipLine, 'SKIP command line present');
  assert.match(skipLine, /--status SKIP --step "Step 2 blocker landing \(undetermined\)"/, 'verbatim SKIP step id');
  const textArg = skipLine.match(/--text "([^"]*)"/);
  assert.ok(textArg, 'SKIP --text double-quoted argument present');
  assert.doesNotMatch(textArg[1], /`/, 'SKIP --text must be shell-safe: no backticks inside the double-quoted argument');
}

function assertFailedQueryIsNotUndetermined(orderingText, failureText) {
  const section = outOfRunSection(orderingText);
  assert.match(
    section,
    /failed blocker query is not `undetermined`[^\n]*stops before claiming/,
    'ordering section: a failed blocker query is not undetermined and stops before claiming',
  );
  const exit1 = failureText.split('\n').find((l) => l.startsWith('**Exit 1')) || '';
  assert.ok(exit1, 'Exit 1 paragraph present');
  assert.match(exit1, /--blocker-landing/, 'Exit 1 paragraph names the --blocker-landing query failure');
  assert.match(exit1, /blocker landing query failed/, 'Exit 1 paragraph names the CLI line');
}

function assertStep3PassesBlockerLanding(text) {
  const step3 = (text.match(/^3\. \*\*Pre-flight\*\*.*$/m) || [])[0] || '';
  assert.ok(step3, 'step 3 line present');
  assert.match(step3, /--merge-gate --blocker-landing --integration-branch "\$INTEGRATION_BRANCH"/, 'step 3 call passes --blocker-landing');
  assert.match(step3, /blockerLanding/, 'step 3 names the blockerLanding key');
  assert.match(step3, /or the blocker-landing query failed/, 'step 3 exit 1 includes the blocker-landing query failure');
}

function assertGhAbsentOpenStop(text) {
  const para = text.split('\n').find((l) => l.startsWith('**Blocker landing.**')) || '';
  assert.ok(para, 'Blocker landing. paragraph present');
  assert.match(para, /--blocker-states-json/, 'names --blocker-states-json');
  assert.match(para, /issue_read/, 'fetches each blocker over MCP issue_read');
  assert.match(para, /open blocker reads `open`/, 'an open blocker reads open');
  assert.match(para, /every other closed blocker `undetermined`/, 'any other closed blocker reads undetermined');
  assert.match(para, /exit 2 — a \*\*STOP before claiming\*\*/, 'a states-file problem is exit 2');
}

// A fresh mutated copy that provably differs from the live text.
function mutate(original, from, to) {
  const mutated = original.replace(from, to);
  assert.notEqual(mutated, original, `mutation matched nothing: ${String(from)}`);
  return mutated;
}

test('AC5.1: the out-of-run section names all five verdicts and their outcomes', () => {
  const text = readText(ORDERING);
  assertVerdictTable(text);
  assert.throws(() => assertVerdictTable(mutate(text, /^\| `unlanded` \|[^\n]*\n/m, '')), { message: 'unlanded row is a hard fail' });
  assert.throws(() => assertVerdictTable(mutate(text, /^\| `open` \|([^\n]*)hard fail/m, '| `open` |$1stop')), { message: 'open row is a hard fail' });
  assert.throws(() => assertVerdictTable(mutate(text, /^\| `not-applicable` \|[^\n]*\n/m, '')), { message: 'not-applicable row is satisfied' });
  assert.throws(() => assertVerdictTable(mutate(text, /--blocker-landing/g, '--blocker-lookup')), { message: 'the section names the --blocker-landing call' });
});

test('AC5.2: the unlanded card carries blocker, commit, integration branch and both escapes on their own lines', () => {
  const text = readText(ORDERING);
  assertUnlandedCard(text);
  assert.throws(() => assertUnlandedCard(mutate(text, /^git merge \{commit\}$/m, 'git merge {commit} --no-ff')), { message: 'escape 1: git merge {commit} on its own line' });
  assert.throws(() => assertUnlandedCard(mutate(text, /^gh api -X DELETE/m, 'run gh api -X DELETE')), { message: 'escape 2: gh api -X DELETE on its own line' });
  assert.throws(() => assertUnlandedCard(mutate(text, /origin\/\{integration-branch\}/g, 'the integration branch')), { message: 'card names origin/{integration-branch}' });
  assert.throws(() => assertUnlandedCard(mutate(text, /(\| `unlanded` \|[^\n]*)before Step 2\.8/, '$1before claiming')), { message: 'the unlanded row stops before Step 2.8' });
});

test('AC7.1, AC7.2: undetermined proceeds and writes one SKIP per blocker, shell-safe', () => {
  const text = readText(ORDERING);
  assertUndeterminedSkip(text);
  assert.throws(() => assertUndeterminedSkip(mutate(text, /^(\| `undetermined` \|[^\n]*)proceed/m, '$1halt')), { message: 'undetermined proceeds' });
  assert.throws(() => assertUndeterminedSkip(mutate(text, /one `SKIP` per blocker/, 'one SKIP')), { message: 'one SKIP per blocker' });
  assert.throws(() => assertUndeterminedSkip(mutate(text, /--step "Step 2 blocker landing \(undetermined\)"/, '--step "blocker landing"')), { message: 'verbatim SKIP step id' });
  assert.throws(
    () => assertUndeterminedSkip(mutate(text, /(--text "condition: )#\{blocker\}/, '$1`#{blocker}`')),
    { message: 'SKIP --text must be shell-safe: no backticks inside the double-quoted argument' },
  );
});

test('AC9.1, AC9.2: a failed blocker query is not undetermined', () => {
  const ordering = readText(ORDERING);
  const failure = readText(PREFLIGHT_FAILURE);
  assertFailedQueryIsNotUndetermined(ordering, failure);
  assert.throws(
    () => assertFailedQueryIsNotUndetermined(mutate(ordering, /failed blocker query is not `undetermined`/, 'failed blocker query is `undetermined`'), failure),
    { message: 'ordering section: a failed blocker query is not undetermined and stops before claiming' },
  );
  assert.throws(
    () => assertFailedQueryIsNotUndetermined(ordering, mutate(failure, /(\*\*Exit 1[^\n]*)blocker landing query failed/, '$1blocker lookup problem')),
    { message: 'Exit 1 paragraph names the CLI line' },
  );
  assert.throws(
    () => assertFailedQueryIsNotUndetermined(ordering, failure.split('\n').map((l) => (l.startsWith('**Exit 1') ? l.replace(/--blocker-landing/g, '--blocker-lookup') : l)).join('\n')),
    { message: 'Exit 1 paragraph names the --blocker-landing query failure' },
  );
});

test("multi-spec.md step 3's call passes --blocker-landing", () => {
  const text = readText(MULTI_SPEC);
  assertStep3PassesBlockerLanding(text);
  assert.throws(() => assertStep3PassesBlockerLanding(mutate(text, '--merge-gate --blocker-landing --integration-branch', '--merge-gate --integration-branch')), { message: 'step 3 call passes --blocker-landing' });
  assert.throws(() => assertStep3PassesBlockerLanding(mutate(text, ' with `blockerLanding` on each record', '')), { message: 'step 3 names the blockerLanding key' });
  assert.throws(() => assertStep3PassesBlockerLanding(mutate(text, 'or the blocker-landing query failed', 'or something failed')), { message: 'step 3 exit 1 includes the blocker-landing query failure' });
});

test('AC6.1, AC7.1 (gh-absent): multispec-preflight-failure.md keeps the open stop under --records-json', () => {
  const text = readText(PREFLIGHT_FAILURE);
  assertGhAbsentOpenStop(text);
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /re-run the same call with `--blocker-states-json \{file\}`[^.]*\./, '')), { message: 'names --blocker-states-json' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /`issue_read`/g, 'the MCP read')), { message: 'fetches each blocker over MCP issue_read' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /an open blocker reads `open`/, 'an open blocker proceeds')), { message: 'an open blocker reads open' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /every other closed blocker `undetermined`/, 'every other closed blocker `landed`')), { message: 'any other closed blocker reads undetermined' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /is exit 2 — a \*\*STOP before claiming\*\*/, 'is ignored')), { message: 'a states-file problem is exit 2' });
});
