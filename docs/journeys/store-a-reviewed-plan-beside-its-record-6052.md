---
files:
  - plugin/bin/plan-store.js
  - plugin/bin/lib/plan-store/ref.js
  - plugin/bin/lib/plan-store/git.js
  - plugin/bin/lib/plan-store/store.js
  - plugin/bin/lib/plan-store/check.js
  - plugin/bin/lib/issues/plan-line.js
  - plugin/skills/_shared/work-record.md
---

# Store a Reviewed Plan Beside Its Record and Ask Whether It Is Still Valid

**Persona:** A claude-tweaks pipeline maintainer wiring plan-at-specify. They are writing the specify step that saves a reviewed plan, or the build step that wants to reuse one instead of re-planning, and they drive `node plugin/bin/plan-store.js` by hand (or from that code) to see what it guarantees.
**Goal:** Keep a 17-91 KB reviewed plan somewhere that outlives the specify session. It must not go in the issue body (the 65,536-character limit) or on a branch or PR (queue-pull's open-PR exclusion). A later build must be able to get a yes/no on whether the plan still fits the spec and the code it would land on.
**Entry point:** A record with a materialized spec file, a plan file named `YYYY-MM-DD-{feature}-{n}.md`, and the base commit the plan was written against.
**Success state:** The record carries one `Plan: refs/claude-tweaks/plans/{n} {plan-commit-sha} spec-sha256:{hash}` line. `check` on that line prints `{"valid":true,"failed":null}` until the spec's covered sections, the ref or the files the plan names change, and after that names the first check that failed.

## Steps

### 1. Write the plan to its ref — terminal
- **URL:** `node plugin/bin/plan-store.js write --record {n} --plan-file {path} --base {sha} --spec-file {spec}`
- **Action:** Run `write` from the repository (or pass paths relative to the working directory).
- **Should feel:** One command and one JSON line back: `{ref, commit, specHash, line}`, with `line` ready to paste into the record body. Nothing in the checkout moves.
- **Should understand:**
  - The plan becomes one commit whose parent is `--base` and whose only change adds `docs/superpowers/plans/{basename}`. It is pushed to `origin` with a lease on the sha `ls-remote` saw, and the local ref moves only after the push succeeds.
  - Writing again for the same record replaces the ref. Two racing writers lose cleanly: the loser exits 3 and prints no line.
  - Under `work-backend: local-files` nothing is pushed. The line is still printed, and another clone reading it gets `failed: ref`, by design.
  - If the push succeeded but the local ref could not be updated, the remote is the store: exit 0, the line, and a stderr warning naming why (decided at plan review).
- **Red flags:**
  - Exit 0 with no `line`.
  - A `Plan:` line printed after a failed push.
  - A plan commit that changes more than the one plan file.
  - The command succeeding when the base already holds the identical plan file. It must refuse with exit 1, because such a plan can never be read back.

### 2. Handle a refusal — terminal
- **URL:** the same command's exit code and stderr
- **Action:** Branch on the exit code. 3 (`EXIT_NO_REF`) means write no `Plan:` line and fall back to planning at build time. 1 means the inputs do not hold: an unreadable plan or spec, a spec with no `## Overview`, an unresolvable base, an unsafe basename, or a plan the base already holds. 2 means the call itself was malformed.
- **Should feel:** Unambiguous. Every code means one thing, USAGE names all four, and stderr says why in a single `plan-store.js:` line.
- **Should understand:** A cloud sandbox whose git transport refuses a non-branch ref lands on exit 3, the same tested path as a rejected push. The caller loses only the stored plan, never the build.
- **Red flags:** A stack trace instead of an exit code (including when the working directory has been deleted); exit 3 for a malformed call; a refused write that left a ref behind on origin.

### 3. Read the plan back in another clone — terminal
- **URL:** `node plugin/bin/plan-store.js read --record {n} --commit {sha} --out {dir}`
- **Action:** Run `read` with the commit from the `Plan:` line.
- **Should feel:** Byte-for-byte: `{dir}/{basename}` holds exactly what was written, CRLF and non-ASCII included, and stdout prints `{path}`.
- **Should understand:** `read` fetches with a forced one-record refspec, so a plan replaced since the last fetch is seen, and it refuses a ref that names any other commit. The basename is checked by the same rule `write` uses, so a crafted plan commit cannot write outside `--out`.
- **Red flags:** A stale local plan returned after a re-specify; a file written outside `--out`; exit 0 for a commit that is not a one-file plan commit.

### 4. Ask whether the plan is still valid — terminal
- **URL:** `node plugin/bin/plan-store.js check --line '{Plan: line}' --spec-file {spec} --base {sha} [--repo-root {dir}]`
- **Action:** Run `check` with the record's current spec and the commit the build would start from. A caller holding the line from a record body passes `--line-file {file}` instead, so the line never reaches a command line.
- **Should feel:** Like a yes/no with a reason. Exit 0 with `{"valid":true,"failed":null}`, or exit 1 with `failed` naming the first failing check in order: `ref`, `hash`, `base`, `files`.
- **Should understand:**
  - The spec hash covers the `##` sections from `## Overview` through `## Planning Decisions`. Editing `Risk-flags:`, `**Related:**`, `Blocked by` or the fingerprint lines does not invalidate the plan; editing a covered section does.
  - `files` fails when the base changed any Modify or Test path the plan names since the plan commit's parent, and also when the plan names none.
  - Anything `check` cannot determine reads `valid: false`, never valid. A malformed `--line` exits 2 and still prints a `valid: false` verdict.
- **Red flags:** `valid: true` after a covered section changed; `valid: true` for a plan that names no files; a verdict object with keys other than `valid` and `failed`; `--line` and `--line-file` both accepted in one call, or neither, or an unreadable `--line-file` exiting anything but 2.

## Origin

Built for record #6052 (the plan store). The specify writer and the build reader that call it are later records; #6055 deletes refs of closed records and imports `PLAN_REF_PREFIX` and `parsePlanRefName` from `plan-store.js`.

Step 4 updated for #6056 (the specify writer, `plan-a-record-while-shaping-it-6056.md`): `check` takes `--line-file` as the exclusive alternative to `--line`, so a `Plan:` line copied from an editable record body never reaches a command line.
