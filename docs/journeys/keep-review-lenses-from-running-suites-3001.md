---
files:
  - plugin/skills/_shared/subagent-dispatch-core.md
  - plugin/skills/_shared/subagent-output-contract.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/step3-debate-and-refutation.md
  - plugin/skills/review/review-summary-template.md
---

# Keep Review Lenses From Running Suites or Servers

**Persona:** a developer on a Next.js project with a Playwright e2e suite. They run `/claude-tweaks:review` (usually inside `/claude-tweaks:flow`) at `medium` effort or above, so Step 3 fans out reproduction-pair lens agents while `/visual-review` later starts its own ephemeral dev server for the same review.
**Goal:** the review's parallel reviewers only read and report. None of them starts the project's suites, builds, dev servers, or e2e runners. If something is left listening on a local port after the fan-out anyway, the developer is told, and nothing is killed.
**Entry point:** `/claude-tweaks:review #{n}` (or the `review` phase of `/claude-tweaks:flow #{n}`) on a diff that includes test or app code.
**Success state:** the review finishes with no stray `next dev`, mock server, or Playwright runner started by a lens. The review summary's `Fan-out leftovers` section reads `None`, or names each new listener as `{command}:{port}` with a note that ownership is unattributed. `decisions.md` carries a matching `STAGED … new listener(s)` line.

## Steps

### 1. Start a review that fans out lens agents — any session
- **URL:** `/claude-tweaks:review #{n}` at `review-effort` `medium` or above
- **Action:** let Step 3 compose the `review-dispatch` bundle and dispatch its reproduction pairs.
- **Should feel:** quiet on the machine. Lens agents read the diff bundle and source files, and the developer sees no burst of test-runner or dev-server processes and no port collisions with their own running server.
- **Should understand:** every lens, debate, refutation, and gap-sweep prompt carries the verbatim `READ-ONLY REVIEW:` line from `_shared/subagent-dispatch-core.md`'s Read-only Reviewer Discipline section. Running checks is `/claude-tweaks:test`'s job. The one sanctioned run is a single targeted test case, in the foreground, when lens 3f's Vacuity-evidence diagnostic needs execution evidence. A throwaway probe under the agent's `SCRATCH:` path is also fine. When that path lies outside the agent's worktree, the prompt tells the agent to write the probe one plain Bash command per call: `mkdir -p` on its own, then one `printf` redirect or `node -e` call, then `rm` on its own. It never uses a heredoc or an `&&` chain, because the harness guard refuses both by shape (#3519). It also never uses a `;` sequence or a shell variable carried between calls: every call spells out the scratch path as a literal absolute path (#3876).
- **Red flags:** a lens agent's reply mentions "e2e: in-flight" or a backgrounded suite. `friction-events.js` reports `wd-guard-refusal` events from lens probes written as `cat > … <<EOF`, `mkdir -p … && …`, or `S="…/agent-scratch/3a-a" && mkdir -p "$S"`. A finding cites suite failures from the wrong harness (e.g. dev-build auth-gate failures under `next dev`). The rule appears inside the byte-pinned Calibration block.

### 2. Read the post-fan-out sweep's result — the review summary
- **URL:** the review summary's `### Fan-out leftovers` section (full form), or `Fan-out leftovers 0` in the compact form
- **Action:** read what the sweep reported after the fan-out.
- **Should feel:** trustworthy. A clean review says `None` (or `0` in compact form). When something was left listening, each new listener is named by full command name and port, so the developer knows exactly which process to inspect.
- **Should understand:** before dispatch, `build-review-context.js build` snapshots `lsof +c 0 -nP -iTCP -sTCP:LISTEN` into `{ctx-dir}/pre-dispatch-listeners.txt`, next to `pre-dispatch-status.txt` (the reviewer never writes either file). After the fan-out the reviewer re-runs the same command and diffs by command name and port, never PID, with IPv4/IPv6 duplicates collapsed. The check is report-only: it never kills anything. It cannot attribute ownership, because another session may have started the listener, so a listed entry is a lead, not proof a lens misbehaved. A leftover listener also disqualifies the compact summary form, so it can never render `Fan-out leftovers 0` while a listener is reported.
- **Red flags:** `Fan-out leftovers 0` alongside a `STAGED … new listener(s)` line in `decisions.md`. A listener reported only because its PID changed. Any process killed by the review.

### 3. Run a review where `lsof` is unavailable — Windows or a minimal container
- **URL:** `/claude-tweaks:review #{n}` on a machine with no `lsof` on `PATH`
- **Action:** run the review as usual.
- **Should feel:** unaffected. The review completes. Only the leftover-listener check is skipped, and it says so.
- **Should understand:** the snapshot step logs `SKIP {HH:MM:SS} — Review listener snapshot (skipped): lsof unavailable or failed → leftover-listener check not run.` and the post-fan-out check is a no-op, because no snapshot file exists. The untracked-file sweep still runs.
- **Red flags:** the review fails or stalls because `lsof` is missing. No `SKIP` line explaining why listeners went unchecked.

## Origin
- Created during build of #3001. A Fast-profile 3f Test Quality lens agent ran a project's full Playwright e2e suite in the background on the framework's default ports during the fan-out. It raced `/visual-review`'s ephemeral servers and reported wrong-harness failures, and the untracked-file sweep could not see the stray server. The fix added the Read-only Reviewer Discipline to the `review-dispatch` bundle and a report-only leftover-listener check to the post-fan-out sweep.
- Updated during build of #3519. Lens probes on run 2026-10-17T214422-record-3020 followed the old `mkdir -p` + redirect/heredoc scratch recipe and were refused five times. The recipe is now a shell-shape-safe sequence at all four sites that state it.
- Updated during build of #3876. In #3809's review, three lens probes were still refused (`wd-guard-refusal`, 07:12:04-07:12:23Z) because the agents carried the scratch path in a shell variable (`S="…" && mkdir -p "$S" && cat > "$S/probe.js"`). The lens dispatch's Scratch path paragraph now also rules out a `;` sequence and a carried variable, and requires a literal absolute path in every call. The refutation and gap-sweep prompts in `step3-debate-and-refutation.md` carry the same ban, added during that build's review.
- Related journeys: `run-a-deterministic-verification-check.md` (where mechanical verification belongs instead).
