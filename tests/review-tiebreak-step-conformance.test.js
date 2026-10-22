// tests/review-tiebreak-step-conformance.test.js — pins #3947: /review's mandatory tiebreak step
// (plugin/skills/review/step3-tiebreak.md, wired as Step 3.7 in code-mode-steps.md). Every pin carries a
// go-red proof built from the live text (missingFactsOf + assertEachPatternGoesRed, the shape
// tests/review-dispatched-reviewer-degrade-conformance.test.js uses). Later tasks of #3947 append here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { buildFindingsArtifact, resolveTiebreak, checkTiebreakCoverage, findingId } = require('../plugin/bin/lib/tiebreak');
const { formatEntry } = require('../plugin/bin/lib/log-decision/append');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const TIEBREAK = path.join(SKILLS, 'review', 'step3-tiebreak.md');
const CODE_MODE_STEPS = path.join(SKILLS, 'review', 'code-mode-steps.md');

// A fact-list predicate: the facts whose pattern the text no longer matches.
const missingFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);

// Per-assertion go-red proof: strip every match of one pattern from the live text (global, so a phrase the
// file states twice cannot survive the removal), and the shared predicate must report exactly that one fact.
function assertEachPatternGoesRed(text, patterns, missingOf) {
  for (const [pattern, fact] of patterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    const doctored = text.replace(global, '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

// The body of a `## {heading}` section, up to the next `## ` heading (or the end of the file).
function sectionOf(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `step3-tiebreak.md lost its "## ${heading}" section`);
  const bodyStart = start + 1;
  const next = text.indexOf('\n## ', bodyStart + 1);
  return text.slice(bodyStart, next === -1 ? text.length : next);
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
  assertEachPatternGoesRed(tiebreakText(), TIERS_AND_MODES, tiersAndModesMissing);
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
  const placement = sectionOf(tiebreakText(), 'Placement');
  assert.deepEqual(orderProblems(placement, PLACEMENT_ORDER), [], '## Placement must cite the five earlier passes in order');
});

test('AC1.2 the order assertion can go red', () => {
  const placement = sectionOf(tiebreakText(), 'Placement');
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
  assert.deepEqual(entryStatusMissing(sectionOf(tiebreakText(), 'Placement')), [], '## Placement must state both sides of a nearLocation pair enter, each judged on its own');
});

test('AC1.3 the entry-status assertion can go red', () => {
  assertEachPatternGoesRed(sectionOf(tiebreakText(), 'Placement'), ENTRY_STATUS, entryStatusMissing);
});

// --- AC2.1 / AC2.2 / AC12.1: the dispatch prompt ---

const DISPATCH_TEMPLATE = [
  [/\[Use: Capable/, 'the model profile line is [Use: Capable'],
  [/Verdict: confirmed \| refuted \| cant-tell/, 'the Verdict reply line'],
  [/Evidence: \{path\}:\{line\}/, 'the Evidence reply line'],
  [/Severity: critical \| high \| medium \| low \| info/, 'the Severity reply line'],
  [/Recommendation: file \| drop/, 'the Recommendation reply line'],
  [/the last non-empty line of your reply must then read exactly one of: DONE \/ DONE_WITH_CONCERNS \/ NEEDS_CONTEXT \/ BLOCKED, labeled `STATUS: \{WORD\}`/, 'the trailing STATUS instruction'],
  [/\[\.\.\. READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section \.\.\.\]/, 'the READ-ONLY REVIEW placeholder line'],
  [/SCRATCH: \{ctx-dir\}\/agent-scratch\/\{agent-id\}/, 'the SCRATCH line'],
  [/whole (cited )?source line/, 'the evidence quote is the whole cited source line'],
  [/- \{one-line claim\} \(\{severity\}\)/, 'the contested positions line shape'],
];
const dispatchTemplateMissing = missingFactsOf(DISPATCH_TEMPLATE);

test('AC2.1 the dispatch prompt satisfies the subagent contract', () => {
  const template = fencedTemplate(sectionOf(tiebreakText(), 'Dispatch'));
  assert.deepEqual(dispatchTemplateMissing(template), [], 'the fenced dispatch template must carry every contract element');
});

test('AC2.1 the dispatch template assertions can go red', () => {
  assertEachPatternGoesRed(fencedTemplate(sectionOf(tiebreakText(), 'Dispatch')), DISPATCH_TEMPLATE, dispatchTemplateMissing);
});

const hasFrontier = (text) => /Frontier/.test(text);

test('AC2.2 no Frontier in the tiebreak fan-out', () => {
  const dispatch = sectionOf(tiebreakText(), 'Dispatch');
  assert.ok(!hasFrontier(dispatch), '## Dispatch must not name the Frontier profile — a variable-N fan-out is Capable only');
});

test('AC2.2 the Frontier assertion can go red', () => {
  const dispatch = sectionOf(tiebreakText(), 'Dispatch');
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
  const input = inputLinesOf(fencedTemplate(sectionOf(tiebreakText(), 'Dispatch')));
  assert.deepEqual(labelsOf(input), ALLOWLIST_LABELS, 'the input block must carry exactly the allowlisted field labels');
  assert.ok(!leaksReporterContent(input), 'the input block must not mention evidence or reasoning');
});

test('AC12.1 the allowlist assertions can go red', () => {
  const input = inputLinesOf(fencedTemplate(sectionOf(tiebreakText(), 'Dispatch')));
  assert.notDeepEqual(labelsOf([...input, 'Evidence: {the reporting agent\'s quote}']), ALLOWLIST_LABELS, 'an extra input label must turn the field-list check red');
  assert.notDeepEqual(labelsOf(input.filter((line) => !line.startsWith('Diff scope:'))), ALLOWLIST_LABELS, 'a dropped input label must turn the field-list check red');
  assert.ok(leaksReporterContent([...input, 'Reasoning: {the lens agent\'s reasoning}']), 'reasoning text in the input must turn the leak check red');
});

const WAVE = [[/waves of \*{0,2}8\b/, 'the fan-out runs in parallel waves of 8']];
const waveMissing = missingFactsOf(WAVE);

test('Review Focus: the fan-out is bounded to waves of 8', () => {
  assert.deepEqual(waveMissing(sectionOf(tiebreakText(), 'Dispatch')), [], '## Dispatch must name its wave size');
});

test('Review Focus: the wave-size assertion can go red', () => {
  assertEachPatternGoesRed(sectionOf(tiebreakText(), 'Dispatch'), WAVE, waveMissing);
});

const EMPTY_REPLY = [[/empty reply/, 'a failed dispatch is passed as an empty reply']];
const emptyReplyMissing = missingFactsOf(EMPTY_REPLY);

test('Review Focus: an unusable dispatch still produces a verdict line', () => {
  assert.deepEqual(emptyReplyMissing(sectionOf(tiebreakText(), 'Resolve and act')), [], '## Resolve and act must pass a failed dispatch as an empty reply');
});

test('Review Focus: the empty-reply assertion can go red', () => {
  assertEachPatternGoesRed(sectionOf(tiebreakText(), 'Resolve and act'), EMPTY_REPLY, emptyReplyMissing);
});

// --- Fix round 1: logText never rides a shell argument; digest/console are pipeline-run only; the artifact-failure line surfaces ---

const LOG_TEXT_FILE = [
  [/--text-file "\{path-T\}"/, 'the log call passes logText through --text-file'],
  [/T=review-\{ctx-id\}-tiebreak-\{n\}-text\.txt/, 'the text file is a session-tmp path resolved with the finding and reply paths'],
  [/` Mode: inline\.` appended to the content of `T` \(never to a shell argument\)/, 'Mode: inline. is appended to the text file content'],
];
const logTextFileMissing = missingFactsOf(LOG_TEXT_FILE);
const passesTextOnCommandLine = (text) => /--text "/.test(text);

test('fix 1: logText goes through --text-file, never a shell argument', () => {
  const resolveAndAct = sectionOf(tiebreakText(), 'Resolve and act');
  assert.deepEqual(logTextFileMissing(resolveAndAct), [], '## Resolve and act must log through --text-file');
  assert.ok(!passesTextOnCommandLine(resolveAndAct), 'no --text "..." argument: a verbatim source line can carry quotes, $() and backticks');
});

test('fix 1: the --text-file assertions can go red', () => {
  const resolveAndAct = sectionOf(tiebreakText(), 'Resolve and act');
  assertEachPatternGoesRed(resolveAndAct, LOG_TEXT_FILE, logTextFileMissing);
  assert.ok(passesTextOnCommandLine(resolveAndAct.replace('--text-file "{path-T}"', '--text "{logText}"')), 'reverting to --text must turn the check red');
});

const PIPELINE_ONLY = [
  [/- `digest` \(a pipeline run only; `## Standalone review` covers the no-run-dir case\)/, 'the digest action is qualified as pipeline-run only'],
  [/- `console` \(a pipeline run only; `## Standalone review` covers the no-run-dir case\)/, 'the console action is qualified as pipeline-run only'],
];
const pipelineOnlyMissing = missingFactsOf(PIPELINE_ONLY);

test('fix 2: the digest and console actions are pipeline-run only', () => {
  assert.deepEqual(pipelineOnlyMissing(sectionOf(tiebreakText(), 'Resolve and act')), [], 'both bullets must point a standalone review at ## Standalone review');
});

test('fix 2: the pipeline-only qualifiers can go red', () => {
  assertEachPatternGoesRed(sectionOf(tiebreakText(), 'Resolve and act'), PIPELINE_ONLY, pipelineOnlyMissing);
});

const ARTIFACT_FAILURE = [
  [/findings artifact not written \(\{exit\}\); \{N\} findings stay unconfirmed with no tiebreak verdict\./, 'the failure line says the findings stay unconfirmed (so the Review Console surfaces it)'],
  [/lists under the Review Console's Low-confidence section/, 'the failure line lists under the Low-confidence section'],
  [/this line is the only signal/, 'with no artifact this line is the only signal'],
];
const artifactFailureMissing = missingFactsOf(ARTIFACT_FAILURE);

test('fix 3: the artifact-failure line surfaces and states its consequence', () => {
  const section = sectionOf(tiebreakText(), 'Findings artifact');
  assert.deepEqual(artifactFailureMissing(section), [], '## Findings artifact must log a line the console surfaces');
  assert.ok(!/holds the run open/.test(section), 'the archive gate does not hold the run open on an absent artifact');
  // The console surfaces a STAGED line only when it matches console/resolve.js's low-confidence matcher.
  const line = section.match(/`(STAGED [^`]*findings artifact not written[^`]*)`/);
  assert.ok(line, 'the failure log line was not found');
  assert.match(line[1], /low-confidence|not directly verified|unconfirmed/i);
});

test('fix 3: the artifact-failure assertions can go red', () => {
  assertEachPatternGoesRed(sectionOf(tiebreakText(), 'Findings artifact'), ARTIFACT_FAILURE, artifactFailureMissing);
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
  assert.deepEqual(standaloneMissing(sectionOf(tiebreakText(), 'Standalone review')), [], '## Standalone review must state the listing and the no-staging rule');
});

test('AC7.1 the standalone assertions can go red', () => {
  assertEachPatternGoesRed(sectionOf(tiebreakText(), 'Standalone review'), STANDALONE, standaloneMissing);
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
  const dispatched = sectionOf(tiebreakText(), 'Dispatched reviewer');
  assert.deepEqual(dispatchedMissing(dispatched), [], '## Dispatched reviewer must state the mechanism, the fallback ladder and the invariant');
  assert.ok(!/skip dispatch/i.test(dispatched), 'the dispatched-reviewer text must not carry a skip-dispatch carve-out (#3078)');
});

test('AC8.1 the dispatched-reviewer assertions can go red', () => {
  const dispatched = sectionOf(tiebreakText(), 'Dispatched reviewer');
  assertEachPatternGoesRed(dispatched, DISPATCHED, dispatchedMissing);
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

function buildFixtureRun() {
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
  fs.writeFileSync(path.join(dir, 'review-findings.json'), JSON.stringify(artifact));
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${[renderVerdictLine(first), renderVerdictLine(second)].join('\n')}\n`);
  return { dir, artifact, first, second };
}

test('AC3.1 fixture: one verdict line per listed finding, a nearLocation pair judged separately', () => {
  const { dir, artifact, first, second } = buildFixtureRun();
  try {
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AC3.1 the coverage assertion can go red', () => {
  const { dir, artifact } = buildFixtureRun();
  try {
    const decisionsPath = path.join(dir, 'decisions.md');
    const kept = fs.readFileSync(decisionsPath, 'utf8').split('\n').filter((line) => line && !line.includes(`tiebreak:${artifact[1].id}`));
    assert.equal(kept.length, 1, 'anchor line for the second finding not found — proof cannot discriminate');
    fs.writeFileSync(decisionsPath, `${kept.join('\n')}\n`);
    assert.deepEqual(checkTiebreakCoverage(dir).missing, [artifact[1].id], 'dropping one verdict line must report exactly that finding missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

// --- step3-lens-dispatch.md: low tier and the Direct-verification override route through the tiebreak ---

const STEP3 = path.join(SKILLS, 'review', 'step3-lens-dispatch.md');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
const STEP3_BYTE_CEILING = 51584;

const lineStartingWith = (text, prefix) => text.split('\n').find((line) => line.startsWith(prefix)) || '';
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
const lowTierLeftovers = (text) => LOW_TIER_FORBIDDEN.filter(([pattern]) => pattern.test(text)).map(([, fact]) => fact);

test('AC4.1 low tier hands findings to the tiebreak', () => {
  const paragraph = lowTierParagraph(readText(STEP3));
  assert.notEqual(paragraph, '', 'the low-tier single-read paragraph was not found');
  assert.deepEqual(lowTierMissing(paragraph), [], 'the low-tier paragraph must hand findings to the tiebreak');
  assert.deepEqual(lowTierLeftovers(paragraph), [], 'the low-tier paragraph must not keep the old direct-verification path');
});

test('AC4.1 the low-tier assertions can go red', () => {
  const paragraph = lowTierParagraph(readText(STEP3));
  assertEachPatternGoesRed(paragraph, LOW_TIER_REQUIRED, lowTierMissing);
  assert.deepEqual(lowTierLeftovers(`${paragraph} the only path to \`confirmed\` is the Direct-verification override`), ['the old only-path-to-confirmed sentence']);
  assert.deepEqual(lowTierLeftovers(`${paragraph} confirmed via direct verification`), ['the old direct-verification confirmation log line']);
});

// AC4.2: the override stays documented and emits a resolver verdict line.
const OVERRIDE_REQUIRED = [
  [/resolve-tiebreak/, 'the override resolves through resolve-tiebreak'],
  [/Mode: inline\./, 'the override marks its verdict Mode: inline.'],
  [/step3-tiebreak\.md/, 'the override cites the tiebreak step'],
];
const OVERRIDE_FORBIDDEN = [[/the resolution path that actually confirms/, 'the resolution-path-that-actually-confirms sentence']];
const overrideMissing = missingFactsOf(OVERRIDE_REQUIRED);
const overrideLeftovers = (text) => OVERRIDE_FORBIDDEN.filter(([pattern]) => pattern.test(text)).map(([, fact]) => fact);

test('AC4.2 the override stays documented and emits a resolver verdict line', () => {
  const paragraph = overrideParagraph(readText(STEP3));
  assert.notEqual(paragraph, '', 'the Direct-verification override paragraph was not found');
  assert.deepEqual(overrideMissing(paragraph), [], 'the override must route through the resolver');
  assert.deepEqual(overrideLeftovers(paragraph), [], 'the override must not claim to be the resolution path that confirms');
});

test('AC4.2 the override assertions can go red', () => {
  const paragraph = overrideParagraph(readText(STEP3));
  assertEachPatternGoesRed(paragraph, OVERRIDE_REQUIRED, overrideMissing);
  assert.deepEqual(overrideLeftovers(`${paragraph} expect it to be the resolution path that actually confirms a real finding`), ['the resolution-path-that-actually-confirms sentence']);
});

// pointer: the file names the tiebreak step at least twice (low tier + override).
const countOf = (text, needle) => text.split(needle).length - 1;

test('pointer: step3-lens-dispatch.md names step3-tiebreak.md at least twice', () => {
  assert.ok(countOf(readText(STEP3), 'step3-tiebreak.md') >= 2);
});

test('pointer: the count assertion can go red', () => {
  const text = readText(STEP3);
  assert.ok(countOf(text.replaceAll('step3-tiebreak.md', 'step3-other.md'), 'step3-tiebreak.md') < 2);
});

// AC10.1: the rail.
const byteProblems = (bytes) => [
  ...(bytes > STEP3_BYTE_CEILING ? [`over the ${STEP3_BYTE_CEILING} B ceiling`] : []),
  ...(bytes >= RAIL_BYTES ? [`at or over the ${RAIL_BYTES} B rail`] : []),
];

test('AC10.1 step3-lens-dispatch.md stays within its byte ceiling and under the rail', () => {
  assert.deepEqual(byteProblems(fs.statSync(STEP3).size), []);
});

test('AC10.1 the byte-ceiling assertion can go red', () => {
  assert.deepEqual(byteProblems(STEP3_BYTE_CEILING), [], 'the ceiling itself is allowed');
  assert.deepEqual(byteProblems(STEP3_BYTE_CEILING + 1), [`over the ${STEP3_BYTE_CEILING} B ceiling`]);
  assert.deepEqual(byteProblems(RAIL_BYTES), [`over the ${STEP3_BYTE_CEILING} B ceiling`, `at or over the ${RAIL_BYTES} B rail`]);
});
