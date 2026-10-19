---
files:
  - plugin/bin/lib/issues/recent-commit-check.js
  - plugin/skills/capture/SKILL.md
---

# Catch a Capture That Duplicates an Open PR

**Persona:** A developer (or an agent mid-review) who runs `/claude-tweaks:capture` to file a bug they just noticed, unaware that another session already has a fix for the same defect open as a pull request.
**Goal:** The new record is flagged as overlapping the in-flight PR the moment it is filed, so a human closes it as a duplicate instead of it being shaped, dispatched, and built a second time.
**Entry point:** `/claude-tweaks:capture "{idea}"` on a project with `work-backend: github-issues` and a working `gh`.
**Success state:** The record is filed exactly as before, and carries one extra triage comment naming the overlapping open PR(s) — `#{number} {title}`, up to five — marked as a heuristic screen, not a verdict.

## Steps

### 1. Capture screens open PRs before filing
- **URL:** N/A (skill step: capture's Backend Selection, `github-issues` branch)
- **Action:** After composing the payload and body, capture first deletes any match file an earlier capture in the session left behind, then runs one `gh pr list --state open --json number,title,url --limit 200` into a session temp file, then a `node -e` call that reads the new record's title from the payload file and calls `findOpenPrOverlap`. The result (matches or `null`) is held in a temp file.
- **Should feel:** Invisible — one extra list call, no prompt, no delay the developer notices.
- **Should understand:** A PR matches when its title shares at least two key terms with the record's title (the same `deriveKeyTerms` and threshold the recent-commit screen uses); the title is never inlined into a shell command, so an apostrophe can't break it.
- **Red flags:** Any failure here — `gh` error, non-JSON output, a thrown function — must leave filing byte-identical to before: no comment, no error reported as a filing failure.

### 2. The record is filed unchanged
- **URL:** N/A
- **Action:** `gh issue create` runs exactly as it always has (native-type or labels branch). The open-PR result never blocks, delays, or converts the filing into an absorb.
- **Should feel:** Identical to a capture with no overlap.
- **Should understand:** Absorb is still decided only by capture's own routing; an open-PR match is a triage note, not a routing input.
- **Red flags:** A filing that was held back or turned into an absorb because of an open-PR match.

### 3. A triage comment names the overlapping PR
- **URL:** N/A (GitHub issue comment on the new record)
- **Action:** After the existing recent-commit overlap comment (if any), capture posts one separate comment when the held result is non-null, listing up to five PRs as `#{number} {title}` and saying it is a heuristic screen from the open-PR overlap check. A retry or replay of an already-screened payload does not post it again.
- **Should feel:** A quiet, specific nudge — "this might already be in flight at #3172" — that makes closing a duplicate a one-click decision.
- **Should understand:** It is a heuristic: a PR whose title restates an issue title matches on the same terms by design; an unrelated PR sharing one word does not.
- **Red flags:** Two open-PR comments on one record; a comment naming a PR that shares only one key term; a comment carrying an earlier capture's matches from the same session (the match file is cleared before every screen, so a screen that cannot run leaves no result to post).

## Origin
- Created during build of #3191 (open-PR overlap screen in `/claude-tweaks:capture`)
- Motivating incident: #3178, #3185 and #3189 duplicated #3155 while its fix was open as PR #3172
