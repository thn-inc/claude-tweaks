'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// #2429: task-prompt.md's Foreground execution clause and settle-and-merge.md's
// merge-check clause were enforced by prose alone -- both were violated by
// dispatched agents in one real firing (3/30 backgrounded execution, 2/5
// first-attempt merges skipped merge-check). These pin the mechanical,
// orchestrator-side checks added to back each clause.

test('#2429 AC1: sequential-execution.md mechanically verifies the STATUS line the moment each Task call returns, and treats a missing/malformed one as BLOCKED-equivalent, routed through Settle', () => {
  const t = read('plugin/skills/dispatch/sequential-execution.md');
  assert.match(t, /Mechanically verify the status line/);
  assert.match(t, /\^STATUS: \(DONE\|DONE_WITH_CONCERNS\|NEEDS_CONTEXT\|BLOCKED\)\$/);
  assert.match(t, /evidence the dispatched agent backgrounded/);
  assert.match(t, /Treat a missing\/malformed status line exactly like `BLOCKED`/);
  assert.match(t, /route it through this group's own Settle procedure/);
  assert.match(t, /not a firing-wide stop/);
});

test('#2429 AC2: settle-and-merge.md logs a passing merge-check verdict (not just needs-human) and mechanically re-reads decisions.md before merging, in both the Task-call and dispatching-session merge paths', () => {
  const t = read('plugin/skills/dispatch/settle-and-merge.md');
  assert.match(t, /Log a passing verdict too, the same way/);
  assert.match(t, /assess-agent-autonomy verdict auto-merge\. Reversibility: n\/a\./);
  assert.match(t, /Mechanically verify every member's entry exists before proceeding to merge/);
  // #2484: batched to one read of decisions.md checked against every member in
  // memory, replacing the old per-member `grep -c` subprocess.
  assert.match(t, /one read of the file, checked against\s*\n\s*every group member in memory, not one `grep -c` subprocess per member/);
  // #2941: the marker and the check moved into one shared module, so the singleton
  // short-circuit and this bundle path cannot drift apart on the marker text.
  assert.match(t, /require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/dispatch\/merge-verdict\.js'\)/);
  assert.match(t, /confirmFromFile\(process\.argv\[1\], process\.argv\.slice\(2\)\)/);
  assert.doesNotMatch(t, /marker = 'Auto-merge gate: #' \+ n/);
  assert.doesNotMatch(t, /grep -c "Auto-merge gate: #\{n\} assess-agent-autonomy verdict auto-merge"/);
  // The local-merge dispatching-session path is a separate execution thread from
  // the Task call that logged the verdict -- it must re-verify too, not trust
  // OUTCOME: ready-to-merge alone.
  const localMergeSection = t.slice(t.indexOf('## Dispatching-session merge execution'));
  assert.match(localMergeSection, /re-run the Content judgment step's own mechanical check/);
  assert.match(localMergeSection, /not evidence Content judgment ran/);
  assert.match(localMergeSection, /one-read-per-group, checked-in-memory-per-member check above/);
  assert.match(localMergeSection, /accepts the singleton short-circuit's `Auto-merge short-circuit:` marker too/);
});

test('#2429 AC3: both mechanical checks are cross-referenced at the call site they gate (task-prompt.md), so a future edit cannot silently regress to prose-only enforcement', () => {
  const t = read('plugin/skills/dispatch/task-prompt.md');
  const firstCallEnd = t.indexOf('## Second call');
  assert.ok(firstCallEnd > -1);
  assert.match(t.slice(0, firstCallEnd), /backed by a mechanical check, not prose alone \(#2429\)/);
  assert.match(t.slice(firstCallEnd), /own\s+mechanical check too \(#2429\)/);
  // The cross-reference lives in author-facing prose, outside the fenced
  // template copied verbatim into the dispatched agent's prompt -- it must
  // not inflate what's actually dispatched.
  const firstFence = t.slice(t.indexOf('## First call'), firstCallEnd);
  const fenceBody = firstFence.slice(firstFence.indexOf('```') + 3, firstFence.lastIndexOf('```'));
  assert.ok(!fenceBody.includes('#2429'), 'the #2429 cross-reference must stay outside the dispatched template');
});

test('#2941: the second-call cross-reference also names the singleton path\'s Verdict backstop as the #2429 check\'s equivalent, backed by the same module', () => {
  const t = read('plugin/skills/dispatch/task-prompt.md');
  // Frozen pre-#2941 ending of that paragraph -- proves the pattern below can actually go red.
  const PRE_EDIT = 'run the loop — see that step\'s own "Mechanically verify every member\'s entry" paragraph. Keep\n'
    + 'both current if either clause\'s wording changes.';
  const pattern = /wrap-up\/auto-merge-short-circuit\.md`'s Verdict backstop instead \(#2941\)[\s\S]{0,120}?`bin\/lib\/dispatch\/merge-verdict\.js`/;
  assert.match(t, pattern, 'singleton cross-reference missing from task-prompt.md');
  assert.doesNotMatch(PRE_EDIT, pattern, 'pattern matches the pre-edit text -- cannot go red');
  // Still outside the dispatched template, same discipline as the #2429 cross-reference above —
  // bounded to the one fenced block under "## Second call", not the rest of the file.
  const secondCallSection = t.slice(t.indexOf('## Second call'));
  const fenceOpen = secondCallSection.indexOf('```');
  const fenceClose = secondCallSection.indexOf('```', fenceOpen + 3);
  const fenceBody = secondCallSection.slice(fenceOpen + 3, fenceClose);
  assert.ok(!fenceBody.includes('#2941'), 'the #2941 cross-reference must stay outside the dispatched template');
});

test('#2488: task-prompt.md hardens the missing-claim fallback into a HARD-GATE, non-negotiable regardless of the dispatched call\'s own risk judgment', () => {
  const t = read('plugin/skills/dispatch/task-prompt.md');
  assert.match(t, /<!-- HARD-GATE: dispatch-missing-claim-fallback -->/);
  assert.match(t, /This is\s*\na hard, non-negotiable stop, not a default you may reason past\./);
  assert.match(t, /no matter how confident your\s*\nown read of the diff's safety is/);
  // Mechanical audit trail: the state-check result must be logged before any
  // of the four outcomes is reported, not left to unverifiable self-report.
  assert.match(t, /Mechanical audit trail \(#2488\)/);
  assert.match(t, /log-decision\.js.*--section "\/dispatch"/s);
});

test('#2488: the missing-claim fallback is listed in auto-mode-contract.md\'s HARD-GATE / BLOCKED / STOP row, so `auto` never silences it', () => {
  const t = read('plugin/skills/_shared/auto-mode-contract.md');
  const row = t.split('\n').find((l) => l.includes('HARD-GATE / BLOCKED / STOP conditions'));
  assert.ok(row, 'HARD-GATE / BLOCKED / STOP row not found');
  assert.match(row, /dispatch`'s second-call missing-claim fallback/);
  assert.match(row, /#2488/);
});

test('#2912 AC1.1/AC3.1: the first-call template requires verify-run-bookends.js on every transport before DONE', () => {
  const t = read('plugin/skills/dispatch/task-prompt.md');
  const start = t.indexOf('## First call');
  const end = t.indexOf('## Second call');
  assert.ok(start !== -1 && end > start, 'first-call section not found');
  const firstCall = t.slice(start, end);
  assert.match(firstCall, /verify-run-bookends\.js" --run "\{minted-run-dir\}" --targets \{comma-joined issue numbers\}/);
  assert.match(firstCall, /every transport/);
  assert.match(firstCall, /build-test-blocked/);
  const c = read('plugin/skills/flow/claim-targets.md');
  assert.match(c, /committed `work\/\{n\}-spec\.md`/);
  assert.match(c, /canonical `Step 2\.8: claimed #\{n\}`/);
});

test('go-red control: a status line with extra trailing text, or the wrong last line, fails the pinned regex the same way a genuinely missing one would', () => {
  const RE = /^STATUS: (DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)$/;
  assert.ok(!RE.test('STATUS: DONE (backgrounded)'));
  assert.ok(!RE.test('status: done'));
  assert.ok(RE.test('STATUS: DONE_WITH_CONCERNS'));
});

// #3226: a missing-config first call whose claim/PR evidence is intact is repairable --
// call 2's /flow adoption rebuilds config.yml. The repair branch sits after the
// status-line check and the artifact check, and call 2's invocation does not change.
const REPAIR_LINE = "AUTO {time} — Artifact check: config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption. Reversibility: high.";
function section(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + 1);
  assert.ok(startIndex > -1 && endIndex > startIndex, `section ${start} not found`);
  return text.slice(startIndex, endIndex);
}
const gateSection = () => section(read('plugin/skills/dispatch/two-call-gate.md'), '## 2. The gate', '## 5.');
const loopSection = () => section(read('plugin/skills/dispatch/sequential-execution.md'), '## The loop', '## No per-group timeout');
function assertRepairBranch(text) {
  assert.ok(text.includes(REPAIR_LINE), 'literal repair log line');
  assert.match(text, /`repairable: true`/);
  assert.match(text, /`repairable: false`/);
  const status = text.search(/status line/i);
  const artifact = text.indexOf('Artifact check');
  const repair = text.indexOf(REPAIR_LINE);
  assert.ok(status > -1 && status < artifact && artifact < repair, 'status-line check precedes the artifact check precedes the repair branch');
}
test('AC7.1: two-call-gate.md §2 carries the repair branch, its literal log line, and an unchanged call 2', () => {
  const s = gateSection();
  assertRepairBranch(s);
  assert.match(s, /byte-identical/);
  assert.match(s, /keeps section 5's teardown/);
  assert.match(s, /resolveFirstCallGate/);
});
test('AC8.1: sequential-execution.md\'s loop mirrors the repair branch', () => {
  assertRepairBranch(loopSection());
});
test('AC9.2: in both files a malformed status line stays BLOCKED regardless of a repairable artifact', () => {
  assert.match(gateSection(), /malformed status line is `BLOCKED` regardless/);
  assert.match(loopSection(), /malformed status line is `BLOCKED` regardless/);
});
test('go-red control: assertRepairBranch fails on §2 with the repair line removed, or moved before the status-line check', () => {
  const s = gateSection();
  assert.throws(() => assertRepairBranch(s.split(REPAIR_LINE).join('')));
  assert.throws(() => assertRepairBranch(REPAIR_LINE + '\n' + s.split(REPAIR_LINE).join('')));
});
