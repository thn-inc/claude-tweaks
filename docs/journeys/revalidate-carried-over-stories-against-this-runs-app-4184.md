---
files:
  - plugin/skills/stories/refine.md
  - plugin/skills/test/qa-prompts.md
---

# Revalidate Carried-Over Stories Against This Run's App

**Persona:** a developer re-running `/claude-tweaks:stories` in update mode from a fresh linked worktree, against a dev server that came up on a new port, over a stories directory whose YAML was written in an earlier run and pins an absolute `url:` such as `http://127.0.0.1:9999/dashboard`.
**Goal:** refinement validates every sampled story against the app this run actually started, so a stale recorded origin never makes a healthy story fail validation or get tagged `needs-review`.
**Entry point:** `plugin/skills/stories/refine.md`, step 5a item 2, which runs for every story in the validation sample, including carried-over `needs-review` healing candidates.
**Success state:** each sampled story's `playwright-cli` session opens on this run's `APP_URL` origin with the story's own path, query and fragment kept. A story that only failed before because of its pinned port now validates, and 5c's tag self-heal clears its `needs-review` tag.

## Steps

### 1. Refine resolves each sampled story's URL before opening it
- **URL:** `plugin/skills/stories/refine.md`, step 5a item 2 (lead-in)
- **Action:** For each selected story, refine computes `resolved_url` by applying **Resolve each story's dispatch URL against `APP_URL`** from `plugin/skills/test/qa-prompts.md`. `APP_URL` is this `/stories` run's resolved URL: its `URL` input, else `_shared/dev-url-detection.md`'s auto-detected value. With `url: http://127.0.0.1:9999/dashboard` and `APP_URL=http://localhost:54321`, `resolved_url` is `http://localhost:54321/dashboard`.
- **Should feel:** Invisible. The developer never hand-edits ports into old stories before re-running update mode.
- **Should understand:** The rewrite rules (root-relative join, differing-origin replace, matching-origin unchanged) live in `qa-prompts.md` and are only cited by refine, so `/stories` refine and `/test qa` cannot drift apart on what URL a story targets.
- **Red flags:** A `playwright-cli open` on the pinned `9999` port; refine prose that restates the rewrite rules instead of citing the step by name.

### 2. Validation opens, re-navigates and re-opens on `resolved_url`
- **URL:** `plugin/skills/stories/refine.md`, step 5a sub-steps a–b and step 5b item 5 sub-step b
- **Action:** Refine runs `playwright-cli -s=<story-id> open <resolved_url>`. For a story with `auth: { vault: ... }` it runs `state-load` and then `goto <resolved_url>`. If a story still fails, the self-correction round re-opens its `resolved_url` in a fresh session to snapshot the live tree.
- **Should feel:** Trustworthy. A failure recorded here reflects the page under test, not a dead port.
- **Should understand:** `navigate` steps inside the story are not rewritten by refine; only `story.url` is. `/test qa` rewrites both.
- **Red flags:** A `locator_unresolved` failure on every step of a story whose page loads fine at the new port; a `needs-review` tag added to a story that only had a stale origin.

## Origin
- Created during build of #4184 (refine 5a/5b open `resolved_url`, citing `qa-prompts.md`'s rewrite; pinned by `tests/stories-refine-resolved-url.test.js`).
- Related: #2283 (introduced `resolved_url` for `/test qa` dispatch), #3005 (extended the rewrite to `navigate` steps in `/test qa`).
