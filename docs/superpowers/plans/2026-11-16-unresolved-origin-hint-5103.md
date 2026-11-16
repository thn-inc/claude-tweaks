# Unresolved-origin hint `--repo [host/]owner/name` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every gated CLI that cannot resolve its origin tells the user to pass `--repo [host/]owner/name`, not the bare `--repo owner/name` that reaches github.com.

**Architecture:** A text-only change to 14 inline stderr strings in 13 files under `plugin/bin/`. Each string stays inline in its own CLI; `plugin/bin/lib/number-list-cli.js` already owns the one template shared by several CLIs and keeps its `${name}` interpolation. Exit code 2 and every code path are untouched.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T153400-spec-5103-5109/spec-5103/work/5103-spec.md` (record #5103).

Scope keywords: — pass --repo owner/name

## Global Constraints

- The new hint text is exactly `pass --repo [host/]owner/name`; the rest of each message (the CLI name prefix, `could not resolve owner/repo`, and for `preflight-records.js:412` the ` for --blocker-landing` clause) is unchanged.
- Each CLI still exits 2 on an unresolved origin.
- Edit the string in place: no reformatting, no helper extraction, no new test files (CLAUDE.md Working Approach).
- Out of scope, do not touch: `plugin/bin/stale-claim-pr.js` and `tests/stale-claim-pr-cli.test.js` (already say `host/owner/name`, #4794), `docs/journeys/`, `docs/plans/`, `plugin/skills/specify/record-creation-linking.md:39` (override prose, not the unresolved-origin hint).

## Review Focus

- `plugin/bin/lib/number-list-cli.js:117` is a template literal: the new text must keep `${name}` and the backticks, since several CLIs print through it.
- `plugin/bin/preflight-records.js` carries two hints, line 278 and line 412 (the `--blocker-landing` one); changing only one leaves the acceptance grep non-empty.
- `materialize.js`'s hint (line 399) has no test pinning its text, so only the acceptance grep proves it changed.
- A mechanical replace must not widen to `stale-claim-pr.js`, whose `host/owner/name` text is pinned by `tests/stale-claim-pr-cli.test.js:479`.
- Tests that match only `/could not resolve owner\/repo/` stay green untouched; the two that match the tail of the hint (`preflight-records.test.js:1273`, `link.test.js:270`) are the only pins to move.

---

### Task 1: Replace the hint text in 13 CLIs and re-pin two tests

**Files:**
- Modify: `plugin/bin/apply-refine-labels.js:182`
- Modify: `plugin/bin/backlog-grant-gate.js:169`
- Modify: `plugin/bin/fetch-sub-issues.js:121`
- Modify: `plugin/bin/file-feedback.js:120`
- Modify: `plugin/bin/link-records.js:91`
- Modify: `plugin/bin/list-claims.js:80`
- Modify: `plugin/bin/materialize.js:399`
- Modify: `plugin/bin/preflight-records.js:278`
- Modify: `plugin/bin/preflight-records.js:412`
- Modify: `plugin/bin/release-claim.js:151`
- Modify: `plugin/bin/repair-claim.js:112`
- Modify: `plugin/bin/resolved-refusal.js:78`
- Modify: `plugin/bin/lib/compose-subject.js:333`
- Modify: `plugin/bin/lib/number-list-cli.js:117`
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js:1273`
- Test: `tests/bin-lib/issues/link.test.js:270`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing; stderr text only.

- [ ] **Step 1: Re-pin the two tests that match the hint's tail**

  In `tests/bin-lib/preflight-records/preflight-records.test.js:1273` change the regex tail `pass --repo owner\/name` to `pass --repo \[host\/\]owner\/name`. In `tests/bin-lib/issues/link.test.js:270` change `/could not resolve owner\/repo — pass --repo/` to `/could not resolve owner\/repo — pass --repo \[host\/\]owner\/name/`.

- [ ] **Step 2: Confirm no source carries the new text yet**

  Run: `git grep -q -F -e "pass --repo [host/]owner/name" -- plugin/bin`
  Expected: FAIL (exit 1, no match — the two re-pinned tests are red against the old text until Step 3).

- [ ] **Step 3: Replace the text in every source line listed under Files**

  In each listed line replace `pass --repo owner/name` with `pass --repo [host/]owner/name`, nothing else. `lib/number-list-cli.js:117` keeps its `${name}` template literal.

- [ ] **Step 4: Prove the acceptance grep is empty and the new text is everywhere**

  Run: `git grep -n -F -e "pass --repo owner/name" -- plugin/bin`
  Expected: no output (exit 1).

  Run: `git grep -c -F -e "pass --repo [host/]owner/name" -- plugin/bin`
  Expected: 13 lines of `path:count`, `preflight-records.js` with count 2, every other file 1 (14 hits in 13 files).

- [ ] **Step 5: Run the affected suites**

  Run each as its own command, expected PASS: `node --test tests/apply-refine-labels.test.js`, `node --test tests/backlog-grant-gate-cli.test.js`, `node --test tests/fetch-sub-issues-cli.test.js`, `node --test tests/bin-lib/feedback/file-feedback.test.js`, `node --test tests/bin-lib/compose-subject.test.js`, `node --test tests/bin-lib/number-list-cli.test.js`, `node --test tests/bin-lib/issues/link.test.js`, `node --test tests/list-claims-cli.test.js`, `node --test tests/bin-lib/preflight-records/preflight-records.test.js`, `node --test tests/bin-lib/release-claim/cli.test.js`, `node --test tests/bin-lib/repair-claim/cli.test.js`, `node --test tests/bin-lib/issues/resolved-refusal-cli.test.js`, `node --test tests/stale-claim-pr-cli.test.js`.

- [ ] **Step 6: Commit**

  ```bash
  git add plugin/bin/apply-refine-labels.js plugin/bin/backlog-grant-gate.js plugin/bin/fetch-sub-issues.js plugin/bin/file-feedback.js plugin/bin/link-records.js plugin/bin/list-claims.js plugin/bin/materialize.js plugin/bin/preflight-records.js plugin/bin/release-claim.js plugin/bin/repair-claim.js plugin/bin/resolved-refusal.js plugin/bin/lib/compose-subject.js plugin/bin/lib/number-list-cli.js tests/bin-lib/preflight-records/preflight-records.test.js tests/bin-lib/issues/link.test.js
  git commit -m "Say --repo [host/]owner/name in the unresolved-origin hint — 13 gated CLIs (#5103)"
  ```
