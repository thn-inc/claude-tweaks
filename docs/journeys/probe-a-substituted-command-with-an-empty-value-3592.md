---
files:
  - plugin/skills/build/plan-authoring-checks.md
  - plugin/skills/build/plan-authoring-pairing-checks.md
---

# Probe a Substituted Command with an Empty Value

**Persona:** A `/claude-tweaks:build` session finalizing a plan at Spec Step 3 or Design Step 3, whether a maintainer or an agent, whose plan has an agent substitute a value resolved at runtime (a branch name, a ref, a path, an id) into a command.
**Goal:** Learn what the command does when its resolver returns nothing, before an implementer or a reviewer trusts it, so that a filter that drops on an empty value is caught at authoring time.
**Entry point:** running the plan-authoring checks before a plan is finalized. The guidance is `plan-authoring-checks.md`'s **Empty-value probe check (extends the Derived-value probe check)**, which sits directly after the Derived-value probe check it extends.
**Success state:** For each substituted command, the plan records one run with the resolver's degenerate value, empty or unset, and what that run did. A command that widens on an empty input is guarded or redesigned before dispatch.

## Steps

### 1. Spot a substituted command
- **URL:** the plan task being written, read against `plan-authoring-checks.md`'s Derived-value probe check and the Empty-value probe check after it.
- **Action:** Find every command the plan has an agent run with a value filled in at runtime, such as `gh pr list --head {current-branch}`, `git log {ref}`, or a path or id taken from a resolver.
- **Should feel:** Like a short inventory, one line per placeholder, not a hunt.
- **Should understand:**
  - The Derived-value probe already asks for a run with the value the resolver really returns on this machine. This check adds a second run, with the value the resolver returns in its degenerate case.
- **Red flags:**
  - Probing only real, well-formed values (three branches, five refs) and treating that as full coverage.

### 2. Run it once with the empty value
- **URL:** a shell in the worktree, with the command's read-only form.
- **Action:** Run the command with the placeholder empty or unset, for example `gh pr list --head "" --state merged --json number --jq length`, and write the output and exit code into the plan.
- **Should feel:** Quick, and occasionally alarming. One command shows whether an empty input fails loudly or quietly matches everything.
- **Should understand:**
  - A filter that silently drops on an empty value widens the query instead of failing. Every probe with a real value still passes.
  - #3572's empty `--head` printed `30` with exit 0, so a clean worktree on a detached HEAD read as merged. Only review lens 3c caught it, fixed in 373ae7a00.
- **Red flags:**
  - An empty-value run that returns rows or a non-zero count where the real values returned zero.
  - Skipping the run because "the resolver never returns empty". A detached HEAD, a missing config key, or an unset env var all do.

### 3. Pick up the pairing-loop checks when they apply
- **URL:** `plan-authoring-checks.md`'s **Pairing-loop checks:** pointer, then `plan-authoring-pairing-checks.md`.
- **Action:** When the plan also widens a tolerance inside a greedy pairing loop, or replaces a first-come loop with best-first assignment, follow the pointer and run both of the sub-file's checks.
- **Should feel:** Like an optional detour that only some plans take.
- **Should understand:**
  - The two greedy checks moved out of the main file in #3592 so the main file stays under the Read-limit rail. Every plan reads the main file, and only pairing-loop plans need the sub-file.
- **Red flags:**
  - A pairing-loop plan finalized without opening the sub-file because the checks are no longer inline.

## Origin
- Created during build of #3592, a reflect-light finding from #3572. #3572's plan probed its `gh pr list --head {current-branch}` filter only with non-empty branches. The SDD task review also missed the empty case, and review lens 3c caught it.
- Pinned by `tests/empty-value-probe-check-prose.test.js`, which also pins the pairing-loop pointer and both moved checks.
- Related: `prove-an-absence-grep-can-match-3571.md`, another plan-authoring check that `/claude-tweaks:build` applies before a plan is finalized.
