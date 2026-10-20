# First-call artifact check: canonical Step 2.8 claim line (#3577) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `checkFirstCallArtifacts` fails a first call whose run directory's `decisions.md` lacks the canonical `Step 2.8: claimed #{n}` line for any member.

**Architecture:** A sixth check, run last (after the materialized-header check, so every existing failure reason and its test are unchanged), reads `{runDir}/decisions.md` (the same path `plugin/bin/verify-run-bookends.js`'s `readDecisions` uses) through the injected `readFile` seam, and tests each member with the existing `hasCanonicalClaimLogFor(body, n)` from `plugin/bin/lib/log-decision/claim-log.js`. A missing or unreadable `decisions.md` counts as absent for every member.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T180029-record-3577/work/3577-spec.md`

## Global Constraints

- The `integration-model` read gap belongs to #3350 and is not touched here (`resolveIntegrationModel` and the degrade line stay byte-identical).
- Use `hasCanonicalClaimLogFor` (exact per-target line only), never the lenient `hasClaimLogFor` — the spec names the canonical line.
- Failure shape is `{ ok: false, reason, message }`, with no `repairable` key (AC6.2's existing test pins that only `missing-config` carries it).

## Review Focus

- A multi-member group where only one member's line is missing: the message names that member and not the other.
- `decisions.md` absent entirely: fails `claim-log-missing`, never throws.
- A batch-summary or paraphrased claim line (accepted by `hasClaimLogFor`) does not satisfy this check.
- `#7` vs `#700`: `hasCanonicalClaimLogFor`'s `\b` keeps a line for #700 from satisfying #7. Already pinned in claim-log.test.js, so it is not re-tested here.
- The new check never runs ahead of an earlier failure: a run missing both a header and the claim line still reports `materialized-header-missing`.

---

### Task 1: Claim-log check in `checkFirstCallArtifacts`, documented in two-call-gate.md section 2

**Files:**
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js`
- Modify: `plugin/skills/dispatch/two-call-gate.md` (section 2's "Artifact check" paragraph)
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js`

**Interfaces:**
- Consumes: `hasCanonicalClaimLogFor(body: string, n: number) -> boolean` from `../log-decision/claim-log`.
- Produces: new failure `{ ok: false, reason: 'claim-log-missing', message }`, where `message` names `#{n}` and `{runDir}/decisions.md`.

- [ ] **Step 1: Write the failing tests**

Add a test helper `writeClaimLog(runDir, issueNumbers)`. It writes `{runDir}/decisions.md` with `## /flow` followed by one line per member: `- AUTO 20:02:17 — Step 2.8: claimed #{n} (bin/claim-targets.js, transport: git). Reversibility: high.`. Call it in every existing test that asserts `{ ok: true }`: the fully-formed pr-first run, the spec-{n}/work multi-record group, both worktree-mirror tests, the AC6.2 `pass` run, and the three #3350 tests whose result is `{ ok: true }` (AC3.1 ×2, local-merge pin). New tests:

- `fails claim-log-missing when decisions.md lacks the canonical Step 2.8 line (#3577)`: a fully-formed local-merge run with a header and no `decisions.md` → `result.ok === false`, `result.reason === 'claim-log-missing'`, `result.message` matches `/#2806/`, and the result has no `repairable` key.
- `passes once the canonical Step 2.8 line is written (#3577)`: same run, then `writeClaimLog(runDir, [2806])` → `deepEqual(result, { ok: true })`.
- `names only the member whose line is missing in a multi-record group (#3577)`: members [2806, 2807] with headers, line written for 2806 only → reason `claim-log-missing`, message matches `/#2807/` and does not match `/#2806/`.
- `a batch-summary or paraphrased claim line does not satisfy the canonical check (#3577)`: `decisions.md` containing `- AUTO 20:02:17 — Step 2.8: Claimed all 1 targets under run X (git). Reversibility: high.` and `- AUTO 20:02:18 — claimed issue #2806 for this run via claim-targets. Reversibility: high.` → reason `claim-log-missing`.
- `an earlier failure still wins over a missing claim line (#3577)`: no header and no `decisions.md` → reason `materialized-header-missing`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: FAIL. The `claim-log-missing` tests get `{ ok: true }`; every other test passes.

- [ ] **Step 3: Implement check 6 in `checkFirstCallArtifacts`**

After the materialized-header loop, read `path.join(runDir, 'decisions.md')` via `readFile` inside a `try` (a throw counts as `''`). For each `issueNumber`, `if (!hasCanonicalClaimLogFor(body, Number(issueNumber)))`, return `fail('claim-log-missing', \`no canonical "Step 2.8: claimed #${issueNumber}" line in ${decisionsPath} (/flow claim-targets.md's Log the claim)\`)`. Extend the header comment's numbered "Checks, in order" list with item 6.

- [ ] **Step 4: Update two-call-gate.md section 2**

In the "Artifact check" paragraph, after the #2775 materialized-header sentence, add one sentence: it also checks (#3577) that the run directory's `decisions.md` carries the canonical `Step 2.8: claimed #{n}` line for every member (`hasCanonicalClaimLogFor`, `plugin/bin/lib/log-decision/claim-log.js`), the line the stamps gate in `pre-tool-use.js` needs before call 2's first push, so a first call that skipped `verify-run-bookends.js` is stopped here.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: PASS, 0 failures.

Then run the prose suites that read two-call-gate.md:
Run: `node --test tests/dispatch-mechanical-enforcement.test.js tests/dispatch-sequential-execution-conformance.test.js tests/flow-manifesto-integration-model-pin.test.js tests/dispatch-settle-and-merge-lazy-read.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/dispatch/first-call-artifact-check.js plugin/skills/dispatch/two-call-gate.md tests/bin-lib/dispatch/first-call-artifact-check.test.js
git commit -m "Verify the canonical Step 2.8 claim line in the first-call artifact check — closes the self-check-only gap (refs #3577)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3; Deliverable 2 → Step 4; Deliverable 3 + AC 1 → Steps 1/5; AC 2 (#3350 untouched) → Global Constraints.
- **Placeholders:** none.
