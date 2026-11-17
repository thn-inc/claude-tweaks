// tests/review-tiebreak-step-conformance.test.js — pins #3947: /review's mandatory tiebreak step
// (plugin/skills/review/step3-tiebreak.md, wired as Step 3.7 in code-mode-steps.md). Every pin carries a
// go-red proof built from the live text (missingFactsOf + assertEveryMatchGoesRed, from tests/helpers/conformance-asserts.js).
// Later tasks of #3947 append here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, assertEveryMatchGoesRed, globalOf, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');
const { buildFindingsArtifact, resolveTiebreak, checkTiebreakCoverage, findingId, CHUNK_MAX, judgeTier, planChunks } = require('../plugin/bin/lib/tiebreak');
const { formatEntry } = require('../plugin/bin/lib/log-decision/append');
const { coincidence } = require('../plugin/bin/lib/reproduction-log');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
const { categoriseReproduction, findingsMatch, LINE_TOLERANCE_REPRODUCTION_WIDE } = require('../plugin/bin/lib/coordination');
const { DEFER_REASONS } = require('../plugin/bin/lib/issues/record');
const { resolveAll } = require('../plugin/bin/lib/console/resolve');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const TIEBREAK = path.join(SKILLS, 'review', 'step3-tiebreak.md');
const CODE_MODE_STEPS = path.join(SKILLS, 'review', 'code-mode-steps.md');

// The opposite predicate for retired wording: the facts whose pattern the text still matches.
const leftoverFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => pattern.test(text)).map(([, fact]) => fact);

// A section-scoped fact list: [pick(texts), pattern, fact]. The go-red proof strips the pattern from the picked
// region only, then runs the same predicate over the doctored texts.
function sectionFactsMissing(facts) {
  return (texts) => facts.filter(([pick, pattern]) => !pattern.test(pick(texts))).map(([, , fact]) => fact);
}
function assertEachSectionFactGoesRed(texts, facts, missingOf) {
  for (const [pick, pattern, fact] of facts) {
    const region = pick(texts);
    const doctoredRegion = region.replace(globalOf(pattern), '');
    assert.notEqual(doctoredRegion, region, `anchor text for "${fact}" not found — proof cannot discriminate`);
    const doctored = Object.fromEntries(Object.entries(texts).map(([key, text]) => [key, text.replace(region, () => doctoredRegion)]));
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

// The text from `startMarker` up to the next `nextMarker` (or the end of the text); '' when `startMarker` is absent.
function sliceSection(text, startMarker, nextMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const next = text.indexOf(nextMarker, start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

// The text from a start anchor up to the next end anchor (the end anchor is excluded).
function between(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor);
  assert.notEqual(start, -1, `step3-debate-and-refutation.md lost its "${startAnchor}" anchor`);
  const end = text.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(end, -1, `step3-debate-and-refutation.md lost its "${endAnchor}" anchor after "${startAnchor}"`);
  return text.slice(start, end);
}

// The first fenced block of a section: the dispatch template.
function fencedTemplate(section) {
  const found = section.match(/```[a-z]*\n([\s\S]*?)\n```/);
  assert.ok(found, 'the section holds no fenced template block');
  return found[1];
}

const tiebreakText = () => readText(TIEBREAK);

// --- AC1.1: every tier and mode is named ---

const TIERS_AND_MODES = [
  ...['low', 'medium', 'high', 'xhigh', 'max'].map((tier) => [new RegExp('`' + tier + '`'), `the step names the \`${tier}\` effort tier`]),
  ...['auto', 'confirm', 'hybrid', 'interactive'].map((mode) => [new RegExp('`' + mode + '`'), `the step names the \`${mode}\` mode`]),
  [/standalone/i, 'the step names the standalone case'],
  [/dispatched/i, 'the step names the dispatched case'],
];
const tiersAndModesMissing = missingFactsOf(TIERS_AND_MODES);

test('AC1.1 the step names every effort tier and mode', () => {
  assert.deepEqual(tiersAndModesMissing(tiebreakText()), [], 'step3-tiebreak.md must name every tier, every mode, standalone and dispatched');
});

test('AC1.1 the tier and mode assertion can go red', () => {
  assertEveryMatchGoesRed(tiebreakText(), TIERS_AND_MODES, tiersAndModesMissing);
});

// --- AC1.2: placement cites every earlier pass, in order ---

const PLACEMENT_ORDER = [
  [/`step3-lens-dispatch\.md`[^\n]*absence-claim/, 'the reproduction categorisation and absence-claim check (step3-lens-dispatch.md)'],
  [/vacuity/, 'the lens 3f vacuity downgrade'],
  [/`step3-cross-lens-corroboration\.md`/, 'cross-lens corroboration'],
  [/`step3-debate-and-refutation\.md`[^\n]*Step 3\.5/, 'the Step 3.5 debate and refutation (step3-debate-and-refutation.md)'],
  [/Step 3\.6/, 'the Step 3.6 gap sweep'],
];

// Facts missing or out of strictly increasing index order, in the order the entries are listed.
function orderProblems(section, entries) {
  const problems = [];
  let previous = -1;
  for (const [pattern, fact] of entries) {
    const found = pattern.exec(section);
    if (!found) { problems.push(`missing: ${fact}`); continue; }
    if (found.index <= previous) problems.push(`out of order: ${fact}`);
    previous = found.index;
  }
  return problems;
}

test('AC1.2 placement cites every earlier pass in order', () => {
  const placement = sectionOf(tiebreakText(), '## Placement');
  assert.deepEqual(orderProblems(placement, PLACEMENT_ORDER), [], '## Placement must cite the five earlier passes in order');
});

test('AC1.2 the order assertion can go red', () => {
  const placement = sectionOf(tiebreakText(), '## Placement');
  const swapped = [PLACEMENT_ORDER[2], PLACEMENT_ORDER[1], ...PLACEMENT_ORDER.slice(3), PLACEMENT_ORDER[0]];
  assert.notDeepEqual(orderProblems(placement, swapped), [], 'a swapped order must fail the order check');
  const withoutLast = placement.replace(/Step 3\.6/g, '');
  assert.notEqual(withoutLast, placement, 'anchor text for the Step 3.6 citation not found — proof cannot discriminate');
  assert.deepEqual(orderProblems(withoutLast, PLACEMENT_ORDER), ['missing: the Step 3.6 gap sweep'], 'removing the last citation must report exactly it');
});

// --- AC1.3: entry status ---

const ENTRY_STATUS = [
  [/nearLocation/, 'the entry status names the nearLocation pair'],
  [/each [^\n]*judged on its own/, 'each side of a nearLocation pair is judged on its own'],
];
const entryStatusMissing = missingFactsOf(ENTRY_STATUS);

test('AC1.3 entry status includes both sides of a nearLocation pair', () => {
  assert.deepEqual(entryStatusMissing(sectionOf(tiebreakText(), '## Placement')), [], '## Placement must state both sides of a nearLocation pair enter, each judged on its own');
});

test('AC1.3 the entry-status assertion can go red', () => {
  assertEveryMatchGoesRed(sectionOf(tiebreakText(), '## Placement'), ENTRY_STATUS, entryStatusMissing);
});

// --- AC2.1 / AC2.2 / AC12.1: the dispatch prompt ---

// The reply format the tiebreak template and the Per-Candidate Refutation template both ask for.
const REPLY_FORMAT = [
  [/Verdict: confirmed \| refuted \| cant-tell/, 'the Verdict reply line'],
  [/Evidence: \{path\}:\{line\}/, 'the Evidence reply line'],
  [/whole (cited )?source line/, 'the evidence quote is the whole cited source line'],
  [/Severity: critical \| high \| medium \| low \| info/, 'the Severity reply line'],
  [/Recommendation: file \| drop/, 'the Recommendation reply line'],
  [/the last non-empty line of your reply must then read exactly one of: DONE \/ DONE_WITH_CONCERNS \/ NEEDS_CONTEXT \/ BLOCKED, labeled `STATUS: \{WORD\}`/, 'the trailing STATUS instruction'],
];

const DISPATCH_TEMPLATE = [
  [/\[Use: \{Capable \| Standard\}/, 'the model profile line is [Use: {Capable | Standard}'],
  ...REPLY_FORMAT,
  [/\[\.\.\. READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section \.\.\.\]/, 'the READ-ONLY REVIEW placeholder line'],
  [/SCRATCH: \{ctx-dir\}\/agent-scratch\/\{agent-id\}/, 'the SCRATCH line'],
  [/- \{one-line claim\} \(\{severity\}\)/, 'the contested positions line shape'],
];
const dispatchTemplateMissing = missingFactsOf(DISPATCH_TEMPLATE);

test('AC2.1 the dispatch prompt satisfies the subagent contract', () => {
  const template = fencedTemplate(sectionOf(tiebreakText(), '## Dispatch'));
  assert.deepEqual(dispatchTemplateMissing(template), [], 'the fenced dispatch template must carry every contract element');
});

test('AC2.1 the dispatch template assertions can go red', () => {
  assertEveryMatchGoesRed(fencedTemplate(sectionOf(tiebreakText(), '## Dispatch')), DISPATCH_TEMPLATE, dispatchTemplateMissing);
});

// Minor 11 (#3950, ruling R18 moved into the template): a bare filename or another file in Evidence fails
// the resolver's path check and files a refuted finding, so the judge cites the Location path as given.
const EVIDENCE_PATH = [
  [/cite the Location path exactly as given \(the full repo-relative path, never a bare filename or another file\)/, 'the Evidence instruction cites the Location path exactly as given'],
];
const evidencePathMissing = missingFactsOf(EVIDENCE_PATH);

test("minor 11: the tiebreak template tells the judge to cite the Location path exactly as given", () => {
  const template = fencedTemplate(sectionOf(tiebreakText(), '## Dispatch'));
  assert.deepEqual(evidencePathMissing(template), []);
  assert.doesNotMatch(template, /the finding's own path/, 'the retired wording is gone');
});

test('minor 11 the evidence-path assertion can go red', () => {
  assertEveryMatchGoesRed(fencedTemplate(sectionOf(tiebreakText(), '## Dispatch')), EVIDENCE_PATH, evidencePathMissing);
});

const hasFrontier = (text) => /Frontier/.test(text);

test('AC2.2 no Frontier in the tiebreak fan-out', () => {
  const dispatch = sectionOf(tiebreakText(), '## Dispatch');
  assert.ok(!hasFrontier(dispatch), '## Dispatch must not name the Frontier profile — a variable-N fan-out is Capable only');
});

test('AC2.2 the Frontier assertion can go red', () => {
  const dispatch = sectionOf(tiebreakText(), '## Dispatch');
  assert.ok(hasFrontier(`${dispatch}\n[Use: Frontier]`), 'an injected Frontier profile must turn the check red');
});

// Lines of the template before its "Reply with" line: the allowlist the agent receives.
function inputLinesOf(template) {
  const lines = template.split('\n');
  const reply = lines.findIndex((line) => line.startsWith('Reply with'));
  assert.notEqual(reply, -1, 'the dispatch template lost its "Reply with" line');
  return lines.slice(0, reply);
}
const labelsOf = (lines) => lines.filter((line) => /^[A-Z][A-Za-z ]*:/.test(line)).map((line) => line.match(/^[A-Z][A-Za-z ]*:/)[0]);
const ALLOWLIST_LABELS = ['Finding:', 'Severity:', 'Location:', 'Diff scope:', 'Positions:'];
const leaksReporterContent = (lines) => lines.some((line) => /evidence|reasoning/i.test(line));

test('AC12.1 the prompt input is exactly the allowlist', () => {
  const input = inputLinesOf(fencedTemplate(sectionOf(tiebreakText(), '## Dispatch')));
  assert.deepEqual(labelsOf(input), ALLOWLIST_LABELS, 'the input block must carry exactly the allowlisted field labels');
  assert.ok(!leaksReporterContent(input), 'the input block must not mention evidence or reasoning');
});

test('AC12.1 the allowlist assertions can go red', () => {
  const input = inputLinesOf(fencedTemplate(sectionOf(tiebreakText(), '## Dispatch')));
  assert.notDeepEqual(labelsOf([...input, 'Evidence: {the reporting agent\'s quote}']), ALLOWLIST_LABELS, 'an extra input label must turn the field-list check red');
  assert.notDeepEqual(labelsOf(input.filter((line) => !line.startsWith('Diff scope:'))), ALLOWLIST_LABELS, 'a dropped input label must turn the field-list check red');
  assert.ok(leaksReporterContent([...input, 'Reasoning: {the lens agent\'s reasoning}']), 'reasoning text in the input must turn the leak check red');
});

const WAVE = [[/waves of \*{0,2}8\b/, 'the fan-out runs in parallel waves of 8']];
const waveMissing = missingFactsOf(WAVE);

test('Review Focus: the fan-out is bounded to waves of 8', () => {
  assert.deepEqual(waveMissing(sectionOf(tiebreakText(), '## Dispatch')), [], '## Dispatch must name its wave size');
});

test('Review Focus: the wave-size assertion can go red', () => {
  assertEveryMatchGoesRed(sectionOf(tiebreakText(), '## Dispatch'), WAVE, waveMissing);
});

const EMPTY_REPLY = [[/empty reply/, 'a failed dispatch is passed as an empty reply']];
const emptyReplyMissing = missingFactsOf(EMPTY_REPLY);

test('Review Focus: an unusable dispatch still produces a verdict line', () => {
  assert.deepEqual(emptyReplyMissing(sectionOf(tiebreakText(), '## Resolve and act')), [], '## Resolve and act must pass a failed dispatch as an empty reply');
});

test('Review Focus: the empty-reply assertion can go red', () => {
  assertEveryMatchGoesRed(sectionOf(tiebreakText(), '## Resolve and act'), EMPTY_REPLY, emptyReplyMissing);
});

// --- Fix round 1: logText never rides a shell argument; digest/console are pipeline-run only; the artifact-failure line surfaces ---

const LOG_TEXT_FILE = [
  [/--text-file "\{path-T\}"/, 'the log call passes logText through --text-file'],
  [/T=review-\{ctx-id\}-tiebreak-\{n\}-text\.txt/, 'the text file is a session-tmp path resolved with the finding and reply paths'],
  [/` Mode: inline\.` appended to the content of `T` \(never to a shell argument\)/, 'Mode: inline. is appended to the text file content'],
];
const logTextFileMissing = missingFactsOf(LOG_TEXT_FILE);
const passesTextOnCommandLine = (text) => /--text "/.test(text);

test('logText goes through --text-file, never a shell argument', () => {
  const resolveAndAct = sectionOf(tiebreakText(), '## Resolve and act');
  assert.deepEqual(logTextFileMissing(resolveAndAct), [], '## Resolve and act must log through --text-file');
  assert.ok(!passesTextOnCommandLine(resolveAndAct), 'no --text "..." argument: a verbatim source line can carry quotes, $() and backticks');
});

test('the --text-file assertions can go red', () => {
  const resolveAndAct = sectionOf(tiebreakText(), '## Resolve and act');
  assertEveryMatchGoesRed(resolveAndAct, LOG_TEXT_FILE, logTextFileMissing);
  assert.ok(passesTextOnCommandLine(resolveAndAct.replace('--text-file "{path-T}"', '--text "{logText}"')), 'reverting to --text must turn the check red');
});

// The fact, not the wording: each bullet's own parenthetical says pipeline-run only and points at ## Standalone review.
const PIPELINE_ONLY = [
  [/- `digest` \([^)\n]*pipeline run only[^)\n]*`## Standalone review`[^)\n]*\)/, 'the digest action is qualified as pipeline-run only'],
  [/- `console` \([^)\n]*pipeline run only[^)\n]*`## Standalone review`[^)\n]*\)/, 'the console action is qualified as pipeline-run only'],
];
const pipelineOnlyMissing = missingFactsOf(PIPELINE_ONLY);

test('the digest and console actions are pipeline-run only', () => {
  assert.deepEqual(pipelineOnlyMissing(sectionOf(tiebreakText(), '## Resolve and act')), [], 'both bullets must point a standalone review at ## Standalone review');
});

test('the pipeline-only qualifiers can go red', () => {
  assertEveryMatchGoesRed(sectionOf(tiebreakText(), '## Resolve and act'), PIPELINE_ONLY, pipelineOnlyMissing);
});

const ARTIFACT_FAILURE = [
  [/findings artifact not written \(\{exit\}\); \{N\} findings stay unconfirmed with no tiebreak verdict\./, 'the failure line says the findings stay unconfirmed (so the Review Console surfaces it)'],
  [/lists under the Review Console's Low-confidence section/, 'the failure line lists under the Low-confidence section'],
  [/this line is the only signal/, 'with no artifact this line is the only signal'],
];
const artifactFailureMissing = missingFactsOf(ARTIFACT_FAILURE);
const claimsRunHeldOpen = (section) => /holds the run open/.test(section);
const artifactFailureLine = (section) => documentedTemplate(section, ['findings artifact not written']);

test('the findings-artifact failure line surfaces at the console and states its consequence', () => {
  const section = sectionOf(tiebreakText(), '## Findings artifact');
  assert.deepEqual(artifactFailureMissing(section), [], '## Findings artifact must log a line the console surfaces');
  assert.ok(!claimsRunHeldOpen(section), 'the archive gate does not hold the run open on an absent artifact');
  // Run the real console/resolve.js matcher over the documented line.
  assert.equal(consoleLowItems(`${instantiate(artifactFailureLine(section))}\n`).length, 1, 'the failure line must surface as a Low-confidence item');
});

test('the findings-artifact failure assertions can go red', () => {
  const section = sectionOf(tiebreakText(), '## Findings artifact');
  assertEveryMatchGoesRed(section, ARTIFACT_FAILURE, artifactFailureMissing);
  assert.ok(claimsRunHeldOpen(`${section}\nThe archive gate holds the run open.`), 'a planted "holds the run open" must turn the check red');
  const pending = artifactFailureLine(section).replace('stay unconfirmed', 'stay pending');
  assert.equal(consoleLowItems(`${instantiate(pending)}\n`).length, 0, 'a line without the unconfirmed keyword must not surface');
});

// --- AC7.1: standalone ---

const STANDALONE = [
  [/medium or higher/, "can't-tell findings of medium or higher are listed"],
  [/recommendation/, "the tiebreak's recommendation is listed with them"],
  [/nothing is staged/, 'nothing is staged'],
  [/no `review-findings\.json`/, 'no review-findings.json is written'],
];
const standaloneMissing = missingFactsOf(STANDALONE);

test("AC7.1 standalone lists can't-tell >= medium with the recommendation and stages nothing", () => {
  assert.deepEqual(standaloneMissing(sectionOf(tiebreakText(), '## Standalone review')), [], '## Standalone review must state the listing and the no-staging rule');
});

test('AC7.1 the standalone assertions can go red', () => {
  assertEveryMatchGoesRed(sectionOf(tiebreakText(), '## Standalone review'), STANDALONE, standaloneMissing);
});

// --- AC8.1: dispatched reviewer ---

const DISPATCHED = [
  [/nested-children rule/, 'the nested-children rule is the dispatch mechanism'],
  [/Mode: inline\./, 'an inline verdict is marked Mode: inline.'],
  [/before [^\n]*Review Console resolves/, 'verdict lines exist before the Review Console resolves'],
  [/never [^\n]*can't-tell [^\n]*every finding|marking every finding can't-tell is not/, "marking every finding can't-tell is not a fallback"],
];
const dispatchedMissing = missingFactsOf(DISPATCHED);

test('AC8.1 dispatched reviewer states the mechanism, the ladder and the invariant', () => {
  const dispatched = sectionOf(tiebreakText(), '## Dispatched reviewer');
  assert.deepEqual(dispatchedMissing(dispatched), [], '## Dispatched reviewer must state the mechanism, the fallback ladder and the invariant');
  assert.ok(!/skip dispatch/i.test(dispatched), 'the dispatched-reviewer text must not carry a skip-dispatch carve-out (#3078)');
});

test('AC8.1 the dispatched-reviewer assertions can go red', () => {
  const dispatched = sectionOf(tiebreakText(), '## Dispatched reviewer');
  assertEveryMatchGoesRed(dispatched, DISPATCHED, dispatchedMissing);
  assert.ok(/skip dispatch/i.test(`${dispatched}\nskip dispatch and judge directly`), 'an injected carve-out must turn the check red');
});

// --- AC3.1: one verdict line per listed finding (fixture built from the real helpers) ---

const FIXTURE_PATH = 'plugin/bin/foo.js';
const fixtureLines = Array.from({ length: 40 }, (_, i) => `  const value${i + 1} = compute(${i + 1}); // fixture line ${i + 1}`);
const readFixture = (p) => {
  if (p !== FIXTURE_PATH) throw new Error(`unexpected read: ${p}`);
  return `${fixtureLines.join('\n')}\n`;
};
const NOW = new Date(2026, 9, 22, 12, 0, 0);

function renderVerdictLine(resolved) {
  return formatEntry({ status: resolved.logStatus, now: NOW, step: resolved.logStep, text: resolved.logText, reversibility: 'high' });
}

// Removes its tmp dir through the test context's after hook, registered before any write, so a throw anywhere
// after the mkdtemp — here or in the test body — never leaks it.
function buildFixtureRun(t) {
  const findings = [
    { lens: '3c', path: FIXTURE_PATH, line: 20, claim: 'the guard on line 20 swallows the error', reporterSeverity: 'medium', kind: 'unconfirmed' },
    { lens: '3c', path: FIXTURE_PATH, line: 21, claim: 'the retry on line 21 never backs off', reporterSeverity: 'low', kind: 'unconfirmed' },
  ];
  const artifact = buildFindingsArtifact(findings);
  const confirmedReply = [
    'Verdict: confirmed',
    `Evidence: ${FIXTURE_PATH}:20 \`${fixtureLines[19].trim()}\``,
    'Severity: medium',
    'Recommendation: file — the guard drops the error',
    'STATUS: DONE',
  ].join('\n');
  const first = resolveTiebreak(findings[0], confirmedReply, { readFile: readFixture, now: NOW });
  const second = resolveTiebreak(findings[1], '', { readFile: readFixture, now: NOW });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiebreak-step-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'review-findings.json'), JSON.stringify(artifact));
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${[renderVerdictLine(first), renderVerdictLine(second)].join('\n')}\n`);
  return { dir, artifact, first, second };
}

test('AC3.1 fixture: one verdict line per listed finding — two findings at one location (adjacent lines) each get their own', (t) => {
  const { dir, artifact, first, second } = buildFixtureRun(t);
  assert.equal(artifact.length, 2);
  assert.notEqual(artifact[0].id, artifact[1].id, 'two findings at adjacent lines carry two distinct ids');
  assert.equal(artifact[0].id, findingId({ lens: '3c', path: FIXTURE_PATH, line: 20, claim: 'the guard on line 20 swallows the error' }));
  assert.equal(first.outcome, 'confirmed');
  assert.ok(['digest', 'console'].includes(second.outcome), `an empty reply is can't-tell (digest or console), got ${second.outcome}`);
  assert.notEqual(second.outcome, 'drop', 'an empty reply never drops a finding');
  assert.deepEqual(checkTiebreakCoverage(dir).missing, [], 'every listed finding has a verdict line');
  const decisions = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8').split('\n').filter(Boolean);
  for (const { id } of artifact) {
    assert.equal(decisions.filter((line) => line.includes(`tiebreak:${id}`)).length, 1, `finding ${id} appears in exactly one verdict line`);
  }
});

test('AC3.1 the coverage assertion can go red', (t) => {
  const { dir, artifact } = buildFixtureRun(t);
  const decisionsPath = path.join(dir, 'decisions.md');
  const kept = fs.readFileSync(decisionsPath, 'utf8').split('\n').filter((line) => line && !line.includes(`tiebreak:${artifact[1].id}`));
  assert.equal(kept.length, 1, 'anchor line for the second finding not found — proof cannot discriminate');
  fs.writeFileSync(decisionsPath, `${kept.join('\n')}\n`);
  assert.deepEqual(checkTiebreakCoverage(dir).missing, [artifact[1].id], 'dropping one verdict line must report exactly that finding missing');
});

// --- code-mode-steps.md wiring ---

const STEP37_HEADING = '### Step 3.7: Tiebreak (every tier)';
const ROUTING_HEADING = '### Step 3 Routing — Code Review Findings';
const BYPASS = 'bypass Step 3 Routing — they route directly to the Wrap-Up Console';

function wiringProblems(text) {
  const problems = [];
  const step37 = text.indexOf(STEP37_HEADING);
  const routing = text.indexOf(ROUTING_HEADING);
  if (step37 === -1) problems.push('the Step 3.7 heading is missing');
  if (routing === -1) problems.push('the Step 3 Routing heading is missing');
  if (step37 !== -1 && routing !== -1 && step37 > routing) problems.push('the Step 3.7 heading comes after Step 3 Routing');
  if (!text.includes('step3-tiebreak.md')) problems.push('step3-tiebreak.md is not named');
  if (text.includes(BYPASS)) problems.push('the old bypass sentence is still present');
  return problems;
}

test('code-mode-steps wiring: Step 3.7 precedes Step 3 Routing, names the step file, drops the bypass', () => {
  assert.deepEqual(wiringProblems(readText(CODE_MODE_STEPS)), []);
});

test('code-mode-steps wiring assertions can go red', () => {
  const text = readText(CODE_MODE_STEPS);
  assert.deepEqual(wiringProblems(`${text}\n${BYPASS}`), ['the old bypass sentence is still present']);
  assert.ok(wiringProblems(text.replace(STEP37_HEADING, '### Step 3.7: other')).includes('the Step 3.7 heading is missing'));
  assert.ok(wiringProblems(text.replaceAll('step3-tiebreak.md', 'step3-other.md')).includes('step3-tiebreak.md is not named'));
  const routingFirst = text.replace(STEP37_HEADING, '').replace(ROUTING_HEADING, `${ROUTING_HEADING}\n\n${STEP37_HEADING}`);
  assert.ok(wiringProblems(routingFirst).includes('the Step 3.7 heading comes after Step 3 Routing'));
});

// --- step3-lens-dispatch.md: the low tier routes through the tiebreak; the Direct-verification override is retired ---

const STEP3 = path.join(SKILLS, 'review', 'step3-lens-dispatch.md');
// #4826: the low-tier and partner-died paragraphs moved to step3-tier-variants.md.
const TIER_VARIANTS = path.join(SKILLS, 'review', 'step3-tier-variants.md');

const lowTierParagraph = (text) => lineStartingWith(text, '**Low-tier single-read dispatch (`low` only).**');
const overrideParagraph = (text) => lineStartingWith(text, '> **Direct-verification override.**');

// AC4.1: the low tier hands every single-read finding to the tiebreak.
const LOW_TIER_REQUIRED = [
  [/goes to the tiebreak \(`step3-tiebreak\.md`\)/, 'the low tier hands findings to the tiebreak'],
  [/STAGED \{HH:MM:SS\} — Single-read \(low tier\): lens "\{lens\}" finding \{path\}:\{line\} unconfirmed; handed to the tiebreak\./, 'the STAGED line keeps the word unconfirmed'],
];
const LOW_TIER_FORBIDDEN = [
  [/only path to `confirmed` is the Direct-verification override/, 'the old only-path-to-confirmed sentence'],
  [/confirmed via direct verification/, 'the old direct-verification confirmation log line'],
];
const lowTierMissing = missingFactsOf(LOW_TIER_REQUIRED);
const lowTierLeftovers = leftoverFactsOf(LOW_TIER_FORBIDDEN);

test('AC4.1 low tier hands findings to the tiebreak', () => {
  const paragraph = lowTierParagraph(readText(TIER_VARIANTS));
  assert.notEqual(paragraph, '', 'the low-tier single-read paragraph was not found');
  assert.deepEqual(lowTierMissing(paragraph), [], 'the low-tier paragraph must hand findings to the tiebreak');
  assert.deepEqual(lowTierLeftovers(paragraph), [], 'the low-tier paragraph must not keep the old direct-verification path');
});

test('AC4.1 the low-tier assertions can go red', () => {
  const paragraph = lowTierParagraph(readText(TIER_VARIANTS));
  assertEveryMatchGoesRed(paragraph, LOW_TIER_REQUIRED, lowTierMissing);
  assert.deepEqual(lowTierLeftovers(`${paragraph} the only path to \`confirmed\` is the Direct-verification override`), ['the old only-path-to-confirmed sentence']);
  assert.deepEqual(lowTierLeftovers(`${paragraph} confirmed via direct verification`), ['the old direct-verification confirmation log line']);
});

// AC8.1 (#3950): the reviewer's own Direct-verification override is retired. Every unconfirmed finding
// reaches Step 3.7's tiebreak, so the paragraph (and its ` Mode: inline.` verdict path) is gone.
const DIRECT_VERIFICATION = /direct[- ]verification/i;
const RETIRED_REPLACEMENT = "recoverable only through Step 3.7's tiebreak";

// The one predicate both the positive test and its go-red proof call: the retirement facts the text breaks.
function retirementProblems(text) {
  const problems = [];
  if (DIRECT_VERIFICATION.test(text)) problems.push('step3-lens-dispatch.md must not mention direct verification');
  if (overrideParagraph(text) !== '') problems.push('the override paragraph must be gone');
  if (/the override below/.test(text)) problems.push('no pointer to the retired override remains');
  if (!text.includes(RETIRED_REPLACEMENT)) problems.push('the anchor note must name the tiebreak as the way back');
  if (!text.includes('Reading source alone never lifts this downgrade: the only way back')) problems.push('the lens 3f downgrade rule survives the override');
  return problems;
}

test("AC8.1: the Direct-verification override is retired", () => {
  assert.deepEqual(retirementProblems(readText(STEP3)), []);
});

test('AC8.1 the retirement assertions can go red', () => {
  const text = readText(STEP3);
  assert.deepEqual(retirementProblems(`${text}\n> **Direct-verification override.** planted`), ['step3-lens-dispatch.md must not mention direct verification', 'the override paragraph must be gone']);
  assert.deepEqual(retirementProblems(`${text}\nsee the override below`), ['no pointer to the retired override remains']);
  assert.deepEqual(retirementProblems(text.replace(RETIRED_REPLACEMENT, 'recoverable only through the override')), ['the anchor note must name the tiebreak as the way back']);
  assert.deepEqual(retirementProblems(text.replace('Reading source alone never lifts this downgrade: the only way back', 'Reading source lifts it')), ['the lens 3f downgrade rule survives the override']);
});

// AC8.2: the file stays under the rail (52,500 bytes, budgets.js's RAIL_BYTES — the single source) after the paragraph is removed.
test('AC8.2: step3-lens-dispatch.md stays under the rail', () => {
  const bytes = Buffer.byteLength(readText(STEP3));
  assert.ok(underRail(bytes), `step3-lens-dispatch.md is ${bytes} bytes, expected < ${RAIL_BYTES}`);
  assert.ok(!underRail(Buffer.byteLength('x'.repeat(RAIL_BYTES))), 'a file exactly at the rail must turn the check red');
});

// pointer: the file names the tiebreak step at least twice (low tier + the recoverable-through note).
const countOf = (text, needle) => text.split(needle).length - 1;

test('pointer: step3-lens-dispatch.md names step3-tiebreak.md at least twice', () => {
  assert.ok(countOf(readText(STEP3), 'step3-tiebreak.md') >= 2);
});

test('pointer: the count assertion can go red', () => {
  const text = readText(STEP3);
  assert.ok(countOf(text.replaceAll('step3-tiebreak.md', 'step3-other.md'), 'step3-tiebreak.md') < 2);
});

// AC10.1: the rail.
const underRail = (bytes) => bytes < RAIL_BYTES;

test('AC10.1 step3-lens-dispatch.md stays under the rail', () => {
  assert.ok(underRail(Buffer.byteLength(readText(STEP3))), 'step3-lens-dispatch.md must stay under RAIL_BYTES');
});

test('AC10.1 the rail assertion can go red', () => {
  assert.ok(underRail(RAIL_BYTES - 1), 'one byte under the rail passes');
  assert.ok(!underRail(RAIL_BYTES), 'a file exactly at the rail must turn the check red');
  assert.ok(!underRail(RAIL_BYTES + 1), 'a file over the rail must turn the check red');
});

// --- step3-debate-and-refutation.md: Per-Candidate Refutation through the resolver, gap-sweep hand-off ---

const DEBATE = path.join(SKILLS, 'review', 'step3-debate-and-refutation.md');
const debateText = () => readText(DEBATE);

const refutationStep4 = (text) => between(text, '4. **Dispatch one refutation agent', '5. **Resolve.**');
const refutationStep5 = (text) => between(text, '5. **Resolve.**', 'After Step 3.5, every finding has a final bucket');
const gapSweepSection = (text) => between(text, '## Step 3.6: Gap-Sweep', '## Post-fan-out sweep');
const finalBucketParagraph = (text) => lineStartingWith(text, 'After Step 3.5, every finding has a final bucket');
const refutationNote = (text) => lineStartingWith(text, '> **Parallel execution:** Dispatch one refutation agent');

// AC5.1: the refutation template keeps "try to FALSIFY" and replies in the tiebreak fields.
const REFUTATION_TEMPLATE_REQUIRED = [
  [/You are trying to FALSIFY this finding/, 'the template still asks the agent to try to FALSIFY the finding'],
  ...REPLY_FORMAT,
];
const REFUTATION_TEMPLATE_FORBIDDEN = [[/refuted \/ not-refuted/, 'the retired "refuted / not-refuted" verdict line']];
const refutationTemplateMissing = missingFactsOf(REFUTATION_TEMPLATE_REQUIRED);
const refutationTemplateLeftovers = leftoverFactsOf(REFUTATION_TEMPLATE_FORBIDDEN);

test('AC5.1 refutation template replies in the tiebreak fields and drops not-refuted', () => {
  const step4 = refutationStep4(debateText());
  assert.deepEqual(refutationTemplateMissing(step4), [], 'step 4 must carry the tiebreak reply fields and keep the falsify framing');
  assert.deepEqual(refutationTemplateLeftovers(step4), [], 'step 4 must not keep the retired verdict line');
});

test('AC5.1 the refutation-template assertions can go red', () => {
  const step4 = refutationStep4(debateText());
  assertEveryMatchGoesRed(step4, REFUTATION_TEMPLATE_REQUIRED, refutationTemplateMissing);
  assert.deepEqual(refutationTemplateLeftovers(`${step4}\n1. Verdict: refuted / not-refuted`), ['the retired "refuted / not-refuted" verdict line']);
});

// The intro's parallel-execution note names the verdict the agent now returns.
const NOTE_REQUIRED = [[/returns a `confirmed`\/`refuted`\/`cant-tell` verdict/, 'the note names the tiebreak verdict vocabulary']];
const NOTE_FORBIDDEN = [[/`refuted`\/`not-refuted` verdict/, 'the retired refuted/not-refuted verdict wording']];
const noteMissing = missingFactsOf(NOTE_REQUIRED);
const noteLeftovers = leftoverFactsOf(NOTE_FORBIDDEN);

test('AC5.1 the parallel-execution note names the tiebreak verdicts', () => {
  const note = refutationNote(debateText());
  assert.notEqual(note, '', 'the refutation parallel-execution note was not found');
  assert.deepEqual(noteMissing(note), [], 'the note must name confirmed/refuted/cant-tell');
  assert.deepEqual(noteLeftovers(note), [], 'the note must not keep the refuted/not-refuted wording');
});

test('AC5.1 the parallel-execution-note assertions can go red', () => {
  const note = refutationNote(debateText());
  assertEveryMatchGoesRed(note, NOTE_REQUIRED, noteMissing);
  assert.deepEqual(noteLeftovers(`${note} and returns a \`refuted\`/\`not-refuted\` verdict`), ['the retired refuted/not-refuted verdict wording']);
});

// AC5.2: step 5 settles the reply through the resolver.
const REFUTATION_RULE = [
  [/resolve-tiebreak/, 'step 5 feeds the reply to resolve-tiebreak'],
  [/`step3-tiebreak\.md`'s Resolve and act section/, "step 5 cites step3-tiebreak.md's Resolve and act section"],
  [/kind: "unconfirmed"/, 'the candidate is passed with kind: "unconfirmed"'],
  [/reads `kind` only for a contested finding's positions/, 'the resolver reads kind only for a contested finding'],
  [/`drop`[^\n]*tiebreak `refuted` verdict/, 'a drop counts as a tiebreak refuted verdict'],
  [/can't-tell[^\n]*`unconfirmed`[^\n]*Step 3\.7/, "a can't-tell reply joins unconfirmed for Step 3.7"],
  [/Only `confirmed` and `drop` write the resolver's line/, "only confirmed and drop write the resolver's line"],
  [/never be logged as if a real falsification attempt happened/, 'a failed dispatch is never logged as a real falsification attempt'],
  [/`confirmed` → the candidate stands[^\n]*at its own severity, not the resolver's returned `severity`/, "a refutation confirmed keeps its own severity, unlike Step 3.7's"],
  [/else the `reason` field the resolver printed, verbatim/, "the downgrade cause is the resolver's reason verbatim"],
];
const REFUTATION_RULE_FORBIDDEN = [
  [/resolve-refutation/, 'the retired resolve-refutation verb'],
  [/apply `resolveRefutation`/, 'the retired resolveRefutation call'],
  [/`not-refuted`/, 'the retired not-refuted verdict'],
  [/`unparseable verdict`/, 'the retired lossy cause words'],
];
const refutationRuleMissing = missingFactsOf(REFUTATION_RULE);
const refutationRuleLeftovers = leftoverFactsOf(REFUTATION_RULE_FORBIDDEN);

test("AC5.2 step 5 feeds the reply to resolve-tiebreak and hands can't-tell to Step 3.7", () => {
  const step5 = refutationStep5(debateText());
  assert.deepEqual(refutationRuleMissing(step5), [], 'step 5 must state the resolver rule');
  assert.deepEqual(refutationRuleLeftovers(step5), [], 'step 5 must stop citing the retired verb and verdict');
});

test('AC5.2 the refutation-rule assertions can go red', () => {
  const step5 = refutationStep5(debateText());
  assertEveryMatchGoesRed(step5, REFUTATION_RULE, refutationRuleMissing);
  assert.deepEqual(refutationRuleLeftovers(`${step5}\nnode review-coordination.js resolve-refutation {verdict}`), ['the retired resolve-refutation verb']);
  assert.deepEqual(refutationRuleLeftovers(`${step5}\nthen apply \`resolveRefutation\``), ['the retired resolveRefutation call']);
  assert.deepEqual(refutationRuleLeftovers(`${step5}\n- \`not-refuted\` → stands`), ['the retired not-refuted verdict']);
  assert.deepEqual(refutationRuleLeftovers(`${step5}\nwith \`{cause}\` one of \`unparseable verdict\` or \`can't-tell\``), ['the retired lossy cause words']);
});

// Step 5 logs the resolver's line for confirmed/drop and writes the downgrade line otherwise (never both).
// The downgrade line is STAGED, keyed `lens "{lens}" finding {path}:{line}`, and says unconfirmed, so the Review
// Console surfaces the can't-tell finding (F5b).
const DOWNGRADE_LINE = /STAGED \{HH:MM:SS\} — Refutation: lens "\{lens\}" finding \{path\}:\{line\} — no usable verdict \(\{cause\}\)/;
function downgradeProblems(step5) {
  const problems = [];
  const downgrades = step5.split('\n').filter((line) => line.includes('Downgraded to unconfirmed'));
  if (downgrades.length !== 1) problems.push(`expected exactly one downgrade line, found ${downgrades.length}`);
  else if (!DOWNGRADE_LINE.test(downgrades[0])) problems.push('the downgrade line is not the STAGED lens-keyed form');
  if (!/Do not log the resolver's line/.test(step5)) problems.push("the do-not-log-the-resolver's-line rule is missing");
  return problems;
}

test("AC5.2 step 5 keeps one downgrade line for can't-tell and never logs the resolver's line for it", () => {
  assert.deepEqual(downgradeProblems(refutationStep5(debateText())), []);
});

test("AC5.2 the downgrade-line assertions can go red", () => {
  const step5 = refutationStep5(debateText());
  const without = step5.replace(/Do not log the resolver's line/g, '');
  assert.notEqual(without, step5, 'anchor text not found — proof cannot discriminate');
  assert.deepEqual(downgradeProblems(without), ["the do-not-log-the-resolver's-line rule is missing"]);
  const doubled = `${step5}\nSTAGED {HH:MM:SS} — Refutation: x. Downgraded to unconfirmed.`;
  assert.deepEqual(downgradeProblems(doubled), ['expected exactly one downgrade line, found 2']);
  const oldForm = step5.replace(DOWNGRADE_LINE, 'AUTO {HH:MM:SS} — Refutation: {path}:{line} — no usable verdict ({cause})');
  assert.notEqual(oldForm, step5, 'anchor text for the downgrade line not found');
  assert.deepEqual(downgradeProblems(oldForm), ['the downgrade line is not the STAGED lens-keyed form']);
});

// Gap-sweep hand-off.
const GAP_SWEEP_HANDOFF = [[/step3-tiebreak\.md/, 'the gap-sweep findings are handed to step3-tiebreak.md']];
const gapSweepHandoffMissing = missingFactsOf(GAP_SWEEP_HANDOFF);

test('gap-sweep hand-off: Step 3.6 sends its single-source findings to the tiebreak', () => {
  assert.deepEqual(gapSweepHandoffMissing(gapSweepSection(debateText())), [], 'Step 3.6 must name step3-tiebreak.md');
});

test('gap-sweep hand-off: the assertion can go red', () => {
  assertEveryMatchGoesRed(gapSweepSection(debateText()), GAP_SWEEP_HANDOFF, gapSweepHandoffMissing);
});

// The final-bucket paragraph points at Step 3.7, not at a staging that no longer ends the story.
const FINAL_BUCKET_REQUIRED = [[/Step 3\.7[^\n]*`step3-tiebreak\.md`|`step3-tiebreak\.md`[^\n]*Step 3\.7/, 'the paragraph points unconfirmed and contested findings at Step 3.7 (step3-tiebreak.md)']];
const FINAL_BUCKET_FORBIDDEN = [[/are already staged to the Wrap-Up Console/, 'the stale already-staged sentence']];
const finalBucketMissing = missingFactsOf(FINAL_BUCKET_REQUIRED);
const finalBucketLeftovers = leftoverFactsOf(FINAL_BUCKET_FORBIDDEN);

test('final bucket: unconfirmed and contested findings go to Step 3.7', () => {
  const paragraph = finalBucketParagraph(debateText());
  assert.notEqual(paragraph, '', 'the final-bucket paragraph was not found');
  assert.deepEqual(finalBucketMissing(paragraph), [], 'the paragraph must point at Step 3.7');
  assert.deepEqual(finalBucketLeftovers(paragraph), [], 'the paragraph must not keep the already-staged sentence');
});

test('final bucket: the assertions can go red', () => {
  const paragraph = finalBucketParagraph(debateText());
  assertEveryMatchGoesRed(paragraph, FINAL_BUCKET_REQUIRED, finalBucketMissing);
  assert.deepEqual(finalBucketLeftovers(`${paragraph} \`unconfirmed\` and \`contested\` are already staged to the Wrap-Up Console.`), ['the stale already-staged sentence']);
});

// code-mode-steps.md points at the verbs the debate file now uses.
const tierParagraph = (text) => lineStartingWith(text, '**At `high` and above**, Cross-Lens Debate runs.');
const CITES_TIEBREAK = /`resolve-debate`\/`resolve-tiebreak`/;
const CITES_RETIRED_VERB = /resolve-refutation/;

test('code-mode-steps.md names resolve-tiebreak, not resolve-refutation, for the refutation pass', () => {
  const sentence = tierParagraph(readText(CODE_MODE_STEPS));
  assert.notEqual(sentence, '', 'the tier paragraph was not found');
  assert.match(sentence, CITES_TIEBREAK);
  assert.doesNotMatch(sentence, CITES_RETIRED_VERB);
});

test('code-mode-steps.md verb-citation assertions can go red', () => {
  const sentence = tierParagraph(readText(CODE_MODE_STEPS));
  const reverted = sentence.replace('`resolve-tiebreak`', '`resolve-refutation`');
  assert.notEqual(reverted, sentence, 'anchor text not found — proof cannot discriminate');
  assert.doesNotMatch(reverted, CITES_TIEBREAK);
  assert.match(reverted, CITES_RETIRED_VERB);
});

// --- step3-routing.md: takes tiebreak-confirmed findings (AC6.1) ---

const ROUTING = path.join(SKILLS, 'review', 'step3-routing.md');
const routingText = () => readText(ROUTING);
const inputsSection = (text) => between(text, '## Inputs\n', '**`unconfirmed` findings can originate');
const lowTierBullet = (text) => lineStartingWith(text, '- Low-tier single-read (Step 3');
const noReproBullet = (text) => lineStartingWith(text, '- No reproduction agreement (Step 3)');
const refutationBullet = (text) => lineStartingWith(text, '- A `confirmed` finding downgraded by the Per-Candidate Refutation Pass');
const surfacingParagraph = (text) => lineStartingWith(text, '**Effort-tier surfacing.**');
const xhighParagraph = (text) => lineStartingWith(text, 'At **`xhigh` and above**');
const maxParagraph = (text) => lineStartingWith(text, 'At **`max`**');

const ROUTING_FORBIDDEN = [
  [/the Direct-verification override is the only path to `confirmed`/, 'the override is the only path to confirmed for the low tier'],
  [/where it is the designed confirmation path/, 'the override is the designed confirmation path for the low tier'],
];
const routingLeftovers = leftoverFactsOf(ROUTING_FORBIDDEN);

test('AC6.1 step3-routing.md no longer bypasses the tiebreak', () => {
  const text = routingText();
  assert.deepEqual(routingLeftovers(text), [], 'step3-routing.md must not keep the pre-tiebreak routing sentences');
});

test('AC6.1 the routing leftover assertions can go red', () => {
  const text = routingText();
  assert.deepEqual(routingLeftovers(`${text}\nthe Direct-verification override is the only path to \`confirmed\` for this source`), [ROUTING_FORBIDDEN[0][1]]);
  assert.deepEqual(routingLeftovers(`${text}\nwhere it is the designed confirmation path`), [ROUTING_FORBIDDEN[1][1]]);
});

// F2: no file of the review skill routes an unconfirmed/contested finding straight to the console.
const REVIEW_DIR = path.join(SKILLS, 'review');
const BYPASS_FORBIDDEN = [
  [/route directly to the Wrap-Up Console's Low-confidence/, "route directly to the Wrap-Up Console's Low-confidence"],
  [/route straight to the Wrap-Up Review Console's Low-confidence/, "route straight to the Wrap-Up Review Console's Low-confidence"],
  [/lands in Low-confidence subsection/, 'lands in Low-confidence subsection'],
  [/Low-confidence subsection as usual/, 'Low-confidence subsection as usual'],
  [/skips straight to Step 3 Routing/, 'skips straight to Step 3 Routing'],
  [/staged to the Wrap-Up Review Console instead/, 'staged to the Wrap-Up Review Console instead'],
];
const reviewFiles = () => fs.readdirSync(REVIEW_DIR).filter((name) => name.endsWith('.md'));
const bypassLeftovers = (files, readFile) => files.flatMap((name) => BYPASS_FORBIDDEN
  .filter(([pattern]) => pattern.test(readFile(name))).map(([, phrase]) => `${name}: ${phrase}`));
const readReviewFile = (name) => readText(path.join(REVIEW_DIR, name));

test('no review file routes a finding straight to the console, bypassing Step 3.7', () => {
  const files = reviewFiles();
  assert.ok(files.includes('step3-lens-dispatch.md') && files.includes('review-summary-template.md'), 'the scan covers the review skill directory');
  assert.deepEqual(bypassLeftovers(files, readReviewFile), []);
});

test('the review-wide bypass scan can go red', () => {
  for (const [, phrase] of BYPASS_FORBIDDEN) {
    assert.deepEqual(bypassLeftovers(['planted.md'], () => `text ${phrase} text`), [`planted.md: ${phrase}`], `a planted "${phrase}" must turn the scan red`);
  }
});

// AC8.1 (#3950): no file of the review skill names the retired Direct-verification override.
const retiredOverrideMentions = (files, readFile) => files.filter((name) => DIRECT_VERIFICATION.test(readFile(name)));

test('AC8.1: no review file names the retired Direct-verification override', () => {
  assert.deepEqual(retiredOverrideMentions(reviewFiles(), readReviewFile), []);
  const routing = routingText();
  assert.doesNotMatch(noReproBullet(routing), /Mode: inline|resolve-tiebreak/, 'the no-reproduction bullet no longer resolves through an override');
  assert.match(readReviewFile('step3-tiebreak.md'), /An inline fallback verdict \(`## Dispatched reviewer`\) goes through the same resolver, with ` Mode: inline\.` appended to the content of `T`/);
});

test('AC8.1 the review-wide retirement scan can go red', () => {
  assert.deepEqual(retiredOverrideMentions(['planted.md'], () => 'the Direct-verification override'), ['planted.md']);
  assert.deepEqual(retiredOverrideMentions(['planted.md'], () => 'elevated via direct verification'), ['planted.md']);
});

const ROUTING_INPUTS = [[/tiebreak-confirmed findings \(`step3-tiebreak\.md`\)/, 'the Inputs list takes tiebreak-confirmed findings']];
const routingInputsMissing = missingFactsOf(ROUTING_INPUTS);

test('AC6.1 step3-routing.md lists tiebreak-confirmed findings among its Inputs', () => {
  assert.deepEqual(routingInputsMissing(inputsSection(routingText())), [], 'the ## Inputs list must name the tiebreak-confirmed findings');
});

test('AC6.1 the Inputs assertion can go red', () => {
  assertEveryMatchGoesRed(inputsSection(routingText()), ROUTING_INPUTS, routingInputsMissing);
});

// Routing facts are section-scoped over { routing }, so the shared fact-list helpers apply.
const routingTexts = () => ({ routing: routingText() });

const SOURCE_BULLETS = [
  [({ routing }) => noReproBullet(routing), /A lens 3f vacuity finding from either source is re-confirmed only by the reviewing agent's own executed run, never by source reading\./, 'the no-reproduction bullet states the lens 3f executed-run rule on its own'],
  [({ routing }) => lowTierBullet(routing), /goes to the tiebreak \(`step3-tiebreak\.md`\)/, 'the low-tier bullet hands findings to the tiebreak'],
  [({ routing }) => refutationBullet(routing), /Step 3\.7/, 'the refutation bullet hands the downgraded finding to Step 3.7'],
  [({ routing }) => refutationBullet(routing), /can't-tell/, "the refutation bullet names the can't-tell downgrade"],
];
const sourceBulletsMissing = sectionFactsMissing(SOURCE_BULLETS);

test('AC6.1 the unconfirmed-source bullets say the tiebreak settles these findings', () => {
  const texts = routingTexts();
  for (const [pick, , fact] of SOURCE_BULLETS) assert.notEqual(pick(texts), '', `bullet not found for "${fact}"`);
  assert.deepEqual(sourceBulletsMissing(texts), [], 'the source bullets must route through the tiebreak');
});

test('AC6.1 the source-bullet assertions can go red', () => {
  assertEachSectionFactGoesRed(routingTexts(), SOURCE_BULLETS, sourceBulletsMissing);
});

// Minor 13: what the lens 3f rule was once an exception to is gone, so the bullet never calls it one.
const orphanedException = (bullet) => /\bthe exception\b/.test(bullet);

test('minor 13: the no-reproduction bullet states the lens 3f rule with no orphaned "the exception"', () => {
  assert.equal(orphanedException(noReproBullet(routingText())), false);
});

test('minor 13 the orphaned-exception assertion can go red', () => {
  const bullet = noReproBullet(routingText());
  assert.equal(orphanedException(bullet.replace('is re-confirmed only by', 'is the exception: re-confirmed only by')), true);
});

const SURFACING = [
  [({ routing }) => surfacingParagraph(routing), /Step 3\.7's `confirmed` outcome \(`step3-tiebreak\.md`\)/, "unconfirmed/contested findings reach the table only through Step 3.7's confirmed outcome"],
  // #3949 retired "through the finding's earlier STAGED line": the verdict supersedes that line.
  [({ routing }) => surfacingParagraph(routing), /`console` outcome reaches the Wrap-Up Review Console as its own row, per `step3-tiebreak\.md`'s `console` bullet/, "a tiebreak console outcome reaches the Review Console as its own row, citing step3-tiebreak.md"],
  [({ routing }) => xhighParagraph(routing), /can't-tell/, "the xhigh paragraph names the tiebreak's can't-tell outcomes"],
  [({ routing }) => xhighParagraph(routing), /surfacing inline doesn't remove the staging/, 'the xhigh paragraph keeps the staging wording'],
  [({ routing }) => maxParagraph(routing), /on top of the .{0,40}rows `xhigh` already added/, 'the max paragraph still stacks on the xhigh rows'],
  [({ routing }) => maxParagraph(routing), /staged to `staged\/review-contested-\{N\}\.md` as before/, 'the max paragraph keeps the contested staging wording'],
];
const surfacingMissing = sectionFactsMissing(SURFACING);

test('AC6.1 the effort-tier surfacing paragraphs route through the tiebreak and keep the staging wording', () => {
  const texts = routingTexts();
  for (const [pick, , fact] of SURFACING) assert.notEqual(pick(texts), '', `paragraph not found for "${fact}"`);
  assert.deepEqual(surfacingMissing(texts), []);
});

test('AC6.1 the surfacing assertions can go red', () => {
  assertEachSectionFactGoesRed(routingTexts(), SURFACING, surfacingMissing);
});

// --- multi-agent-coordination.md: the reproduction bucket rule and the unconfirmed stage path (AC9.1 / AC9.2) ---

const COORDINATION_DOC = path.join(SKILLS, '_shared', 'multi-agent-coordination.md');
const coordinationText = () => readText(COORDINATION_DOC);

// AC9.1: the doc states the straddling pair still reproduces, and stages a description file, not a patch.
const COORDINATION_REQUIRED = [
  [/staged\/review-unconfirmed-\{n\}\.md/, 'the unconfirmed stage path is a .md description file'],
  [/straddl.*still reproduces.*lower severity.*severityContested/, 'a straddling pair still reproduces at the lower severity, flagged severityContested'],
];
const COORDINATION_FORBIDDEN = [
  [/Cross-bucket mismatches do not reproduce/, 'the stale cross-bucket-does-not-reproduce sentence'],
  [/review-unconfirmed-\{n\}\.patch/, 'the stale .patch stage path'],
];
const coordinationMissing = missingFactsOf(COORDINATION_REQUIRED);
const coordinationLeftovers = leftoverFactsOf(COORDINATION_FORBIDDEN);

test('AC9.1 multi-agent-coordination.md states the straddle rule and the .md stage path', () => {
  const text = coordinationText();
  assert.deepEqual(coordinationMissing(text), [], 'the doc must state the corrected bucket rule and stage path');
  assert.deepEqual(coordinationLeftovers(text), [], 'the doc must not keep the stale bucket sentence or the .patch stage path');
});

test('AC9.1 the coordination-doc assertions can go red', () => {
  const text = coordinationText();
  assertEveryMatchGoesRed(text, COORDINATION_REQUIRED, coordinationMissing);
  assert.deepEqual(coordinationLeftovers(`${text}\nCross-bucket mismatches do not reproduce.`), [COORDINATION_FORBIDDEN[0][1]]);
  assert.deepEqual(coordinationLeftovers(`${text}\nStage path: staged/review-unconfirmed-{n}.patch.`), [COORDINATION_FORBIDDEN[1][1]]);
});

// AC9.2: the prose is held to the code. A high/medium pair at one location with near-identical text straddles
// the bucket boundary: findingsMatch refuses it, categoriseReproduction (location + substance only) still
// pairs it and reconcileSeverity keeps the lower severity, flagged severityContested.
const STRADDLE_TEXT = 'the guard on this line swallows the error instead of rethrowing it';
const straddleFinding = (severity) => ({ path: 'plugin/bin/foo.js', line: 20, severity, text: STRADDLE_TEXT });

test('AC9.2 a pair straddling the severity boundary still reproduces at the lower severity, flagged contested', () => {
  const a = straddleFinding('high');
  const b = straddleFinding('medium');
  assert.equal(findingsMatch(a, b), false, 'findingsMatch requires the same severity bucket');
  const { confirmed, unconfirmed } = categoriseReproduction([a], [b]);
  assert.equal(confirmed.length, 1, 'the straddling pair is one confirmed finding');
  assert.equal(unconfirmed.length, 0, 'nothing is left unconfirmed');
  assert.equal(confirmed[0].severity, 'medium', 'reconcileSeverity keeps the lower severity');
  assert.equal(confirmed[0].severityContested, true);
});

test('AC9.2 the straddle assertion can go red', () => {
  const a = straddleFinding('high');
  const sameBucket = straddleFinding('critical');
  assert.equal(findingsMatch(a, sameBucket), true, 'a same-bucket pair matches, so the false above discriminates');
  const { confirmed } = categoriseReproduction([a], [sameBucket]);
  assert.notEqual(confirmed[0].severityContested, true, 'a same-bucket pair is not contested, so the contested flag above discriminates');
});

// --- _shared/materiality-floor.md: the tiebreak-cant-tell digest value (R1) ---

const MATERIALITY_FLOOR = path.join(SKILLS, '_shared', 'materiality-floor.md');
const materialityText = () => readText(MATERIALITY_FLOOR);

// The text of the floor's `### Tiebreak can't-tell value` subsection, up to the next heading.
const tiebreakValueSection = (text) => sliceSection(text, "### Tiebreak can't-tell value", '\n### ');

const TIEBREAK_VALUE = [
  [/Defer-reason: tiebreak-cant-tell/, 'the floor documents the Defer-reason: tiebreak-cant-tell value'],
  [/step3-tiebreak\.md/, 'the floor names step3-tiebreak.md as the producer'],
  [/Deliberately \*\*not\*\* in `DEFER_REASONS`/, 'the floor says the value is deliberately not in DEFER_REASONS'],
];
const tiebreakValueFactsMissing = missingFactsOf(TIEBREAK_VALUE);
const tiebreakValueMissing = (text) => tiebreakValueFactsMissing(tiebreakValueSection(text));

test('materiality-floor.md documents Defer-reason: tiebreak-cant-tell, produced by step3-tiebreak.md, outside DEFER_REASONS', () => {
  assert.deepEqual(tiebreakValueMissing(materialityText()), [], "the floor's Tiebreak can't-tell value subsection must carry every fact");
});

test('the materiality-floor assertions can go red', () => {
  assertEveryMatchGoesRed(tiebreakValueSection(materialityText()), TIEBREAK_VALUE, tiebreakValueFactsMissing);
  assert.deepEqual(tiebreakValueMissing('## no such subsection'), TIEBREAK_VALUE.map(([, fact]) => fact), 'a floor without the subsection fails every fact');
});

test('tiebreak-cant-tell is not in DEFER_REASONS', () => {
  assert.ok(!DEFER_REASONS.includes('tiebreak-cant-tell'), 'tiebreak-cant-tell is an entry-format value, not a fix-now-failure reason');
  assert.ok(DEFER_REASONS.includes('tangential'), 'DEFER_REASONS is the real gate vocabulary, so the includes check above discriminates');
});

const RESOLVE_NAMES_VALUE = [[/tiebreak-cant-tell/, 'the Resolve and act section names the tiebreak-cant-tell digest value']];
const resolveNamesValueMissing = (text) => missingFactsOf(RESOLVE_NAMES_VALUE)(sectionOf(text, '## Resolve and act'));

test("step3-tiebreak.md's Resolve and act section names tiebreak-cant-tell", () => {
  assert.deepEqual(resolveNamesValueMissing(tiebreakText()), []);
});

test('the Resolve and act tiebreak-cant-tell assertion can go red', () => {
  const text = tiebreakText();
  const doctored = text.replace(/tiebreak-cant-tell/g, '');
  assert.notEqual(doctored, text, 'anchor text not found');
  assert.deepEqual(resolveNamesValueMissing(doctored), [RESOLVE_NAMES_VALUE[0][1]]);
});

// --- docs/skill-graph.md: the tiebreak step's edges (AC11.1) ---

const SKILL_GRAPH = path.join(__dirname, '..', 'docs', 'skill-graph.md');
const skillGraphText = () => readText(SKILL_GRAPH);

// The `## review` section, up to the next `## ` heading.
const reviewGraphSection = (text) => sliceSection(text, '\n## review\n', '\n## ');
const graphRowOf = (prefix) => ({ graph }) => lineStartingWith(reviewGraphSection(graph), prefix);

const coordinationRow = graphRowOf('| `bin/review-coordination.js` |');
const subagentCoreRow = graphRowOf('| `_shared/subagent-dispatch-core.md` |');
const GRAPH_ROWS = [
  [coordinationRow, /step3-tiebreak\.md/, 'the review-coordination row names step3-tiebreak.md'],
  [coordinationRow, /resolve-tiebreak/, 'the review-coordination row names resolve-tiebreak'],
  [coordinationRow, /write-findings/, 'the review-coordination row names write-findings'],
  [coordinationRow, /plan-chunks/, 'the review-coordination row names plan-chunks'],
  [graphRowOf('| `_shared/materiality-floor.md` |'), /tiebreak-cant-tell/, 'the materiality-floor row names tiebreak-cant-tell'],
  [subagentCoreRow, /tiebreak/, 'the subagent-dispatch-core row names the tiebreak'],
  [subagentCoreRow, /nested/i, 'the subagent-dispatch-core row names the nested-children rule'],
];
const graphRowsMissing = sectionFactsMissing(GRAPH_ROWS);

test('AC11.1 the review section of skill-graph.md records the tiebreak edges', () => {
  assert.deepEqual(graphRowsMissing({ graph: skillGraphText() }), []);
});

test('AC11.1 the graph-row assertions can go red', () => {
  const texts = { graph: skillGraphText() };
  assert.ok(reviewGraphSection(texts.graph).length > 0, 'the ## review section exists');
  assertEachSectionFactGoesRed(texts, GRAPH_ROWS, graphRowsMissing);
  assert.equal(graphRowsMissing({ graph: '## other\n' }).length, GRAPH_ROWS.length, 'a graph without the review section fails every fact');
});

// Entry files only: a sub-file citing step3-tiebreak.md (code-mode-steps.md wires Step 3.7) is a step
// reference, not a restated edge, so the scan is deliberately limited to files named SKILL.md.
function listSkillMdFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSkillMdFiles(full);
    return entry.name === 'SKILL.md' ? [full] : [];
  });
}
const skillsNamingStep = (files, readFile) => files.filter((file) => readFile(file).includes('step3-tiebreak.md'));

test('AC11.1 no SKILL.md entry file names step3-tiebreak.md (its edge lives only in skill-graph.md)', () => {
  const files = listSkillMdFiles(SKILLS);
  assert.ok(files.length > 20, 'the scan covers every skill entry file');
  assert.deepEqual(skillsNamingStep(files, readText), []);
});

test('AC11.1 the SKILL.md-names-step3-tiebreak.md scan can go red', () => {
  const files = listSkillMdFiles(SKILLS);
  const planted = files[0];
  assert.deepEqual(skillsNamingStep(files, (file) => (file === planted ? 'see step3-tiebreak.md' : '')), [planted]);
});

// ===== Final-review fix wave (#3947, F1-F16) =====

const SUMMARY_TEMPLATE = path.join(SKILLS, 'review', 'review-summary-template.md');
const liveTexts = () => ({
  tiebreak: tiebreakText(),
  step3: readText(STEP3),
  tierVariants: readText(TIER_VARIANTS),
  debate: debateText(),
  template: readText(SUMMARY_TEMPLATE),
});
const tiebreakSection = (heading) => (texts) => sectionOf(texts.tiebreak, `## ${heading}`);
const tiebreakTemplate = (texts) => fencedTemplate(sectionOf(texts.tiebreak, '## Dispatch'));
const hungParagraph = (texts) => lineStartingWith(texts.step3, '**Hung or non-responsive single-read agent.**');
const refutationTemplateOf = (texts) => refutationStep4(texts.debate);
const compactForm = (texts) => between(texts.template, '## Compact form — clean PASS', '```markdown');
const templateTiebreakSection = (texts) => sliceSection(texts.template.slice(texts.template.indexOf('## Full template')), '\n### Tiebreak\n', '\n### ');

const FIX_WAVE = [
  // F1: reading never confirms a vacuity claim.
  [tiebreakTemplate, /A vacuity claim[^\n]*cannot be confirmed by reading code/, 'F1 the template tells the agent reading cannot confirm a vacuity claim'],
  [tiebreakSection('Resolve and act'), /On a lens 3f vacuity finding, write a `confirmed` reply to `R` with its `Verdict: confirmed` line replaced by `Verdict: cant-tell`/, "F1 a confirmed reply on a vacuity finding is rewritten as a can't-tell reply"],
  [tiebreakSection('Resolve and act'), /a vacuity claim needs an executed run \(`step3-lens-dispatch\.md`'s lens 3f vacuity bullet\)/, "F1 the cause cites step3-lens-dispatch.md's vacuity rule"],
  [tiebreakSection('Resolve and act'), /a `refuted` reply resolves as written/, 'F1 a refuted reply on a vacuity finding resolves normally'],
  // F3 (#3950): the reviewer-read override is retired; only an inline fallback verdict is reviewer-read, and it carries Mode: inline.
  [tiebreakSection('Resolve and act'), /An inline fallback verdict \(`## Dispatched reviewer`\) goes through the same resolver, with ` Mode: inline\.` appended to the content of `T`/, 'F3 only an inline fallback verdict is reviewer-read and carries Mode: inline.'],
  // F4: the post-fan-out sweep re-runs after the tiebreak's last wave.
  [tiebreakSection('Dispatch'), /After the last wave, re-run `step3-lens-dispatch\.md`'s Post-fan-out untracked-file sweep against the same pre-dispatch listing/, 'F4 the sweep re-runs after the last wave against the same listing'],
  [tiebreakSection('Dispatch'), /report-only, as there/, 'F4 the re-run sweep is report-only'],
  [tiebreakSection('Dispatch'), /Skip it when this step dispatched no agent/, 'F4 the re-run is skipped when nothing was dispatched'],
  // F5: what #3772 supersedes, and how a console outcome surfaces.
  [tiebreakSection('Resolve and act'), /supersedes it through `console\/resolve\.js`'s `#3772` matcher only when that line carries `lens "\{lens\}"` and `\{path\}:\{line\}`/, 'F5a the supersession claim names the lens + path:line key'],
  // #3949 retired the contested-file gap and the surfaces-through-the-STAGED-line wording: verdicts now
  // supersede the line and its linked staged file, and a console verdict is its own row.
  [tiebreakSection('Resolve and act'), /A staged `review-unconfirmed-\*`, `review-contested-\*` or `review-debate-\*` file that line names is superseded with it/, 'F5a a linked staged file is superseded with its line'],
  [tiebreakSection('Resolve and act'), /- `console`[^\n]*surfaces at the Review Console as a Low-confidence or Contested row carrying the logged line's `Severity:` and `Recommendation:`/, 'F5b a console outcome surfaces as a row carrying severity and recommendation'],
  // F6: the refutation template carries only the allowlist.
  [refutationTemplateOf, /Diff scope: /, 'F6 the refutation template input carries the diff scope'],
  // F7: step3-tiebreak.md points at the template's Tiebreak section; the template has the slots.
  [tiebreakSection('Resolve and act'), /`review-summary-template\.md`'s `### Tiebreak` section/, 'F7 the digest count points at the template section'],
  [tiebreakSection('Standalone review'), /`review-summary-template\.md`'s `### Tiebreak` section/, 'F7 the standalone lists point at the template section'],
  [tiebreakSection('Dispatched reviewer'), /`review-summary-template\.md`'s `### Tiebreak` section/, 'F7 the Tiebreak caveat points at the template section'],
  [templateTiebreakSection, /\{n\} confirmed · \{n\} dropped · \{n\} digest · \{n\} console/, 'F7 the template counts each outcome'],
  [templateTiebreakSection, /\{only when[^}\n]*\} \*\*Tiebreak caveat:\*\*/, 'F7 the template carries a conditional Tiebreak caveat slot'],
  [templateTiebreakSection, /standalone review only[^\n]*medium or higher[^\n]*recommendation/, "F7 the template carries the standalone can't-tell >= medium list"],
  [compactForm, /nothing to judge, or every verdict was `confirmed` or `drop`, and no Tiebreak caveat applies/, 'F7 the compact form requires a tiebreak with nothing left open'],
  // F8: a dispatched reviewer's timeout takes the inline rung.
  [tiebreakSection('Resolve and act'), /empty reply file \(a dispatched reviewer takes the inline rung instead, see `## Dispatched reviewer`\)/, "F8 the empty-reply rule defers to the dispatched reviewer's inline rung"],
  // F9: claims are collapsed before write-findings; a resolver failure never invents a verdict.
  [tiebreakSection('Findings artifact'), /Collapse each claim's whitespace and line breaks to single spaces/, 'F9 claims are collapsed before write-findings'],
  [tiebreakSection('Resolve and act'), /When `resolve-tiebreak` exits non-zero for an entry, never invent a verdict/, 'F9 a resolver failure never invents a verdict'],
  [tiebreakSection('Resolve and act'), /no verdict line, so the archive gate refuses the run and surfaces it/, 'F9 the archive gate surfaces the unresolved finding'],
  // F10: the lens written to review-findings.json.
  [tiebreakSection('Findings artifact'), /`lens` is the lens the finding's earlier STAGED line names/, "F10 lens is the earlier STAGED line's lens"],
  [tiebreakSection('Findings artifact'), /`gap-sweep` for a gap-sweep finding/, 'F10 a gap-sweep finding uses lens gap-sweep'],
  [tiebreakSection('Findings artifact'), /a contested entry's first position's lens/, "F10 a contested entry uses its first position's lens"],
  [tiebreakSection('Findings artifact'), /a multi-lens refutation candidate's first listed lens/, 'F10 a multi-lens refutation candidate uses its first listed lens'],
  // F11: the digest write follows the Defer path, approval included.
  [tiebreakSection('Resolve and act'), /including that bullet's interactive batch-table approval/, "F11 the digest write follows the Defer path's batch-table approval"],
  // F12: the hung single-read agent's substitute findings go to Step 3.7, not the override.
  [hungParagraph, /enter `unconfirmed` for Step 3\.7/, "F12 the reviewer's substitute findings enter unconfirmed for Step 3.7"],
  [hungParagraph, /a reporter cannot judge its own finding/, 'F12 the reporter is not its own judge'],
  // F13: a standalone inline verdict carries Mode: inline.
  [tiebreakSection('Standalone review'), /an inline verdict's line also carries ` Mode: inline\.`/, 'F13 a standalone inline verdict line carries Mode: inline.'],
];
const fixWaveMissing = sectionFactsMissing(FIX_WAVE);

test('vacuity, override, sweep re-run, supersession, template-slot, lens and digest-approval facts are each stated in their own section', () => {
  assert.deepEqual(fixWaveMissing(liveTexts()), []);
});

test('each of those section facts can go red', () => {
  assertEachSectionFactGoesRed(liveTexts(), FIX_WAVE, fixWaveMissing);
});

// F1: the documented vacuity rewrite, run through the real resolver, logs the can't-tell verdict as its reason —
// not could-not-parse, which an emptied reply would log.
const VACUITY_FINDING = { lens: '3f', path: FIXTURE_PATH, line: 20, claim: 'the test on line 20 cannot fail', reporterSeverity: 'medium', kind: 'unconfirmed' };
const VACUITY_CONFIRMED = [
  'Verdict: confirmed',
  `Evidence: ${FIXTURE_PATH}:20 \`${fixtureLines[19].trim()}\``,
  'Severity: medium',
  'Recommendation: file — the assertion never runs',
  'STATUS: DONE',
].join('\n');
const vacuityRewrite = (texts) => {
  const m = /with its `(Verdict: confirmed)` line replaced by `(Verdict: cant-tell)`/.exec(tiebreakSection('Resolve and act')(texts));
  assert.ok(m, 'the vacuity rewrite instruction was not found');
  return (reply) => reply.replace(m[1], m[2]);
};
const vacuityReason = (reply) => resolveTiebreak(VACUITY_FINDING, reply, { readFile: readFixture, now: NOW }).reason;

test("F1 the documented vacuity rewrite resolves can't-tell with reason verdict:cant-tell", () => {
  assert.equal(vacuityReason(vacuityRewrite(liveTexts())(VACUITY_CONFIRMED)), 'verdict:cant-tell');
});

test('F1 the vacuity-rewrite assertion can go red', () => {
  assert.equal(vacuityReason(VACUITY_CONFIRMED), 'confirmed by tiebreak', 'the unrewritten reply confirms, so the rewrite is what changes the outcome');
  assert.equal(vacuityReason(''), 'could-not-parse', 'an emptied reply logs could-not-parse, the misdescription the rewrite avoids');
});

const FIX_WAVE_FORBIDDEN = [
  [tiebreakSection('Resolve and act'), /Any reviewer-read verdict|An override's can't-tell outcome/, 'F3 step3-tiebreak.md no longer routes a reviewer-read override through the resolver'],
  [hungParagraph, /Direct-verification override for that lens|resolved via reviewing agent's own Direct-verification override|never the override below/, 'F12 the hung-agent fallback no longer settles through the override'],
  [refutationTemplateOf, /Cached evidence:/, 'F6 no Cached evidence line in the refutation template'],
  [refutationTemplateOf, /Category: \{category\}/, 'F6 no Category line in the refutation template'],
  [refutationTemplateOf, /cached evidence/i, "F6 no mention of the reporter's cached evidence"],
];
const fixWaveLeftovers = (texts) => FIX_WAVE_FORBIDDEN.filter(([pick, pattern]) => pattern.test(pick(texts))).map(([, , fact]) => fact);

test('the reviewer-read override, hung-agent override and cached-evidence wording is gone', () => {
  const texts = liveTexts();
  for (const [pick, , fact] of FIX_WAVE_FORBIDDEN) assert.notEqual(pick(texts), '', `region not found for "${fact}"`);
  assert.deepEqual(fixWaveLeftovers(texts), []);
});

test('the retired-wording assertions can go red', () => {
  const plants = [
    "An override's can't-tell outcome is not logged.",
    "resolved via reviewing agent's own Direct-verification override",
    'Cached evidence: {evidence text}',
    'Severity: {severity}  Category: {category}',
    'do not trust the cached evidence text below',
  ];
  FIX_WAVE_FORBIDDEN.forEach(([pick, , fact], i) => {
    const texts = liveTexts();
    const region = pick(texts);
    const key = Object.keys(texts).find((k) => texts[k].includes(region));
    const planted = { ...texts, [key]: texts[key].replace(region, () => `${region} ${plants[i]}`) };
    assert.ok(fixWaveLeftovers(planted).includes(fact), `a planted "${plants[i]}" must turn "${fact}" red`);
  });
});

// F4: the cited sweep heading resolves.
const SWEEP_HEADING = '\n## Post-fan-out untracked-file sweep\n';
const hasSweepHeading = (text) => text.includes(SWEEP_HEADING);

test('the cited Post-fan-out untracked-file sweep heading exists', () => {
  assert.ok(hasSweepHeading(readText(STEP3)));
});

test('the sweep-heading assertion can go red', () => {
  const text = readText(STEP3);
  const stripped = text.replace(SWEEP_HEADING, '\n');
  assert.notEqual(stripped, text, 'anchor heading not found — proof cannot discriminate');
  assert.ok(!hasSweepHeading(stripped), 'stripping the heading must turn the check red');
});

// F6: the refutation template's input carries no reporter content, like Step 3.7's.
test('the refutation template input is the allowlist only', () => {
  const block = refutationTemplateOf(liveTexts());
  const input = block.slice(block.indexOf('Candidate finding:'), block.indexOf('[... READ-ONLY REVIEW'));
  assert.notEqual(input, '', 'the refutation input block was not found');
  assert.ok(!leaksReporterContent(input.split('\n')), 'the refutation input must not carry evidence or reasoning');
  assert.ok(leaksReporterContent([...input.split('\n'), 'Cached evidence: {evidence text}']), 'an evidence line must turn the leak check red');
});

// F15: the evidence window the prose states is the resolver's own constant.
const windowFacts = (n) => [
  [tiebreakTemplate, new RegExp(`a line within ${n} of Location`), "the tiebreak template states the resolver's evidence window"],
  [refutationTemplateOf, new RegExp(`a line within ${n} of \\{line\\}`), "the refutation template states the resolver's evidence window"],
];

test("the templates' evidence window equals LINE_TOLERANCE_REPRODUCTION_WIDE", () => {
  assert.deepEqual(sectionFactsMissing(windowFacts(LINE_TOLERANCE_REPRODUCTION_WIDE))(liveTexts()), []);
});

test('the evidence-window twin pin can go red', () => {
  const n = LINE_TOLERANCE_REPRODUCTION_WIDE;
  const texts = liveTexts();
  const drifted = Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, t.replaceAll(`a line within ${n} of`, `a line within ${n + 4} of`)]));
  assert.notEqual(drifted.tiebreak, texts.tiebreak, 'anchor text not found in the tiebreak template');
  assert.notEqual(drifted.debate, texts.debate, 'anchor text not found in the refutation template');
  assert.deepEqual(sectionFactsMissing(windowFacts(n))(drifted), windowFacts(n).map(([, , fact]) => fact));
});

// F5: the documented STAGED lines surface at the Review Console and a tiebreak `confirmed` supersedes them,
// run through the real console/resolve.js and the real resolver.

function consoleLowItems(decisions) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiebreak-console-'));
  try {
    fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
    fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
    const deps = {
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
      gitApplyCheck: () => ({ ok: true }),
      readGrants: (numbers) => Object.fromEntries(numbers.map((n) => [n, { labels: ['auto:build', 'auto:merge'], pendingSince: null }])),
      now: () => Date.parse('2026-10-22T12:00:00Z'),
    };
    return resolveAll({ runDir, policy: 'console-auto', deps }).items.filter((i) => i.section === 'Low-confidence findings');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

// The one backticked log-line template in `text` that contains every needle.
function documentedTemplate(text, needles) {
  const spans = [...text.matchAll(/`((?:STAGED|AUTO) \{HH:MM:SS\}[^`]*)`/g)].map((m) => m[1]).filter((s) => needles.every((n) => s.includes(n)));
  assert.equal(spans.length, 1, `expected one documented log line containing ${JSON.stringify(needles)}, found ${spans.length}`);
  return spans[0];
}
const instantiate = (template) => `- ${template
  .replace(/\{HH:MM:SS\}/g, '10:00:00')
  .replace(/\{lens[A-Z]?\}/g, '3b')
  .replace(/\{path\}/g, 'src/a.js')
  .replace(/\{line\}/g, '4')
  .replace(/\{[^{}]*\}/g, 'x')}`;

const SOURCE_LINES = ['// one', '// two', '// three', '  const guard = check(value); // the guarded read', '// five'];
function confirmedEntryFor(lens) {
  const finding = { lens, path: 'src/a.js', line: 4, claim: 'the guard is skipped', reporterSeverity: 'medium', kind: 'unconfirmed' };
  const reply = `Verdict: confirmed\nEvidence: src/a.js:4 \`${SOURCE_LINES[3].trim()}\`\nSeverity: medium\nRecommendation: file — real\nSTATUS: DONE`;
  const resolved = resolveTiebreak(finding, reply, { readFile: () => SOURCE_LINES.join('\n'), now: NOW });
  assert.equal(resolved.outcome, 'confirmed');
  return renderVerdictLine(resolved);
}

function consoleProblems(template) {
  const staged = instantiate(template);
  const problems = [];
  if (consoleLowItems(`${staged}\n`).length !== 1) problems.push('does not surface as a Low-confidence item');
  const lens = (/lens "([^"]+)"/.exec(staged) || [])[1];
  if (!lens) problems.push('carries no lens key');
  else if (consoleLowItems(`${staged}\n${confirmedEntryFor(lens)}\n`).length !== 0) problems.push('not superseded by a confirmed tiebreak verdict');
  return problems;
}

const CONSOLE_LINES = [
  ['debate', ['Gap-sweep:', 'single-source by design'], 'F5a the gap-sweep finding line'],
  ['debate', ['converged negative'], 'F5b the debate-converged-negative line'],
  ['debate', ['no usable verdict'], "F5b the refutation can't-tell line"],
];

test('the gap-sweep, debate-negative and refutation-downgrade lines surface and are superseded by a confirmed verdict', () => {
  const texts = liveTexts();
  for (const [key, needles, name] of CONSOLE_LINES) {
    assert.deepEqual(consoleProblems(documentedTemplate(texts[key], needles)), [], name);
  }
});

test('the console-surfacing assertions can go red', () => {
  assert.deepEqual(consoleProblems('STAGED {HH:MM:SS} — Gap-sweep: {path}:{line} — {one-line finding}. Staged to Review Console as low-confidence (gap-sweep, single-source by design). Reversibility: high.'), ['carries no lens key']);
  assert.deepEqual(consoleProblems('AUTO {HH:MM:SS} — Debate: cross-lens disagreement on {path}:{line} converged negative after 1 round. Reversibility: high.'), ['does not surface as a Low-confidence item', 'carries no lens key']);
  assert.deepEqual(consoleProblems('STAGED {HH:MM:SS} — Refutation: lens "{lens}" near src/other.js:9 for {path}:{line} — unconfirmed. Reversibility: high.'), ['not superseded by a confirmed tiebreak verdict']);
});

// F9: the resolver-failure line surfaces and carries no verdict marker.
const resolverFailureLine = (texts) => documentedTemplate(sectionOf(texts.tiebreak, '## Resolve and act'), ['resolve-tiebreak exited']);
const failureLineProblems = (template) => {
  const problems = [];
  if (consoleLowItems(`${instantiate(template)}\n`).length !== 1) problems.push('does not surface as a Low-confidence item');
  if (/tiebreak:/.test(template)) problems.push('carries the tiebreak: marker');
  return problems;
};

test('the resolve-tiebreak failure line surfaces and carries no tiebreak: marker', () => {
  assert.deepEqual(failureLineProblems(resolverFailureLine(liveTexts())), []);
});

test('the resolve-tiebreak failure-line assertions can go red', () => {
  const line = resolverFailureLine(liveTexts());
  assert.deepEqual(failureLineProblems(line.replace('unconfirmed', 'pending')), ['does not surface as a Low-confidence item']);
  assert.deepEqual(failureLineProblems(`${line} tiebreak:abc123def456`), ['carries the tiebreak: marker']);
});

// Final re-review residuals: every unconfirmed source keeps a console-visible line, and the
// two "run the sweep once" sentences name Step 3.7's re-run.
// The share-a-location line comes from its composer (#5595), not the prose; a doctored texts.nearLocation stands in for it.
const NEAR_LOCATION_LINE = formatEntry({ ...coincidence({ lens: '3b', path: 'src/a.js', lineA: 4, lineB: 6 }), now: new Date(2026, 9, 22, 10, 0, 0) });
const nearLocationLine = (texts) => texts.nearLocation || NEAR_LOCATION_LINE;
const partnerDiedParagraph = (texts) => lineStartingWith(texts.tierVariants, '> **Reproduction-pair partner dies or is unavailable.**');
const PER_FINDING_LINE = /per-finding (?:`unconfirmed` )?line/;
function residualProblems(texts) {
  const problems = [];
  if (consoleLowItems(`${nearLocationLine(texts)}\n`).length !== 1) problems.push('nearLocation line does not surface');
  if (!PER_FINDING_LINE.test(hungParagraph(texts))) problems.push('hung-agent findings get no per-finding line');
  if (!PER_FINDING_LINE.test(partnerDiedParagraph(texts))) problems.push('partner-died findings get no per-finding line');
  if (!/Step 3\.7 re-runs it/.test(texts.step3)) problems.push('step3 sweep says once without the Step 3.7 re-run');
  if (!/exactly once \(Step 3\.7 re-runs it/.test(texts.debate)) problems.push('debate sweep says once without the Step 3.7 re-run');
  if (!/logging only what the earlier sweep did not already report/.test(sectionOf(texts.tiebreak, '## Dispatch'))) problems.push('Step 3.7 sweep re-logs earlier leftovers');
  return problems;
}

test('nearLocation, hung-agent and partner-died findings stay console-visible; the sweep re-run is named', () => {
  assert.deepEqual(residualProblems(liveTexts()), []);
});

test('each console-visibility and sweep re-run assertion can go red', () => {
  const live = liveTexts();
  const cases = [
    [{ nearLocation: NEAR_LOCATION_LINE.replace('both staged unconfirmed.', 'both staged.') }, 'nearLocation line does not surface'],
    [{ step3: live.step3.replace(", plus `step3-tier-variants.md`'s low-tier per-finding line for each finding it reports.", '') }, 'hung-agent findings get no per-finding line'],
    [{ tierVariants: live.tierVariants.replace(' plus the low-tier per-finding `unconfirmed` line for each of its findings,', '') }, 'partner-died findings get no per-finding line'],
    [{ step3: live.step3.replace('; Step 3.7 re-runs it once for its own waves (`step3-tiebreak.md`).', '.') }, 'step3 sweep says once without the Step 3.7 re-run'],
    [{ debate: live.debate.replace(' (Step 3.7 re-runs it for its own waves)', '') }, 'debate sweep says once without the Step 3.7 re-run'],
    [{ tiebreak: live.tiebreak.replace(', logging only what the earlier sweep did not already report', '') }, 'Step 3.7 sweep re-logs earlier leftovers'],
  ];
  for (const [patch, expected] of cases) {
    const doctored = { ...live, ...patch };
    const key = Object.keys(patch)[0];
    assert.notEqual(doctored[key], live[key], `anchor for "${expected}" vanished`);
    assert.deepEqual(residualProblems(doctored), [expected]);
  }
});

// --- Failure paths: every failing call has a stated next move, so no finding loses its verdict silently ---

const AUTO_DECISION_LOG = path.join(SKILLS, '_shared', 'auto-decision-log.md');
const failurePathTexts = () => ({
  ...liveTexts(),
  coordination: coordinationText(),
  adlog: readText(AUTO_DECISION_LOG),
});
const refutationStep5Of = (texts) => refutationStep5(texts.debate);
const coordinationNoInlineLine = (texts) => lineStartingWith(texts.coordination, 'No outcome is "ask the user inline."');
const statusSemantics = (texts) => sliceSection(texts.adlog, '\n## Status semantics\n', '\n## ');

const FAILURE_PATHS = [
  // The failure log lines carry branch text, so they ride --text-file.
  [tiebreakSection('Findings artifact'), /passed through `log-decision\.js --text-file` \(never a `--text` argument\)/, 'the artifact-failure line is logged through --text-file'],
  [tiebreakSection('Resolve and act'), /log, through `--text-file` as step 3 does/, 'the resolve-tiebreak failure line is logged through --text-file'],
  // write-findings exit 2 is one fixable entry; only exit 3 or a second failure stops the step.
  [tiebreakSection('Findings artifact'), /Exit 2 means one malformed entry, and stderr names its index/, 'write-findings exit 2 names one malformed entry'],
  [tiebreakSection('Findings artifact'), /fix that entry against `buildFindingsArtifact`'s checks \(`plugin\/bin\/lib\/tiebreak\.js`\) and re-run once/, 'the entry is fixed against buildFindingsArtifact and re-run once'],
  [tiebreakSection('Findings artifact'), /Exit 3, or a second failure, stops this step/, 'only exit 3 or a second failure stops the step'],
  // A log-decision.js failure is retried once, then the outcome is not acted on.
  [tiebreakSection('Resolve and act'), /A non-zero `log-decision\.js` exit is retried once/, 'a log-decision.js failure is retried once'],
  [tiebreakSection('Resolve and act'), /if it still fails, do not act on `outcome`/, 'a second log-decision.js failure blocks acting on the outcome'],
  [tiebreakSection('Resolve and act'), /name the finding in the summary as having no verdict line/, 'the unlogged finding is named in the summary'],
  // A failed dispatch is re-dispatched once before it becomes an empty reply; a dispatched reviewer goes inline.
  [tiebreakSection('Resolve and act'), /is re-dispatched once as a fresh chunk agent/, 'a failed chunk dispatch is re-dispatched once as a fresh chunk agent'],
  [tiebreakSection('Resolve and act'), /`BLOCKED`, `NEEDS_CONTEXT`, a session limit/, 'BLOCKED, NEEDS_CONTEXT and a session limit count as failed'],
  [tiebreakSection('Resolve and act'), /A single-finding agent is never re-dispatched: if it fails \(an empty, failed, timed-out, or non-`DONE` reply\), its reply is passed as an empty reply file/, 'a failed single-finding agent is never re-dispatched but becomes an empty reply'],
  [tiebreakSection('Dispatched reviewer'), /or fails again after its chunk's re-dispatch or its single-finding re-dispatch \(`## Resolve and act`/, 'a dispatched reviewer takes the inline rung for a failed agent too'],
  // The wave wait is bounded, and the fan-out carries its Form B directive.
  [tiebreakSection('Dispatch'), /`step3-lens-dispatch\.md`'s hung single-read agent rule \(its bounded wait and one `SendMessage` nudge\)/, "the wave wait cites the hung single-read agent rule's bound"],
  [tiebreakSection('Dispatch'), /an agent still silent after that is a failed dispatch/, 'an agent silent past the bound is a failed dispatch'],
  [tiebreakSection('Dispatch'), /> \*\*Parallel execution:\*\* Dispatch each wave's tiebreak agents as parallel Task agents — each runs independently[^\n]*Assemble results after all agents complete\./, 'the fan-out carries a Form B parallel-execution directive'],
  // The printed fields include logLine; a standalone resolver failure is reported.
  [tiebreakSection('Resolve and act'), /prints JSON with `outcome`, `severity`, `recommendation`, `logLine`/, 'the printed fields include logLine'],
  [tiebreakSection('Standalone review'), /no verdict \(resolve-tiebreak exited \{exit\}\)/, 'a standalone resolver failure is listed as no verdict'],
  [templateTiebreakSection, /no verdict \(resolve-tiebreak exited \{exit\}\)/, 'the template carries the no-verdict row'],
  // The refutation pass never treats a crashed resolver as a surviving finding.
  [refutationStep5Of, /a non-zero `resolve-tiebreak` exit \(no `outcome`\) → the candidate is downgraded to `unconfirmed`/, 'a refutation resolver crash downgrades the candidate'],
  [refutationStep5Of, /`\{cause\}` `resolve-tiebreak exited \{exit\}`/, 'the downgrade cause names the resolver exit'],
  [refutationStep5Of, /never treats a crashed resolver as a surviving finding/, 'a crashed resolver never leaves a surviving finding'],
  // Shared docs.
  [coordinationNoInlineLine, /On `\/review` they first go to its tiebreak \(`review\/step3-tiebreak\.md`\)/, "/review's unconfirmed findings go to its tiebreak first"],
  [coordinationNoInlineLine, /the caller's Review Console handles what is left/, 'the Review Console handles what the tiebreak leaves'],
  [statusSemantics, /`STAGED` lines \(low-confidence, unconfirmed, contested, debate\) need no `staged\/` file[^\n]*`plugin\/bin\/lib\/console\/resolve\.js`'s `coordinationItems`/, "review's coordination STAGED lines need no staged file"],
];
const failurePathsMissing = sectionFactsMissing(FAILURE_PATHS);

test('every failure path in the tiebreak, the refutation pass and the shared docs has a stated next move', () => {
  const texts = failurePathTexts();
  for (const [pick, , fact] of FAILURE_PATHS) assert.notEqual(pick(texts), '', `region not found for "${fact}"`);
  assert.deepEqual(failurePathsMissing(texts), []);
});

test('each failure-path fact can go red', () => {
  assertEachSectionFactGoesRed(failurePathTexts(), FAILURE_PATHS, failurePathsMissing);
});

// #4026: an agent copies step 2's command block verbatim, so each mode gets its own command. The
// standalone one never carries `--run`: an unset $PIPELINE_RUN_DIR is `--run ""`, which exits 2.
function tiebreakCommandProblems(section) {
  const fences = [...section.matchAll(/([^\n]*)\n\n[ \t]*```bash\n([\s\S]*?)\n[ \t]*```/g)]
    .filter((m) => m[2].includes('resolve-tiebreak'))
    .map((m) => ({ label: m[1], cmd: m[2].trim() }));
  const problems = [];
  if (fences.length !== 2) problems.push(`expected two resolve-tiebreak commands, found ${fences.length}`);
  const pipeline = fences.filter((f) => f.cmd.endsWith('--run "$PIPELINE_RUN_DIR"'));
  const standalone = fences.filter((f) => !f.cmd.includes('--run'));
  if (pipeline.length !== 1 || !/A pipeline run/.test(pipeline[0].label)) problems.push('no labeled pipeline-run command ending in --run "$PIPELINE_RUN_DIR"');
  if (standalone.length !== 1 || !/Standalone/.test(standalone[0].label)) problems.push('no labeled standalone command without --run');
  return problems;
}

const resolveAndAct = () => sectionOf(tiebreakText(), '## Resolve and act');

test('step 2 gives a pipeline-run resolve-tiebreak command with --run and a standalone one without it', () => {
  assert.deepEqual(tiebreakCommandProblems(resolveAndAct()), []);
});

test('the resolve-tiebreak command check can go red: one shared block, or --run on the standalone form', () => {
  const live = resolveAndAct();
  const standaloneLabel = live.indexOf('   Standalone (no run dir)');
  assert.notEqual(standaloneLabel, -1, 'the standalone label anchors the control');
  const afterFence = live.indexOf('```\n', live.indexOf('```bash', standaloneLabel) + 7) + 4;
  const oneBlock = live.slice(0, standaloneLabel) + live.slice(afterFence);
  assert.notEqual(oneBlock, live);
  assert.ok(tiebreakCommandProblems(oneBlock).includes('expected two resolve-tiebreak commands, found 1'), JSON.stringify(tiebreakCommandProblems(oneBlock)));
  const runEverywhere = live.replace(/(resolve-tiebreak "\{path-F\}" "\{path-R\}" --root "\{checkout under review\}" --tier \{tier\})\n/, '$1 --run "$PIPELINE_RUN_DIR"\n');
  assert.notEqual(runEverywhere, live);
  assert.ok(tiebreakCommandProblems(runEverywhere).includes('no labeled standalone command without --run'));
});

// ===== #5540: one tiebreak judge per chunk of at most CHUNK_MAX findings =====

// Every fenced block of a section, in order: the single-finding template first, the chunk template second.
function fencedBlocks(section) {
  return [...section.matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}
const chunkTemplateOf = (section) => {
  const blocks = fencedBlocks(section);
  assert.equal(blocks.length, 2, `## Dispatch must hold the single-finding and the chunk template, found ${blocks.length} fenced blocks`);
  return blocks[1];
};

const CHUNKING = [
  [/chunks of at most \*{0,2}8\b/, 'the entry set is grouped into chunks of at most 8 findings'],
  [/in entry order/, 'the chunks follow entry order'],
  [/one fresh agent per chunk/, 'one fresh agent is dispatched per chunk'],
];
const chunkingMissing = missingFactsOf(CHUNKING);
// The number the chunk sentence states, or null when no chunk sentence is present.
const chunkBound = (text) => {
  const m = /chunks of at most \*{0,2}(\d+)\b/.exec(text);
  return m ? Number(m[1]) : null;
};

test('AC4.1: Dispatch chunks the entry set at the CHUNK_MAX bound', () => {
  const dispatch = sectionOf(tiebreakText(), '## Dispatch');
  assert.deepEqual(chunkingMissing(dispatch), [], '## Dispatch must group the entries into chunks and dispatch one agent per chunk');
  assert.equal(chunkBound(dispatch), CHUNK_MAX, "the chunk sentence's bound must equal tiebreak.js's CHUNK_MAX");
});

test('AC4.1: the chunking assertions can go red', () => {
  const dispatch = sectionOf(tiebreakText(), '## Dispatch');
  assertEachPatternGoesRed(dispatch, CHUNKING, chunkingMissing);
  const drifted = dispatch.replace(/chunks of at most \*{0,2}8\b/, 'chunks of at most **9**');
  assert.notEqual(drifted, dispatch, 'anchor text for the chunk bound not found');
  assert.notEqual(chunkBound(drifted), CHUNK_MAX, 'a bound that drifted from CHUNK_MAX must turn the twin pin red');
});

// The pre-change opening sentence of ## Dispatch (base 1e346e837), pasted as a literal.
const PRE_CHUNK_DISPATCH_SENTENCE = 'One agent per entry, in parallel waves of **8**: dispatch a wave in one batch, wait for every agent of the wave to return, then start the next.';

test('AC4.1: the prose reverted to one agent per finding fails', () => {
  const dispatch = sectionOf(tiebreakText(), '## Dispatch');
  const start = dispatch.indexOf('Plan the chunks in code');
  assert.notEqual(start, -1, 'the chunk sentence was not found');
  const endMarker = 'then start the next.';
  const end = dispatch.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'the chunk sentence end was not found');
  const reverted = dispatch.slice(0, start) + PRE_CHUNK_DISPATCH_SENTENCE + dispatch.slice(end + endMarker.length);
  assert.notEqual(reverted, dispatch);
  assert.deepEqual(chunkingMissing(reverted), CHUNKING.map(([, fact]) => fact), 'the one-agent-per-entry text must fail every chunk fact');
  assert.equal(chunkBound(reverted), null, 'the one-agent-per-entry text states no chunk bound');
});

const CHUNK_TEMPLATE = [
  [/^Id: \{id\}$/m, 'each finding block and each reply block opens with an Id: header'],
  [/^Reply with one block per finding, each opening with its own Id: line copied exactly, then exactly these lines; one status line ends the whole reply:$/m, 'the reply asks for one block per finding, each opening with its Id: line copied exactly'],
  ...REPLY_FORMAT,
  [/Judge each finding on its own: one being right or wrong says nothing about the next\./, 'the judge is told to judge each finding on its own'],
  [/you were deliberately given no account of how any of them was reported/, 'the judge is given no account of how a finding was reported'],
  [/\[Use: \{Capable \| Standard\}/, 'the model profile line is [Use: {Capable | Standard}'],
  [/\[\.\.\. READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section \.\.\.\]/, 'the READ-ONLY REVIEW placeholder line'],
  [/SCRATCH: \{ctx-dir\}\/agent-scratch\/\{agent-id\}/, 'the SCRATCH line'],
];
const chunkTemplateMissing = missingFactsOf(CHUNK_TEMPLATE);
const CHUNK_ALLOWLIST_LABELS = ['Diff scope:', 'Id:', 'Finding:', 'Severity:', 'Location:', 'Positions:'];

test('AC4.1: the chunk template carries the id header and the per-finding reply', () => {
  const template = chunkTemplateOf(sectionOf(tiebreakText(), '## Dispatch'));
  assert.deepEqual(chunkTemplateMissing(template), [], 'the chunk template must carry every contract element');
  const input = inputLinesOf(template);
  assert.deepEqual(labelsOf(input), CHUNK_ALLOWLIST_LABELS, 'the chunk input is the Diff scope line once, then the per-finding allowlist under its Id header');
  assert.ok(!leaksReporterContent(input), 'the chunk input must not mention evidence or reasoning');
});

test('AC4.1: the chunk template assertions can go red', () => {
  const template = chunkTemplateOf(sectionOf(tiebreakText(), '## Dispatch'));
  assertEveryMatchGoesRed(template, CHUNK_TEMPLATE, chunkTemplateMissing);
  const input = inputLinesOf(template);
  assert.notDeepEqual(labelsOf([...input, 'Diff scope: {again}']), CHUNK_ALLOWLIST_LABELS, 'a second Diff scope line must turn the label check red');
  assert.notDeepEqual(labelsOf(input.filter((line) => !line.startsWith('Id:'))), CHUNK_ALLOWLIST_LABELS, 'a dropped Id header must turn the label check red');
  assert.ok(leaksReporterContent([...input, "Evidence: {the reporting agent's quote}"]), 'evidence text in the chunk input must turn the leak check red');
});

// Deliverable 4: the per-chunk failure ladder, then the per-finding one.
const CHUNK_CALL = /run the chunk call once \(with `--run` in a pipeline run\)/;
const UNSETTLED_REDISPATCH = /Every id in its `unsettled` list \(reason `missing` or `duplicated`\) gets one single-finding re-dispatch after that call/;
const CHUNK_LADDER = [
  [tiebreakSection('Placement'), /sharing a chunk agent with up to seven others/, 'each finding shares a chunk agent with up to seven others'],
  [tiebreakSection('Dispatch'), /F=review-\{ctx-id\}-tiebreak-chunk-\{c\}\.json R=review-\{ctx-id\}-tiebreak-chunk-\{c\}-reply\.txt/, 'the chunk entries and reply files are session-tmp paths per chunk'],
  [tiebreakSection('Dispatch'), /a lens 3f vacuity finding's entry carries `vacuity: true`/, 'a lens 3f vacuity entry carries vacuity: true in the chunk file'],
  [tiebreakSection('Resolve and act'), /For an entry carrying `vacuity: true` the code rewrites its block's `Verdict: confirmed` line to `Verdict: cant-tell`, so the dispatcher never edits a chunk reply/, 'the code, not the dispatcher, rewrites a vacuity entry in a chunk reply'],
  [tiebreakSection('Dispatch'), /one number per finding, since no chunk holds more than 8/, '{n} is one number per finding, since no chunk holds more than 8'],
  [tiebreakSection('Dispatch'), /`\(c − 1\) × 8 \+ i \+ 1`/, "a chunk result's per-finding position is (c − 1) × 8 + i + 1"],
  [tiebreakSection('Dispatch'), /On the `plan-chunks` double-failure path there is no output, so `\{n\}` is the finding's 1-based position in E\./, '{n} is the 1-based position in E on the plan-chunks double-failure path'],
  [tiebreakSection('Dispatch'), /in a pipeline run and standalone alike: `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/review-coordination\.js" finding-ids "\{path-F\}"`/, 'the chunk ids come from one finding-ids call over F, in both modes'],
  [tiebreakSection('Dispatch'), /with `\{id\}` the entry's `id` from that chunk's `finding-ids` call/, "the chunk template's {id} is the finding-ids output"],
  [tiebreakSection('Dispatch'), /On exit 2, fix the entry stderr names and re-run it once/, 'a finding-ids exit 2 is fixed and re-run once'],
  [tiebreakSection('Resolve and act'), /On exit 2, fix the chunk file against stderr and re-run the chunk call once/, 'a chunk-call exit 2 is fixed and re-run once'],
  [tiebreakSection('Resolve and act'), /any other exit, or a second failure, gives each of the chunk's findings step 2's no-verdict line/, "only a second chunk-call failure gives each finding step 2's no-verdict line"],
  [tiebreakSection('Resolve and act'), /is re-dispatched once as a fresh chunk agent/, 'a failed chunk reply is re-dispatched once as a fresh chunk agent'],
  [tiebreakSection('Resolve and act'), /its valid blocks are discarded, not settled/, "a failed chunk reply's valid blocks are discarded, not settled"],
  [tiebreakSection('Resolve and act'), /one fresh single-finding agent, the finding's third and last judge attempt/, 'a twice-failed chunk sends each finding to one single-finding agent, its last attempt'],
  [tiebreakSection('Resolve and act'), CHUNK_CALL, 'the chunk call runs once, with --run in a pipeline run'],
  [tiebreakSection('Resolve and act'), UNSETTLED_REDISPATCH, 'each unsettled id gets one single-finding re-dispatch after the chunk call'],
  [tiebreakSection('Resolve and act'), /at most three judge attempts/, 'a finding gets at most three judge attempts'],
  [tiebreakSection('Resolve and act'), /`check-coverage` stays the backstop for an unsettled finding nobody followed up/, 'check-coverage stays the backstop'],
  [tiebreakSection('Dispatched reviewer'), /Fallback ladder, per chunk first, then per finding:/, "the dispatched reviewer's ladder runs per chunk first, then per finding"],
  // Final-review fix wave: a dispatched reviewer's timed-out chunk agent has spent its keep-alive bound
  // (_shared/subagent-dispatch-core.md judges a child silent at the bound in-session), so it is never re-dispatched.
  [tiebreakSection('Resolve and act'), /except a dispatched reviewer's timed-out chunk agent, which has already spent its keep-alive bound, so each of its findings goes straight to the inline rung, with no chunk re-dispatch\./, "a dispatched reviewer's timed-out chunk goes straight to the inline rung, with no chunk re-dispatch"],
  [tiebreakSection('Dispatched reviewer'), /times out at that rule's bound as a chunk agent \(it has spent its keep-alive bound, so its chunk is not re-dispatched\)/, "the dispatched reviewer's ladder reads a timed-out chunk's findings inline, with no re-dispatch"],
  // Final-review fix wave: single-finding follow-ups are capped like chunk agents, so a wave of twice-failed chunks cannot fan out 64 agents.
  [tiebreakSection('Dispatch'), /Single-finding follow-ups \(`## Resolve and act`'s `unsettled`-id re-dispatches and per-finding fallbacks\) go out the same way: in parallel waves of \*\*8\*\*, each wave under that same wait rule\./, 'single-finding follow-ups go out in waves of 8 under the same wait rule'],
];
const chunkLadderMissing = sectionFactsMissing(CHUNK_LADDER);

// The chunk call runs before any unsettled re-dispatch, and no probe call (a chunk call without --run) precedes it.
function ladderOrderProblems(section) {
  const problems = [];
  const call = section.search(CHUNK_CALL);
  const redispatch = section.search(UNSETTLED_REDISPATCH);
  if (call === -1) problems.push('the chunk call marker is missing');
  if (redispatch === -1) problems.push('the unsettled re-dispatch marker is missing');
  if (call !== -1 && redispatch !== -1 && redispatch < call) problems.push('the unsettled re-dispatch comes before the chunk call');
  if (/\bprobe call\b/i.test(section)) problems.push('a probe call is named');
  if (/chunk call[^\n.]*without `--run`/.test(section)) problems.push('a chunk call runs without --run');
  return problems;
}

test('Deliverable 4: the per-chunk failure ladder', () => {
  const texts = liveTexts();
  for (const [pick, , fact] of CHUNK_LADDER) assert.notEqual(pick(texts), '', `region not found for "${fact}"`);
  assert.deepEqual(chunkLadderMissing(texts), []);
  assert.deepEqual(ladderOrderProblems(resolveAndAct()), []);
});

test('Deliverable 4: the failure-ladder assertions can go red', () => {
  assertEachSectionFactGoesRed(liveTexts(), CHUNK_LADDER, chunkLadderMissing);
  const live = resolveAndAct();
  // Permutation: the unsettled re-dispatch sentence moved above the chunk call, both markers kept.
  const sentence = /Every id in its `unsettled` list[^\n]*?\(` Mode: inline\.`\)\./.exec(live);
  assert.ok(sentence, 'the unsettled re-dispatch sentence was not found');
  const withoutSentence = live.replace(sentence[0], '');
  const callAt = withoutSentence.search(CHUNK_CALL);
  assert.notEqual(callAt, -1);
  const moved = withoutSentence.slice(0, callAt) + sentence[0] + ' ' + withoutSentence.slice(callAt);
  assert.notEqual(moved, live);
  assert.deepEqual(ladderOrderProblems(moved), ['the unsettled re-dispatch comes before the chunk call']);
  const absent = live.replace(CHUNK_CALL, 'run it');
  assert.notEqual(absent, live);
  assert.deepEqual(ladderOrderProblems(absent), ['the chunk call marker is missing']);
  const probed = live.replace(CHUNK_CALL, (m) => `first run a probe call to list the unsettled ids, then ${m}`);
  assert.deepEqual(ladderOrderProblems(probed), ['a probe call is named']);
  const noRun = live.replace(CHUNK_CALL, (m) => `run the chunk call once without \`--run\` to list the unsettled ids, then ${m}`);
  assert.deepEqual(ladderOrderProblems(noRun), ['a chunk call runs without --run']);
  // The probe check is anchored on the call phrase: a probe script elsewhere in the section is no probe call.
  assert.deepEqual(ladderOrderProblems(`${live}\nA probe script stays in scratch.`), []);
});

// {n} is defined once, in ## Dispatch; its stride is CHUNK_MAX, and no other definition survives.
const nStride = (text) => {
  const m = /`\(c − 1\) × (\d+) \+ i \+ 1`/.exec(text);
  return m ? Number(m[1]) : null;
};
const RETIRED_N_DEFINITIONS = [/`\{n\}` the entry's position in the set/, /the finding's position in the whole set/];
const nDefinitionProblems = (text) => {
  const problems = [];
  if (nStride(sectionOf(text, '## Dispatch')) !== CHUNK_MAX) problems.push('the {n} stride is not CHUNK_MAX');
  if ((text.match(/A finding's `\{n\}`, everywhere in this step/g) || []).length !== 1) problems.push('{n} is not defined exactly once');
  if (RETIRED_N_DEFINITIONS.some((p) => p.test(text))) problems.push('a second {n} definition survives');
  return problems;
};

test('Minor 4/7: {n} has one definition and its stride equals CHUNK_MAX', () => {
  assert.deepEqual(nDefinitionProblems(tiebreakText()), []);
});

test('Minor 4/7: the {n} assertions can go red', () => {
  const text = tiebreakText();
  const drifted = text.replace('`(c − 1) × 8 + i + 1`', '`(c − 1) × 9 + i + 1`');
  assert.notEqual(drifted, text);
  assert.deepEqual(nDefinitionProblems(drifted), ['the {n} stride is not CHUNK_MAX']);
  assert.deepEqual(nDefinitionProblems(text.replace('(`{n}` as `## Dispatch` defines it)', "(`{n}` the entry's position in the set)")), ['a second {n} definition survives']);
  assert.deepEqual(nDefinitionProblems(`${text}\nA finding's \`{n}\`, everywhere in this step, is something else.`), ['{n} is not defined exactly once']);
});

// Important 1: F is resolved and written before the finding-ids call that reads it.
const F_RESOLVE = 'F=review-{ctx-id}-tiebreak-chunk-{c}.json';
const FINDING_IDS_CALL = 'finding-ids "{path-F}"';
const findingIdsOrderProblems = (dispatch) => {
  const f = dispatch.indexOf(F_RESOLVE);
  const ids = dispatch.indexOf(FINDING_IDS_CALL);
  if (f === -1 || ids === -1) return ['marker missing'];
  return ids < f ? ['finding-ids runs before F is resolved'] : [];
};

test('Important 1: the chunk file is resolved before finding-ids reads it', () => {
  assert.deepEqual(findingIdsOrderProblems(sectionOf(tiebreakText(), '## Dispatch')), []);
});

test('Important 1: the finding-ids order assertion can go red', () => {
  const dispatch = sectionOf(tiebreakText(), '## Dispatch');
  const call = `\`node "\${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" ${FINDING_IDS_CALL}\``;
  assert.ok(dispatch.includes(call), 'the finding-ids call anchor was not found');
  const swapped = dispatch.replace(call, 'it').replace(F_RESOLVE, `${call} ${F_RESOLVE}`);
  assert.notEqual(swapped, dispatch);
  assert.deepEqual(findingIdsOrderProblems(swapped), ['finding-ids runs before F is resolved']);
  assert.deepEqual(findingIdsOrderProblems(dispatch.replaceAll(FINDING_IDS_CALL, 'x')), ['marker missing']);
});

// ===== #5541: the tiebreak judge tier follows the finding's severity =====
// Only `info` findings take the Standard tier; every other severity, a null or unknown one included, stays
// Capable, and a Standard judge that raises a finding to medium or higher is re-judged at Capable.

const collapseWhitespace = (s) => s.replace(/\s+/g, ' ');
const dispatchSection = () => collapseWhitespace(sectionOf(tiebreakText(), '## Dispatch'));
const TIER_ROUTE = /((?:`[a-z]+`(?:, | and )?)+) findings take the `standard` tier/g;
const NULL_TO_STANDARD = /null or unknown[^.]*`standard`/;
const OTHER_SEVERITIES_CAPABLE = 'every other severity, a null or unknown one included, the `capable` tier';

// The problems with the Dispatch section's routing sentences: every sentence that sends severities to the
// standard tier names only info, none sends a null or unknown severity there, and the section says that
// every other one, a null or unknown one included, takes the capable tier.
function tierRoutingProblems(dispatch) {
  const problems = [];
  const routes = [...dispatch.matchAll(TIER_ROUTE)];
  if (routes.length === 0) problems.push('no sentence names the severities that take the standard tier');
  for (const route of routes) {
    const severities = route[1].match(/`([a-z]+)`/g).map((s) => s.slice(1, -1));
    if (JSON.stringify(severities) !== JSON.stringify(['info'])) problems.push(`the standard tier takes ${severities.join(', ')}, not only info`);
  }
  if (NULL_TO_STANDARD.test(dispatch)) problems.push('a null or unknown severity is routed to the standard tier');
  if (!dispatch.includes(OTHER_SEVERITIES_CAPABLE)) problems.push('every other severity, a null or unknown one included, is not routed to the capable tier');
  return problems;
}

test('AC3: the prose routes only info to the Standard tier', () => {
  assert.deepEqual(tierRoutingProblems(dispatchSection()), []);
});

test('AC3: the tier-routing assertions can go red', () => {
  const dispatch = dispatchSection();
  const sentence = '`info` findings take the `standard` tier';
  assert.equal(dispatch.split(sentence).length - 1, 1, 'the routing sentence anchors the controls and occurs once');
  const routes = (replacement) => dispatch.replace(sentence, replacement);
  assert.deepEqual(tierRoutingProblems(routes('`info` and `medium` findings take the `standard` tier')), ['the standard tier takes info, medium, not only info']);
  assert.deepEqual(tierRoutingProblems(routes('`info`, `low` and `medium` findings take the `standard` tier')), ['the standard tier takes info, low, medium, not only info']);
  assert.deepEqual(tierRoutingProblems(routes('`low` findings take the `standard` tier')), ['the standard tier takes low, not only info']);
  assert.deepEqual(tierRoutingProblems(routes('`info` findings take the `capable` tier')), ['no sentence names the severities that take the standard tier']);
  // A second routing sentence is read too: the check no longer stops at the first match.
  assert.deepEqual(tierRoutingProblems(`${dispatch} Also \`medium\` findings take the \`standard\` tier.`), ['the standard tier takes medium, not only info']);
  assert.deepEqual(tierRoutingProblems(`${dispatch} A null or unknown severity takes the \`standard\` tier.`), ['a null or unknown severity is routed to the standard tier']);
  const noNull = dispatch.replace(', a null or unknown one included,', '');
  assert.notEqual(noNull, dispatch);
  assert.deepEqual(tierRoutingProblems(noNull), ['every other severity, a null or unknown one included, is not routed to the capable tier']);
});

// A chunk plan's problems against its entries: no chunk mixes tiers, none exceeds CHUNK_MAX, and every entry is planned once.
function chunkTierProblems(entries, chunks) {
  const problems = [];
  const planned = chunks.flatMap((chunk) => chunk.indexes);
  for (const chunk of chunks) {
    if (chunk.indexes.length > CHUNK_MAX) problems.push(`chunk of ${chunk.indexes.length} exceeds CHUNK_MAX`);
    if (!chunk.indexes.every((i) => judgeTier(entries[i]) === chunk.tier)) problems.push(`a ${chunk.tier} chunk holds an entry of the other tier`);
  }
  if (new Set(planned).size !== entries.length || planned.length !== entries.length) problems.push('the chunks do not plan every entry exactly once');
  return problems;
}

const TIER_ENTRY = { lens: '3a', path: 'plugin/bin/foo.js', line: 20, kind: 'unconfirmed' };
const tierEntry = (claim, reporterSeverity, extra = {}) => ({ ...TIER_ENTRY, claim, reporterSeverity, ...extra });
const MIXED_ENTRIES = [
  ...Array.from({ length: 6 }, (_, i) => tierEntry(`low ${i}`, 'low')),
  tierEntry('info 0', 'info'),
  tierEntry('info 1', 'info'),
  tierEntry('contested info/high', 'info', { kind: 'contested', positions: [{ severity: 'info' }, { severity: 'high' }] }),
  tierEntry('null severity', null),
  // Plan Review Clarification: a null position makes it Capable even though its one known position is info.
  tierEntry('contested info/null', 'info', { kind: 'contested', positions: [{ severity: 'info' }, { severity: null }] }),
];

const CHUNK_TIER_PLAN = [
  [/a chunk never mixes tiers/, 'a chunk never mixes tiers'],
  [/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/review-coordination\.js" plan-chunks "\{path-E\}"`/, 'the chunks come from one plan-chunks call over the entries file E'],
  [/resolved with one plain `session-tmp-resolve\.js` call of its own, before `plan-chunks` runs, in a pipeline run and standalone alike/, 'E is resolved with its own plain session-tmp-resolve.js call, before plan-chunks runs'],
  [/`Write` the chunk's entries as one JSON array to `F` — the entries of E at the chunk's `indexes` from `plan-chunks`, in that order/, "the chunk file holds the entries of E at the chunk's indexes, in that order"],
];
const chunkTierPlanMissing = missingFactsOf(CHUNK_TIER_PLAN);

test('AC3: a chunk holds findings of one tier only', () => {
  const dispatch = dispatchSection();
  assert.deepEqual(chunkTierPlanMissing(dispatch), [], '## Dispatch must plan chunks per tier through plan-chunks');
  const chunks = planChunks(MIXED_ENTRIES);
  assert.deepEqual(chunkTierProblems(MIXED_ENTRIES, chunks), []);
  const tierOf = (claim) => chunks.find((c) => c.indexes.some((i) => MIXED_ENTRIES[i].claim === claim)).tier;
  assert.equal(tierOf('contested info/high'), 'capable');
  assert.equal(tierOf('null severity'), 'capable');
  assert.equal(tierOf('contested info/null'), 'capable', 'a null position severity is Capable even when the known positions are all info');
  assert.deepEqual(chunks.map((c) => c.tier).sort(), ['capable', 'capable', 'standard'], 'the fixture reaches both tiers, and its nine Capable entries span two chunks');
});

test('AC3: the chunk-tier assertions can go red', () => {
  assertEachPatternGoesRed(dispatchSection(), CHUNK_TIER_PLAN, chunkTierPlanMissing);
  // The code half, over hand-built plans: a chunk mixing tiers, an oversize chunk, and a dropped entry each turn it red.
  assert.deepEqual(chunkTierProblems(MIXED_ENTRIES, [{ tier: 'capable', indexes: MIXED_ENTRIES.map((_, i) => i) }]), ['chunk of 11 exceeds CHUNK_MAX', 'a capable chunk holds an entry of the other tier']);
  const real = planChunks(MIXED_ENTRIES);
  const contestedAt = MIXED_ENTRIES.findIndex((e) => e.claim === 'contested info/high');
  const misrouted = real.map((c) => ({ ...c, indexes: c.indexes.filter((i) => i !== contestedAt) }));
  misrouted.find((c) => c.tier === 'standard').indexes.push(contestedAt);
  assert.deepEqual(chunkTierProblems(MIXED_ENTRIES, misrouted), ['a standard chunk holds an entry of the other tier']);
  assert.deepEqual(chunkTierProblems(MIXED_ENTRIES, real.slice(1)), ['the chunks do not plan every entry exactly once']);
});

const MODEL_LINE = [
  [/resolve-profile\.js" capable --run-dir/, 'the Model line resolves the capable tier with resolve-profile.js'],
  [/resolve-profile\.js" standard --run-dir/, 'the Model line resolves the standard tier with resolve-profile.js'],
  [/an escalation re-judge \(`## Resolve and act`\) is always `capable`/, 'an escalation re-judge is always capable'],
];
const modelLineMissing = missingFactsOf(MODEL_LINE);

test('AC3: the Model line resolves each tier with resolve-profile.js', () => {
  assert.deepEqual(modelLineMissing(dispatchSection()), []);
});

test('AC3: the Model-line assertions can go red', () => {
  assertEachPatternGoesRed(dispatchSection(), MODEL_LINE, modelLineMissing);
});

const TIER_FLAG = ' --tier {tier}';
// Each resolve-tiebreak command fence of step 2 carries the agent's tier, so a standard judge's reply is never resolved as capable.
const tierFlagProblems = (section) => {
  const fences = [...section.matchAll(/```bash\n([\s\S]*?)\n[ \t]*```/g)].map((m) => m[1]).filter((cmd) => cmd.includes('resolve-tiebreak'));
  return fences.length === 2 ? fences.filter((cmd) => !cmd.includes(TIER_FLAG)).map(() => 'a resolve-tiebreak command carries no --tier {tier}') : [`expected two resolve-tiebreak commands, found ${fences.length}`];
};

const ESCALATION = [
  [/"escalated": \[\.\.\.\]/, 'the chunk call prints an escalated list'],
  [/step 2's command with the chunk's `F` and `R` and `--tier \{tier\}`/, "the chunk call carries --tier {tier}, the chunk's tier from plan-chunks"],
  [/Every id in its `escalated` list \(reason `raised`/, 'every escalated id is named, reason raised'],
  [/one `capable` single-finding re-judge/, 'an escalated id gets one capable single-finding re-judge'],
  [/the `standard` judge's reply is never logged/, "the standard judge's reply is never logged"],
  [/plus one `capable` re-judge when a `standard` judge raised it/, 'the attempt count adds the one capable re-judge'],
  [/A one-finding call at `--tier standard` that prints `escalated: true` is re-judged the same way/, 'a one-finding escalated:true is re-judged the same way'],
  [/always resolves with `--tier capable`/, 'an inline verdict always resolves with --tier capable'],
  [/The re-judge's entry is the finding's entry from E plus `"severityFloor": "\{severity\}"`, with `\{severity\}` from its `escalated` item \(or the one-finding form's `severity`\), so a failed or can't-tell re-judge still settles at the raised severity\./, "the re-judge's entry carries severityFloor, so a failed re-judge settles at the raised severity"],
  [/At `--tier standard` the one-finding call may print `\{"escalated": true, …\}` in place of a result: nothing is logged, and the finding is re-judged as the `escalated` sentence above says\./, 'step 2 names the escalated: true output form of a one-finding call'],
];
const escalationMissing = missingFactsOf(ESCALATION);

test('AC2: a raised finding is re-judged at Capable', () => {
  const section = collapseWhitespace(resolveAndAct());
  assert.deepEqual(escalationMissing(section), []);
  assert.deepEqual(tierFlagProblems(resolveAndAct()), []);
});

test('AC2: the escalation assertions can go red', () => {
  const section = collapseWhitespace(resolveAndAct());
  assertEachPatternGoesRed(section, ESCALATION, escalationMissing);
  const live = resolveAndAct();
  const stripped = live.replace(`--root "{checkout under review}"${TIER_FLAG}`, '--root "{checkout under review}"');
  assert.notEqual(stripped, live);
  assert.deepEqual(tierFlagProblems(stripped), ['a resolve-tiebreak command carries no --tier {tier}']);
  assert.deepEqual(tierFlagProblems(live.replaceAll(TIER_FLAG, '')), ['a resolve-tiebreak command carries no --tier {tier}', 'a resolve-tiebreak command carries no --tier {tier}']);
});

const ESCALATION_LADDER = [[/whose escalation re-judge \(`## Resolve and act`\) fails or times out/, 'the reviewer reads a finding inline when its escalation re-judge fails or times out']];
const escalationLadderMissing = missingFactsOf(ESCALATION_LADDER);

test('AC2: inline verdicts resolve at --tier capable', () => {
  const reviewer = collapseWhitespace(sectionOf(tiebreakText(), '## Dispatched reviewer'));
  assert.deepEqual(escalationLadderMissing(reviewer), []);
});

test('AC2: the inline-verdict assertions can go red', () => {
  assertEachPatternGoesRed(collapseWhitespace(sectionOf(tiebreakText(), '## Dispatched reviewer')), ESCALATION_LADDER, escalationLadderMissing);
});
