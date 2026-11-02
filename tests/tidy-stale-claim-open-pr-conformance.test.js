// tests/tidy-stale-claim-open-pr-conformance.test.js
// Pins /tidy Step 4.7's stale-claim routing (record #4423): a 'stale' claim blob whose run still has an
// open PR carrying the run marker is a Yours Resume no-op naming the PR, never a Release.
// Since #4596 the paragraph calls bin/stale-claim-pr.js for the match and the Resume line instead of
// restating the marker rule and the Resume grammar, so the rule lives once, in code.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');

function read(rel) {
  return readText(path.join(REPO_ROOT, rel));
}

function findRow(text, prefix) {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

const SCAN_PROCEDURES = read('plugin/skills/tidy/scan-procedures.md');
const ACTIONS = read('plugin/skills/tidy/actions-github-issues.md');
const COLLECTION_ROUTING = read('plugin/skills/tidy/collection-routing.md');

function claimAuditSection() {
  const start = SCAN_PROCEDURES.indexOf('## Step 4.7: Audit Issue Claims');
  const end = SCAN_PROCEDURES.indexOf('### Backstops: issue-claim audit-trail integrity checks');
  assert.notEqual(start, -1, 'scan-procedures.md must carry the Step 4.7 heading');
  assert.notEqual(end, -1, 'scan-procedures.md must carry the Backstops heading');
  return SCAN_PROCEDURES.slice(start, end);
}

test('the stale-blob row offers Resume when an open PR carries the run marker (#4423)', () => {
  const row = findRow(claimAuditSection(), '| Blob classified `\'stale\'`');
  assert.ok(row, 'the stale-blob row is present');
  assert.match(row, /open PR/);
  assert.match(row, /Resume/);
});

test('AC1.2: the stale-claim paragraph calls the CLI on both transports (#4596)', () => {
  const s = claimAuditSection();
  assert.ok(s.includes('bin/stale-claim-pr.js'), 'calls the one matcher implementation');
  assert.ok(s.includes('--resume'), 'asks it for the validated Resume line');
  assert.ok(s.includes('--repo "{owner}/{repo}"'), 'passes --repo, since an origin shape parseRepo rejects is exit 3 before the gh check');
  assert.ok(s.includes('--listing'), 'hands it the MCP listing when gh is absent');
  assert.ok(s.includes('mcp__github__list_pull_requests'), 'lists open PRs through the MCP tool when gh is absent');
});

test('AC1.1: the stale-claim paragraph restates neither the marker rule nor the Resume grammar (#4596)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  for (const retired of [
    'trimmed line equal to',
    'claude-tweaks-run: {runId}',
    '^\\d{4}-\\d{2}-\\d{2}T\\d{6}-[a-z0-9][a-z0-9-]*$',
    'PIPELINE_RUN_DIR="{dir}/{runId}"',
    '`[a-z][a-z,-]*`',
    'isCrossRepository',
    'head.repo.full_name',
  ]) {
    assert.ok(!flat.includes(retired), `the paragraph must not restate ${retired} — bin/stale-claim-pr.js owns it`);
  }
});

test('a matching PR routes as the Yours Unsettled run no-op, never staged and never released (#4423)', () => {
  const s = claimAuditSection().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  assert.match(s, /`resume`/);
  assert.match(s, /`resolve`/);
  assert.ok(s.includes('Resume open PR #{number} ({url})'), 'the Resume rendering names the PR');
  assert.ok(s.includes('Resolve open PR #{number} ({url})'), 'the Resolve fallback names the PR');
  // Step 4.7's table rows already say "Manual review", so a bare match proves nothing: pin the
  // failed-listing sentence itself.
  assert.match(s, /failed listing[^.]*Manual review[^.]*never an unchecked Release/);
  assert.match(s, /1000-entry listing with no match[^.]*Manual review/);
  assert.match(s, /Manual review[^.]*any other non-zero exit/);
  assert.match(s, /\*\*Unsettled run\*\*/);
  assert.match(s, /Yours/);
  assert.match(s, /never staged/);
  assert.match(s, /never released/i);
});

test('AC1.1: the stale-claim call passes --issue {n} so a gone run dir resumes through dispatch (#4673)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  assert.ok(flat.includes('--resume --issue {n}'), 'the call hands the claim number to the CLI');
  // The dispatch literal sits in the Resume row's own sentence, not merely somewhere in the section.
  const rowAt = flat.indexOf('Resume open PR #{number} ({url}) — {resume}');
  assert.notEqual(rowAt, -1, 'the Resume row is present');
  const archivedAt = flat.indexOf('absent or archived', rowAt);
  assert.notEqual(archivedAt, -1, 'the Resume row names the absent-or-archived condition');
  const sentence = flat.slice(rowAt, archivedAt);
  assert.ok(sentence.includes('`/claude-tweaks:dispatch resume #{n}`'), 'names the dispatch-resume command in the Resume row sentence');
  assert.ok(sentence.includes('`record-{n}`'), 'the dispatch line is for a dispatched run');
  assert.ok(!sentence.includes('. '), 'the slice stays inside one sentence');
});

test('AC2.1: a present run dir still renders the PR body\'s resume line (#4673)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  assert.ok(flat.includes('Resume open PR #{number} ({url}) — {resume}'), 'the Resume row keeps its rendering');
  assert.ok(flat.includes('the PR body\'s resume line'), 'the PR body stays the resume source for a present run dir');
});

test('the Collect line carries the PR number and resume command for a Resume recommendation (#4423)', () => {
  const s = claimAuditSection();
  const collect = '→ Collect each as: `[claim] claims/issue-{n}.json — {status} — {recommendation}`';
  const at = s.indexOf(collect);
  assert.notEqual(at, -1, 'Step 4.7 keeps its Collect line');
  assert.match(s.slice(at + collect.length), /^\s*A Resume recommendation[^\n]*PR #\{number\}/);
});

test('the Release claim executor never receives an open-PR stale row (#4423)', () => {
  const start = ACTIONS.indexOf('## Release claim');
  const end = ACTIONS.indexOf('## Sync to GitHub');
  assert.ok(start !== -1 && end > start, 'actions-github-issues.md carries both headings');
  const s = ACTIONS.slice(start, end);
  assert.match(s, /open marked PR/);
  assert.match(s, /never a Release row/);
});

// #4849: a stale-claim Release (and a matched Resume row) states the open linked PR's disposition,
// taken from bin/dispatch-resume.js's verdict. The section is addressed to the Issue Claims agent,
// which gets issue-claims-backstops.md inlined whole, so it carries the whole rule.
const BACKSTOPS = read('plugin/skills/tidy/issue-claims-backstops.md');
const STEP6 = read('plugin/skills/tidy/step-6-auto.md');
const DISPOSITION_PREFIX = '### Open linked PR on a stale-claim Release';
const DISPOSITION_HEADING = `${DISPOSITION_PREFIX} (#4849)`;

function dispositionSection(text) {
  const start = text.indexOf(DISPOSITION_PREFIX);
  const end = text.indexOf('### Backstop: missed `parked` restoration');
  if (start === -1) return '';
  assert.ok(end > start, 'the disposition section sits before the first Backstop heading');
  return text.slice(start, end);
}

// One entry per fact the section must state; a string is an exact literal, a RegExp a window claim.
const DISPOSITION_FACTS = [
  { name: 'section', pin: DISPOSITION_HEADING, strip: ' (#4849)' },
  { name: 'runs the verdict', pin: 'bin/dispatch-resume.js" --issue {n}' },
  { name: 'resume disposition', pin: 'PR #{prNumber}: resume — /claude-tweaks:dispatch resume #{n}' },
  { name: 'no-pr appends nothing', pin: 'exit 3 with reason `no-pr`, append nothing' },
  { name: 'refused disposition', pin: 'PR #{number}: {disposition} — {remedy}' },
  { name: 'several PRs on one line', pin: '(ascending, on one line: several PRs render `PR #{a}, #{b}: {disposition} — {remedy}`)' },
  { name: 'disposition vocabulary', pin: '`disposition` (`resume`, `close-out` or `close`)' },
  { name: 'lands in the finding', pin: "end of the `[claim]` row's `{recommendation}`" },
  { name: 'a failed read is stated', pin: /exit 2 or 4[^.]*open linked PR unknown \(dispatch-resume exit \{code\}\)/ },
  { name: 'gh-absent transport citation', pin: '`_shared/github-write-transport.md`' },
  { name: 'matched row is scoped to the dispatch form', pin: 'runs the verdict only when the printed `resume` is `/claude-tweaks:dispatch resume #{n}`' },
  { name: 'a PR body resume line stands', pin: "a PR body's own resume line stands, with no verdict run" },
  { name: 'matched row exit 0 keeps the command', pin: 'exit 0 keeps the printed command' },
  { name: 'dispatch form runs the same command', pin: 'For the dispatch form, run the same command' },
  { name: 'matched row no-pr resolves', pin: 'on exit 3 with reason `no-pr` render `Resolve open PR #{number} ({url}) before any release` instead' },
  { name: 'matched row replaced rendering', pin: 'any other exit 3 renders `{disposition}: dispatch-resume {n}` in place of the Resume rendering (the verdict CLI, `dispatch-resume.js --issue {n}`, prints the steps)' },
  { name: 'intro scopes the matched rows to the dispatch form', pin: 'for each one `stale-claim-pr.js` matched with the dispatch-resume command printed as `resume`' },
  { name: 'matched row failed read keeps the command', pin: 'on exit 2 or 4 it keeps the command and appends the same unknown note' },
  { name: 'matched row stays never staged', pin: 'That row stays never staged and its claim never released' },
  { name: 'stale claim reads resumable', pin: 'the same as the `swept: stale claim` tombstone the Release writes' },
];

function missingDispositionFacts(text) {
  const flat = dispositionSection(text).replace(/\s+/g, ' ');
  return DISPOSITION_FACTS.filter(({ pin }) => (typeof pin === 'string' ? !flat.includes(pin) : !pin.test(flat))).map((f) => f.name);
}

// Strips exactly one fact from the section (the heading fact drops only its issue suffix, so the section is still found).
function stripFact(text, fact) {
  const section = dispositionSection(text);
  const flatSection = section.replace(/\s+/g, ' ');
  const stripped = flatSection.replace(fact.strip || fact.pin, '');
  const start = text.indexOf(DISPOSITION_PREFIX);
  return text.slice(0, start) + stripped + text.slice(start + section.length);
}

test('AC4.1: the stale-claim finding names a PR disposition when an open linked PR exists (#4849)', () => {
  assert.ok(dispositionSection(BACKSTOPS).length > 0, 'the section exists in issue-claims-backstops.md');
  assert.deepEqual(missingDispositionFacts(BACKSTOPS), []);
});

for (const fact of DISPOSITION_FACTS) {
  test(`AC4.1 control: dropping "${fact.name}" goes red on exactly that fact (#4849)`, () => {
    const mutated = stripFact(BACKSTOPS, fact);
    assert.notEqual(mutated, BACKSTOPS, 'the strip matched something');
    assert.deepEqual(missingDispositionFacts(mutated), [fact.name]);
  });
}

// A rewrite of a guard condition, not a deletion: each `from` sits inside its fact's pinned phrase and is
// unique at its first occurrence in the section, so replacing it changes exactly that fact's string.
const DISPOSITION_REWRITES = [
  { fact: 'matched row no-pr resolves', from: 'exit 3 with reason `no-pr` render', to: 'exit 3 with reason refused render' },
  { fact: 'matched row no-pr resolves', from: 'on exit 3 with reason `no-pr` render', to: 'render' },
  { fact: 'matched row replaced rendering', from: 'any other exit 3 renders', to: 'exit 3 renders' },
  { fact: 'matched row replaced rendering', from: 'any other exit 3 renders', to: 'exit 0 renders' },
  { fact: 'matched row replaced rendering', from: '`{disposition}: dispatch-resume {n}`', to: '`PR #{number}: {disposition} — dispatch-resume.js --issue {n} prints the steps`' },
  { fact: 'dispatch form runs the same command', from: 'For the dispatch form, run', to: 'For either form, run' },
  { fact: 'intro scopes the matched rows to the dispatch form', from: 'the dispatch-resume command printed as `resume`', to: 'a printed resume command' },
  { fact: 'matched row exit 0 keeps the command', from: 'exit 0 keeps the printed command', to: 'exit 3 keeps the printed command' },
  { fact: 'matched row failed read keeps the command', from: 'it keeps the command and appends', to: 'it drops the command and appends' },
];

for (const { fact, from, to } of DISPOSITION_REWRITES) {
  test(`AC4.1 control: rewriting "${from}" to "${to}" reports exactly "${fact}" (#4849)`, () => {
    const section = dispositionSection(BACKSTOPS);
    const flatSection = section.replace(/\s+/g, ' ');
    assert.ok(flatSection.includes(from), 'the rewrite target is in the section');
    const mutated = BACKSTOPS.replace(section, flatSection.replace(from, to));
    assert.notEqual(mutated, BACKSTOPS);
    assert.deepEqual(missingDispositionFacts(mutated), [fact]);
  });
}

test('AC4.1 control: a section-less file reports every fact missing (#4849)', () => {
  assert.deepEqual(missingDispositionFacts(BACKSTOPS.replace(DISPOSITION_HEADING, '### Something else')), DISPOSITION_FACTS.map((f) => f.name));
});

const HANDOFF = "means Release plus `issue-claims-backstops.md`'s PR disposition.";
const OLD_HANDOFF = 'means plain Release.';

function handoffProblems(flat) {
  const problems = [];
  if (!flat.includes(HANDOFF)) problems.push('hand-off');
  if (flat.includes(OLD_HANDOFF)) problems.push('old sentence');
  return problems;
}

test('AC4.1: the plain-Release sentence hands to the disposition section (#4849)', () => {
  assert.deepEqual(handoffProblems(claimAuditSection().replace(/\s+/g, ' ')), []);
});

test('AC4.1 control: dropping the hand-off sentence reports only the hand-off (#4849)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' ');
  const mutated = flat.replace(HANDOFF, '');
  assert.notEqual(mutated, flat);
  assert.deepEqual(handoffProblems(mutated), ['hand-off']);
});

test('AC4.1 control: the old plain-Release sentence alone is reported as the old sentence (#4849)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' ');
  const mutated = `${flat} ${OLD_HANDOFF}`;
  assert.notEqual(mutated, flat);
  assert.deepEqual(handoffProblems(mutated), ['old sentence']);
});

// A staged claim-releases row's action states the disposition in a short form so the Approve item passes
// the Width gate; the whole remedy runs about 360 characters, past the 100-character gate on one `command`
// line. The four forms are the rulings of the #4849 fix round.
const STAGED_FACTS = [
  { name: 'one-PR action', pin: "`claim-releases` row's `action` reads `Release claim; PR #{number} disposition: {disposition}` for one open PR" },
  { name: 'several-PR action', pin: '`Release claim; {k} open PRs, disposition: {disposition}` for several (no `#` refs)' },
  { name: 'unknown-PR action', pin: '`Release claim; open linked PR unknown (dispatch-resume exit {code})` after exit 2 or 4' },
  { name: 'no-pr action', pin: 'and the plain release action for `no-pr`' },
  { name: 'remedy stays off command', pin: "The full remedy stays in the finding's `{recommendation}` and in the staged `.md` body, never in `command`, which stays the release mutation" },
];
const STAGED_REWRITES = [
  { fact: 'remedy stays off command', from: 'never in `command`', to: 'also in `command`' },
  { fact: 'remedy stays off command', from: ' and in the staged `.md` body', to: '' },
  { fact: 'remedy stays off command', from: 'which stays the release mutation', to: 'which carries the remedy' },
  { fact: 'one-PR action', from: 'for one open PR', to: 'for several open PRs' },
  { fact: 'one-PR action', from: 'disposition: {disposition}` for one', to: 'disposition: {remedy}` for one' },
  { fact: 'several-PR action', from: 'for several (no `#` refs)', to: 'for several (with `#` refs)' },
  { fact: 'unknown-PR action', from: 'after exit 2 or 4', to: 'after exit 3' },
  { fact: 'no-pr action', from: 'for `no-pr`', to: 'for `close`' },
];
const STAGED_BANNED = /`claim-releases`[^.]*verbatim/;

function stagedProblems(flat) {
  const problems = STAGED_FACTS.filter(({ pin }) => !flat.includes(pin)).map((f) => f.name);
  if (STAGED_BANNED.test(flat)) problems.push('verbatim');
  return problems;
}

test('AC4.1: a staged claim-releases row states its disposition in short form and keeps the remedy off command (#4849)', () => {
  assert.deepEqual(stagedProblems(STEP6.replace(/\s+/g, ' ')), []);
});

for (const fact of STAGED_FACTS) {
  test(`AC4.1 control: step-6-auto without "${fact.name}" reports exactly that fact (#4849)`, () => {
    const flat = STEP6.replace(/\s+/g, ' ');
    const mutated = flat.replace(fact.pin, '');
    assert.notEqual(mutated, flat);
    assert.deepEqual(stagedProblems(mutated), [fact.name]);
  });
}

for (const { fact, from, to } of STAGED_REWRITES) {
  test(`AC4.1 control: step-6-auto rewriting "${from}" to "${to}" reports exactly "${fact}" (#4849)`, () => {
    const flat = STEP6.replace(/\s+/g, ' ');
    assert.ok(flat.includes(from), 'the rewrite target is in step-6-auto.md');
    const mutated = flat.replace(from, to);
    assert.notEqual(mutated, flat);
    assert.deepEqual(stagedProblems(mutated), [fact]);
  });
}

test('AC4.1 control: a claim-releases action that carries the disposition verbatim is reported (#4849)', () => {
  const flat = STEP6.replace(/\s+/g, ' ');
  const mutated = `${flat} A \`claim-releases\` row's \`action\` carries the PR disposition verbatim.`;
  assert.deepEqual(stagedProblems(mutated), ['verbatim']);
});

// [\s\S] not [^.]: the sentence names `release-claim.js`, whose dot would end a [^.]* window.
const EXECUTOR_PIN = /PR disposition[\s\S]{0,160}`release-claim\.js` never closes or touches the PR/;

function releaseClaimSection() {
  const start = ACTIONS.indexOf('## Release claim');
  const end = ACTIONS.indexOf('## Sync to GitHub');
  assert.ok(start !== -1 && end > start, 'actions-github-issues.md carries both headings');
  return ACTIONS.slice(start, end);
}

test('the Release claim executor leaves the PR alone (#4849)', () => {
  assert.match(releaseClaimSection().replace(/\s+/g, ' '), EXECUTOR_PIN);
});

test('control: the Release claim section without the executor sentence fails the pin (#4849)', () => {
  const flat = releaseClaimSection().replace(/\s+/g, ' ');
  const mutated = flat.replace(EXECUTOR_PIN, '');
  assert.notEqual(mutated, flat);
  assert.doesNotMatch(mutated, EXECUTOR_PIN);
});

test('collection-routing routes a [claim] Resume/Resolve outcome to Yours and supersedes [unsettled] (#4423)', () => {
  const row = findRow(COLLECTION_ROUTING, '| `[backlog]`, `[parked]`');
  assert.ok(row, 'the Approve routing row is present');
  assert.match(row, /`\[claim\]` Resume\/Resolve outcome/);
  assert.match(row, /lands in \*\*Yours \(\{N\}\)\*\* as an Auto no-op, never staged/);
  assert.match(row, /supersedes an `\[unsettled\]` row for the same `#\{n\}`/);
});
