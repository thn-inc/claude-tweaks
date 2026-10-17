---
files:
  - plugin/skills/visual-review/SKILL.md
  - plugin/skills/review/review-summary-template.md
  - plugin/skills/flow/materialize.md
---

# Get a Visual-Review Recommendation Only for a UI Surface

**Persona:** a developer running `/claude-tweaks:flow` on a CLI-and-agent plugin record. Their journeys list internal modules in `files:` for traceability. Code-mode `/claude-tweaks:review` hands the diff to `/claude-tweaks:visual-review --mode=recommendation` (Step 0.5) to decide whether a browser walk is worth suggesting.
**Goal:** be told to walk a journey in a browser only when the run has something a browser can open. A change to a CLI-only module that a journey happens to list should not produce a "walk this journey" follow-up. A web record's backend change behind a visible page should still produce one.
**Entry point:** the `review` phase of `/claude-tweaks:flow #{n}` (or `/claude-tweaks:review #{n}`) on a record whose diff overlaps a journey's `files:`.
**Success state:** for a `Surface: backend`/`infra`/`terminal` run, the review summary's `### Visual Review` reads `Skipped — no UI changes`, with the reason and the overlapping journeys named, and there is no `Recommended follow-up` line. For a `Surface: web` run, the summary shows the same recommendation table and follow-up line as before.

## Steps

### 1. Review an infra record whose diff touches a journey's files — the review summary
- **URL:** the review summary's `### Visual Review` section for a record whose materialized header reads `surface: infra`
- **Action:** read what Step 6's recommendation-mode hand-off returned.
- **Should feel:** precise, not noisy. Nothing suggests opening a browser for a journey whose entry point is a CLI invocation, yet the developer can still see which journeys the change touched.
- **Should understand:** a journey whose `files:` overlap the diff is only *affected* when the run carries a frontend-surface signal. Step 0.5 reads `surface:` from the run's materialized header: `work/{n}-spec.md` in the checkout under review, the worktree's copy, which is not under `$RUN_ROOT`. A declared `backend`, `infra`, or `terminal` is no signal, and the file sniff does not run. The suppressed line names the reason (`Surface: infra`) and the overlapping journeys, and the summary records it as `Skipped — no UI changes`.
- **Red flags:** a `> Recommended follow-up: /claude-tweaks:visual-review journey:` line on an infra record. The status reads `Skipped — no UI changes` with no journey names, so the overlap silently disappears.

### 2. Review a web record whose backend change overlaps a journey — the review summary
- **URL:** the same section for a record whose header reads `surface: web` and whose diff touches only an API/service file that a journey's `files:` lists
- **Action:** read the recommendation.
- **Should feel:** unchanged from before. The page that depends on the changed API still gets a walk recommended.
- **Should understand:** a declared `web`, `mobile`, or `desktop` surface is enough on its own. Unlike the design wrapper's precedence, the Layer 3 trigger-file sniff need not also match, because a web record's backend change can still break a page. The recommendation table and follow-up line render as before.
- **Red flags:** a web record's recommendation suppressed because the changed file is `.ts` outside a UI path.

### 3. Run a standalone review, or review a record with no `Surface:` — the review summary
- **URL:** `/claude-tweaks:review` with no pipeline run directory, or a record filed before `/specify` wrote `Surface:`
- **Action:** read the recommendation for a diff that does, then does not, include a UI trigger file (for example a `.tsx` component).
- **Should feel:** predictable. With no declared surface, the decision follows the changed files themselves.
- **Should understand:** when no materialized header resolves, or it carries no `surface:`, Step 0.5 falls back to `design-wrapper/frontend-detection.md`'s Layer 3 sniff over the changed files. A UI trigger file means the overlap counts; none means the suppressed line. The design-integration flag (Layer 1) plays no part: a project without Impeccable configured still gets recommendations. `flow/materialize.md`'s header reader table lists Step 0.5 as a `surface` reader.
- **Red flags:** every recommendation suppressed on a project with design integration disabled. A legacy backend-only diff in a web app suppressed with nothing in the summary naming the affected journeys.

## Origin
- Created during build of #2927. On #2769's review, `plugin/bin/lib/gif/palette.js`, a CLI and agent-only module listed in `walkthrough-gif-capture-2758.md`'s `files:`, produced a browser-walk recommendation for a journey with no page to open. Step 0.5 now gates "affected" on the run's surface. The review summary gained a bullet so the suppressed journeys still reach a human, because for a legacy no-`Surface:` consumer record that bullet is the main visible signal.
- Related journeys: `keep-review-lenses-from-running-suites-3001.md` (the same review run's fan-out).
