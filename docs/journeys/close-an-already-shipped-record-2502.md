---
files:
  - plugin/skills/build/SKILL.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/dispatch/two-call-gate.md
  - plugin/skills/dispatch/reporting.md
  - plugin/bin/lib/issues/shipped-candidate.js
---

# Close an Already-Shipped Record

**Persona:** the dispatched `build,test` Task agent working a record whose deliverables turn out to already be on the integration branch — an internal tooling user — and the human record-owner who later reads the record's own timeline.
**Goal:** stop before writing a pointless "verified already implemented, no code changes" bookkeeping commit or opening a throwaway draft PR, and instead close the record cleanly with a staged proposal naming the evidence.
**Entry point:** `/build`'s Spec Step 2, after the record is materialized and before a plan is searched for — reached on both the plan-exists and no-plan-exists branches.
**Success state:** the record is closed via a staged Close proposal naming the base-branch commit/PR that already satisfies it; any draft PR the pr-early lifecycle opened is closed with a pointer comment; the record's claim is released; the dispatching session's group report reads as a no-op, never `pending-review`.

## Steps

### 1. Already-shipped assessment — `/build` Spec Step 2
- **URL:** `plugin/skills/build/SKILL.md` "Already-shipped assessment (#2502)"
- **Action:** Before searching for a plan, read the materialized spec's own Deliverables and Acceptance Criteria and check each item against the current codebase — the same read "Check what's already implemented" does later, just run up front. This is distinct from the `Premise-check:` mechanical routing above it: that routes on a scripted command's exit code; this is a judgment call made for every record, gated on nothing but reading the spec.
- **Should feel:** A quick, decisive check — not a second build pass. Most records fail this check immediately (real work remains) and fall through to a normal build with no extra cost paid.
- **Should understand:** The bar is literal — every Deliverable and every Acceptance Criterion already satisfied, zero implementation diff required. "Close enough" or "the intent is covered by a different approach" does not qualify; that is a normal build with a smaller diff, not an already-shipped exit.
- **Red flags:** Treating partial satisfaction as already-shipped; skipping the check because a plan already exists (the assessment runs regardless of which branch Spec Step 2 takes next).

### 2. Stop and report `OUTCOME: already-shipped`
- **URL:** `plugin/skills/dispatch/task-prompt.md` OUTPUT FORMAT
- **Action:** When every item clears, stop here instead of proceeding to Spec Step 3 or Common Step 2. Report `OUTCOME: already-shipped` — a fourth value alongside `build-test-ok`/`build-test-failed`/`build-test-blocked`. This is a clean, non-error terminal outcome; the dispatching session's `two-call-gate.md` §2 routes it to §7, never to §5's fail-loud path — Settle's failure classification, retry counting, and failure comment never run.
- **Should feel:** Terminal, not ambiguous — the agent isn't waiting for a second call to confirm anything; this record's work is finished the moment the report lands.
- **Should understand:** The materialize commit from Spec Step 1 stays as the run's only commit — no "verified already implemented" bookkeeping doc is ever committed, which is the cost this whole flow exists to avoid (#2502's own motivating case, PR #2497).
- **Red flags:** A second `review,polish,wrap-up` call getting dispatched anyway — `task-prompt.md`'s own gate treats `already-shipped` as a third, distinct case that never reaches that call.

### 3. Clean up the record before returning
- **URL:** `plugin/skills/build/SKILL.md` "Already-shipped assessment" steps 2-4
- **Action:** Stage a Close proposal reusing `plugin/bin/lib/issues/shipped-candidate.js`'s proposal shape, naming the base-branch commit/PR that already satisfies the record. Close any draft PR the pr-early lifecycle already opened (`gh pr close {number} --comment "..."`) — never leave a bookkeeping-only draft PR for a human to find. Release the record's claim now via `_shared/issue-claims.md`'s release path, reason `already-shipped`.
- **Should feel:** Tidy — nothing is left half-open for a human to clean up by hand.
- **Should understand:** These three actions happen in the *first* `build,test` call, before the dispatching session even reads the report — there is no second call in this flow to do them later.
- **Red flags:** A draft PR still open after the report lands; a claim still held past this point.

### 4. Dispatching session tears down the worktree, reports a no-op
- **URL:** `plugin/skills/dispatch/two-call-gate.md` "§7. Terminal path when the first call reports `already-shipped`"; `plugin/skills/dispatch/reporting.md`
- **Action:** **Dispatching session** makes the same direct `/claude-tweaks:wrap-up {target} cleanup-only` call sections 5 and 6 both specify — never through `/claude-tweaks:flow`, since there is no materialize-shape-gate concern to route around and re-running `/flow`'s pre-flight buys nothing here. `cleanup-only`'s Section E release step finds an already-released claim and no-ops (the same idempotent overlap §6 already documents for its own case).
- **Should feel:** Ordinary teardown, not a special case requiring extra judgment from the dispatching session.
- **Should understand:** The group's own report states plainly that the record's deliverables were already on the base branch, names the staged Close proposal, and stops — no `pending-review` line, no timing line implying a review is waiting, and no `PushNotification` (nothing here is an FYI worth a notification).
- **Red flags:** The group reporting `pending-review` for an already-shipped record — that conflates "closed via staged proposal" with "shipped via a merge this firing performed," which `reporting.md`'s own already-shipped section exists to prevent.

## Origin
- Created during wrap-up of the #2502/#2488/#2484/#2449/#1826/#496 bundle (2026-09-17) — a J2 missing-journey gap-detection finding: the already-shipped exit this same bundle introduced had zero journey coverage.
- Related specs: #2502 (introduced the exit), #2488 (task-prompt.md's second-call HARD-GATE, orthogonal to this flow), #360/#1537 (the AC-forwarding verification #496 hardens, orthogonal to this flow)
