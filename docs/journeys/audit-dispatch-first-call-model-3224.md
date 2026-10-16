---
files:
  - plugin/skills/dispatch/task-prompt.md
  - plugin/bin/lib/model-profiles/profiles.js
  - plugin/bin/log-decision.js
  - tests/dispatch-model-profile-conformance.test.js
---

# Audit Which Model a Dispatch Firing's First Call Ran On

**Persona:** A claude-tweaks maintainer reviewing a `/claude-tweaks:dispatch` firing the morning after, who found a stranded build (claim live, draft PR open, no `config.yml`) and wants to know whether that group's `build,test` call ran on the model the template asks for, or was clamped down.
**Goal:** Read, for one dispatched group, the model its first Task call resolved to and why, without opening any session transcript.
**Entry point:** The group's run directory, `.claude-tweaks/pipelines/{run-id}/` in the main checkout.
**Success state:** One `decisions.md` line names the first call's model and the resolver's `source`, and the maintainer can tell an expected clamp from an unexpected downgrade at a glance.

## Steps

### 1. Confirm what the template asks for — `plugin/skills/dispatch/task-prompt.md`
- **URL:** `plugin/skills/dispatch/task-prompt.md`, section `## First call — build,test`, the line beginning `[Use: Capable]`
- **Action:** Read the first-call template's model line and the `model-ceiling` clamp paragraph directly after its fence.
- **Should feel:** Settled — one line states the profile and the issue (#3212) that chose it, with no need to dig through history.
- **Should understand:** The first call asks for Capable (Opus by default); the second call (`review,polish,wrap-up`) still asks for Standard. A project with `model-ceiling: standard` gets Sonnet for the first call by design.
- **Red flags:** The first-call line reads `[Use: Standard]` again (the conformance suite `tests/dispatch-model-profile-conformance.test.js` should have failed on that); the clamp paragraph missing, leaving a Sonnet first call unexplained.

### 2. Read the group's first-call model line — `{run-dir}/decisions.md`
- **URL:** `.claude-tweaks/pipelines/{run-id}/decisions.md`
- **Action:** Find the line `- AUTO {time} — Dispatch group [{issues}]: first-call model resolved to {model} (source: {source}). Reversibility: n/a.`
- **Should feel:** Like reading a receipt: one line per group, written after the first call returned, with the cause attached.
- **Should understand:** `source: default` or `source: policy` means the Capable row resolved as configured; `source: ceiling` means the project's `model-ceiling` clamped it (`profiles.js`'s `resolve()`); `degraded:session-failure` means an earlier failure this session blacklisted the model.
- **Red flags:** No such line for a group whose first call ran (the dispatching session skipped the log step); the line appearing *above* the first call's own `/flow` entries in the file, which means it was written before the dispatch and could have pushed `/flow`'s run-directory adoption into recovery (case 3).

### 3. Reproduce the resolution locally — terminal
- **URL:** `node plugin/bin/resolve-profile.js capable`
- **Action:** Run it from the checkout root and compare `model`/`source` with the logged line.
- **Should feel:** Confirming, not investigative — the same inputs give the same answer.
- **Should understand:** A mismatch means the policy changed since the firing, or the session had a recorded model failure; the logged line is the record of what actually ran.
- **Red flags:** The local resolution and the logged line disagree with no policy change in between.

## Origin
- Created during build of record #3224 (dispatch first call on the Capable profile)
- Steps 1-3 built in this session
- Related specs: #3212 (parent decomposition), #2912 (first-call bypass evidence)
