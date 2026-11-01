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
const verdictRow = (section, verdict) => section.split('\n').find((l) => l.startsWith(`| \`${verdict}\` |`)) || '';

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
  // The stop message is the card text before its first "# Escape" heading line; the
  // escape commands also carry #{blocker}, {commit} and the branch, so searching the
  // whole card would pass even if the message itself dropped them.
  const lines = card.split('\n');
  const firstHeading = lines.findIndex((l) => /^# Escape/.test(l));
  assert.ok(firstHeading > 0, 'card has a message before its first escape heading');
  const message = lines.slice(0, firstHeading).join('\n');
  assert.match(message, /#\{blocker\}/, 'card message names the blocker');
  assert.match(message, /\{commit\}/, 'card message names the closing commit');
  assert.match(message, /origin\/\{integration-branch\}/, 'card message names origin/{integration-branch}');
  assert.ok(lines.includes('git fetch origin {integration-branch} {commit}'), 'escape 1: git fetch origin {integration-branch} {commit} on its own line');
  assert.ok(lines.includes('git merge --ff-only origin/{integration-branch}'), 'escape 1: git merge --ff-only origin/{integration-branch} on its own line');
  assert.ok(lines.includes('git merge {commit}'), 'escape 1: git merge {commit} on its own line');
  assert.ok(lines.some((l) => l.startsWith('gh api -X DELETE')), 'escape 2: gh api -X DELETE on its own line');
  assert.ok(lines.some((l) => l.startsWith('gh issue view {n} --json body') && l.includes('{blocker}') && l.endsWith('gh issue edit {n} --body-file -')), 'escape 2 (body-text): a one-line rewrite of the body without the Blocked by line');
  const cherry = lines.indexOf(CHERRY_COMMENT);
  assert.ok(cherry !== -1, 'escape 1 carries the cherry-pick-only comment line');
  const esc1 = lines.findIndex((l) => l.startsWith('# Escape 1'));
  const esc2 = lines.findIndex((l) => l.startsWith('# Escape 2'));
  assert.ok(esc1 !== -1 && esc1 < cherry && cherry < esc2, 'the cherry-pick comment sits under escape 1, before escape 2');
  assert.match(section, /cherry-picked landing reads `unlanded`/, 'cherry-pick caveat present');
}
const CHERRY_COMMENT = "# To land only the fix (not the commit's whole history), cherry-pick it, then take escape 2";

// The `{text-file}` holder sentence: from its opening words to the first sentence-ending period.
function holderSentence(section) {
  const at = section.indexOf('`{text-file}` holds one line');
  if (at === -1) return '';
  const rest = section.slice(at);
  const end = rest.search(/\.(?=\s|$)/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

function assertUndeterminedSkip(text) {
  const section = outOfRunSection(text);
  assert.match(verdictRow(section, 'undetermined'), /proceed/, 'undetermined proceeds');
  assert.match(section, /one `SKIP` per blocker/, 'one SKIP per blocker');
  const skipLine = section.split('\n').find((l) => l.includes('bin/log-decision.js'));
  assert.ok(skipLine, 'SKIP command line present');
  assert.match(skipLine, /--status SKIP --step "Step 2 blocker landing \(undetermined\)"/, 'verbatim SKIP step id');
  // The text interpolates the git-derived {integration-branch}, so it travels via --text-file
  // (_shared/auto-decision-log.md's "Text from git or a user"), never a quoted --text.
  assert.ok(skipLine.includes('--text-file "{text-file}"'), 'SKIP passes its text via --text-file "{text-file}"');
  assert.doesNotMatch(skipLine, /--text\s+["']/, 'SKIP must not pass a quoted --text');
  const holder = section.match(/`\{text-file\}` holds one line, `([^`\n]+)`/);
  assert.ok(holder, 'text-file holder line present: `{text-file}` holds one line, `…`');
  assert.ok(
    holder[1] === 'condition: #{blocker} blocker landing undetermined (via {via}) → fallback: proceeded without confirming its closing commit reached origin/{integration-branch}',
    'text-file line carries the condition and fallback wording',
  );
  assert.match(holderSentence(section), /written per `_shared\/auto-decision-log\.md`'s Text from git or a user paragraph/, 'cites auto-decision-log.md\'s "Text from git or a user" paragraph');
  assert.match(section, /write the file, log it, then rewrite it for the next blocker/, 'one text file, rewritten for each next blocker');
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
  assert.match(step3, /never a second invocation \(the gh-absent `--blocker-states-json` re-run aside[;)]/, 'step 3 qualifies "never a second invocation" with the gh-absent re-run');
  assert.match(step3, /on a resume whose step list has neither `build` nor `test`[^)]*leave `--blocker-landing` off/, 'step 3 drops --blocker-landing on a resume whose build already ran');
}

function assertGhAbsentOpenStop(text) {
  const para = text.split('\n').find((l) => l.startsWith('**Blocker landing.**')) || '';
  assert.ok(para, 'Blocker landing. paragraph present');
  assert.match(para, /--blocker-states-json/, 'names --blocker-states-json');
  assert.match(para, /issue_read/, 'fetches each blocker over MCP issue_read');
  assert.match(para, /open blocker reads `open`/, 'an open blocker reads open');
  assert.match(para, /every other closed blocker `undetermined`/, 'any other closed blocker reads undetermined');
  assert.match(para, /`issue_read` cannot fetch[^.]*is a \*\*STOP before claiming\*\* that names it/, 'an unfetchable blocker is a STOP naming it');
  assert.match(para, /exit 2 — a \*\*STOP before claiming\*\*/, 'a states-file problem is exit 2');
  assert.match(
    para,
    /The transports differ here on purpose: on the `gh` path an unresolvable blocker reads `undetermined`\/`not-found` and proceeds with a `SKIP`, but the states file cannot express not-found, so on this path it is a STOP\./,
    'records the deliberate gh / gh-absent difference for an unresolvable blocker',
  );
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
  assert.throws(() => assertVerdictTable(mutate(text, /^\| `landed` \|[^\n]*\n/m, '')), { message: 'landed row is satisfied' });
  assert.throws(() => assertVerdictTable(mutate(text, /^\| `not-applicable` \|[^\n]*\n/m, '')), { message: 'not-applicable row is satisfied' });
  assert.throws(() => assertVerdictTable(mutate(text, /--blocker-landing/g, '--blocker-lookup')), { message: 'the section names the --blocker-landing call' });
});

test('AC5.2: the unlanded card carries blocker, commit, integration branch and both escapes on their own lines', () => {
  const text = readText(ORDERING);
  assertUnlandedCard(text);
  assert.throws(() => assertUnlandedCard(mutate(text, /^git merge \{commit\}$/m, 'git merge {commit} --no-ff')), { message: 'escape 1: git merge {commit} on its own line' });
  assert.throws(() => assertUnlandedCard(mutate(text, /^gh api -X DELETE/m, 'run gh api -X DELETE')), { message: 'escape 2: gh api -X DELETE on its own line' });
  assert.throws(() => assertUnlandedCard(mutate(text, /^gh issue view \{n\} --json body.*$/m, 'gh issue edit {n}')), { message: 'escape 2 (body-text): a one-line rewrite of the body without the Blocked by line' });
  assert.throws(() => assertUnlandedCard(mutate(text, /origin\/\{integration-branch\}/g, 'the integration branch')), { message: 'card message names origin/{integration-branch}' });
  // Message-line deletions: the escape lines below still carry each token, so only a
  // message-scoped assertion can see these go missing.
  assert.throws(() => assertUnlandedCard(mutate(text, / by #\{blocker\}, which/, ' by it, which')), { message: 'card message names the blocker' });
  assert.throws(() => assertUnlandedCard(mutate(text, /closing commit \{commit\}/, 'closing commit')), { message: 'card message names the closing commit' });
  assert.throws(() => assertUnlandedCard(mutate(text, /is not on origin\/\{integration-branch\}\./, 'is not on the integration branch.')), { message: 'card message names origin/{integration-branch}' });
  assert.throws(() => assertUnlandedCard(mutate(text, /^git fetch origin \{integration-branch\} \{commit\}$/m, 'git fetch origin {integration-branch}')), { message: 'escape 1: git fetch origin {integration-branch} {commit} on its own line' });
  assert.throws(() => assertUnlandedCard(mutate(text, /^git merge --ff-only origin\/\{integration-branch\}\n/m, '')), { message: 'escape 1: git merge --ff-only origin/{integration-branch} on its own line' });
  assert.throws(() => assertUnlandedCard(mutate(text, /cherry-picked landing reads `unlanded`/, 'cherry-picked landing reads `landed`')), { message: 'cherry-pick caveat present' });
  assert.throws(() => assertUnlandedCard(mutate(text, /(\| `unlanded` \|[^\n]*)before Step 2\.8/, '$1before claiming')), { message: 'the unlanded row stops before Step 2.8' });
  // No "# Escape" heading line left: the message/escape split point is gone.
  assert.throws(() => assertUnlandedCard(mutate(text, /^# Escape[^\n]*\n/gm, '')), { message: 'card has a message before its first escape heading' });
  // The cherry-pick-only comment: deleted, then moved below escape 2's heading (permutation).
  const withoutCherry = mutate(text, `${CHERRY_COMMENT}\n`, '');
  assert.throws(() => assertUnlandedCard(withoutCherry), { message: 'escape 1 carries the cherry-pick-only comment line' });
  assert.throws(
    () => assertUnlandedCard(mutate(withoutCherry, /^(# Escape 2[^\n]*\n)/m, (line) => `${line}${CHERRY_COMMENT}\n`)),
    { message: 'the cherry-pick comment sits under escape 1, before escape 2' },
  );
});

test('AC7.1, AC7.2: undetermined proceeds and writes one SKIP per blocker, shell-safe', () => {
  const text = readText(ORDERING);
  assertUndeterminedSkip(text);
  assert.throws(() => assertUndeterminedSkip(mutate(text, /^(\| `undetermined` \|[^\n]*)proceed/m, '$1halt')), { message: 'undetermined proceeds' });
  assert.throws(() => assertUndeterminedSkip(mutate(text, /one `SKIP` per blocker/, 'one SKIP')), { message: 'one SKIP per blocker' });
  assert.throws(() => assertUndeterminedSkip(mutate(text, /--step "Step 2 blocker landing \(undetermined\)"/, '--step "blocker landing"')), { message: 'verbatim SKIP step id' });
  assert.throws(() => assertUndeterminedSkip(mutate(text, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/log-decision\.js"[^\n]*\n/m, '')), { message: 'SKIP command line present' });
  // Revert to the interpolated quoted form: no --text-file on the line.
  assert.throws(
    () => assertUndeterminedSkip(mutate(text, / --text-file "\{text-file\}"(?=\n```\n\n`\{text-file\}` holds one line, `condition: #\{blocker\})/, ' --text "condition: #{blocker} undetermined"')),
    { message: 'SKIP passes its text via --text-file "{text-file}"' },
  );
  // Keep --text-file but add a quoted --text beside it.
  assert.throws(
    () => assertUndeterminedSkip(mutate(text, /(--reversibility n\/a --text-file "\{text-file\}")(?=\n```\n\n`\{text-file\}` holds one line, `condition: #\{blocker\})/, '$1 --text "x"')),
    { message: 'SKIP must not pass a quoted --text' },
  );
  assert.throws(
    () => assertUndeterminedSkip(mutate(text, /`\{text-file\}` holds one line, `condition: #\{blocker\}/, '`{text-file}` holds the text: condition: #{blocker}')),
    { message: 'text-file holder line present: `{text-file}` holds one line, `…`' },
  );
  assert.throws(
    () => assertUndeterminedSkip(mutate(text, /proceeded without confirming its closing commit reached origin\/\{integration-branch\}`/, 'proceeded`')),
    { message: 'text-file line carries the condition and fallback wording' },
  );
  assert.throws(
    () => assertUndeterminedSkip(mutate(text, /Text from git or a user paragraph/, 'logging paragraph')),
    { message: 'cites auto-decision-log.md\'s "Text from git or a user" paragraph' },
  );
  // The citation moved, lowercase text intact, out of the holder sentence into a
  // sentence of its own: a whole-section pin still matches it, so only the
  // sentence-scoped pin can see the move.
  const CITATION = "written per `_shared/auto-decision-log.md`'s Text from git or a user paragraph";
  const moved = mutate(text, /(`\{text-file\}` holds one line, [^\n]*?), written per `_shared\/auto-decision-log\.md`'s Text from git or a user paragraph([^\n]*?shell quoting\.)/,
    (_, head, tail) => `${head}${tail} It is ${CITATION}.`);
  assert.ok(outOfRunSection(moved).includes(CITATION), 'the moved copy still carries the lowercase citation');
  assert.ok(!holderSentence(outOfRunSection(moved)).includes(CITATION), 'the moved copy holds the citation outside the holder sentence');
  assert.throws(() => assertUndeterminedSkip(moved), { message: 'cites auto-decision-log.md\'s "Text from git or a user" paragraph' });
  assert.throws(
    () => assertUndeterminedSkip(mutate(text, /write the file, log it, then rewrite it for the next blocker/, 'one file per blocker')),
    { message: 'one text file, rewritten for each next blocker' },
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
    () => assertFailedQueryIsNotUndetermined(ordering, mutate(failure, /^\*\*Exit 1[^\n]*$/m, (line) => line.replace(/--blocker-landing/g, '--blocker-lookup'))),
    { message: 'Exit 1 paragraph names the --blocker-landing query failure' },
  );
});

test("multi-spec.md step 3's call passes --blocker-landing", () => {
  const text = readText(MULTI_SPEC);
  assertStep3PassesBlockerLanding(text);
  assert.throws(() => assertStep3PassesBlockerLanding(mutate(text, '--merge-gate --blocker-landing --integration-branch', '--merge-gate --integration-branch')), { message: 'step 3 call passes --blocker-landing' });
  assert.throws(() => assertStep3PassesBlockerLanding(mutate(text, ' with `blockerLanding` on each record', '')), { message: 'step 3 names the blockerLanding key' });
  assert.throws(() => assertStep3PassesBlockerLanding(mutate(text, 'or the blocker-landing query failed', 'or something failed')), { message: 'step 3 exit 1 includes the blocker-landing query failure' });
  assert.throws(() => assertStep3PassesBlockerLanding(mutate(text, / \(the gh-absent `--blocker-states-json` re-run aside[^)]*\)/, '')), { message: 'step 3 qualifies "never a second invocation" with the gh-absent re-run' });
  assert.throws(() => assertStep3PassesBlockerLanding(mutate(text, '; on a resume whose step list has neither `build` nor `test`, the build has run, so leave `--blocker-landing` off, as `validation.md`\'s 2.7b skips', '')), { message: 'step 3 drops --blocker-landing on a resume whose build already ran' });
});

test('AC6.1, AC7.1 (gh-absent): multispec-preflight-failure.md keeps the open stop under --records-json', () => {
  const text = readText(PREFLIGHT_FAILURE);
  assertGhAbsentOpenStop(text);
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /re-run the same call with `--blocker-states-json \{file\}`[^.]*\./, '')), { message: 'names --blocker-states-json' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /`issue_read`/g, 'the MCP read')), { message: 'fetches each blocker over MCP issue_read' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /an open blocker reads `open`/, 'an open blocker proceeds')), { message: 'an open blocker reads open' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /every other closed blocker `undetermined`/, 'every other closed blocker `landed`')), { message: 'any other closed blocker reads undetermined' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /is a \*\*STOP before claiming\*\* that names it/, 'is skipped')), { message: 'an unfetchable blocker is a STOP naming it' });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, /is exit 2 — a \*\*STOP before claiming\*\*/, 'is ignored')), { message: 'a states-file problem is exit 2' });
  const TRANSPORT_MSG = 'records the deliberate gh / gh-absent difference for an unresolvable blocker';
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, 'reads `undetermined`/`not-found` and proceeds with a `SKIP`', 'reads `open`')), { message: TRANSPORT_MSG });
  assert.throws(() => assertGhAbsentOpenStop(mutate(text, 'the states file cannot express not-found', 'the MCP read is slower')), { message: TRANSPORT_MSG });
});

// ---- Task 5: the single-record substep 2.7b (validation.md, SKILL.md, express-entry.md) ----
const SKILL_MD = path.join(FLOW_DIR, 'SKILL.md');
const VALIDATION = path.join(FLOW_DIR, 'validation.md');
const EXPRESS_ENTRY = path.join(FLOW_DIR, 'express-entry.md');

const SEC_HEADING = '## 2.7b — Blocker landing (single-record)';

// Every marker must exist before positions are compared: indexOf's -1 is below every
// real position, so a reworded marker would otherwise leave the pin green.
function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `marker missing: ${marker}`);
    assert.ok(idx > last, `${marker} must come after the previous marker`);
    last = idx;
  }
}

// 2.7b runs from its heading to the next `## ` heading, or EOF.
const bounds27b = (text) => {
  const at = text.indexOf(SEC_HEADING);
  assert.notStrictEqual(at, -1, `marker missing: ${SEC_HEADING}`);
  const next = text.indexOf('\n## ', at + SEC_HEADING.length);
  return [at, next === -1 ? text.length : next];
};
const section27b = (text) => {
  const [at, end] = bounds27b(text);
  return text.slice(at, end);
};
// mutate(), acting inside the 2.7b section only.
const mutate27b = (text, from, to) => {
  const [at, end] = bounds27b(text);
  return text.slice(0, at) + mutate(text.slice(at, end), from, to) + text.slice(end);
};
const assertFacts = (haystack, facts) => {
  for (const f of facts) assert.match(haystack, f.re, f.msg);
};
const skillBullet = (text) => text.split('\n').find((l) => l.startsWith('- 2.7b —')) || '';

test('AC6.1: SKILL.md lists 2.7b after 2.7 and before 2.8', () => {
  const text = readText(SKILL_MD);
  const order = ['- 2.7 —', '- 2.7b —', '- 2.8 —'];
  requireOrder(text, order);
  // Permutation, not deletion: the bullet moves below the whole 2.8 bullet (down to the 2.9 bullet).
  const bullet = skillBullet(text);
  const without = mutate(text, `${bullet}\n`, '');
  const permuted = mutate(without, '- 2.9 —', `${bullet}\n- 2.9 —`);
  assert.throws(() => requireOrder(permuted, order), /must come after/);
  assert.throws(() => requireOrder(without, order), /marker missing: - 2\.7b —/);
  // Step 2's count word and detailed-procedure pointer track the list; each pin proves itself on a mutated copy.
  const COUNT_MSG = "Step 2's count word is five checks, after the dispatch-capability preflight";
  const POINTER_MSG = 'Step 2 points at 2.5-2.7b for the detailed procedure';
  const assertCount = (t) => assert.match(t, /\nA dispatch-capability preflight, five checks, then a route, before pipeline starts\./, COUNT_MSG);
  const assertPointer = (t) => assert.match(t, /for 2\.5-2\.7b's detailed procedure/, POINTER_MSG);
  assertCount(text);
  assertPointer(text);
  assert.throws(() => assertCount(mutate(text, 'five checks, then a route', 'four checks, then a route')), { message: COUNT_MSG });
  assert.throws(() => assertPointer(mutate(text, "for 2.5-2.7b's detailed procedure", "for 2.5-2.7's detailed procedure")), { message: POINTER_MSG });
  // The bullet mirrors Step 2.8's skip list: an unresolved topic name, or a step list with neither build nor test.
  const TOPIC_MSG = 'SKILL.md 2.7b bullet skips on an unresolved topic name';
  const assertTopic = (t) => assert.match(skillBullet(t), /`work-backend: local-files`, an unresolved topic name, or/, TOPIC_MSG);
  assertTopic(text);
  assert.throws(() => assertTopic(mutate(text, ', an unresolved topic name, or', ', or')), { message: TOPIC_MSG });
  const STEPS_MSG = 'SKILL.md 2.7b bullet skips on a step list with neither build nor test';
  const assertSteps = (t) => assert.match(skillBullet(t), /, or a step list with neither `build` nor `test`:/, STEPS_MSG);
  assertSteps(text);
  assert.throws(() => assertSteps(mutate(text, /(- 2\.7b —[^\n]*), or a step list with neither `build` nor `test`:/, '$1:')), { message: STEPS_MSG });
  // Keyed to the invocation, not the record count left after the merge-state gate.
  const INVOKED_MSG = 'SKILL.md 2.7b bullet is keyed to a run invoked with one record';
  const assertInvoked = (t) => assert.match(skillBullet(t), /^- 2\.7b — Blocker landing, if invoked with one record;/, INVOKED_MSG);
  assertInvoked(text);
  assert.throws(() => assertInvoked(mutate(text, 'Blocker landing, if invoked with one record;', 'Blocker landing. Single record target only;')), { message: INVOKED_MSG });
});

const RUN_FACTS = [
  { re: /preflight-records\.js" \{n\} --blocker-landing --integration-branch "\$INTEGRATION_BRANCH"/, msg: '2.7b runs the --blocker-landing call with $INTEGRATION_BRANCH', from: ' --blocker-landing --integration-branch "$INTEGRATION_BRANCH"', to: ' --integration-branch "$INTEGRATION_BRANCH"' },
  { re: /BLOCKED[^\n]*before Step 2\.8 claims/, msg: '2.7b stops before Step 2.8 claims', from: / before Step 2\.8 claims/, to: ' before the build' },
  { re: /`open` or `unlanded` is BLOCKED — a STOP before Step 2\.8 claims/, msg: '2.7b: open and unlanded are both BLOCKED before Step 2.8 claims', from: '`open` or `unlanded` is BLOCKED', to: '`open` proceeds; `unlanded` is BLOCKED' },
  { re: /`undetermined` proceeds/, msg: '2.7b: undetermined proceeds', from: '`undetermined` proceeds', to: '`undetermined` is BLOCKED too' },
  { re: /`undetermined` proceeds, holding that file's per-blocker `SKIP`/, msg: '2.7b: undetermined holds the per-blocker SKIP', from: ", holding that file's per-blocker `SKIP`", to: '' },
  { re: /`multispec-dependency-ordering\.md`'s out-of-run verdict table/, msg: '2.7b applies the out-of-run verdict table', from: "`multispec-dependency-ordering.md`'s out-of-run verdict table", to: 'the verdict table' },
  { re: /`_shared\/integration-branch\.md`/, msg: '2.7b resolves $INTEGRATION_BRANCH per _shared/integration-branch.md', from: ' per `_shared/integration-branch.md`', to: '' },
  { re: /This substep covers a run invoked with one record target only;/, msg: '2.7b is keyed to a run invoked with one record target', from: 'a run invoked with one record target only', to: 'a single record target only' },
  { re: /even one the merge-state gate splits down to a single record —[^\n]*never runs 2\.7b/, msg: 'a run the merge-state gate splits down to one record never runs 2.7b', from: ' — even one the merge-state gate splits down to a single record —', to: '' },
];
function assertRunsAndStops(text) {
  requireOrder(text, ['## 2.7 —', SEC_HEADING]);
  assert.match(text, /^Run substeps 2\.5, 2\.6, 2\.7, and 2\.7b in order\./m, 'line 5 names 2.7b');
  assertFacts(section27b(text), RUN_FACTS);
}
test("AC6.1: validation.md's 2.7b runs the landing call and stops before Step 2.8", () => {
  const text = readText(VALIDATION);
  assertRunsAndStops(text);
  for (const f of RUN_FACTS) assert.throws(() => assertRunsAndStops(mutate27b(text, f.from, f.to)), { message: f.msg });
  assert.throws(() => assertRunsAndStops(mutate(text, 'Run substeps 2.5, 2.6, 2.7, and 2.7b in order.', 'Run substeps 2.5, 2.6, and 2.7 in order.')), { message: 'line 5 names 2.7b' });
  assert.throws(() => assertRunsAndStops(mutate(text, SEC_HEADING, '## 2.7c — Blocker landing (single-record)')), /marker missing/);
  // Bounded section: a fact that survives only under a later `## ` heading does not count.
  const later = `${mutate27b(text, '`undetermined` proceeds', '`undetermined` is BLOCKED too')}\n## 2.7c — Later\n\n\`undetermined\` proceeds\n`;
  assert.throws(() => assertRunsAndStops(later), { message: '2.7b: undetermined proceeds' });
});

const GATE_FACTS = [
  { re: /`bodyBlockedBy: \[\]`, the substep is a no-op/, msg: 'body-text with bodyBlockedBy: [] is a no-op', from: ', the substep is a no-op', to: ', the substep runs' },
  { re: /Under `native` the call always runs/, msg: 'native always makes the call', from: 'Under `native` the call always runs', to: 'Under `native` the call may run' },
  { re: /`blockerLanding: \[\]` → no-op/, msg: 'blockerLanding: [] is a no-op', from: ' → no-op', to: ' → stop' },
  { re: /out-of-run verdict table to every entry of `records\["\{n\}"\]\.blockerLanding`, whether or not that flag is set/, msg: 'the verdict table still applies when nativeLinksUnchecked is set', from: ', whether or not that flag is set', to: '' },
  { re: /nativeLinksUnchecked: true`[^\n]*hold one `SKIP` — it is never "no blockers":\n[\s\S]*?\n {3}Then apply/, msg: 'the nativeLinksUnchecked SKIP is held, then the table is applied (not an Otherwise)', from: '\n   Then apply', to: '\n   Otherwise apply' },
  { re: /Read `work-links`/, msg: 'the substep reads work-links', from: 'Read `work-links`', to: 'Read the links policy' },
];
function assertGate(text) { assertFacts(section27b(text), GATE_FACTS); }
test('AC11.1, AC11.2, AC6.2: the call is skipped only under body-text with bodyBlockedBy: [], and native is a no-op on blockerLanding: []', () => {
  const text = readText(VALIDATION);
  assertGate(text);
  for (const f of GATE_FACTS) assert.throws(() => assertGate(mutate27b(text, f.from, f.to)), { message: f.msg });
});

const EXIT_FACTS = [
  { re: /`multispec-preflight-failure\.md`'s Exit 1 and Exit 2 paragraphs/, msg: 'a non-zero exit is handled per Exit 1 and Exit 2', from: "`multispec-preflight-failure.md`'s Exit 1 and Exit 2 paragraphs", to: 'the failure paragraphs' },
  { re: /re-run once on exit 1[^\n]*STOP before claiming[^\n]*quoting stderr/, msg: 'exit 1 re-runs once then stops before claiming, quoting stderr', from: 'quoting stderr', to: 'quietly' },
  { re: /exit 2 is a STOP at once/, msg: 'exit 2 stops at once', from: 'exit 2 is a STOP at once', to: 'exit 2 is retried' },
  { re: /never read as "no blockers"/, msg: 'a non-zero exit is never read as "no blockers"', from: 'never read as "no blockers"', to: 'treated as clean' },
  { re: /Decide on the exit code and the `preflight-records\.js:` line/, msg: 'the verdict rests on the exit code and the prefixed line, not on stderr being one line', from: 'Decide on the exit code and the `preflight-records.js:` line', to: 'Decide on stderr' },
  { re: /so never assume stderr is one line or empty/, msg: 'stderr is never assumed to be one line or empty', from: ', so never assume stderr is one line or empty', to: '' },
];
function assertExit(text) { assertFacts(section27b(text), EXIT_FACTS); }
test('AC9.1: a non-zero 2.7b exit stops before claiming and is never "no blockers"', () => {
  const text = readText(VALIDATION);
  assertExit(text);
  for (const f of EXIT_FACTS) assert.throws(() => assertExit(mutate27b(text, f.from, f.to)), { message: f.msg });
});

const PLAN_REVIEW_FACTS = [
  { re: /neither `build` nor `test`/, msg: '2.7b skips on a step list with neither build nor test', from: 'neither `build` nor `test`', to: 'no steps' },
  { re: /An unresolved topic name \(no record number\)/, msg: '2.7b skips on an unresolved topic name', from: 'An unresolved topic name (no record number), or a', to: 'A' },
  { re: /`nativeLinksUnchecked: true`[^\n]*it is never "no blockers"/, msg: 'nativeLinksUnchecked: true is never "no blockers"', from: ' — it is never "no blockers"', to: '' },
  { re: /Write the held `SKIP`s, exactly once\./, msg: 'the held SKIPs are written exactly once', from: ', exactly once', to: '' },
  { re: /and not again if an express-escalated run continues at Step 3/, msg: 'an express-escalated run does not write the SKIPs again at Step 3', from: ', and not again if an express-escalated run continues at Step 3', to: '' },
  { re: /Under `interactive` mode no Manifesto runs \(`mode-table\.md`\), so `decisions\.md` never legitimately carries more than Step 2\.8's claim lines/, msg: 'under interactive no Manifesto runs, so decisions.md carries only the claim lines', from: 'Under `interactive` mode no Manifesto runs', to: 'Under `confirm` mode the Manifesto runs' },
  { re: /; 2\.7b writes none and instead states each `undetermined` verdict, and the native-links-unread note, in the conversation, one line each/, msg: 'under interactive 2.7b states each verdict and the native-links note in the conversation', from: ', in the conversation, one line each', to: '' },
  { re: /`express-entry\.md`'s Bind step/, msg: 'SKIPs on the express route are written after express-entry.md Bind step', from: "`express-entry.md`'s Bind step", to: 'the express route' },
  { re: /right after Step 3's Manifesto write or adoption/, msg: 'SKIPs are written right after Step 3', from: "right after Step 3's Manifesto write or adoption", to: 'right away' },
  { re: /never before[^\n]*Step 2\.8's claim lines/, msg: 'SKIPs are never written before Step 3 (adoption tolerates only claim lines)', from: /never before[^\n]*claim lines in `decisions\.md`/, to: 'at any time' },
];
function assertPlanReview(valText, expText) {
  assertFacts(section27b(valText), PLAN_REVIEW_FACTS);
  assert.match(expText, /`validation\.md`'s 2\.7b/, 'express-entry.md Bind step names 2.7b');
  assert.match(expText, /2\.7b held — once: Step 3 does not write them again on escalation/, 'express-entry.md Bind step writes the SKIPs once, not again at Step 3');
  // Every held SKIP, the native-links-unchecked one included — not only the per-blocker ones.
  assert.match(expText, /then write any `SKIP` lines `validation\.md`'s 2\.7b held/, 'express-entry.md Bind step writes every SKIP 2.7b held');
}
test('plan-review: 2.7b skips on a step list with neither build nor test, writes its SKIPs after Step 3 or after express Bind, and treats nativeLinksUnchecked as never "no blockers"', () => {
  const val = readText(VALIDATION);
  const exp = readText(EXPRESS_ENTRY);
  assertPlanReview(val, exp);
  for (const f of PLAN_REVIEW_FACTS) assert.throws(() => assertPlanReview(mutate27b(val, f.from, f.to), exp), { message: f.msg });
  assert.throws(() => assertPlanReview(val, mutate(exp, "`validation.md`'s 2.7b", '`validation.md`')), { message: 'express-entry.md Bind step names 2.7b' });
  assert.throws(() => assertPlanReview(val, mutate(exp, ' — once: Step 3 does not write them again on escalation', '')), { message: 'express-entry.md Bind step writes the SKIPs once, not again at Step 3' });
  assert.throws(() => assertPlanReview(val, mutate(exp, 'write any `SKIP` lines', 'write any per-blocker `SKIP` lines')), { message: 'express-entry.md Bind step writes every SKIP 2.7b held' });
  // The sentence sits in the Bind step (step 2 of the Express path), before step 3's Procedure.
  const BIND_ORDER = ['2. **Bind.**', "`validation.md`'s 2.7b", '3. **Procedure.**'];
  requireOrder(exp, BIND_ORDER);
  const misplaced = mutate(mutate(exp, "`validation.md`'s 2.7b", '`validation.md`'), '3. **Procedure.**', "3. **Procedure.** `validation.md`'s 2.7b");
  assert.throws(() => requireOrder(misplaced, BIND_ORDER), /must come after/);
});

test('AC12.1: under work-backend: local-files 2.7b is skipped entirely, ahead of the work-links read', () => {
  const text = readText(VALIDATION);
  const sec = section27b(text);
  const LOCAL = { re: /work-backend: local-files`\*\* — skip the substep entirely[^\n]*no `preflight-records\.js` call and no log line/, msg: 'local-files skip: no preflight-records.js call and no log line' };
  const WORK_LINKS_READ = 'resolve-policy.js" --values work-links';
  assertFacts(sec, [LOCAL]);
  requireOrder(sec, ['work-backend: local-files', WORK_LINKS_READ]);
  assert.throws(() => assertFacts(section27b(mutate27b(text, ' and no log line', '')), [LOCAL]), { message: LOCAL.msg });
  // Deletion control: the whole local-files step gone -> the existence half throws.
  const step1 = sec.match(/^1\. [^\n]*\n/m)[0];
  assert.ok(step1.includes('work-backend: local-files'), 'step 1 is the local-files step');
  const deleted = mutate27b(text, step1, '');
  assert.throws(() => requireOrder(section27b(deleted), ['work-backend: local-files', WORK_LINKS_READ]), /marker missing: work-backend: local-files/);
  // Permutation control: the same step moved below the work-links read.
  const moved = mutate27b(deleted, '4. **Call.**', `${step1}4. **Call.**`);
  assert.throws(() => requireOrder(section27b(moved), ['work-backend: local-files', WORK_LINKS_READ]), /must come after/);
  // The SKILL.md bullet names the skip.
  const skill = readText(SKILL_MD);
  const BULLET_MSG = 'SKILL.md 2.7b bullet names work-backend: local-files';
  assert.match(skillBullet(skill), /work-backend: local-files/, BULLET_MSG);
  assert.throws(() => assert.match(skillBullet(mutate(skill, 'skipped under `work-backend: local-files`', 'skipped under some backends')), /work-backend: local-files/, BULLET_MSG), { message: BULLET_MSG });
});

test('2.7b checks run in the stated order: local-files, step list, work-links read, bodyBlockedBy, call, exit, nativeLinksUnchecked, verdict table, SKIP timing', () => {
  const sec = section27b(readText(VALIDATION));
  const CHAIN = [
    'work-backend: local-files',
    'An unresolved topic name',
    'neither `build` nor `test`',
    'resolve-policy.js" --values work-links',
    '`bodyBlockedBy: []`',
    'preflight-records.js" {n} --blocker-landing',
    'Exit 1 and Exit 2',
    '`nativeLinksUnchecked: true`',
    'multispec-dependency-ordering.md',
    'after Step 3',
  ];
  requireOrder(sec, CHAIN);
  // One permutation per adjacent pair: swap neighbouring numbered steps.
  const blocks = sec.split(/^(?=\d\. \*\*)/m);
  assert.equal(blocks.length, 8, 'intro plus seven numbered steps');
  for (let i = 1; i < 7; i++) {
    const swapped = blocks.slice();
    [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    const permuted = swapped.join('');
    assert.notEqual(permuted, sec, `swap ${i}/${i + 1} changed nothing`);
    assert.throws(() => requireOrder(permuted, CHAIN), /must come after/, `swapping steps ${i} and ${i + 1} must go red`);
  }
});
