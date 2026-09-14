---
files:
  - plugin/skills/_shared/pr-first-merge-post-merge.md
  - plugin/skills/_shared/pr-run-comments.md
  - plugin/skills/flow/summary-template.md
  - docs/releasing.md
---

# Learn Which Release Carried a Merge

**Persona:** A maintainer (or the Claude session that just merged a pr-first run) whose PR landed on `main` minutes before — or minutes after — a sibling session's release, and who needs to know whether the work already shipped.
**Goal:** Get a one-line, mechanically-derived answer to "where did this merge land relative to the release history?" — via tag ancestry alone, with no project-specific release tooling and no per-project release-process knowledge required.
**Entry point:** A confirmed pr-first merge (`gh pr view --json mergeCommit`), inside `_shared/pr-first-merge-post-merge.md` Step 4 — or a terminal at the repo root, running the git commands by hand against any merge sha.
**Success state:** The closing report shows a `**Release status:**` line quoting one of the fixed forms verbatim; under pr-first, the PR's `release-status` comment carries the same value. The maintainer knows in one glance whether the merge already shipped, and under which tag.

## Steps

### 1. Ask the commit graph — terminal or Step 4.1
- **URL:** `git fetch origin main && git describe --tags --contains --first-parent <merge-sha>` (Step 4.1 runs the identical command against `{merge-sha}` = `gh pr view --json mergeCommit`'s value, after the fetch)
- **Action:** `--first-parent` restricts the ancestry walk to first-parent history, so the command resolves to at most one tag — the nearest release tag reachable forward from the merge commit — purely from graph ancestry, independent of that commit's own subject text, whether it was produced by a squash or a merge commit, or which release engine cut the tag.
- **Should feel:** Instant and unambiguous — one line, no `gh`, no network beyond the fetch the caller already did, and no per-project configuration to resolve first.
- **Should understand:** A non-zero exit means "no tag yet contains this commit" — read as the literal string `unreleased`, never as an error. A resolved tag name means the merge is already shipped under that version.
- **Red flags:** Treating a non-zero exit as a failure rather than the normal "not yet released" case; resolving without `--first-parent` (a merge commit's non-first-parent ancestry can reach a tag on a branch that never actually shipped this commit to the integration branch's own history).

### 2. Read the human line in the closing report — flow summary / PR
- **URL:** `/claude-tweaks:flow`'s Pipeline Summary (`**Release status:**` line) — or the PR's `release-status` comment (`<!-- run-comment: release-status -->`)
- **Action:** Read the one line: `unreleased` / `v{tag}` / `release status unavailable — {reason}` / `n/a — not merged in this run (outcome: {armed | pending-review})`.
- **Should feel:** Like a status light, not a paragraph — the same words every time, so a glance suffices and a grep works.
- **Should understand:** `unreleased` means the next release will carry this merge automatically — release-please (or `bin/release-local.js` under `local-merge`) derives its own changelog and version from conventional-commit history, so there is nothing to draft or backfill by hand.
- **Red flags:** A paraphrased line (the vocabulary is fixed — the report quotes it verbatim); any reference to a staged backfill file — that mechanism was retired (#2257) once the tag-based engine made CHANGELOG drift structurally impossible on this path.

## Origin
- Created during build of #678 (run 2026-08-16T225409-spec-678-680-681-682-683-679)
- Rewritten for #2257 (release lifecycle wiring) around `git describe --tags --contains --first-parent`, replacing the retired `release.js status` bump-commit-walk description and the CHANGELOG-backfill staging step it drove
- Related specs: #680 (Next Actions release-row premise check); #2256 (`/claude-tweaks:release`, the tag-based engine this ancestry check now assumes)
