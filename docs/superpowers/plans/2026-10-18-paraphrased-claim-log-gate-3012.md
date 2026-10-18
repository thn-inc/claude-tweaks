# Paraphrase-tolerant bookkeeping-stamps recognition (#3012) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bookkeeping-stamps PreToolUse gate accept a Step 2.8 claim line or a PR-early Step 1 line that is semantically equivalent but not byte-exact, while a genuinely missing line still denies.

**Architecture:** Two pure, per-line recognizers, each OR-ed with the existing exact regex (never replacing it). `paraphrasedClaimNumbers(line)` lives beside `hasClaimLogFor` in `plugin/bin/lib/log-decision/claim-log.js`. `hasPrEarlyStep1LineFor(body, branch)` lives beside `hasLoggedPrEarlyStep1` in `plugin/bin/lib/hooks/pre-tool-use.js`. Both recognize only `AUTO` entry lines and require the issue number or branch to be present unambiguously, plus the step's positive outcome semantics.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T232414-record-3012/work/3012-spec.md` (materialized from GitHub issue #3012)

Scope keywords: hasClaimLogFor, hasLoggedPrEarlyStep1

## Global Constraints

- Gotcha (verbatim): "Do not loosen the match so far that a genuinely missing claim (never logged at all) passes — the gate's whole purpose is catching exactly that case. Any looser recognition must still require the claimed issue number and the "claimed" semantics to be unambiguously present."
- The existing exact forms keep matching exactly as today. Each new recognizer is an additional OR branch.
- `isClaimLogEntry` / `classifyDecisions` (preflight's fresh-mint detection, #2861) stay strict and unchanged. They answer a different question: "is this file only claim lines?"
- Sole-site proof (run at authoring time): `git grep -n -e hasClaimLogFor -e "no existing PR for" -- plugin/bin` → the only consumers are `pre-tool-use.js:37/1313` (`hasLoggedClaim`) and `pre-tool-use.js:1249` (`hasLoggedPrEarlyStep1`). Nothing else re-parses these lines.

## Review Focus

1. A negated mention ("this run never itself claimed #1786 via claim-targets.js", from real archive `2026-09-14T135637-record-1786`) must not satisfy the gate. Pinned in Task 1.
2. A date after "claimed" ("claimed 2026-09-14T14:29Z", from real archive `2026-09-14T132657-record-…-1769`) must not read as record #2026. Pinned in Task 1.
3. A branch that is a strict prefix of a logged branch — including the `+` separator real multi-spec branches use (`worktree-flow` vs `worktree-flow+spec-3153-3156`) — must not satisfy Step 1. Pinned in Task 2.
4. An outcome word that appears only inside the `Reversibility:` clause ("(PR can be closed/reopened; …)", from real archive `2026-08-14T201053-record-421`) must not count as a Step 1 outcome. Pinned in Task 2.
5. A Step-2/3-only paraphrase ("pushed X to origin and opened draft PR #N", which carries no Step 1 outcome) must still deny. This is the #1800 gap. Pinned in Task 2.

## Real-input probe (done at authoring time; re-run after Task 2)

Scratch probes over every archived `decisions.md` under `$RUN_ROOT/.claude-tweaks/pipelines/archive/` (1050 files):

- Claim recognizer: 417 accepted lines = 192 canonical (`grep -rhE "^- AUTO .*Step 2\.8: claimed #[0-9]+ \(bin/claim-targets\.js, transport"` | `wc -l` = 192) + 225 paraphrased, reconciled exactly. Of the remaining `AUTO` + `claimed` + `#N` lines, 53 were rejected; review found none of them to be a missed same-run claim with a number adjacent to "claimed".
- Step 1 recognizer: 92 of 92 (run, branch) pairs the canonical regex accepts are also accepted. The recognizer additionally accepts 23 genuinely paraphrased Step 1 lines, e.g. "no existing PR found for `worktree-dispatch-392`".

After implementation, the implementer re-runs the shipped functions over the same archive and confirms the counts are unchanged (417 / 92-of-92).

---

### Task 1: Paraphrase-tolerant claim-log recognition

**Files:**
- Modify: `plugin/bin/lib/log-decision/claim-log.js` (add `paraphrasedClaimNumbers`, extend `hasClaimLogFor`, export the new function, update header comment)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:1293-1317` (comment above `hasLoggedClaim` only — name the paraphrase tolerance, #3012)
- Modify: `docs/hooks.md` (the "Claim-stamp branch (#2526…)" bullet — one sentence: a semantically equivalent paraphrase is also accepted, with the recognition rules)
- Modify: `docs/plugin-structure.md:35` (claim-log.js's export list gains `paraphrasedClaimNumbers`)
- Test: `tests/bin-lib/log-decision/claim-log.test.js`, `tests/hooks-bookkeeping-stamps-gate.test.js`; re-run, no edit: `tests/bin-lib/claim-targets/claim-targets.test.js` (its `hasClaimLogFor` assertions at :1357-1358 are true-only, so loosening cannot break them)

**Interfaces:**
- Produces: `paraphrasedClaimNumbers(line: string) => number[]` — the record numbers a single decisions.md line positively records as claimed (empty when none). `hasClaimLogFor(body, n)` keeps its signature and returns true on: the exact form, OR the batch form, OR any line where `paraphrasedClaimNumbers(line).includes(n)`.

- [ ] **Step 1: Write the failing tests** in `claim-log.test.js`, names starting `AC1.1:`:
  - `AC1.1: hasClaimLogFor accepts paraphrased claim lines that name the number (#3012)` — every one of these returns true for its number (real archive lines, verbatim):
    - `- AUTO 06:31:43 — log-decision: flow: claimed issue #2694 via MCP transport (gh CLI unavailable); tombstone reclaim from prior run. Reversibility: high.` → 2694 (the record's own observed shape)
    - `- AUTO 07:42:07 — spec #827 — flow/claim-targets: Claimed issue #827 for this run (claims-registry blob write, state: absent -> live). Reversibility: high.` → 827
    - `- AUTO 01:03:28 — Step 2.8: claimed #517, #518, #519 on claims-registry (all classified 'absent'). Reversibility: high.` → 517, 518, 519
    - `- AUTO 07:49:40 — Step 2.8: group-claimed #533,#534,#536 under run 2026-08-16T074746-spec-533-534-536. Reversibility: high.` → 534
    - `- AUTO -- Step 2.8 claim: both #1447 and #1446 claimed successfully under runId 2026-08-29T232244-record-1446 (claim-targets.js exit 0). Reversibility: high.` → 1446, 1447
    - `- AUTO 07:27:52 — Step 2.8: claimed 2554,2745 (bin/claim-targets.js, transport: git). Reversibility: high.` → 2745 (bare numbers, anchored)
    - `- AUTO 05:25:45 — Step 2.8 (claim targets): Claimed issue #2328 (create-only write). Reversibility: high.` → 2328
  - `AC1.1: hasClaimLogFor still denies a claim that was never logged (#3012 Gotcha)` — each returns false for the named number:
    - `''` and `'## /flow\n'` → 7
    - `- AUTO 16:14:57 — log-decision: Wrap-up outcome: pending-review. Separately noted: this run never itself claimed #1786 via claim-targets.js. Reversibility: n/a.` → 1786
    - `- AUTO 08:00:00 — Step 2.8: #3012 was not claimed (blob unreadable). Reversibility: n/a.` → 3012
    - `- AUTO 21:08:27 — Step 2.8: claim contested: #3004 held live by run 2026-10-16T190307-record-2734 (claimed 19:07:35, ttl 72h). Reversibility: n/a.` → 3004
    - `- AUTO 08:00:00 — Step 2.8: #3012 was claimed by run 2026-10-01T000000-record-3012 (another session). Reversibility: n/a.` → 3012
    - `- AUTO 17:54:54 — log-decision: Group E abandoned before claiming: sibling-session claims (#1769 alone, host=vm, claimed 2026-09-14T14:29Z). Reversibility: n/a.` → 2026 and 1769
    - `- AUTO 03:49:47 — Known drift: issue #614 claimed eight objectives. Reversibility: high.` → 614 (backward form needs a claim anchor)
    - `- STAGED 08:00:00 — Step 2.8: claimed #3012 (bin/claim-targets.js, transport: git).` → **true** (the existing whole-file exact match is status-agnostic — pinned so the new code does not silently change it), while `paraphrasedClaimNumbers` of `- STAGED 08:00:00 — flow: claimed issue #3012.` is `[]`
    - `- AUTO 08:00:00 — flow: claimed issue #700 via MCP.` → 7 (word-bounded number)
    - `- AUTO 08:00:00 — flow: #3012 left unclaimed. Reversibility: n/a.` → 3012
  - Keep the existing `hasClaimLogFor keeps hasLoggedClaim's semantics` test unchanged.

- [ ] **Step 2: Run** `node --test tests/bin-lib/log-decision/claim-log.test.js`. Expected: FAIL. The positive paraphrase assertions fail and `paraphrasedClaimNumbers` is not a function.

- [ ] **Step 3: Implement** `paraphrasedClaimNumbers` in `claim-log.js` exactly as below. This is the algorithm the authoring-time probe validated; the surrounding prose is the implementer's.

```js
const AUTO_LINE_RE = /^\s*-\s+AUTO\b/;
const CLAIM_ANCHOR_RE = /\bStep 2\.8\b|\bclaim-targets\b|\bclaims-registry\b|\bissue-claims\b/i;
const NEGATED_SRC = String.raw`(?<!(?:\b(?:not|never|no)\b|n't)(?:\s+[\w'-]+){0,2}\s+)`;
const NUM_LIST_SRC = String.raw`#?\d+(?:(?:\s*,\s*|\s+and\s+|\s+)#?\d+)*`;
const HASH_LIST_SRC = String.raw`#\d+(?:(?:\s*,\s*|\s+and\s+|\s+)#\d+)*`;
const LIST_END_SRC = String.raw`(?![\w#/:-]|\.\d)`;
// "claimed [both|group|the] [issue(s)|target(s)|record(s)] <list>"
const FORWARD_RE = new RegExp(`${NEGATED_SRC}\\bclaimed\\s+(?:(?:both|group|the)\\s+)?(?:(?:issues?|targets?|records?)\\s+)?(${NUM_LIST_SRC})${LIST_END_SRC}(?!\\s*(?:targets?|issues?|records?|members?)\\b)`, 'gi');
// "<#list> [were|was|both|all|each|successfully] claimed" — never "claimed by"
const BACKWARD_RE = new RegExp(`(${HASH_LIST_SRC})${LIST_END_SRC}\\s+(?:(?:were|was|both|all|each|successfully)\\s+)*claimed\\b(?!\\s+by\\b)`, 'gi');
```

Rules:
- A non-`AUTO` line, or a line containing `\bcontested\b` (case-insensitive), yields `[]`.
- Only the text before the first `/\sReversibility:/` is examined.
- Forward matches contribute every `#N` in the list, and bare `N` only when the line also matches `CLAIM_ANCHOR_RE`.
- Backward matches are honored only when `CLAIM_ANCHOR_RE` matches.
- Return deduplicated numbers.

Then extend `hasClaimLogFor` to fall back to `String(body).split(/\r?\n/).some((l) => paraphrasedClaimNumbers(l).includes(Number(n)))`. Export the new function.

- [ ] **Step 4: Add the gate-level tests** to `tests/hooks-bookkeeping-stamps-gate.test.js`, modeled on the existing `(#2526): claim logged -> falls through …` test at line 213:
  - `AC1.1 (#3012): a paraphrased claim line (flow: claimed issue #991 via MCP transport …) -> falls through past the claim branch to the worktree deny, not a claim deny`
  - `AC1.1 (#3012): a negated paraphrase (… never itself claimed #991 …) -> still the claim deny naming #991`

- [ ] **Step 5: Run** `node --test tests/bin-lib/log-decision/claim-log.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/bin-lib/claim-targets/claim-targets.test.js`. Expected: PASS. Then revert only `plugin/bin/lib/log-decision/claim-log.js` (`git show HEAD:plugin/bin/lib/log-decision/claim-log.js > <scratch>` + copy back, never `git stash`). Confirm only the new positive tests and the first gate test go red, then restore.

- [ ] **Step 6: Update** the comment above `hasLoggedClaim` in `pre-tool-use.js`, the claim-stamp bullet in `docs/hooks.md`, and `docs/plugin-structure.md:35`.

- [ ] **Step 7: Commit** — `git add plugin/bin/lib/log-decision/claim-log.js plugin/bin/lib/hooks/pre-tool-use.js docs/hooks.md docs/plugin-structure.md tests/bin-lib/log-decision/claim-log.test.js tests/hooks-bookkeeping-stamps-gate.test.js` with message `Accept paraphrased Step 2.8 claim lines in the bookkeeping-stamps gate — refs #3012`.

---

### Task 2: Paraphrase-tolerant PR-early Step 1 recognition

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:1208-1258` (add exported pure `hasPrEarlyStep1LineFor`; `hasLoggedPrEarlyStep1` reads the file and delegates; add to `module.exports`)
- Modify: `docs/hooks.md` (the `#1800` precondition sentence: a paraphrased Step 1 outcome line naming the branch also satisfies it; FAILED lines never do)
- Test: `tests/hooks-bookkeeping-stamps-gate.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `hasPrEarlyStep1LineFor(body: string, branch: string) => boolean` — true when the existing exact three-shape regex matches, OR some single line matches all of the following:
  - it is an `AUTO` entry line (`/^\s*-\s+AUTO\b/`);
  - it contains `/\bPR[- ]early\b/i`;
  - it contains no `/\bFAILED\b/`;
  - its text before `/\sReversibility:/` matches the outcome regex below;
  - that same text contains the branch as a whole token: preceded by start, whitespace, or one of `` ` ' " ( ``; followed by end, whitespace, one of `` ; , ` ' " ) ``, or `.` + whitespace/end.

```js
const STEP1_OUTCOME_RE = /\bno\s+(?:(?:existing|open|prior|matching|draft)\s+)*PRs?\s+(?:found|exists?|existed|for|on)\b|\bfound\s+no\s+(?:(?:existing|open|prior|matching|draft)\s+)*PRs?\b|\breus(?:e|ed|ing)\b|\breopen(?:ed|ing)?\b/i;
```

- [ ] **Step 1: Write the failing tests**, unit-level against `pre.hasPrEarlyStep1LineFor`, names starting `AC1.1:`:
  - `AC1.1: hasPrEarlyStep1LineFor accepts the three canonical lines and paraphrased Step 1 outcomes naming the branch (#3012)`. True for branch `B=worktree-dispatch-record-3012`:
    - the existing three canonical lines (no-match / reuse-open / reopen)
    - `` - AUTO 21:52:00 — PR-early run lifecycle: no existing PR found for `B`. Pushed branch, opened draft PR #443. Reversibility: high. ``
    - `- AUTO 08:42:07 — log-decision: PR-early run lifecycle: no PR existed for B (checked via gh pr list --state all, no match); pushing. Reversibility: n/a.`
    - `- AUTO 22:03:52 — log-decision: PR-early run lifecycle: reused existing OPEN PR #2535 for branch B. Reversibility: high.`
  - `AC1.1: hasPrEarlyStep1LineFor still rejects a Step 1 that never ran (#3012 Gotcha)` — false for:
    - `''`
    - `- AUTO 03:50:57 — PR-early run lifecycle Step 2 (push): pushed B to origin and opened draft PR #2393. Reversibility: high.` (no Step 1 outcome)
    - `- AUTO 09:00:00 — PR-early run lifecycle: push of B to origin FAILED (network); run proceeds local-only, no PR opened. Reversibility: n/a.`
    - `- AUTO 20:31 — Pushed B to origin per pr-early-run-lifecycle.md and opened PR #432. Reversibility: high (PR can be closed/reopened; branch already existed).` (outcome word only in Reversibility)
    - `- AUTO 09:00:00 — PR-early run lifecycle: no existing PR found for B-retry; creating. Reversibility: n/a.` (prefix branch)
    - for branch `worktree-flow`: `- AUTO 19:34:01 — PR-early run lifecycle: no existing PR found for worktree-flow+spec-3153-3156, creating. Reversibility: n/a.`
    - `- SKIP 09:00:00 — PR-early run lifecycle: no existing PR found for B. Reversibility: n/a.`
  - Gate-level: `AC1.1 (#3012): a paraphrased Step 1 line satisfies the #989 exemption precondition -> allow`. Modeled on the existing `(#1800): Step 1's reuse-open line …` test at line 592, with decisions.md holding `` - AUTO 09:00:00 — PR-early run lifecycle: no existing PR found for `${branch}`, creating. Reversibility: n/a. ``

- [ ] **Step 2: Run** `node --test tests/hooks-bookkeeping-stamps-gate.test.js`. Expected: FAIL (`pre.hasPrEarlyStep1LineFor is not a function`; the gate-level test denies).

- [ ] **Step 3: Implement** `hasPrEarlyStep1LineFor` per the Interfaces block, and make `hasLoggedPrEarlyStep1(runDir, branch)` read decisions.md and return `hasPrEarlyStep1LineFor(body, branch)`. Keep its try/catch → false posture and its existing #1800 comment, plus one paragraph on #3012. Export it.

- [ ] **Step 4: Run** `node --test tests/hooks-bookkeeping-stamps-gate.test.js tests/bin-lib/log-decision/claim-log.test.js tests/pr-early-run-lifecycle-step1-logging-conformance.test.js`. Expected: PASS. Revert only `pre-tool-use.js` (via `git show HEAD:…`); confirm only the new positive and gate tests go red; restore.

- [ ] **Step 5: Real-input re-probe** — run the shipped `hasClaimLogFor`/`paraphrasedClaimNumbers` and `hasPrEarlyStep1LineFor` over the archive (scratch script, not committed). Confirm 417 accepted claim lines and 92 of 92 canonical Step 1 pairs still accepted.

- [ ] **Step 6: Update `docs/hooks.md`**, then commit: `git add plugin/bin/lib/hooks/pre-tool-use.js docs/hooks.md tests/hooks-bookkeeping-stamps-gate.test.js` with message `Accept paraphrased PR-early Step 1 lines in the bookkeeping-stamps gate — refs #3012`.

---

## Self-review

- **Spec coverage:**
  - Deliverable 1 (loosen `hasClaimLogFor` and the sibling PR-early check) → Tasks 1 and 2.
  - Deliverable 2 (the docs-only alternative) → not taken. The AC is disjunctive, and its first branch is implemented. The "Mechanical backstop" paragraph of `claim-targets.md` stays accurate, since the template remains the documented form.
  - AC1.1 → both tasks' `AC1.1:` tests.
  - Gotcha → both "still rejects / still denies" tests plus Review Focus 1-5.
- **Placeholders:** none.
- **Type consistency:** `paraphrasedClaimNumbers(line) => number[]`, `hasClaimLogFor(body, n) => boolean`, `hasPrEarlyStep1LineFor(body, branch) => boolean`.
