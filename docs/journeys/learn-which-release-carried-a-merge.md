---
files:
  - plugin/skills/_shared/pr-first-merge-post-merge.md
  - plugin/skills/_shared/pr-run-comments.md
  - plugin/skills/flow/summary-template.md
  - docs/releasing.md
---

# Learn Which Release Carried a Merge

**Persona:** claude-tweaks maintainer (or the Claude session that just merged a pr-first run) whose PR landed on `main` minutes before — or minutes after — a sibling session's version bump, and who needs to know whether the work already shipped under a tag that never got a mention.
**Goal:** Get a one-line, mechanically-derived answer to "where did this merge land relative to the tag history?" — from pure tag ancestry, no CHANGELOG comparison, no plugin-manifest precondition.
**Entry point:** A confirmed pr-first merge (`gh pr view --json mergeCommit`), inside `_shared/pr-first-merge-post-merge.md` Step 4 — or a terminal at any git checkout, running the same `git describe` invocation by hand against any merge sha.
**Success state:** The closing report shows a `**Release status:**` line quoting one of three fixed forms verbatim; the PR's `release-status` comment carries the same line; `CHANGELOG.md` is never touched by this check.

## Steps

### 1. Ask git — terminal or Step 4.1
- **URL:** `git fetch origin {branch}` then `git describe --tags --contains --first-parent --match 'v*' {merge-sha}` (Step 4.1 runs this exact form after the merge is confirmed)
- **Action:** Resolves purely from tag ancestry — no manifest, no CHANGELOG, no record numbers to pass. Exit 0 with a tag name (strip a trailing `~N`/`^N` ancestry suffix — `git describe` emits one for every ancestor of the tagged commit, not only the exact tagged commit) means a `v*` tag is reachable forward from the merge along first-parent history. A non-zero exit with `fatal: cannot describe '...'` on stderr means no tag is reachable yet — read as `unreleased`, never as an error. Any other failure (a different stderr, or the fetch itself failing) is a genuine degrade.
- **Should feel:** Instant and unambiguous — one git call, no forge call, works identically under `local-merge`.
- **Should understand:** This works on **any** project that tags releases `v*` — no plugin manifest, no CHANGELOG convention required. #2257 replaced the old bump-commit-walk (`bin/release.js status`'s CHANGELOG-comparison logic) with this ancestry check specifically because it generalizes past this repo's own conventions.
- **Red flags:** Treating the "cannot describe" exit as an error rather than "unreleased"; running this against a ref that hasn't been fetched (a stale local view of `origin/{branch}` reports a tag as missing when it already landed).

### 2. Read the human line in the closing report — flow summary / PR
- **URL:** `/claude-tweaks:flow`'s Pipeline Summary (`**Release status:**` line) — or the PR's `release-status` comment (`<!-- run-comment: release-status -->`)
- **Action:** Read the one line: `already carried by {tag}` / `not yet in a release — bump pending` / `release status unavailable — {reason}` / `n/a — not merged in this run (outcome: {armed | pending-review})` (the last only when this run's own PR didn't merge).
- **Should feel:** Like a status light, not a paragraph — the same three or four words every time, so a glance suffices and a grep works.
- **Should understand:** There is no backfill case left to act on — `git describe` answers the whole question from ancestry alone, so `already carried by {tag}` needs nothing further from the maintainer.
- **Red flags:** A paraphrased line (the vocabulary is fixed — the report quotes it verbatim); any mention of a `staged/release-backfill-*.md` file — that mechanism is retired entirely (#2257), not a dual path.

## Origin
- Created during build of #678 (run 2026-08-16T225409-spec-678-680-681-682-683-679)
- Steps 1-3 built in this session
- Rewritten by #2257 (lifecycle wiring): replaced `bin/release.js status`'s bump-commit-walk (CHANGELOG-comparison, manifest-gated) with a plain `git describe --tags --contains` ancestry check (no manifest dependency, no backfill staging — that mechanism retired entirely). Step 3 (applying a backfill) removed — there is nothing left to apply.
- Related specs: #680 (Next Actions release-row premise check — now `_shared/release-recommendation-gate.md`, a separate check reading the preflight pack's `unreleased` field, not this one)
