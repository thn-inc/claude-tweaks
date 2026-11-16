---
files:
  - plugin/bin/code-health.js
  - plugin/skills/code-health/ci-integration.md
---

# Gate a Push on Code-Health State

**Persona:** Developer who wires `node plugin/bin/code-health.js status --fail-on regressed|risk-high` into a pre-push hook or a CI step, following `plugin/skills/code-health/ci-integration.md`.
**Goal:** A gate whose pass means "a sweep ran here and found nothing to block on", never "there was nothing to read".
**Entry point:** `code-health.js status --fail-on regressed` (or `risk-high`), with or without `--root <checkout>`.
**Success state:** The hook passes only on a trustworthy local cache with no matching entry, fails with exit 1 on a real regressed or high-risk finding, and stops with exit 2 and a one-line reason whenever it cannot trust its input.

## Steps

### 1. Read what the gate checks — `ci-integration.md`'s Regression and Risk Gating section
- **Action:** The developer reads the section before adding the hook.
- **Should feel:** Like the limits are stated up front, not discovered in production.
- **Should understand:** The gate reads the local, git-ignored cache at `.claude-tweaks/code-health/cache.json` under `--root` or the current directory. Each checkout and linked worktree has its own cache. It cannot tell a stale cache from a fresh one and is not suited to a fresh CI checkout.
- **Red flags:** Wording that suggests the gate reads GitHub issue state, or that it works on any checkout.

### 2. Run the gate where a sweep ran — `status --fail-on regressed`
- **Action:** The hook runs in the checkout whose sweep wrote the cache.
- **Should feel:** Predictable — the same counts line `status` always printed.
- **Should understand:** Exit 0 with `open:… regressed:… closed:… wontfix:…` when nothing matches; exit 1 with a `FAIL:` line when a regressed (or, for `risk-high`, an open or regressed high-risk) entry exists. An empty `{}` cache is a real sweep result and passes.
- **Red flags:** A changed counts line, or an exit code other than 0 or 1 on a valid cache.

### 3. Run the gate where no sweep ran — a fresh CI checkout or another worktree
- **Action:** The hook runs somewhere the cache file does not exist.
- **Should feel:** Stopped, with the reason in hand — not a silent green.
- **Should understand:** Exit 2, nothing on stdout, and one stderr line: `status: --fail-on cannot evaluate: {path}: no cache file (no sweep has written one under this root)`. From another worktree, pass `--root` naming the checkout the sweep ran in.
- **Red flags:** Exit 0 with all-zero counts — the false pass this gate used to give.

### 4. Hit an untrusted cache — symlink, outside the checkout, or malformed
- **Action:** The cache path is a symlink (dangling, inside, or outside the checkout), a directory, sits behind a symlinked directory that leaves the checkout, is unreadable, or holds invalid JSON, a non-object, or an entry that is not an object.
- **Should feel:** Like the gate refuses to guess.
- **Should understand:** Exit 2 with the same one-line shape, the reason `not a regular file inside the checkout` or `not a readable code-health cache`. Exit 2 is a setup problem to fix, not a finding.
- **Red flags:** A crash with exit 1 (which reads as "gate failed") or a verdict computed from a file outside the checkout.

### 5. Typo or drop the gate's value — `--fail-on Regressed`, or a bare trailing `--fail-on`
- **Action:** The hook passes a value that is not `regressed` or `risk-high`, or ends with `--fail-on` and no value at all.
- **Should feel:** Caught at once.
- **Should understand:** Exit 2 with a usage error naming the accepted values (`status: --fail-on "{value}" is not a recognized value (must be one of regressed|risk-high) …`, with `""` for a missing value) — a different message from the cache refusal.
- **Red flags:** Exit 0 — an unrecognized or missing value silently disabling the gate.

## Origin
- Created during build of record #5529 (flow run `2026-11-15T210059-spec-5528-5529`).
- Steps 1-4 built in this session. Step 5 describes the existing unrecognized-value guard; the run's review added the bare trailing `--fail-on` case, which used to fall through to plain `status` and exit 0.
- Related: `have-a-health-sweep-honor-closed-and-wontfix-issues-5528.md` (record #5528, the other fix from the same audit).
