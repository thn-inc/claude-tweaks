---
files:
  - plugin/bin/blast-radius.js
  - plugin/bin/lib/blast-radius-cli.js
  - plugin/bin/lib/issues/blast-radius.js
  - plugin/skills/assess-agent-autonomy/merge-check.md
---

# Gather a Merge Decision's Blast Radius

**Persona:** claude-tweaks skill author (or a maintainer of a project using the plugin) who wants proof that a failed merge-base resolution can never masquerade as a clean, zero-file diff — the exact silent-approval hazard the prose choreography this CLI replaced was one split Bash call away from.
**Goal:** Watch the CLI succeed on a real diff, then watch it fail loud — non-zero exit, a named stderr message, and nothing at all on stdout — for every way merge-base resolution can go wrong, so a caller (`/claude-tweaks:assess-agent-autonomy`'s `merge-check` mode) can trust that a JSON object on stdout always means a real, resolved diff.
**Entry point:** A terminal inside a git worktree that branched from an integration branch (any repo checkout with at least one commit ahead of its base).
**Success state:** One JSON object `{mergeBase, config, summary}` on the happy path, and — across every failure shape — exit code 1, a `blast-radius: <message>` line on stderr naming the specific failure, and an empty stdout.

## Steps

### 1. Resolve the whole gather in one call — the happy path
- **URL:** `node plugin/bin/blast-radius.js --integration-branch main`
- **Action:** Run from inside a worktree with at least one commit ahead of `main` — this is the exact command `plugin/skills/assess-agent-autonomy/merge-check.md`'s Step 1 invokes when a caller (`/claude-tweaks:dispatch`'s Auto-merge gate, or `/claude-tweaks:wrap-up`'s Review Console short-circuit) needs a merge-eligibility verdict.
- **Should feel:** Instant and complete — one JSON line replaces what used to be three separate `git`/`node` commands stitched together by prose.
- **Should understand:** `mergeBase` is the real resolved commit (a 40-char SHA), `config` carries this project's own `merge-sensitive-paths`/`auto-merge-max-lines`/`auto-merge-max-files` (resolved by the CLI itself via the canonical policy read path — the caller never pre-fetches these), and `summary` is `classifyDiffFiles`/`blastRadiusSummary`'s output (`implLines`/`implFiles`/`testLines`/`testFiles`/`pipelineArtifactLines`/`pipelineArtifactFiles`/`sensitiveFilesTouched` — the last two excluding a materialized spec or writing-plans doc from `implLines`/`implFiles`, #1906) — the same classification module `merge-check.md`'s Step 2 judgment weighs, never reimplemented here. Since #1930 one of the two callers named above no longer reaches this CLI on its happy path: `/claude-tweaks:wrap-up`'s Review Console short-circuit invokes `merge-check #{n} --pack {run-dir}/wrap-up-pack.json`, and merge-check's Step 1 then takes the same `{mergeBase, config, summary}` from the fact pack's `blastRadius` field (`bin/wrap-up-pack.js`, which ran this same module) instead of spawning this command — a `blastRadius` carrying `ok: false` is merge-check's existing `could-not-gather` → `needs-human` and never triggers a fresh probe. `/claude-tweaks:dispatch`'s Auto-merge gate passes no `--pack` and still runs the CLI verbatim, as does the wrap-up path whenever the pack file is absent, so every step below is still the live contract.
- **Red flags:** A summary with `implFiles: 0` on a branch that genuinely has changes — that shape must never occur without a matching non-zero exit code somewhere in this session's history explaining why.

### 2. Pass a known merge base directly — `--base`
- **URL:** `node plugin/bin/blast-radius.js --base <sha>`
- **Action:** Run with `--base` pointing at a commit a caller already resolved (e.g. one of `/claude-tweaks:dispatch`'s per-group Task calls, which already knows its own worktree's merge base).
- **Should feel:** A direct pass-through — no integration-branch resolution, no extra git calls beyond verifying the ref.
- **Should understand:** `--base` short-circuits `--integration-branch` resolution entirely; `mergeBase` in the output is the verified, resolved form of exactly what was passed.
- **Red flags:** A nonexistent `--base` ref resolving anything at all.

### 3. Watch resolution failure fail loud, not silent
- **URL:** `node plugin/bin/blast-radius.js --integration-branch no-such-branch`
- **Action:** Run against an integration branch that cannot resolve to a merge base.
- **Should feel:** Unambiguous — the failure is impossible to misread as success.
- **Should understand:** Exit code 1, stderr reads `blast-radius: could not resolve merge base of "no-such-branch" and HEAD: ...`, and **stdout is empty** — never a JSON object, never a zero-file summary. This is the headline property record #888 exists to guarantee: the retired shell choreography's hazard was that a resolution failure could silently read as `git diff ""..HEAD`'s zero-line, exit-0 output, clearing every `auto-merge-max-*` threshold. That collapse is now structurally unreachable — every resolution-failure path throws before the CLI ever writes to stdout.
- **Red flags:** Any stdout output on this path, however small; an exit code of 0.

### 4. A bad `--run` path fails the same way
- **URL:** `node plugin/bin/blast-radius.js --integration-branch main --run /no/such/directory`
- **Action:** Run with `--run` pointing at a path that doesn't exist or isn't a directory.
- **Should feel:** The same fail-loud contract as step 3 — a typo'd run directory is a resolution failure too, not a silent "no run-config overlay."
- **Should understand:** Exit 1, stderr names the bad path directly (`blast-radius: --run dir does not exist or is not a directory: ...`), empty stdout — matching `plugin/bin/resolve-policy.js`'s own `--run` validation convention rather than degrading permissively.
- **Red flags:** A bad `--run` value being silently ignored and the command still succeeding with a JSON summary — that would mean a run's Manifesto-tightened `auto-merge-max-lines` silently never applied.

### 5. A renamed sensitive file still trips the floor
- **URL:** `node plugin/bin/blast-radius.js --integration-branch main` (after renaming a file matched by this project's `merge-sensitive-paths`)
- **Action:** Rename a sensitive-path file (e.g. one matching a configured glob) on the current branch relative to the integration branch, then run the CLI.
- **Should feel:** Nothing special — the rename is just another change the summary correctly attributes.
- **Should understand:** The CLI passes `--no-renames` to `git diff`, so a rename reports as a full delete-plus-add pair (two ordinary paths) rather than collapsing into git's `old => new` composite path — which would match no `merge-sensitive-paths` glob and silently evade the hard floor. `sensitiveFilesTouched` in the output still names the old (sensitive) path.
- **Red flags:** `sensitiveFilesTouched` empty after renaming a file that unambiguously matches a configured sensitive-path glob.

## Origin
- Created during build of #888 (assess-agent-autonomy `merge-check` hardening — replaced merge-check.md's prose-guarded, multi-command shell choreography with this CLI so a resolution failure can never be read as a zero-file blast radius).
- Related specs: #889 (assess-agent-autonomy gather transport-blindness — a sibling hardening pass on the same skill's other modes)
