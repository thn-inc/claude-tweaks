---
files:
  - plugin/bin/release-state.js
  - plugin/bin/lib/release-state/store.js
  - plugin/bin/lib/release-state/marker.js
  - plugin/skills/_shared/release-state.md
  - plugin/bin/lib/issues/claim-store.js
  - tests/bin-lib/release-state/store.test.js
  - tests/bin-lib/release-state/marker.test.js
  - tests/bin-lib/release-state/cli.test.js
  - tests/release-state-contract-conformance.test.js
---

# Move the Reviewed-Through Marker with the release-state CLI

**Persona:** the rolling post-merge review of the release-as-promotion design (#5838): a local `/release` session with `gh`, or a scheduled cloud Routine with no `gh` that reaches GitHub only through MCP tools. Also the maintainer who recovers a marker after a history rewrite.
**Goal:** record how far `main` has been reviewed, in state that outlives any run directory and that both a local session and a cloud sandbox can read and move, with no way for a stale or replayed firing to move it backwards.
**Entry point:** `node plugin/bin/release-state.js marker read`, then `marker advance --to <sha> --run <id>` (`marker init --to <sha>` on a repository that has no marker yet).
**Success state:** `reviewed-through.json` on the `release-state` branch holds `{version: 1, sha, advancedAt, run}` at the newly reviewed commit, `marker read` prints it, and every outcome that is not a move exits with its own documented code (`plugin/skills/_shared/release-state.md`, Exit codes).

## Steps

### 1. Read the marker
- **URL:** `plugin/bin/release-state.js marker read [--repo [host/]owner/name]`; `plugin/bin/lib/release-state/store.js` (`readStateFile`)
- **Action:** The reviewer runs `marker read`. The store fetches the `release-state` tip into a scratch ref and shows the file, falling back to the contents API when git cannot answer.
- **Should feel:** Like reading one small file, with three answers that never blur: the marker object, `{"absent":true}`, or exit 3.
- **Should understand:** `absent` is reported only once a branch read confirms that the branch or the file is missing. An inaccessible repository, an auth, 5xx or rate-limit failure, malformed JSON, a missing or short `sha`, or a `version` other than 1 is unreadable (exit 3), never absent and never a marker.
- **Red flags:** `{"absent":true}` from a run whose `gh` token cannot see the repository, which would let a later `init` plant a second baseline. A malformed marker printed as if it were valid.

### 2. Start the marker on a fresh repository
- **URL:** `plugin/bin/release-state.js marker init --to <sha>`
- **Action:** On a repository with no marker, the reviewer runs `marker init` at a commit on `main`'s first-parent line. The first write creates the `release-state` branch from the default branch tip, then creates the file with run `init`, using create-if-not-exists compare-and-set rather than a prior read.
- **Should feel:** Like a one-time setup that refuses to clobber anything.
- **Should understand:** A marker that already exists makes `init` exit 1. A target off the first-parent line is refused. No write ever names `main`.
- **Red flags:** A `release-state` branch created as an orphan, or a file written to `main`. A second `init` that overwrites an existing marker.

### 3. Advance the marker after a review
- **URL:** `plugin/bin/release-state.js marker advance --to <sha> --run <id> [--branch <name>]`; `plugin/bin/lib/release-state/marker.js` (`advanceMarker`, `descentVerdict`)
- **Action:** After reviewing up to a commit, the reviewer advances the marker to it. The CLI fetches `origin/main` and checks that the target is a first-parent descendant of the current marker, then writes with the file's lease.
- **Should feel:** Forward-only and idempotent. Re-running a finished advance is harmless.
- **Should understand:** Advancing to the marker's own sha is `{"advanced":false,"reason":"same"}` with no write. A target behind the marker, or one merged in through a second parent, is refused (exit 1) and writes nothing. When a concurrent writer wins the compare-and-set, the CLI re-reads: a marker already at or past the target is success (`reason: "at-or-past"`), otherwise it retries once against the fresh marker, and a second loss ends as contested (exit 4). A shallow or stale clone that lacks a needed commit exits 5 (insufficient history), never 1. Without a local clone of the target repository the compare API answers instead.
- **Red flags:** A marker that moves backwards, or a replayed Routine firing that rewrites `advancedAt` for a sha already recorded. A shallow-clone miss reported as refused. A commit message carrying `#`, which the generated issue-tracking workflow would read as a closing keyword.

### 4. Advance from a gh-absent cloud sandbox
- **URL:** `plugin/bin/release-state.js marker advance … --marker-json <path> [--after-conflict]`; `plugin/skills/_shared/release-state.md` (gh-absent (MCP) path)
- **Action:** The **agent** reads `reviewed-through.json` at ref `release-state` with `get_file_contents` and writes `{content, sha}`, `null` or `{failure}` to the session temp file. It runs the CLI with `--marker-json`, and on exit 0 with a `write` descriptor makes the one `create_or_update_file` call that descriptor names, carrying its blob `sha` as the lease. On a rejection or a lost answer it re-reads and re-runs with `--after-conflict`.
- **Should feel:** Like the `gh` path, with the agent fetching and writing and Node deciding.
- **Should understand:** The CLI never reaches MCP itself. A not-found counts as `null` only after a root read on `release-state` (or on the default branch, for a missing branch) succeeds. The descent check still needs a local clone of the same repository, so a sandbox without one exits 5.
- **Red flags:** An agent that writes the marker without the descriptor's `sha`, or that writes again after a second rejection. A `null` file handed to the CLI after a read that failed for a reason other than not-found.

### 5. Recover an orphaned or malformed marker
- **URL:** `plugin/bin/release-state.js marker reset --to <sha> --run <id> [--force (--reason <text> | --reason-file <path>)]`
- **Action:** After a force-push or history rewrite leaves the marker off `main`'s first-parent line, `marker advance` exits 6 (orphaned). The maintainer runs `marker reset` to a commit on the line. A marker that is still on the line, or that is malformed, needs `--force` with `--reason` or `--reason-file`.
- **Should feel:** Guarded. Recovery exists, but never as a quiet way around the forward-only rule.
- **Should understand:** An unforced reset succeeds only for an orphaned marker (basis `orphaned`). A forced reset always records basis `forced` and puts its reason in the `release-state` commit message. A reason is one line of at most 200 characters with no `#`, and the composed message must fit the same budget, else exit 2. A skill writes the reason to a file and passes `--reason-file`, never `--reason "…"`, because double quotes still let a shell expand `$(…)` and backticks; the two flags are mutually exclusive.
- **Red flags:** An unforced reset that succeeds over a marker still on the line. A reset target off the first-parent line that is accepted. A skill-composed reason passed inline as `--reason "…"`.

## Origin
- Created during `/claude-tweaks:build` of record #5883 (2026-11-18), the release-state branch store under the release-as-promotion parent #5838. The merge-pause flag (#5884) is the next file on the same store.
- Updated during the review of #5883: step 5 names `--reason-file`, the file form of a forced reset's reason.
- Related journeys: `stop-the-issue-tracking-workflow-billing-every-push-5152.md` (the generated workflow now skips pushes to `release-state` as well).
