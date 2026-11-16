# Reword CLAUDE.md's maturity paragraph (#5585) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `CLAUDE.md`'s "Established codebase" paragraph (line 64) in place with the stance "redesign is free, a run in flight on the previous release is not broken".

**Architecture:** One in-place edit of one line of `CLAUDE.md`. No other file changes; `.claude-tweaks/policy.yml` keeps `project-maturity: established`.

**Tech Stack:** Markdown; `node --test` for the byte-budget check.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T001050-record-5585/work/5585-spec.md` (materialized from GitHub issue #5585)

## Global Constraints

- `CLAUDE.md` byte budget: `tests/claude-md-budget.test.js` `BUDGET_BYTES` is 24,576; the file is 24,571 bytes at base. The new paragraph must be no longer than the 786-byte one it replaces.
- Every other line of `CLAUDE.md` stays byte-identical (`tests/working-approach-scope-discipline.test.js`, `tests/subagent-contract-clauses.test.js` pin other prose).
- The paragraph keeps its first two words `Established codebase` and the word `expand-contract` (five files cite the rule by that name).
- No sentence of history or example is added (`docs/decisions/0010-*`).

## Review Focus

- A trailing-newline or line-join slip that turns the one line into two (AC3 requires exactly 1 added / 1 removed).
- A changed word that grows the paragraph past the 5 bytes of headroom.
- Accidental edits to any file in the spec's "What else states the old stance" table (AC4).

---

### Task 1: Replace the maturity paragraph

**Files:**
- Modify: `CLAUDE.md:64`

**Interfaces:**
- Consumes: none
- Produces: none

- [ ] **Step 1: Confirm the new wording is absent at base**

- [ ] **Step 2: Run the check to verify it fails**

Run: `git grep -c -F "Redesign is free" -- CLAUDE.md`
Expected: FAIL (prints nothing, exit 1)

- [ ] **Step 3: Replace line 64 of `CLAUDE.md`** with exactly this text (736 bytes, one line):

```
Established codebase distributed to real users via a versioned plugin marketplace; live sessions run mixed plugin versions. Redesign is free: replace a design outright when a better one exists, with no preference for what already shipped. The one limit: a change must not break a run in flight on the previous release. Where such a run reads a contract (skill frontmatter shape, hook payloads, work-record schema, run-directory files, `_shared/*.md` conventions, this repo's committed config, which the installed build reads with older code), change it by expand-contract: add the new beside the old, migrate every consumer, remove the old once its recorded removal condition holds (Don'ts `[IL-85]`) — never a silent breaking rename.
```

- [ ] **Step 4: Verify the acceptance criteria**

Run: `git grep -c -F "Established codebase" -- CLAUDE.md` — Expected: `CLAUDE.md:1`; that line contains `Redesign is free`, `run in flight on the previous release`, `mixed plugin versions`, `expand-contract`, `beside the old`, `removal condition` (AC1).
Run: `git grep -c -F "Prefer stability over novelty" -- CLAUDE.md` — Expected: no output, exit 1 (AC2).
Run: `git diff --numstat HEAD -- CLAUDE.md` — Expected: `1	1	CLAUDE.md` (AC3).
Run: `node --test tests/claude-md-budget.test.js` — Expected: PASS (AC3).
Run: `git diff --stat HEAD -- plugin .claude-tweaks/policy.yml docs/donts.md docs/skill-authoring.md` — Expected: empty (AC4).
Run: `node plugin/bin/resolve-policy.js --values project-maturity` — Expected: `established` (AC4).
Proof(public-contract): the only contract changed is this repo's own CLAUDE.md prose, which no payload code parses; AC4's empty `git diff --stat` over `plugin`, `.claude-tweaks/policy.yml`, `docs/donts.md`, `docs/skill-authoring.md` proves no shipped skill contract, policy key, or hook payload moved, and `resolve-policy.js --values project-maturity` still printing `established` proves the maturity-keyed consumers read the same value.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "Reword CLAUDE.md's maturity paragraph — redesign is free, a run in flight is not broken (refs #5585)"
```

AC5 (full suite) is verified by the pipeline's test phase.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3; Deliverable 2 → Step 4's AC4 checks; AC1–AC4 → Step 4; AC5 → test phase.
- **Placeholders:** none.
