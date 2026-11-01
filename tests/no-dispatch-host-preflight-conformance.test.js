// tests/no-dispatch-host-preflight-conformance.test.js — pins #4555: a host with no Agent/Task tool
// stops flow/build cleanly before the `subagent` execution strategy runs, instead of silently
// implementing the plan inline. Task 1 pins the policy half: build/execution-mode-policy.md's
// "No-dispatch host (#4555)" section (the stop, the resume command, the SKIP line, the dispatch
// reporting channel). Later tasks append the call-site pins (flow, build, review, dispatch).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const SKILLS = path.join(PLUGIN, 'skills');
const POLICY = path.join(SKILLS, 'build', 'execution-mode-policy.md');

// A fact-list predicate: the facts whose pattern the text no longer matches.
const missingFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);

// Per-assertion go-red proof (the 6bb1bb695 shape): strip one pattern's matched phrase from the live
// text, and the shared predicate must report exactly that one fact missing.
function assertEachPatternGoesRed(text, patterns, missingOf) {
  for (const [pattern, fact] of patterns) {
    const doctored = text.replace(pattern, '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

const lineStartingWith = (text, prefix) => text.split('\n').find((line) => line.startsWith(prefix)) || '';

// The text from `heading` to the next `## ` heading (or EOF). Asserts the heading exists.
function sectionOf(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `heading not found: ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

const POLICY_HEADING = '## No-dispatch host (#4555)';

const POLICY_FACTS = [
  [/`_shared\/subagent-dispatch-core\.md`'s probe, "`ToolSearch` finds none, deferred or otherwise"/, 'AC5.1: cites the canonical no-Agent probe'],
  [/The probe's result decides, never the host's shape/, 'the probe result decides, not fork/pinned shape'],
  [/`\/claude-tweaks:flow` Step 2\.4 runs it whenever the step list includes `build`/, 'AC10.1: flow probes only build step lists'],
  [/`\/claude-tweaks:build` Common Step 1\.5 runs it before Common Step 1\.6's plan reviewer and Common Step 2's `subagent` execution/, 'AC1.3: build enforcement point'],
  [/never implement plan tasks inline, never switch to `batched` on the run's behalf/, 'AC2.2: stop, never inline, never auto-batched'],
  [/^ *BLOCKED — this host has no Agent\/Task tool, so the `subagent` execution strategy cannot run\.$/m, 'AC2.1: BLOCKED cause line'],
  [/^ *Resume from a top-level session:\n *\{resume command\}$/m, 'AC2.1: resume command on its own line'],
  [/`\{resume command\}` depends on how the run was started/, 'AC9.1: resume command depends on entry route'],
  [/Under `\/claude-tweaks:dispatch` \(`run-state\.json` `dispatched: true`\) it is `\/claude-tweaks:dispatch #\{n\}`, to use after dispatch's Settle procedure runs/, 'AC9.2: dispatch route names /claude-tweaks:dispatch #{n}'],
  [/Otherwise it repeats the invocation the stopped run received, keeping its `PIPELINE_RUN_DIR="…"` prefix whenever one was adopted/, 'AC9.3: other routes repeat the invocation, prefix kept'],
  [/When the record already has an open draft PR, that command's open-pr line names `\/claude-tweaks:dispatch resume #\{n\}` whenever resume would accept it \(`dispatch\/open-pr-exclusion-report\.md`\)/, 'AC9.2: an open draft PR routes to dispatch resume'],
  [/Or run it in-session, in human-reviewed batches: `\/claude-tweaks:build \{received target\} batched`/, 'AC3.1: batched named as explicit human choice'],
  [/`\{received target\}` is the `#\{n\}` or design-doc path the build received/, 'AC3.1: design-mode build has no record number'],
  [/Under `subagent-only` that line is omitted/, 'AC3.2: subagent-only omits batched'],
  [/--status SKIP --text "condition: no Agent\/Task tool in this host → fallback: run stopped before build; resume from a top-level session"/, 'AC4.1: SKIP line in condition → fallback shape'],
  [/at flow Step 2\.4 only when it already has `config\.yml`/, 'D3: flow 2.4 logs only into a dir with config.yml'],
  [/otherwise the `SKIP` text goes in the stop report only, so a resume never adopts the directory as a recovery \(`flow\/steps-and-gates\.md`'s case 3\)/, 'D3: no config.yml → stop report only, never case 3'],
  [/Under `\/claude-tweaks:dispatch` \(`run-state\.json` `dispatched: true`, headless or not\), report through its existing channel/, 'AC4.2: every dispatched call reports the gate line, not only headless'],
  [/`OUTCOME: build-test-blocked`, `STATUS: BLOCKED`, `ISSUE #\{n\}: failed:no-dispatch-host` — never a new outcome word/, 'AC4.2: dispatch headless reports build-test-blocked'],
  [/Settle treats it as a pre-flight stop \(`dispatch\/settle-and-merge\.md`'s No-dispatch-host special case\)/, 'D4: policy points at the Settle special case'],
  [/This stop tears nothing down itself/, 'resume leaves state in place'],
  [/under `current-branch` the open-items ledger flow Step 1 created/, 'current-branch ledger stays in place'],
  [/A flow resume whose step list omits `build` is not probed here/, 'AC10.2: build-less resumes proceed'],
  [/`assess-agent-autonomy`'s `merge-check` then routes that run's merge to a human/, 'AC10.3: a build-less degraded review routes its merge to a human'],
  [/a choice for a human and never taken automatically/, 'AC3.1: batched is never taken automatically'],
  [/before it claims targets or creates a worktree, fresh or resumed/, 'AC1.2: flow preflight precedes claim and worktree, fresh or resumed'],
];
const policyMissing = missingFactsOf(POLICY_FACTS);

test('AC5.1 AC1.2 AC1.3 AC2.1 AC2.2 AC3.1 AC3.2 AC4.1 AC4.2 AC9.1 AC9.2 AC9.3 AC10.1 AC10.2 AC10.3 AC11.1 AC11.2 AC12.1: execution-mode-policy.md states the no-dispatch-host stop (#4555)', () => {
  const section = sectionOf(readText(POLICY), POLICY_HEADING);
  assert.deepEqual(policyMissing(section), [], 'the No-dispatch host section must state every fact of the stop (#4555)');
});

test('AC8.2: each policy fact can go red', () => {
  const section = sectionOf(readText(POLICY), POLICY_HEADING);
  assertEachPatternGoesRed(section, POLICY_FACTS, policyMissing);
});

// Item 1's dispatch-route sentence (not item 4's, whose parenthetical adds ", headless or not").
const DISPATCH_ROUTE_SENTENCE = /Under `\/claude-tweaks:dispatch` \(`run-state\.json` `dispatched: true`\) it is[\s\S]*?Settle procedure runs\./;

function dispatchRouteSentence(section) {
  const found = section.match(DISPATCH_ROUTE_SENTENCE);
  assert.ok(found, 'the dispatch-route sentence of resume-command item 1 was not found');
  return found[0];
}

test('AC9.2: the dispatch route never names the prefixed flow invocation', () => {
  const section = sectionOf(readText(POLICY), POLICY_HEADING);
  const sentence = dispatchRouteSentence(section);
  assert.ok(!sentence.includes('PIPELINE_RUN_DIR'), 'the dispatch route must name /claude-tweaks:dispatch #{n}, never a PIPELINE_RUN_DIR-prefixed flow invocation');

  // Control: the same check on a copy with the prefix inside that sentence must fail. A dotted token
  // ("a.b") precedes it, so a first-"." sentence end would miss the prefix — the extraction must not.
  const doctored = section.replace(sentence, sentence.replace('to use after', 'to use a.b PIPELINE_RUN_DIR="x" after'));
  assert.notEqual(doctored, section, 'anchor text for the dispatch-route sentence not found — control cannot discriminate');
  assert.ok(dispatchRouteSentence(doctored).includes('PIPELINE_RUN_DIR'), 'the control copy must trip the same check');
});

// --- Call sites: flow Step 2.4 and build Common Step 1.5 (Task 2) ---

const FLOW_SKILL = path.join(SKILLS, 'flow', 'SKILL.md');
const BUILD_SKILL = path.join(SKILLS, 'build', 'SKILL.md');
const FLOW_ITEM_PREFIX = '- 2.4 — Dispatch-capability preflight (#4555).';
const BUILD_PARA_PREFIX = '**Dispatch-capability preflight (#4555), first, whatever this step\'s skip gate decides:**';

const flowItemOf = (text) => lineStartingWith(text, FLOW_ITEM_PREFIX);
const buildParaOf = (text) => lineStartingWith(text, BUILD_PARA_PREFIX);

const FLOW_FACTS = [
  [/When the step list includes `build`/, 'AC10.1: flow gates only a step list with build'],
  [/on every entry — fresh, or a resume \(a step-list resume or an adopted `PIPELINE_RUN_DIR`\)/, 'AC1.2: flow runs it again on a build resume'],
  [/`_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC1.1: flow cites the probe'],
  [/before 2\.5-2\.8, so a host that can never build leaves no claim or draft PR behind/, 'AC1.2: flow runs it before claim and worktree creation'],
  [/A step list without `build` skips it \(review's run-level \*\*Independence: degraded\*\* caveat covers that run\)/, 'AC10.2: build-less resumes proceed'],
  [/stop BLOCKED per `build\/execution-mode-policy\.md`'s No-dispatch host section/, 'AC2.1: flow stop cites the policy section'],
  [/never implement plan tasks inline/, 'AC2.2: flow never inline'],
];
const BUILD_FACTS = [
  [/before Common Step 1\.6's plan reviewer and Common Step 2's `subagent` execution/, 'AC1.3: build runs it before subagent execution (and before 1.6)'],
  [/`_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC1.1: build cites the probe'],
  [/stop BLOCKED per `execution-mode-policy\.md`'s No-dispatch host section/, 'AC2.1: build stop cites the policy section'],
  [/never implement the plan's tasks inline, and never switch to `batched` on the run's behalf/, 'AC2.2: build never inline, never auto-batched'],
];
const flowMissing = missingFactsOf(FLOW_FACTS);
const buildMissing = missingFactsOf(BUILD_FACTS);

test('AC1.1 AC1.2 AC2.1 AC2.2 AC10.1 AC10.2: flow Step 2.4 runs the dispatch-capability preflight (#4555)', () => {
  const item = flowItemOf(readText(FLOW_SKILL));
  assert.ok(item, `flow SKILL.md has no "${FLOW_ITEM_PREFIX}" line`);
  assert.deepEqual(flowMissing(item), [], 'flow Step 2.4 must state every fact of the preflight (#4555)');
});

test('AC8.2: each flow Step 2.4 fact can go red', () => {
  const item = flowItemOf(readText(FLOW_SKILL));
  assert.ok(item, `flow SKILL.md has no "${FLOW_ITEM_PREFIX}" line`);
  assertEachPatternGoesRed(item, FLOW_FACTS, flowMissing);
});

test('AC1.1 AC1.3 AC2.1 AC2.2: build Common Step 1.5 runs the dispatch-capability preflight (#4555)', () => {
  const para = buildParaOf(readText(BUILD_SKILL));
  assert.ok(para, `build SKILL.md has no "${BUILD_PARA_PREFIX}" paragraph`);
  assert.deepEqual(buildMissing(para), [], 'build Common Step 1.5 must state every fact of the preflight (#4555)');
});

test('AC8.2: each build Common Step 1.5 fact can go red', () => {
  const para = buildParaOf(readText(BUILD_SKILL));
  assert.ok(para, `build SKILL.md has no "${BUILD_PARA_PREFIX}" paragraph`);
  assertEachPatternGoesRed(para, BUILD_FACTS, buildMissing);
});

test('AC1.2: flow 2.4 precedes 2.8 (claim)', () => {
  const text = readText(FLOW_SKILL);
  const preflight = '- 2.4 — Dispatch-capability preflight';
  const claim = '- 2.8 — Claim the targets';
  const precedes = (t) => t.indexOf(preflight) >= 0 && t.indexOf(preflight) < t.indexOf(claim);
  assert.ok(precedes(text), 'Step 2.4 must come before the 2.8 claim');

  // Control: swap the two lines in memory — the comparison must flip.
  const lines = text.split('\n');
  const a = lines.findIndex((l) => l.startsWith(preflight));
  const b = lines.findIndex((l) => l.startsWith(claim));
  assert.ok(a >= 0 && b >= 0, 'both lines must exist for the swap control');
  [lines[a], lines[b]] = [lines[b], lines[a]];
  const swapped = lines.join('\n');
  assert.notEqual(swapped, text, 'the swap control must change the text');
  assert.ok(!precedes(swapped), 'the swapped copy must fail the ordering check');
});

test('AC1.3: build preflight sits in Common Step 1.5, before Common Step 1.6', () => {
  const text = readText(BUILD_SKILL);
  const h15 = '### Common Step 1.5: Plan Audit';
  const h16 = '### Common Step 1.6: Plan Review';
  const placed = (t) => {
    const at = t.indexOf(buildParaOf(t));
    return at > t.indexOf(h15) && t.indexOf(h15) >= 0 && at < t.indexOf(h16);
  };
  assert.ok(placed(text), 'the preflight paragraph must sit between the 1.5 and 1.6 headings');

  // Control: move the paragraph after the 1.6 heading line in memory — the check must fail.
  const para = buildParaOf(text);
  const without = text.replace(`${para}\n`, '');
  const h16Line = without.split('\n').find((l) => l.startsWith(h16));
  const moved = without.replace(h16Line, `${h16Line}\n\n${para}`);
  assert.notEqual(moved, without, 'the move control must change the text');
  assert.ok(!placed(moved), 'the moved copy must fail the placement check');
});

test('AC2.2: neither SKILL.md tells the agent to implement plan tasks inline', () => {
  const INLINE = /(?:implement|execute|run)(?:s|ing)? (?:the plan(?:'s tasks)?|plan tasks|the tasks) inline/i;
  const offenders = (text) => text.split('\n').filter((line) => INLINE.test(line) && !/never (?:implement|execute|run)/i.test(line));
  for (const file of [FLOW_SKILL, BUILD_SKILL]) {
    assert.deepEqual(offenders(readText(file)), [], `${path.basename(path.dirname(file))}/SKILL.md must not instruct inline implementation of plan tasks`);
  }

  // Control: an affirmative instruction appended to a copy must be reported.
  const doctored = `${readText(FLOW_SKILL)}\nImplement plan tasks inline.`;
  assert.deepEqual(offenders(doctored), ['Implement plan tasks inline.'], 'the sweep must report an affirmative inline instruction');
  assert.deepEqual(offenders('Execute the tasks inline.'), ['Execute the tasks inline.'], 'the sweep must catch the execute/run synonyms');
});

test('AC1.3: no build hand-off line skips Common Step 1.5 by proceeding straight to Common Step 2', () => {
  const SKIPS = /Proceed to \*\*Common Step 2\*\*/;
  const offenders = (text) => text.split('\n').filter((line) => SKIPS.test(line));
  for (const file of [BUILD_SKILL, path.join(SKILLS, 'build', 'micro-plan.md')]) {
    assert.deepEqual(offenders(readText(file)), [], `${path.basename(file)} must proceed to Common Step 1.5, whose preflight runs before Common Step 2`);
  }

  // Control: appending the skipping line to a copy must be reported.
  const doctored = `${readText(BUILD_SKILL)}\nProceed to **Common Step 2**.`;
  assert.deepEqual(offenders(doctored), ['Proceed to **Common Step 2**.'], 'the check must report a line that skips Common Step 1.5');
});
