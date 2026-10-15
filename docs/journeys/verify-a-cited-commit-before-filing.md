---
files:
  - plugin/bin/docs-health.js
  - plugin/bin/lib/docs-health/commit-ref.js
  - plugin/skills/docs-health/judge-procedure.md
---

# Verify a Cited Commit Before Filing a Docs-Health Finding

**Persona:** The `/claude-tweaks:docs-health` judge — usually a scheduled Routine running in a shallow cloud sandbox — and the maintainer who later reads the issue it files.
**Goal:** A filed docs-health finding never asserts a commit hash exists, is reachable, or is missing unless that claim was checked against complete repository history.
**Entry point:** Point 6 of the docs-health JUDGE procedure, whenever a finding's `newString` cites a commit hash or its `oldString` is a commit-hash citation the judge is about to call dangling.
**Success state:** Every hash in the filed `newString` either classified `reachable`, or the text says plainly that the commit does not exist, is unreachable from the integration branch, or could not be verified — and a dangling-citation finding is filed only when `verify-commit` returned `not-found` or `exists-unreachable` for the cited hash.

## Steps

### 1. The judge runs `verify-commit` on every cited hash
- **URL:** N/A (CLI: `node bin/docs-health.js verify-commit <hash>... --root <dir> [--integration-branch <name>] [--remote <name>] [--no-deepen]`)
- **Action:** Before emitting the finding, the judge passes every hash in `newString` — and, for a dangling-citation finding, the hash the doc already cites in `oldString` — to the subcommand. It prints `{"result": {...}}` and exits 0 whatever the outcomes; only a missing hash argument is a usage error (exit 2).
- **Should feel:** Routine — one command beside `check-freshness`, the same `{result}` envelope as its sibling subcommands.
- **Should understand:** The integration branch is `--integration-branch` when given, else the project's `integration-branch` policy key, else the `<remote>/HEAD` symbolic ref; with none resolvable every hash reads `unverifiable`, never a guessed `main`.
- **Red flags:** Running it on only the hashes that "look suspicious" — the instruction covers every hash in the finding's text.

### 2. A shallow clone is deepened first, or no verdict is given
- **URL:** N/A
- **Action:** When `git rev-parse --is-shallow-repository` reads `true`, the helper runs one bounded fetch (`--unshallow --no-tags`, every branch head, 120 s, no terminal prompt) and re-checks. `--no-deepen` skips the fetch.
- **Should feel:** Slow once on a fresh sandbox, then instant — `result.shallow.deepened` reports whether the fetch ran.
- **Should understand:** Every branch head is fetched, not only the integration branch: a clone made with `--depth` is single-branch, and a commit that lives only on another branch would otherwise read `not-found` — the exact mistake #2785's filed text made about `41dc8424f`.
- **Check:** in a `git clone --depth 1` of this repository, `verify-commit 41dc8424f cdb32b046` returns `exists-unreachable` and `reachable` after deepening; with `--no-deepen` both read `unverifiable`.
- **Red flags:** Any `reachable` or `not-found` while `result.shallow.deepened` is false on a shallow clone. A failed fetch (offline, auth, timeout) must show as `unverifiable` with `result.shallow.error` set, never as `not-found`.

### 3. The judge reads each hash's outcome
- **URL:** N/A
- **Action:** Each `result.commits[]` entry carries `outcome`: `reachable`, `exists-unreachable`, `not-found`, `ambiguous` (with a `candidates` array of full hashes), `invalid` (not a hash, or longer than the repository's hash length), or `unverifiable` (with a `reason`).
- **Should feel:** Decisive — the outcome maps straight to what the finding may say.
- **Should understand:** `unverifiable` is "no verdict", not "missing"; `ambiguous` is never silently resolved to one candidate.
- **Red flags:** A filed finding calling a hash "not a resolvable object" when its outcome was `unverifiable` or `exists-unreachable`.

### 4. The finding is filed with honest citation text
- **URL:** N/A (the finding JSON's `newString`, `reason`, `confidence`)
- **Action:** The judge cites a hash as fact only when it is `reachable`. Otherwise it drops the hash or states the outcome in `newString`, and names the outcome in `reason`. A dangling-citation finding whose cited hash came back `unverifiable` is dropped or filed at `confidence: "low"`.
- **Should feel:** Trustworthy for the maintainer — the replacement text in the issue can be applied without re-checking every hash by hand.
- **Should understand:** This is the check #2785's own build had to redo from scratch; it now runs at filing time.
- **Red flags:** A filed issue whose proposed replacement names a reachable commit that never touched the cited files (#2785's `15553cf`) — `verify-commit` proves existence and reachability, not relevance, so this mistake can still get through and the maintainer should spot-check it.

## Origin
- Created during build of #2866 (docs-health: verify proposed replacement text against unshallowed history before filing)
- Related: #2785 (the filed record whose proposed replacement text cited one unreachable and one unrelated commit)
