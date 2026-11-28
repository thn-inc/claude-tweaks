---
files:
  - plugin/workflows/review-lens-fanout.js
  - plugin/skills/review/step3-workflow-dispatch.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/bin/lib/policy-schema.js
  - plugin/skills/_shared/subagent-output-contract.md
---

# Run Review Lenses Through a Workflow

**Persona:** a plugin maintainer running `/claude-tweaks:review` from a top-level Claude Code session in this repository, who has opted in to `review-lens-dispatch: workflow` to measure whether one workflow script dispatches the lens reviewers more cheaply than fourteen Task calls typed by the session.
**Goal:** Step 3's lens reviewers 3a–3g run from one `claude-tweaks:review-lens-fanout` workflow call, their replies are settled in one `settle-lens-replies` call, and anything that stops the workflow path drops the review back to the Task dispatch with one named `SKIP` line.
**Entry point:** `review-lens-dispatch: workflow` in `.claude-tweaks/policy.yml` (the key defaults to `task`), then `/claude-tweaks:review` at `medium` or above.
**Success state:** `decisions.md`'s `## /review` holds the same pair lines the Task path would have written, every unsettled lens was finished by its `needsSession` reason, and the review continued at the absence check exactly where the Task path continues after pairing — or one `Step 3 lens dispatch (workflow fallback)` `SKIP` line names why it did not.

## Steps

### 1. Opt in — the maintainer
- **URL:** `.claude-tweaks/policy.yml`: `review-lens-dispatch: workflow`; check with `node plugin/bin/resolve-policy.js --values review-lens-dispatch`
- **Action:** set the key. A `dontAsk` or headless session also needs the allow rule `Workflow(claude-tweaks:review-lens-fanout)`; the plugin adds none.
- **Should feel:** a one-line, reversible switch; removing it restores today's dispatch exactly.
- **Should understand:** an invalid value resolves to `task`; a session on an older plugin release ignores the key, and its policy audit names it as unrecognised.
- **Red flags:** the resolver printing anything but `task`, `workflow` or `worker` (the headless-worker path, #6003); a session that never had the allow rule silently "working" because every review fell back.

### 2. Start the workflow — the review session
- **URL:** the `Workflow dispatch (opt-in, #5599)` pointer in `step3-lens-dispatch.md` sends Step 3 to `plugin/skills/review/step3-workflow-dispatch.md` (only when the key resolves `workflow`); one `Workflow` call to `claude-tweaks:review-lens-fanout` with `args: { lenses: [{ lens, brief, model, reviewers }] }`
- **Action:** compose each lens brief exactly as the Task path does (the `SCRATCH:` line makes each reviewer `mktemp -d` its own directory), resolve each lens's model with `resolve-profile.js`, send the Workflow call alone in its message, then start the 30-minute timer and dispatch lens 3h beside it.
- **Should feel:** one call where there used to be fourteen near-identical prompts; both reviewers of a lens provably got one string.
- **Should understand:**
  - The script refuses malformed `args` with `started: false` before any reviewer starts; a reviewer that throws, returns null or blank text comes back `failed: true` without touching the others.
  - `subagent-output-contract.md`'s Workflow-dispatched agents section says how each contract rule is kept: the harness wraps each brief in a frame and indents it, so a brief never relies on column-zero lines; the plugin's `SubagentStop` hook re-prompts a reply with no status line.
- **Red flags:** the session typing the brief twice; a lens missing a `model` reaching an agent; lens 3h sent through the script.

### 3. Settle the replies — the review session
- **URL:** the run file (`workflows/{runId}.json`, three directories above the launch result's `transcriptDir`) passed to `review-coordination.js settle-lens-replies`, `--only confirmed` then `--only unconfirmed`
- **Action:** when the completion notification arrives (stop the timer), settle; finish each `needsSession` lens by its `reason` — `single-reviewer` takes the single-read rule, `reviewer-unusable` re-dispatches only the unusable reviewers through the Task path, once, logging `Step 3 lens dispatch (reviewer re-dispatch)`.
- **Should feel:** the pairing lands without the session transcribing a single reply.
- **Should understand:** a misplaced status line is used and named under `violations` in the review summary; a settle exit 3 (run dir) is never a fallback — re-resolve, re-run once, then run standalone and say the lines went unlogged.
- **Red flags:** a lens in neither `settled` nor `needsSession`; a failed reviewer counted as an empty findings table.

### 4. Fall back when the path cannot finish — the review session
- **URL:** `log-decision.js --text-file` with `Step 3 lens dispatch (workflow fallback): condition: … → fallback: Task lens dispatch. Reversibility: n/a.`
- **Action:** on any of the five conditions — no Workflow tool, refused or failed before a reviewer starts, `started: false` (or any `started` other than `true` on a `completed` run), ended with no result (including the 30-minute timer winning; stop the run first), or the first settle call exiting 2 — dispatch lenses 3a–3g through the Task path and keep 3h.
- **Should feel:** the review still completes; the only trace is one line naming the condition.
- **Should understand:** once the fallback is taken, a result that arrives later is never read; those reviews pay for the reviewers twice, which the parked measurement record counts.
- **Red flags:** a fallback with no `SKIP` line; a review waiting on a run it cannot see; 3h dispatched twice.

## Origin
- Created during the build of #5599 (PR #5819), which added the `review-lens-dispatch` key, `plugin/workflows/review-lens-fanout.js`, `step3-workflow-dispatch.md`, and the Subagent Contract's Workflow-dispatched agents section.
- Step 4 updated during review of #5599: fallback condition 3 also covers a `completed` run whose `started` is missing or anything other than `true`.
- Related journeys: `settle-a-lens-fan-out-in-one-call-5598.md` (the settle verb this path calls), `log-reproduction-lines-through-the-pairing-command-5595.md` (the Task path's per-pair command), `resolve-a-policy-key.md`.
