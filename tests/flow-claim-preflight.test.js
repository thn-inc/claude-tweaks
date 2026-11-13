const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');

function read(relativePath) {
  return readText(path.join(REPO_ROOT, relativePath));
}

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdFilesUnder(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

test('claim-outcomes.md is deleted', () => {
  assert.strictEqual(fs.existsSync(path.join(REPO_ROOT, 'plugin/skills/dispatch/claim-outcomes.md')), false);
});

test('flow/claim-targets.md exists and is referenced by flow/SKILL.md Step 2.8', () => {
  assert.strictEqual(fs.existsSync(path.join(REPO_ROOT, 'plugin/skills/flow/claim-targets.md')), true);
  const skillMd = read('plugin/skills/flow/SKILL.md');
  assert.match(skillMd, /2\.8 — Claim the targets/);
  assert.match(skillMd, /claim-targets\.md/);
});

test('claim-targets.md skip-guard keys on run-identity match and the local-files backend', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /claim\.runId === basename\(\$PIPELINE_RUN_DIR\)/);
  assert.match(content, /work-backend.*local-files/);
});

test('dispatch/SKILL.md Step 4 is mint-only — no claim-only modifier remains', () => {
  const content = read('plugin/skills/dispatch/SKILL.md');
  assert.doesNotMatch(content, /claim-only/);
  assert.match(content, /Mint the selected group's run directory/);
  assert.doesNotMatch(content, /bootstrap-then-add `bot:in-progress`/);
});

test('dispatch/SKILL.md argument-hint drops --claim-only', () => {
  const hintLine = read('plugin/skills/dispatch/SKILL.md')
    .split('\n')
    .find((l) => l.startsWith('argument-hint:'));
  assert.ok(hintLine, 'argument-hint line should exist');
  assert.doesNotMatch(hintLine, /claim-only/);
  assert.match(hintLine, /--budget/);
});

test('task-prompt.md first template no longer claims "already-claimed"; second still does', () => {
  const content = read('plugin/skills/dispatch/task-prompt.md');
  assert.match(content, /Execute claude-tweaks build\+test for this dispatch group of/);
  assert.doesNotMatch(content, /Execute claude-tweaks build\+test for this already-claimed/);
  assert.match(content, /Execute claude-tweaks review\+polish\+wrap-up for this already-claimed/);
});

test('task-prompt.md documents DISPATCH_HEADLESS for headless firings', () => {
  assert.match(read('plugin/skills/dispatch/task-prompt.md'), /DISPATCH_HEADLESS/);
});

test('task-prompt.md keys DISPATCH_HEADLESS on Routine-fired presence, not the next form (refs #1492)', () => {
  const content = read('plugin/skills/dispatch/task-prompt.md');
  assert.match(content, /Add it when this firing came from a scheduled Routine/);
  assert.doesNotMatch(content, /Add it only when the dispatching session's own firing was `next`-form/);
});

test('_shared/headless-self-report.md documents the Step 2.8 contest trigger', () => {
  const content = read('plugin/skills/_shared/headless-self-report.md');
  assert.match(content, /flow-step-2\.8-claim-contest|Step 2\.8 claim contest/);
});

test('settle-and-merge.md documents the claim-contest special case', () => {
  const content = read('plugin/skills/dispatch/settle-and-merge.md');
  assert.match(content, /Claim-contest special case/);
  assert.match(content, /DISPATCH_HEADLESS/);
});

test('issue-claims.md "The lock" step 4 checks for an in-flight PR before a tombstone/stale reclaim (#315, #974)', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  const step4Start = content.indexOf("4. **`state: 'tombstone'` or `'stale'`**");
  assert.ok(step4Start !== -1, 'step 4 heading should exist');
  const step5Start = content.indexOf("5. **`state: 'live'`**", step4Start);
  assert.ok(step5Start !== -1, "step 5 heading should exist after step 4");
  const step4 = content.slice(step4Start, step5Start);
  assert.match(step4, /pr-opened:/);
  assert.match(step4, /mcp__github__pull_request_read/);
  assert.match(step4, /OPEN/);
  assert.match(step4, /fail-open/);
});

test('claim-targets.md in-flight card routes into resume-confirmation.md, gated on DISPATCH_HEADLESS (#958)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  const cardStart = content.indexOf('## Flow: Claim in-flight');
  assert.ok(cardStart !== -1, 'in-flight card region should exist');
  const sectionEnd = content.indexOf('\n- **4** —', cardStart);
  assert.ok(sectionEnd !== -1, 'in-flight section should end before the exit-4 bullet');
  const section = content.slice(cardStart, sectionEnd);
  // The stale "Known gap ... unimplemented" framing must be gone, replaced by an actual route.
  assert.doesNotMatch(section, /Known gap/);
  assert.doesNotMatch(section, /hook-in is unimplemented/);
  assert.match(section, /DISPATCH_HEADLESS/);
  assert.match(section, /dispatch\/resume-confirmation\.md/);
  assert.match(section, /claude-tweaks-run: \{run-id\}/);
  assert.match(section, /check-resume-freshness/);
});

test('resume-confirmation.md documents claim-targets.md as a second caller (#958)', () => {
  const content = read('plugin/skills/dispatch/resume-confirmation.md');
  assert.match(content, /flow\/claim-targets\.md/);
  assert.match(content, /#958/);
});

test('settle-and-merge.md Claim-contest special case also covers the Claim in-flight stop, with a distinct failing-check-name (review finding, #958)', () => {
  const content = read('plugin/skills/dispatch/settle-and-merge.md');
  const sectionStart = content.indexOf('**Claim-contest special case');
  assert.ok(sectionStart !== -1, 'Claim-contest special case section should exist');
  const sectionEnd = content.indexOf('\n1. The CLI in step 2', sectionStart);
  assert.ok(sectionEnd !== -1, 'special-case section should end before the numbered steps');
  const section = content.slice(sectionStart, sectionEnd);
  assert.match(section, /Claim in-flight/);
  assert.match(section, /flow-step-2\.8-claim-in-flight/);
  // both failing-check-names must be distinct and both present
  assert.match(section, /flow-step-2\.8-claim-contest/);
});

test('mcp-transport.md no longer carries claim-write sections', () => {
  const content = read('plugin/skills/dispatch/mcp-transport.md');
  assert.doesNotMatch(content, /## Step 4 — claiming a group/);
  assert.doesNotMatch(content, /## Step 4 — `--claim-only` release/);
});

test('claim-targets.md claim read cites issue-claims.md steps 1-2 — no raw base64 -d pipe (#720)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.doesNotMatch(content, /base64 -d/);
  assert.match(content, /__ABSENT__/);
  assert.match(content, /@base64d/);
});

test('every base64 -d claim read under skills/ handles the absent-file case, not just cites issue-claims.md (#720, #780)', () => {
  const offenders = [];
  for (const file of mdFilesUnder(path.join(REPO_ROOT, 'plugin', 'skills'))) {
    const text = readText(file);
    if (!/ref=claims-registry/.test(text) || !/base64 -d/.test(text)) continue;
    // A citation to issue-claims.md is no longer sufficient on its own (#780) — the read
    // itself must show it handles the absent/404 case, via the __ABSENT__ sentinel or an
    // equivalent explicit `|| null` / not-found branch.
    const absentBranch = /__ABSENT__|\|\| null|404/.test(text);
    if (!absentBranch) offenders.push(path.relative(REPO_ROOT, file));
  }
  assert.deepStrictEqual(offenders, []);
});

test('issue-claims.md step 1 spells out the 404->__ABSENT__ exit-status branch as a shell snippet (#780)', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  const step1Start = content.indexOf('1. Read the claim file at the payload');
  assert.ok(step1Start !== -1, 'step 1 heading should exist');
  const step2Start = content.indexOf('2. **Extract the content before classifying', step1Start);
  assert.ok(step2Start !== -1, 'step 2 heading should exist after step 1');
  const step1 = content.slice(step1Start, step2Start);
  assert.match(step1, /```bash/);
  assert.match(step1, /404/);
  assert.match(step1, /__ABSENT__/);
});

test('issue-claims.md step 2 extracts .content before classifying — never passes the wrapper object (#780)', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  const step2Start = content.indexOf('2. **Extract the content before classifying');
  assert.ok(step2Start !== -1, 'step 2 heading should exist');
  const step3Start = content.indexOf("3. **`state:", step2Start);
  assert.ok(step3Start !== -1, 'step 3 heading should exist after step 2');
  const step2 = content.slice(step2Start, step3Start);
  assert.match(step2, /field's value/i);
  assert.match(step2, /never the wrapper object/i);
  assert.match(step2, /jq -r '\.content'|jq -r \.content/);
});

test('issue-claims.md "Reading claim state" section does not restate the old wrapper-object bug (#780)', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  const sectionStart = content.indexOf('## Reading claim state');
  assert.ok(sectionStart !== -1, 'Reading claim state section should exist');
  const sectionEnd = content.indexOf('## TTL and staleness');
  assert.ok(sectionEnd !== -1, 'TTL and staleness section should exist after it');
  const section = content.slice(sectionStart, sectionEnd);
  assert.match(section, /"The lock" step 1-2 above/);
  assert.match(section, /already-extracted/);
});

test('scan-procedures.md claim read no longer pipes to bare base64 -d with no absent branch (#780)', () => {
  const content = read('plugin/skills/tidy/scan-procedures.md');
  assert.doesNotMatch(content, /-q '\.content' \| base64 -d/);
  assert.match(content, /__ABSENT__/);
});

test('contest card renders holder liveness — three verdict variants, each with a next step (#722)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /Live sibling on this machine/);
  assert.match(content, /Remote holder/);
  assert.match(content, /Stale holder — no activity since/);
  assert.match(content, /sessionId/);
  assert.match(content, /git worktree list/);
  assert.match(content, /~\/\.claude\/projects\//);

  // Extract the card region (the fenced ```markdown block for "## Flow: Claim contested")
  // and confirm each of the three verdict variants carries its own "Next:" step.
  const cardStart = content.indexOf('## Flow: Claim contested');
  assert.ok(cardStart !== -1, 'card region should exist');
  const cardEnd = content.indexOf('```', cardStart);
  const card = content.slice(cardStart, cardEnd);
  const nextCount = (card.match(/Next:/g) || []).length;
  assert.strictEqual(nextCount, 3, 'card should carry exactly one "Next:" step per verdict variant');
  assert.match(card, /Live sibling on this machine[\s\S]*?Next: wait for it to finish or release/);
  assert.match(card, /Remote holder \(\{holder-host\}\)\. Next: inspect that session/);
  assert.match(card, /Stale holder — no activity since[\s\S]*?Next: \{if step 3 matched a worktree/);
});

test('contest card weighs worktree evidence before recommending reclaim on a Stale-holder verdict (#722)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  // Step 5's verdict rule must not let a matched (possibly-live) worktree be reclaimed on the
  // strength of an absent transcript alone.
  assert.match(content, /Stale-holder next step must not recommend reclaim/);
  assert.match(content, /inspect the matched worktree/);
  // The card's Stale variant must render that softened next step conditionally rather than
  // unconditionally pointing at /tidy reclaim.
  assert.match(content, /inspect it\s*\n\s*before any reclaim; a locked worktree usually means a live session/);
});

test('contest liveness lookup is evidence-gathering, never a gate or a prompt (#722)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /never block on the lookup|evidence, not an error/);
  assert.match(content, /session-evaluation\.md/);
  // the card remains a stop: the section still forbids AskUserQuestion
  assert.match(content, /No `AskUserQuestion`/);
});

test('claim step invokes bin/claim-targets.js — no per-target gh api snippet remains (#723)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /bin\/claim-targets\.js/);
  const claimSection = content.split('## Claim every named target')[1];
  assert.ok(claimSection, 'claim section heading must exist');
  assert.doesNotMatch(claimSection, /gh api "repos/);
  assert.doesNotMatch(claimSection, /gh issue edit "\$ISSUE"/);
  // the canonical-read citation tokens survive (pinned by the #720 tests too)
  assert.match(content, /__ABSENT__/);
  assert.match(content, /@base64d/);
});

test('multi-spec pre-flight cites bin/preflight-records.js (#723; dispatch stopped deriving groups from it in #3278)', () => {
  assert.match(read('plugin/skills/flow/multi-spec.md'), /bin\/preflight-records\.js/);
});

test('claim-targets.md mandates a decisions.md log line on successful claim, and documents the mechanical backstop that now enforces it (#2492, #2526)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  const claimSection = content.split('## Claim every named target')[1];
  assert.ok(claimSection, 'claim section heading must exist');
  // The mandatory post-claim log-decision.js call — a local, durable trace
  // independent of a fresh gh/MCP read against claims-registry.
  assert.match(claimSection, /Log the claim \(mandatory, #2492\)/);
  assert.match(claimSection, /bin\/log-decision\.js.*--run "\$PIPELINE_RUN_DIR" --status AUTO/s);
  assert.match(claimSection, /--step "Step 2\.8"/);
  // The mechanical backstop note: checkBookkeepingStampsGate now enforces
  // this stamp (closed by #2526, shortly after #2492 documented the gap) —
  // this must assert the gap is CLOSED, not merely that it is discussed.
  assert.match(claimSection, /Mechanical backstop.*#2526/s);
  assert.doesNotMatch(claimSection, /this step has no mechanical backstop today/);
  assert.match(claimSection, /checkBookkeepingStampsGate/);
  assert.match(claimSection, /hasLoggedClaim/);
  assert.match(claimSection, /claims\/issue-\{n\}\.json/);
  assert.match(claimSection, /2026-09-14/);
  assert.match(claimSection, /#2329/);
});

test('AC1.1, AC2.1: multi-spec Validation cites the merge-state gate sub-file, which records a no-ask auto split (#2733)', () => {
  assert.match(read('plugin/skills/flow/multi-spec.md'), /multispec-merge-gate\.md/);
  assert.match(read('plugin/skills/flow/SKILL.md'), /multispec-merge-gate\.md/);
  const gate = read('plugin/skills/flow/multispec-merge-gate.md');
  assert.match(gate, /preflight-records\.js[^\n]*--merge-gate/);
  assert.match(gate, /never calls `AskUserQuestion`/);
  assert.match(gate, /before Step 2\.8/);
  assert.match(gate, /must be merged first/);
});

test('AC1.1, AC6.1: parallel waves — decision sub-file, opt-in token, merge-back, single-PR reconciliation (#2677)', () => {
  const skill = read('plugin/skills/flow/SKILL.md');
  assert.match(skill, /\| `parallel` \|[^\n]*multispec-parallel-waves\.md/);
  assert.match(read('plugin/skills/flow/multi-spec.md'), /multispec-parallel-waves\.md/);
  assert.match(read('plugin/skills/flow/multispec-review-console.md'), /multispec-parallel-waves\.md/);
  const doc = read('plugin/skills/flow/multispec-parallel-waves.md');
  assert.match(doc, /preflight-records\.js[^\n]*--waves/);
  assert.match(doc, /merge --no-ff/);
  assert.match(doc, /merge --abort/);
  assert.match(doc, /never calls `AskUserQuestion`/);
  assert.match(doc, /spec-\{N\}\/ledger\.md/);
  assert.match(doc, /Rejected — one shared worktree/);
});

test('parallel waves run on isolated agent worktrees, over the merge-gate kept set, with a consumed member marker (#2677 final review)', () => {
  const { extractArgumentHint } = require('../plugin/bin/lib/skill-audit/argument-hint');
  const doc = read('plugin/skills/flow/multispec-parallel-waves.md');
  assert.match(doc, /isolation: "worktree"/);
  assert.match(doc, /worktreeBranch/);
  assert.match(doc, /mergeGate\.kept/);
  assert.match(doc, /^OUTCOME: built-tested \| hard-gate-failed \| blocked$/m);
  assert.doesNotMatch(doc, /adopt-or-create naming|\{shared-branch\}-spec-\{N\}/);
  for (const file of [
    'plugin/skills/build/worktree-setup.md',
    'plugin/skills/build/SKILL.md',
    'plugin/skills/test/SKILL.md',
    'plugin/skills/_shared/ledger-format.md',
  ]) {
    assert.match(read(file), /MULTISPEC_PARALLEL_WAVE/, `${file} must consume MULTISPEC_PARALLEL_WAVE`);
  }
  assert.match(extractArgumentHint(read('plugin/skills/flow/SKILL.md')), /\[parallel\]/);
});

test('settle-and-merge.md Claim-contest special case covers the exit-6 Claims branch missing stop as a pre-flight stop (#4495)', () => {
  const content = read('plugin/skills/dispatch/settle-and-merge.md');
  const sectionStart = content.indexOf('**Claim-contest special case');
  assert.ok(sectionStart !== -1, 'Claim-contest special case section should exist');
  // End at the next special case, not at the numbered steps: the span to the numbered steps also
  // holds the plan-review special case, which carries the same two phrases and would keep the
  // assertions below green with the exit-6 sentence deleted.
  const sectionEnd = content.indexOf('\n**Open-linked-PR enrichment', sectionStart);
  assert.ok(sectionEnd !== -1, 'special-case section should end before the open-linked-PR enrichment paragraph');
  const section = content.slice(sectionStart, sectionEnd);
  assert.match(section, /Claims branch missing/);
  assert.match(section, /flow-step-2\.8-claims-branch-missing/);
  assert.match(section, /claims-branch-missing stop, skip steps 3-7/);
  assert.match(section, /dispatch-retry-ceiling/);
  assert.match(section, /no failure comment/);
});

function readExit7Bullet() {
  const content = read('plugin/skills/flow/claim-targets.md');
  const start = content.indexOf('- **7**');
  assert.ok(start !== -1, 'exit-7 bullet should exist');
  const end = content.indexOf('\n- **2**', start);
  assert.ok(end !== -1, 'exit-7 bullet should end before the exit-2 bullet');
  return { content, bullet: content.slice(start, end) };
}

test('AC6.1: flow/claim-targets.md carries the exit-7 card with no retry and no question (#4899)', () => {
  const { content, bullet } = readExit7Bullet();
  assert.match(bullet, /## Flow: Claim permission denied/);
  assert.match(bullet, /\{operation\}/);
  assert.match(bullet, /\{reason\}/);
  assert.match(bullet, /token's access/);
  assert.match(bullet, /claims-registry/);
  assert.match(bullet, /No `AskUserQuestion`/);
  const cardStart = bullet.indexOf('```markdown');
  assert.ok(cardStart !== -1, 'the exit-7 bullet should carry a markdown card fence');
  const card = bullet.slice(cardStart);
  assert.doesNotMatch(card, /re-run/i, 'a refused token is not fixed by a re-run');
  assert.match(content, /On exit 3, 4, 5, 6, or 7/);
});

test('AC6.1: settle-and-merge.md treats the claim permission denied stop as a pre-flight stop (#4899)', () => {
  const content = read('plugin/skills/dispatch/settle-and-merge.md');
  const sectionStart = content.indexOf('**Claim-contest special case');
  assert.ok(sectionStart !== -1, 'Claim-contest special case section should exist');
  const sectionEnd = content.indexOf('\n**Open-linked-PR enrichment', sectionStart);
  assert.ok(sectionEnd !== -1, 'special-case section should end before the open-linked-PR enrichment paragraph');
  const section = content.slice(sectionStart, sectionEnd);
  assert.match(section, /Claim permission denied/);
  assert.match(section, /flow-step-2\.8-claim-permission-denied/);
  assert.match(section, /failed:claim-permission-denied/);
  assert.match(section, /since the four are different stop shapes/);
  assert.match(section, /the claim-permission-denied stop is the exception/);
  assert.match(section.replace(/\s+/g, ' '), /that is the rendered card, which carries the operation and reason; the first call's report lines do not\)/);
  // The exit-6 sentence earlier in the section already carries "dispatch-retry-ceiling" and
  // "no failure comment", so this stop's own sentence is sliced out before asserting on it.
  const stopStart = section.indexOf('For the claim-permission-denied stop');
  assert.ok(stopStart !== -1, 'the claim-permission-denied sentence should exist');
  const stop = section.slice(stopStart);
  assert.match(stop, /skip steps 1-7/);
  assert.match(stop, /no release/);
  assert.match(stop, /dispatch-retry-ceiling/);
  assert.match(stop, /no failure comment/);
  assert.match(stop, /no `bot:blocked`/);
  assert.match(stop, /grants untouched/);
});

test('the express call reports the claim permission denied line (#4899)', () => {
  assert.match(read('plugin/skills/dispatch/express-prompt.md'), /ISSUE #\{issue\}: failed:claim-permission-denied/);
  const lane = read('plugin/skills/_shared/express-lane.md');
  assert.match(lane, /exit 7/);
  assert.match(lane, /failed:claim-permission-denied/);
});

test('flow/claim-targets.md states the MCP claim path is not this stop (#4899)', () => {
  const { bullet } = readExit7Bullet();
  assert.match(bullet, /gh-absent[^\n]*this stop/);
  assert.match(bullet, /MCP[^\n]*transient/);
  assert.match(bullet.replace(/\s+/g, ' '), /OUTCOME: build-test-blocked` \(`OUTCOME: blocked` on a second call\)/);
  assert.match(bullet, /ISSUE #\{n\}: failed:claim-permission-denied/);
  assert.match(bullet, /STATUS: BLOCKED/);
  assert.match(bullet, /`\{target\}` is `permissionDenied\.issue`/);
});

test('a dispatched first call learns the exact gate value, and teardown skips the claim release (#4899)', () => {
  assert.match(read('plugin/skills/dispatch/task-prompt.md'), /exit 7 uses the gate value `claim-permission-denied`, exactly/);
  const gate = read('plugin/skills/dispatch/two-call-gate.md');
  const start = gate.indexOf('**Claim permission stop (#4899).**');
  assert.ok(start !== -1, 'two-call-gate.md should carry the Claim permission stop paragraph');
  const paragraph = gate.slice(start, gate.indexOf('\n\n', start));
  assert.match(paragraph, /\(claim-permission-denied: skip the claim release\)/);
  assert.match(paragraph, /does not apply/);
  assert.match(gate, /none after a Claim permission stop/);
  const sectionE = read('plugin/skills/wrap-up/cleanup-procedures-execution.md');
  assert.match(sectionE, /Skip this whole section when the invocation names `claim-permission-denied: skip the claim release`/);
  const skipLog = sectionE.replace(/\s+/g, ' ');
  assert.match(skipLog, /log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status SKIP --section "\/wrap-up" --step "Section E" --text "condition: claim-permission-denied named by the cleanup-only call → fallback: claim release skipped" --reversibility n\/a/);
  assert.match(skipLog, /production step failed, or this section was skipped\)/);
  // The receiver: wrap-up's flags.md declares the phrase, so it is not read as a record reference.
  const flags = read('plugin/skills/wrap-up/flags.md');
  assert.match(flags, /`\(claim-permission-denied: skip the claim release\)`[^\n]*stripped before input classification[^\n]*never read as a record reference/);
});

test('the other "move on" sites name the Claim permission stop (#4899)', () => {
  assert.match(read('plugin/skills/dispatch/sequential-execution.md'), /group N\+1 \(none after a Claim permission stop/);
  assert.match(read('plugin/skills/dispatch/two-call-gate.md'), /next group's worktree \(none after a Claim permission stop: the firing ends, `SKILL\.md`\)\.\n\n## 8\./);
  assert.match(read('plugin/skills/_shared/express-lane.md'), /on a Claim permission stop, exit 7, Settle skips steps 1-7/);
  assert.match(read('plugin/skills/dispatch/SKILL.md'), /the ranking returns `null`, or a Claim permission stop\), close/);
});

test('dispatch/SKILL.md loop, move-on and close-out sites carve out the Claim permission stop (#4899)', () => {
  const skill = read('plugin/skills/dispatch/SKILL.md');
  assert.match(skill, /the ranking returns `null`, or a Claim permission stop ends the firing/);
  assert.match(skill, /move straight to the next group \(none after a Claim permission stop\)/);
  assert.match(skill, /the repo-wide infra-outage stop, the Claim permission stop, a queue-pull/);
});

test('AC7.1: dispatch/SKILL.md stops the firing on a claim permission denied stop, in every selection form (#4899)', () => {
  const content = read('plugin/skills/dispatch/SKILL.md');
  const start = content.indexOf('**Claim permission stop (#4899).**');
  assert.ok(start !== -1, 'Claim permission stop paragraph should exist');
  const end = content.indexOf('\n\n', start);
  const paragraph = content.slice(start, end === -1 ? undefined : end);
  assert.match(paragraph, /failed:claim-permission-denied/);
  assert.match(paragraph, /every selection form/);
  assert.match(paragraph, /attempt no further group/);
  assert.match(paragraph, /same token/);
  assert.match(paragraph, /named records after it as not attempted and unclaimed/);
});

// #5230: the ranking script's copy of the stop is no longer pinned. The stop is agent-side: the
// firing ends before the next pick, as firing-exclusion.md (pinned here) states; the ranking
// (`rankNext`, behind `queue-pull.js --rank`) only picks a group.
test('firing-exclusion.md names the stop; reporting.md relays it (#4899)', () => {
  const content = read('plugin/skills/dispatch/firing-exclusion.md');
  assert.match(content, /claim-permission-denied/, 'firing-exclusion.md must name the stop');
  assert.match(content, /ends the firing/, 'firing-exclusion.md must say the stop ends the firing');
  const relayed = read('plugin/skills/dispatch/reporting.md');
  assert.match(relayed, /claim-permission-denied/);
  assert.match(relayed, /its report block names the record and the stop, says the firing stopped, lists any named records after it as not attempted and unclaimed/);
  assert.doesNotMatch(relayed, /names the record and the refusal/);
});

test('headless-self-report.md files its diagnostic through --body-file, never a shell-quoted --body (#4899)', () => {
  const template = read('plugin/skills/_shared/headless-self-report.md');
  assert.equal(template.match(/--body-file "\{body-file\}"/g)?.length, 2);
  assert.doesNotMatch(template, /--body "/);
  assert.doesNotMatch(read('plugin/skills/dispatch/settle-and-merge.md'), /template's `--body`/);
});

test('#4794: the exit-2 bullet names the unknown-host refusal and its transport limit', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  const start = content.indexOf('- **2** —');
  assert.ok(start !== -1, 'exit-2 bullet should exist');
  const end = content.indexOf('**On exit', start);
  assert.ok(end !== -1, 'exit-2 bullet should end before the On-exit paragraph');
  const bullet = content.slice(start, end).replace(/\s+/g, ' ');
  assert.match(bullet, /unknown-host/);
  assert.match(bullet, /does not reach that refusal/);
});

test('AC8.1: no prose says a claim read or write 401/403 exits 4 (#4899)', () => {
  const walk = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, ext);
    return entry.name.endsWith(ext) ? [full] : [];
  });
  const files = [
    ...walk(path.join(REPO_ROOT, 'plugin'), '.md'),
    ...walk(path.join(REPO_ROOT, 'plugin'), '.js'),
    // The project skills restate the exit table too (batching-failure-posture.md once kept the old exit 4 claim).
    ...walk(path.join(REPO_ROOT, '.claude/skills'), '.md'),
    path.join(REPO_ROOT, 'docs/plugin-structure.md'),
    path.join(REPO_ROOT, 'docs/journeys/act-on-a-contested-claim.md'),
  ];
  assert.ok(files.length > 50, 'the sweep should cover the plugin tree');
  assert.ok(files.some((file) => file.includes(`${path.sep}.claude${path.sep}skills${path.sep}`)), 'the sweep should cover .claude/skills');
  // Whitespace is collapsed first so a sentence wrapped across lines is seen whole; `refus` covers
  // refused/refuses/refusal, and the exit code may be backticked. The first branch excludes only the
  // exact phrase "rate-limited 403 is exit 4": exit 7's own bullet says it, and it is correct.
  const exit4 = '\\bexits? `?4\\b';
  const sweep = new RegExp(
    `(claim read( or write)?|claim write|401/403)[^.]{0,80}(?<!rate-limited 403 is )${exit4}`
    + `|${exit4}[^.]{0,80}((refus|401/403)[^.]{0,80}claim|claim (read|write)[^.]{0,80}(refus|401|403))`,
    'gi',
  );
  const sweepOffenders = (text) => [...text.replace(/\s+/g, ' ').matchAll(sweep)].map((match) => match[0]);
  const offenders = [];
  for (const file of files) {
    for (const hit of sweepOffenders(readText(file))) {
      offenders.push(`${path.relative(REPO_ROOT, file)}: ${hit}`);
    }
  }
  assert.deepStrictEqual(offenders, []);
  // go-red control: the same matcher flags a planted line in each branch's shape. The strings are
  // built from parts so this file never carries the forbidden sentence whole.
  const planted = ['A claim read or write', ['401', '403'].join('/'), 'exits', '4.'].join(' ');
  assert.strictEqual(sweepOffenders(planted).length, 1, 'control: a planted "claim read or write 401/403 exits 4" must be flagged');
  const plantedReverse = ['It exits', '4 when GitHub', 'refuses a', 'claim read.'].join(' ');
  assert.strictEqual(sweepOffenders(plantedReverse).length, 1, 'control: a planted "exits 4 when GitHub refuses a claim read" must be flagged');
  assert.deepStrictEqual(sweepOffenders('Exit 7 covers a claim read or write; a rate-limited 403 is exit 4.'), [], 'control: the exact rate-limited phrase stays allowed');
  assert.match(read('docs/plugin-structure.md'), /7 GitHub refused a claim read or write/);
});
