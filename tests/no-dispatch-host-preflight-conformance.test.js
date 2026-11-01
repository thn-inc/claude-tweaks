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
  [/--run "\$PIPELINE_RUN_DIR" --section "\/\{flow\|build\}" --step "\{Step 2\.4 \| Common Step 1\.5\} dispatch-capability preflight \(skipped\)" /, 'AC4.1: SKIP line carries the canonical --section and --step flags'],
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
  [/That file's self-judge fallback covers read-only lens and judge units, never plan implementation\./, 'F3: states its departure from the probe\'s self-judge fallback'],
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

// --- Cwd-pinned pointer in build/worktree-setup.md (Task 3) ---

const WORKTREE_SETUP = path.join(SKILLS, 'build', 'worktree-setup.md');
const POINTER_PREFIX = '**Cwd-pinned session (#4555).**';
const pointerOf = (text) => lineStartingWith(text, POINTER_PREFIX);

const POINTER_FACTS = [
  [/`dispatch\/sequential-execution\.md`'s "When the dispatching session itself is cwd-pinned \(#447\)" section/, 'AC7.1: cites the #447 section'],
  [/that mechanism is not restated here/, 'AC7.1: pointer, not a copy'],
  [/is not a no-dispatch host \(`execution-mode-policy\.md`'s No-dispatch host section\)/, 'a pinned session with Agent is not stopped'],
];
const pointerMissing = missingFactsOf(POINTER_FACTS);

test('AC7.1: build/worktree-setup.md points a cwd-pinned session at dispatch\'s #447 section (#4555)', () => {
  const para = pointerOf(readText(WORKTREE_SETUP));
  assert.ok(para, `build/worktree-setup.md has no "${POINTER_PREFIX}" paragraph`);
  assert.deepEqual(pointerMissing(para), [], 'the cwd-pinned pointer must state every fact (#4555)');
});

test('AC8.2: each cwd-pinned pointer fact can go red', () => {
  const para = pointerOf(readText(WORKTREE_SETUP));
  assert.ok(para, `build/worktree-setup.md has no "${POINTER_PREFIX}" paragraph`);
  assertEachPatternGoesRed(para, POINTER_FACTS, pointerMissing);
});

test('AC7.1: build/worktree-setup.md carries no second copy of the #447 mechanism', () => {
  // Any backticked `cd {worktree…} &&` form — dispatch's sequential-execution.md spells it both
  // `cd {worktree-path} &&` (line 18) and `cd {worktree} &&` (line 104).
  const CD_PREFIX = /`cd \{worktree[^`]*&&`/g;
  const offenders = (text) => text.match(CD_PREFIX) || [];
  assert.deepEqual(offenders(readText(WORKTREE_SETUP)), [], 'worktree-setup.md must point at the #447 section, not restate its cd-prefix mechanism');

  // Controls: each spelling appended to a copy must be reported.
  for (const variant of ['`cd {worktree-path} &&`', '`cd {worktree} &&`']) {
    const doctored = `${readText(WORKTREE_SETUP)}\nPrefix each call with ${variant}.`;
    assert.deepEqual(offenders(doctored), [variant], `the check must report a restated ${variant} mechanism`);
  }
});

test('AC7.1: the headings the cwd-pinned pointer cites exist', () => {
  const CITED = [
    [path.join(SKILLS, 'dispatch', 'sequential-execution.md'), '## When the dispatching session itself is cwd-pinned (#447)'],
    [POLICY, POLICY_HEADING],
  ];
  const hasHeading = (text, heading) => text.split('\n').includes(heading);
  for (const [file, heading] of CITED) {
    const text = readText(file);
    assert.ok(hasHeading(text, heading), `${path.basename(file)} must carry the line "${heading}"`);

    // Control: a copy with the heading renamed must fail the same check.
    const renamed = text.replace(heading, `${heading} (renamed)`);
    assert.notEqual(renamed, text, `heading anchor for ${path.basename(file)} not found — control cannot discriminate`);
    assert.ok(!hasHeading(renamed, heading), `a renamed heading in ${path.basename(file)} must fail the check`);
  }
});

// --- merge-check's Independence: degraded floor (Task 5) ---

const MERGE_CHECK = path.join(SKILLS, 'assess-agent-autonomy', 'merge-check.md');
const REVIEW_STEP3 = path.join(SKILLS, 'review', 'step3-lens-dispatch.md');
const MERGE_FLOOR_PREFIX = '- **An `Independence: degraded` review is a hard floor (#4555)**';
const REVIEW_SKIP_PREFIX = '> **No `Agent` tool in this host (run-level, #4555).**';
const SKIP_TEXT = /condition: no Agent tool in this host → fallback: [^"`]+/;

const MERGE_FLOOR_FACTS = [
  [/if `\$PIPELINE_RUN_DIR\/decisions\.md` — or, when `--pack` was passed, the `decisions\.md` beside that pack/, 'AC10.3: names the run-dir decisions.md (and the one beside --pack)'],
  [/, and for a bundle member #\{n\} the `spec-\{n\}\/decisions\.md` under the group run directory/, 'AC10.3: a bundle member\'s spec-{n}/decisions.md under the group run directory is read too'],
  [/ — carries `\/claude-tweaks:review`'s run-level no-`Agent` `SKIP` line/, 'AC10.3: keys on review\'s run-level SKIP line'],
  [/`condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself`/, 'AC10.3: quotes the exact SKIP text'],
  [/or its review summary rendered the \*\*Independence: degraded\*\* line \(with no run directory to read, that summary line alone decides\), render `needs-human`/, 'AC10.3: renders needs-human; no run dir → summary line decides'],
  [/so its merge routes to a human\. Do not weigh anything else\./, 'AC10.3: merge decision routes to a human, hard floor'],
];
const mergeFloorMissing = missingFactsOf(MERGE_FLOOR_FACTS);

test('AC10.3: merge-check renders needs-human for an Independence: degraded review (#4555)', () => {
  const bullet = lineStartingWith(readText(MERGE_CHECK), MERGE_FLOOR_PREFIX);
  assert.ok(bullet, `merge-check.md has no "${MERGE_FLOOR_PREFIX}" bullet`);
  assert.deepEqual(mergeFloorMissing(bullet), [], 'the Independence floor bullet must state every fact (#4555)');
});

test('AC8.2: each merge-check Independence-floor fact can go red', () => {
  const bullet = lineStartingWith(readText(MERGE_CHECK), MERGE_FLOOR_PREFIX);
  assert.ok(bullet, `merge-check.md has no "${MERGE_FLOOR_PREFIX}" bullet`);
  assertEachPatternGoesRed(bullet, MERGE_FLOOR_FACTS, mergeFloorMissing);
});

test('AC10.3: the SKIP text merge-check reads is the text review writes', () => {
  const reviewLine = lineStartingWith(readText(REVIEW_STEP3), REVIEW_SKIP_PREFIX);
  const bullet = lineStartingWith(readText(MERGE_CHECK), MERGE_FLOOR_PREFIX);
  assert.ok(reviewLine, `step3-lens-dispatch.md has no "${REVIEW_SKIP_PREFIX}" line`);
  assert.ok(bullet, `merge-check.md has no "${MERGE_FLOOR_PREFIX}" bullet`);
  const textIn = (line) => (line.match(SKIP_TEXT) || [null])[0];
  assert.ok(textIn(reviewLine), 'review line carries no SKIP text');
  assert.equal(textIn(bullet), textIn(reviewLine), 'merge-check must quote the exact SKIP text review writes');

  // Control: a drifted review line must fail the same comparison.
  const drifted = reviewLine.replace('reviewer itself', 'reviewer');
  assert.notEqual(drifted, reviewLine, 'drift anchor not found — control cannot discriminate');
  assert.notEqual(textIn(bullet), textIn(drifted), 'a drifted review SKIP text must fail the equality check');
});

test('the Calibration closing sentence lists the Independence floor', () => {
  const NEW_SENTENCE = /Every floor stated above still applies on its own terms: a\s+sensitive-path hit renders `needs-human` with nothing else weighed, and so do any review finding\s+at Medium or above and an `Independence: degraded` review\./;
  const text = readText(MERGE_CHECK);
  assert.match(text, NEW_SENTENCE);
  const hasOldWording = (t) => t.includes('Both floors stated above');
  assert.ok(!hasOldWording(text), 'the "Both floors" wording must be gone');

  // Control: a copy with the old phrase appended must fail the absence check.
  const withOld = `${text}\nBoth floors stated above`;
  assert.notEqual(withOld, text, 'control copy must differ');
  assert.ok(hasOldWording(withOld), 'the absence check must catch a reintroduced "Both floors" wording');

  // Control: the pre-change sentence must fail the same assertion.
  const OLD_SENTENCE = 'Both floors stated above still apply on their own terms: a\nsensitive-path hit renders `needs-human` with nothing else weighed, and so does any review finding\nat Medium or above.';
  assert.ok(!NEW_SENTENCE.test(OLD_SENTENCE), 'the pre-change sentence must not satisfy the new pin');
});

test('merge-check Anti-Patterns names the Independence floor', () => {
  const PREFIX = '| Rendering `auto-merge` after a review marked `Independence: degraded` |';
  const text = readText(MERGE_CHECK);
  assert.ok(lineStartingWith(text, PREFIX), `merge-check.md Anti-Patterns has no row starting ${PREFIX}`);

  // Control: a copy of the live text with that row removed must fail the same check.
  const mutated = text.split('\n').filter((line) => !line.startsWith(PREFIX)).join('\n');
  assert.notEqual(mutated, text, 'row anchor not found — control cannot discriminate');
  assert.equal(lineStartingWith(mutated, PREFIX), '', 'removing the row must turn the check red');
});

// --- dispatch's Settle: a no-dispatch-host stop is a pre-flight stop (Task 6) ---

const SETTLE = path.join(SKILLS, 'dispatch', 'settle-and-merge.md');
const SETTLE_PREFIX = '**No-dispatch-host special case (#4555).**';
const SETTLE_STEP1 = '1. The CLI in step 2 performs the ownership read itself';
const settleParaOf = (text) => lineStartingWith(text, SETTLE_PREFIX);

const SETTLE_FACTS = [
  [/`ISSUE #\{n\}: failed:no-dispatch-host`/, 'D4: Settle recognizes the stop by its gate line'],
  [/treat it as a pre-flight stop, like the claims-branch-missing stop above/, 'D4: pre-flight-stop special case'],
  [/so no claim of this run's exists/, 'D4: no claim of this run\'s exists at the stop'],
  [/Skip steps 1-7: no release, no `failure-check` classification, no attempt counted against `dispatch-retry-ceiling`, no failure comment/, 'D4: steps 1-7 skipped — no release, classification, retry count or failure comment'],
  [/read `_shared\/headless-self-report\.md` and follow its dedup-and-file procedure/, 'D4: headless self-report'],
  [/failing-check-name `flow-step-2\.4-no-dispatch-host`/, 'D4: self-report name'],
];
const settleMissing = missingFactsOf(SETTLE_FACTS);

test('AC12.1 AC12.2: Settle settles a no-dispatch-host stop as a pre-flight stop (#4555)', () => {
  const paragraph = settleParaOf(readText(SETTLE));
  assert.ok(paragraph, `settle-and-merge.md has no "${SETTLE_PREFIX}" paragraph`);
  assert.deepEqual(settleMissing(paragraph), [], 'the Settle special case must state every fact (#4555)');
});

test('AC8.2: each Settle no-dispatch-host fact can go red', () => {
  const paragraph = settleParaOf(readText(SETTLE));
  assert.ok(paragraph, `settle-and-merge.md has no "${SETTLE_PREFIX}" paragraph`);
  assertEachPatternGoesRed(paragraph, SETTLE_FACTS, settleMissing);
});

test('AC12.1: the special case sits before Settle step 1', () => {
  const placed = (text) => {
    const at = text.indexOf(SETTLE_PREFIX);
    return at >= 0 && at < text.indexOf(SETTLE_STEP1);
  };
  const text = readText(SETTLE);
  assert.ok(text.includes(SETTLE_STEP1), 'Settle step 1 anchor not found');
  assert.ok(placed(text), 'the No-dispatch-host special case must precede Settle step 1');

  // Control: a copy with the paragraph removed and re-inserted after the END of step 1's full line
  // must fail the same check.
  const paragraph = settleParaOf(text);
  assert.ok(paragraph, `settle-and-merge.md has no "${SETTLE_PREFIX}" paragraph`);
  const without = text.replace(`${paragraph}\n\n`, '');
  const step1End = without.indexOf('\n', without.indexOf(SETTLE_STEP1));
  assert.notEqual(step1End, -1, 'step 1 line end not found — control cannot discriminate');
  const moved = `${without.slice(0, step1End)}\n\n${paragraph}${without.slice(step1End)}`;
  assert.notEqual(moved, text, 'move anchor not found — control cannot discriminate');
  assert.ok(!placed(moved), 'a paragraph moved after step 1 must turn the placement check red');
});

test('AC12.1: Settle and the policy section name the same gate', () => {
  const GATE = 'failed:no-dispatch-host';
  const policySection = sectionOf(readText(POLICY), POLICY_HEADING);
  const paragraph = settleParaOf(readText(SETTLE));
  assert.ok(paragraph, `settle-and-merge.md has no "${SETTLE_PREFIX}" paragraph`);
  const namesGate = (t) => t.includes(GATE);
  assert.ok(namesGate(policySection), 'the policy section must name the gate token');
  assert.ok(namesGate(paragraph), 'the Settle paragraph must name the same gate token');

  // Control: a drifted Settle paragraph must fail the same check.
  const drifted = paragraph.replaceAll('no-dispatch-host', 'no-dispatch');
  assert.notEqual(drifted, paragraph, 'drift anchor not found — control cannot discriminate');
  assert.ok(!namesGate(drifted), 'a Settle paragraph with a drifted gate token must turn the check red');
});

// --- dispatch's reporting.md relays the stop to the human (final-review F2) ---

const REPORTING = path.join(SKILLS, 'dispatch', 'reporting.md');
const RELAY_PREFIX = '**No-dispatch-host stops are relayed (#4555).**';
const relayParaOf = (text) => lineStartingWith(text, RELAY_PREFIX);

const RELAY_FACTS = [
  [/When a group's first call reports `ISSUE #\{n\}: failed:no-dispatch-host`/, 'F2: keyed on the gate line'],
  [/this host has no Agent\/Task tool, so the `subagent` execution strategy cannot run/, 'F2: names the cause'],
  [/closes with the resume command on its own line, `\/claude-tweaks:dispatch #\{n\}`, to run from a top-level session/, 'F2: closes with the resume command'],
  [/\(`build\/execution-mode-policy\.md`'s No-dispatch host section\)/, 'F2: cites the policy section'],
];
const relayMissing = missingFactsOf(RELAY_FACTS);

test('F2: dispatch reporting.md relays a no-dispatch-host stop to the human (#4555)', () => {
  const para = relayParaOf(readText(REPORTING));
  assert.ok(para, `reporting.md has no "${RELAY_PREFIX}" paragraph`);
  assert.deepEqual(relayMissing(para), [], 'the relay paragraph must state every fact (#4555)');
});

test('F2: each reporting.md relay fact can go red', () => {
  const para = relayParaOf(readText(REPORTING));
  assert.ok(para, `reporting.md has no "${RELAY_PREFIX}" paragraph`);
  assertEachPatternGoesRed(para, RELAY_FACTS, relayMissing);
});

test('F2: the relay paragraph sits directly after the plan-review relay paragraph', () => {
  const PLAN_REVIEW = '**Plan-review questions are relayed, not dropped (#3377).**';
  const adjacent = (text) => {
    const lines = text.split('\n');
    const at = lines.findIndex((line) => line.startsWith(PLAN_REVIEW));
    return at >= 0 && lines[at + 1] === '' && lines[at + 2] !== undefined && lines[at + 2].startsWith(RELAY_PREFIX);
  };
  const text = readText(REPORTING);
  assert.ok(adjacent(text), 'the relay paragraph must follow the plan-review relay paragraph');

  // Control: a copy with the relay paragraph removed must fail the same check.
  const without = text.split('\n').filter((line) => !line.startsWith(RELAY_PREFIX)).join('\n');
  assert.notEqual(without, text, 'the removal control must change the text');
  assert.ok(!adjacent(without), 'a copy without the relay paragraph must fail the adjacency check');
});
