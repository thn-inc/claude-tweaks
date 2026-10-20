# Agent-Trust-Scope Accepted-Risk ADR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent-trust-scope judges (the `/claude-tweaks:code-health focus=agent-trust-scope` sweep and `/claude-tweaks:review` Step 6.65) stop re-reporting a dimension that an accepted ADR keeps on purpose. They show it as an informational `accepted risk — ADR NNNN ({kind})` line instead.

**Architecture:** This is a prose-only change to the judge's calibration text. The generator (`plugin/bin/lib/code-health/candidates-agent-trust-scope.js`) is unchanged and keeps emitting the candidate; `tests/agent-trust-scope-repo-posture.test.js` still pins that. The criteria fragment gains a "What NOT to flag" bullet that tells the judge to suppress such a candidate. Review's Step 6.65 table, and the summary template it renders through, gain the matching footer row. The existing prose wiring test pins both, and each pin has a go-red control.

**Tech Stack:** Markdown skill prose, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T184103-record-3312/work/3312-spec.md`

Scope keywords: agent-trust-scope, accepted risk

## Global Constraints

- Kind literals are exactly `registry-access`, `network-egress`, `credential-scope`.
- The ADR location is `docs/decisions/*.md`, and the status line is `**Status:** accepted`. This repo's form is `- **Status:** accepted`.
- The informational line reads `accepted risk — ADR NNNN ({kind})`, with an em dash. It is never a finding and never a filed issue.
- The guard stays tight. A dimension an ADR only mentions, or one named by an ADR whose status is not `accepted` (superseded, proposed), still reports.
- The generator and `tests/agent-trust-scope-repo-posture.test.js` stay unchanged. The generator still reports `network-egress`, and only the judge suppresses it.

## Review Focus

1. ADR 0022 itself names `registry-access` and `credential-scope` in its Context section, as gaps #2876 closed with deny rules. Those names are mentions, not acceptances, so the guard must key on the `## Decision` section. Task 1's bullet text says so, and Task 3's probe exercises this case on the real ADR.
2. Two status lines in this repo read `accepted` with a qualifier: `accepted — ceiling numbers superseded by …` and `accepted (the option was rejected)`. Neither counts as a clean `accepted`. Task 1's bullet names both qualifier shapes.
3. A kind named only in prose ("outbound network access") rather than by its literal must not suppress the finding. Task 1's bullet covers this, and Task 3 probes it.
4. Review's footer when the accepted-risk candidate is the only one: the section is omitted, and the accepted-risk note replaces the "no actionable findings" note rather than sitting beside it. Task 2's row covers this.
5. The standalone copy-paste prompt mirrors the criterion and must carry the same exception, or a standalone run re-reports the dimension. Task 1 covers this.

---

### Task 1: Criteria fragment — accepted-risk exception

**Files:**
- Modify: `plugin/skills/_shared/criteria-agent-trust-scope.md` — the "What NOT to flag" section (append one bullet after the last one, the "effective permissions" bullet), plus the "Copy-paste prompt (runnable standalone)" block (append one sentence)
- Test: `tests/code-health-agent-trust-scope-wiring.test.js`

**Interfaces:**
- Produces: the literal phrase `accepted risk — ADR NNNN ({kind})`, which Task 2's row cites verbatim.

- [ ] **Step 1: Write the failing test and its go-red control**

Append to `tests/code-health-agent-trust-scope-wiring.test.js`:

```js
const CRITERIA_PATH = path.join(ROOT, 'plugin/skills/_shared/criteria-agent-trust-scope.md');

function assertAcceptedRiskGuard(fragment) {
  const start = fragment.indexOf('## What NOT to flag');
  const end = fragment.indexOf('## Severity calibration', start + 1);
  assert.ok(start >= 0 && end > start, 'fragment must have "## What NOT to flag" before "## Severity calibration"');
  const notFlag = fragment.slice(start, end);
  for (const needle of ['docs/decisions/', '**Status:**', '`accepted`', '## Decision', 'superseded', 'proposed',
    'accepted risk — ADR NNNN ({kind})', 'never as a finding', 'never as a filed issue']) {
    assert.ok(notFlag.includes(needle), `What NOT to flag is missing the accepted-risk guard element: ${needle}`);
  }
  const prompt = fragment.slice(fragment.indexOf('## Copy-paste prompt'));
  assert.ok(prompt.includes('accepted risk — ADR NNNN'), 'copy-paste prompt must mirror the accepted-risk exception');
}

test('AC1.1/AC2.1/AC3.1: criteria fragment carries the accepted-risk ADR guard', () => {
  assertAcceptedRiskGuard(readText(CRITERIA_PATH));
});

test('go-red: the accepted-risk guard check fails when the bullet is removed', () => {
  const fragment = readText(CRITERIA_PATH);
  const mutated = fragment.replace(/^- A dimension the project has formally accepted in an ADR[\s\S]*?(?=\n\n## Severity calibration)/m, '');
  assert.notEqual(mutated, fragment, 'mutation did not apply — the bullet must start with "- A dimension the project has formally accepted in an ADR"');
  assert.throws(() => assertAcceptedRiskGuard(mutated));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/code-health-agent-trust-scope-wiring.test.js`
Expected: FAIL. `AC1.1/...` fails with "missing the accepted-risk guard element: docs/decisions/", and the go-red test fails with "mutation did not apply".

- [ ] **Step 3: Add the bullet and the prompt sentence**

Append this bullet as the last item of "What NOT to flag", using exact copy:

```markdown
- A dimension the project has formally accepted in an ADR. It counts only when a committed
  `docs/decisions/*.md` file's `**Status:**` line reads `accepted` with no qualifier (not
  `superseded`, `proposed`, or `deprecated`, and not an `accepted` qualified as superseded or
  rejected), and that ADR's `## Decision` section names the dimension by the generator's exact
  kind literal (`registry-access`, `network-egress`, or `credential-scope`) as a risk the project
  keeps on purpose. Read `docs/decisions/` before filing. Report a match as one informational
  line, `accepted risk — ADR NNNN ({kind})`, never as a finding and never as a filed issue: a
  `/claude-tweaks:code-health` sweep puts it in its Step 10 summary, and `/claude-tweaks:review`
  Step 6.65 puts it in the summary footer. An ADR that only mentions the kind (in its Context or
  Alternatives, or as a gap it closed with a deny rule), names it only in prose ("outbound network
  access"), or carries any other status does not suppress the finding. Report the candidate as
  usual.
```

Append to the copy-paste prompt's quoted block, after its last sentence (`... that would close it.`), this sentence: `Skip a dimension that a committed docs/decisions/*.md ADR with status accepted names by its kind literal in its Decision section as a risk kept on purpose, and report it as "accepted risk — ADR NNNN ({kind})" instead.` Keep the `> ` quote prefix on each line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/code-health-agent-trust-scope-wiring.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/criteria-agent-trust-scope.md tests/code-health-agent-trust-scope-wiring.test.js
git commit -m "Let agent-trust-scope judges honor an accepted-risk ADR — refs #3312"
```

### Task 2: Review Step 6.65 result row and summary-template footer

**Files:**
- Modify: `plugin/skills/review/focus-criterion-passes.md` — Step 6.65's **Result handling** table (insert one row directly after the "Candidates found but none survive judgment" row)
- Modify: `plugin/skills/review/review-summary-template.md:139` — the Agent Trust Scope section's include/omit note (add the accepted-risk footer case)
- Test: `tests/code-health-agent-trust-scope-wiring.test.js`

**Interfaces:**
- Consumes: Task 1's literal `accepted risk — ADR NNNN ({kind})`.

- [ ] **Step 1: Write the failing test and its go-red control**

Append to `tests/code-health-agent-trust-scope-wiring.test.js`:

```js
function assertStep665AcceptedRiskRow(passes) {
  const start = passes.indexOf('## Step 6.65');
  const end = passes.indexOf('## Step 6.66', start + 1);
  const step = passes.slice(start, end);
  const row = step.split('\n').find((l) => l.startsWith('|') && l.includes('accepted risk — ADR NNNN ({kind})'));
  assert.ok(row, 'Step 6.65 result-handling table has no accepted-risk row');
  assert.match(row, /footer/);
  assert.match(row, /Not an Agent Trust Scope finding/);
}

test('AC1.1: review Step 6.65 renders an accepted-risk candidate as a footer note naming the ADR', () => {
  assertStep665AcceptedRiskRow(readText(path.join(ROOT, 'plugin/skills/review/focus-criterion-passes.md')));
  const tmpl = readText(path.join(ROOT, 'plugin/skills/review/review-summary-template.md'));
  assert.ok(tmpl.includes('accepted risk — ADR NNNN ({kind})'), 'summary template must name the accepted-risk footer note');
});

test('go-red: the Step 6.65 row check fails when the row is removed', () => {
  const passes = readText(path.join(ROOT, 'plugin/skills/review/focus-criterion-passes.md'));
  const mutated = passes.split('\n').filter((l) => !(l.startsWith('|') && l.includes('accepted risk — ADR NNNN'))).join('\n');
  assert.notEqual(mutated, passes, 'mutation did not apply');
  assert.throws(() => assertStep665AcceptedRiskRow(mutated));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/code-health-agent-trust-scope-wiring.test.js`
Expected: FAIL. `AC1.1: review Step 6.65 ...` fails with "has no accepted-risk row", and the go-red test fails with "mutation did not apply".

- [ ] **Step 3: Add the row and the template case**

Insert this row (exact copy):

```markdown
| A candidate whose dimension an accepted ADR keeps on purpose (the criteria fragment's accepted-risk bullet in "What NOT to flag") | Not an Agent Trust Scope finding. Note it in the summary footer as `accepted risk — ADR NNNN ({kind})`, naming the ADR file. When no other candidate survives judgment, omit the section and let this note stand in place of the "no actionable findings" note. |
```

In `review-summary-template.md:139`'s brace note, after the "none survived judgment" clause, add: `; when the only surviving reason is an accepted-risk ADR, note it in the summary footer instead: "Agent Trust Scope: accepted risk — ADR NNNN ({kind})."`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/code-health-agent-trust-scope-wiring.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/focus-criterion-passes.md plugin/skills/review/review-summary-template.md tests/code-health-agent-trust-scope-wiring.test.js
git commit -m "Render accepted-risk agent-trust-scope candidates as a review footer note — refs #3312"
```

### Task 3: Real-input judge probe (verification only, no commit)

**Files:** none modified. This is a scratch check under the session scratchpad.

- [ ] **Step 1: Run the generator on this repo**

Run: `node -e "const {scanAgentTrustScope}=require('./plugin/bin/lib/code-health/candidates-agent-trust-scope.js'); console.log(JSON.stringify(scanAgentTrustScope(process.cwd()).candidates.map(c=>c.kind)))"`
Expected: `["network-egress"]`

- [ ] **Step 2: Judge three inputs against the new bullet text, and record each verdict with the line of the ADR it rests on**

- (a) The real `docs/decisions/0022-unattended-runs-keep-network-egress.md`. `network-egress` should come out as `accepted risk — ADR 0022 (network-egress)`, with no finding (AC1.1). `registry-access` and `credential-scope`, if fed as hypothetical candidates, should still report, because they appear in Context only (AC3.1).
- (b) A temp copy of ADR 0022 with `**Status:** superseded`. `network-egress` should report as a finding (AC2.1).
- (c) A temp ADR whose Context says "we discussed network-egress" and whose Decision does not name it. `network-egress` should report (AC3.1).

Expected: all three verdicts match. A mismatch is a plan defect in Task 1's copy. Fix the bullet and re-run Tasks 1 and 3.

Waived deterministic tests for AC1.1, AC2.1, and AC3.1: a sweep's file/no-file outcome is an LLM judgment over prose, with no code path to unit-test. Tasks 1 and 2 pin the guard prose, and Task 3 probes the judgment on real and mutated inputs.

## Plan-audit Check B (scope keywords): reviewed files

Each file the `Scope keywords:` sweep matched was read and classified. None needs an edit in this plan:

- `plugin/skills/code-health/focus-mode.md`: consumer of the fragment. F4 embeds the fragment in the judge prompt, and Step 10's summary carries the informational line per Task 1's bullet. No change.
- `plugin/skills/review/SKILL.md`, `plugin/skills/review/code-mode-steps.md`: descriptive references to Step 6.65 and the Step 6.7 routing row. An accepted-risk note is not a finding, so it never routes. No change.
- `docs/decisions/0022-unattended-runs-keep-network-egress.md`: its Decision ("the scan is expected to keep reporting `network-egress`") stays true, because the generator still reports and only the judge suppresses. No change.
- `docs/journeys/keep-unattended-sessions-from-publishing-or-reading-secrets-2876.md`: owned by build Common Step 6 (`/claude-tweaks:journeys`), not this plan.
- `plugin/bin/lib/code-health/{candidates-agent-trust-scope,criteria,focus-generators}.js`, `tests/agent-trust-scope-repo-posture.test.js`, `tests/bin-lib/code-health/candidates-agent-trust-scope.test.js`: the generator is unchanged by design (Global Constraints).
- `docs/getting-started.md`, `docs/skill-graph.md`, `tests/code-health-app-store-readiness-wiring.test.js`, `tests/path-guard-conformance.test.js`, `tests/flow-cleanup-only-conformance.test.js`, `plugin/skills/specify/shaping-mode-stamping.md`, `docs/journeys/dispatch-a-near-duplicate-pair-by-name-3520.md`, the ledger, and the two older plans under `docs/superpowers/plans/`: keyword hits ("agent-trust-scope" or "accepted risk") with no dependency on the judge's suppression rule. No change.
