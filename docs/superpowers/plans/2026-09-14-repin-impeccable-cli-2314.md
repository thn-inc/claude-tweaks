# Re-pin impeccable-cli to 4.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-pin the Impeccable CLI dependency in `tools/upstream-drift/manifest.yml` and `plugin/skills/design-wrapper/impeccable-cli.md` from the stale `3.6.0` to the actually-installed `4.1.0`, retiring the two manifest assertions whose cited source file no longer exists at that version.

**Architecture:** The Impeccable CLI's engine was rewritten from JS to Rust between `cli-v3.6.0` and `cli-v4.0.0` (confirmed live against `pbakaus/impeccable` — the npm package `impeccable@4.1.0` now ships only a thin shim, `cli/bin/cli.js`, that locates or downloads a compiled per-platform binary; the old `cli/engine/cli/main.mjs`/`cli/engine/registry/antipatterns.mjs` source no longer ships in the installed root at all, confirmed via `gh api "repos/pbakaus/impeccable/contents/cli?ref=cli-v4.1.0"` returning only `bin`/`platform-packages`). `tools/upstream-drift/checks.js`'s `checkAssertions` can only ever read text under the manifest's resolved *installed root* — it never fetches upstream GitHub content — so an assertion citing a file the installed package no longer ships is permanently unresolvable, not merely stale. The fix bumps the pin, narrows `contract-paths` to the one file the installed package still ships (`cli/bin/cli.js` — present in both the installed root and the upstream repo, preserving a valid contract-root mapping for future capability diffs), and empties `assertions` (schema-valid: `requireList` only requires the key be an array, not non-empty — `impeccable-plugin`'s own `fixtures: []` is the existing precedent for an intentionally-empty list) with an explanatory comment, since the same two behavioral claims ("findings JSON goes to stdout, not stderr"; "a clean scan prints `[]` on stdout") remain independently verified end-to-end by this entry's own `fixtures:` (unchanged) and by `tests/impeccable-cli-contract.test.js`'s own live `detect` calls (also unchanged) — both already assert the identical behavior by executing the real installed binary, which is strictly stronger evidence than a static grep ever was.

**Tech Stack:** YAML (`tools/upstream-drift/manifest.yml`), Markdown (`plugin/skills/design-wrapper/impeccable-cli.md`, `.claude/skills/upstream-drift/judge-procedure.md`), `node --test`.

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-2314/.claude-tweaks/pipelines/2026-09-14T194541-record-2314/work/2314-spec.md`

## Global Constraints

- Maintainer-only tooling — `tools/upstream-drift/` and `.claude/skills/upstream-drift/` never ship as plugin payload (CLAUDE.md: "the plugin payload is the `plugin/` subtree — nothing else in this repo ships").
- Never edit `tools/upstream-drift/manifest.yml` to silence a check as an audit side effect — this plan's edit is the deliberate, human-authorized re-pin the record itself asks for, not an audit run doing it unilaterally.
- `assertions: []` is schema-valid (`tools/upstream-drift/manifest.js`'s `requireList` requires the key be present and be an array, not non-empty) and evaluates `status: 'ok'` in `checkAssertions` (`Array.prototype.every` on `[]` is vacuously true).
- `node --test tests/impeccable-cli-contract.test.js` reads `PINNED` from the manifest directly (`ENTRY.pinned`) — never a second hardcoded literal (that duplication was #1900's own root cause) — so this plan never touches the test file itself.

### Key Files

- `tools/upstream-drift/manifest.yml` (Modify) — the `impeccable-cli` entry's `pinned`, `contract-paths`, `assertions`.
- `plugin/skills/design-wrapper/impeccable-cli.md` (Modify) — line 3's `<!-- upstream-pin: -->` comment.
- `.claude/skills/upstream-drift/judge-procedure.md` (Modify) — the worked-example mapping table citing the retired contract path.

---

### Task 1: Re-pin `impeccable-cli` in `tools/upstream-drift/manifest.yml`

**Files:**
- Modify: `tools/upstream-drift/manifest.yml:24,37-48` (the `impeccable-cli` entry's `pinned`, `contract-paths`, `assertions` — line numbers per this plan's authoring; re-locate by the `name: impeccable-cli` anchor if the file has since shifted)

**Interfaces:**
- Consumes: nothing from an earlier task (first task).
- Produces: the manifest entry every later task's verification reads (`tools/upstream-drift/checks.js`'s `checkVersion`/`checkAssertions`, and `tests/impeccable-cli-contract.test.js`'s `ENTRY.pinned`).

- [ ] **Step 1: Confirm current content matches what this task expects to change**

```bash
node -e "
const {loadManifest} = require('./tools/upstream-drift/manifest.js');
const m = loadManifest('./tools/upstream-drift/manifest.yml');
const e = m.dependencies.find(d => d.name === 'impeccable-cli');
console.log(JSON.stringify({pinned: e.pinned, contractPaths: e['contract-paths'], assertionCount: e.assertions.length}, null, 2));
"
```

Expected output (this is a read-only confirmation, not a red/green test — the manifest has no "test" of its own beyond schema validation, which the loader above already performs by not throwing):

```json
{
  "pinned": "3.6.0",
  "contractPaths": [
    "cli/engine/cli/main.mjs",
    "cli/engine/registry/antipatterns.mjs"
  ],
  "assertionCount": 2
}
```

If this doesn't match, stop and re-read the current file before editing — someone else may have already touched this entry.

- [ ] **Step 2: Edit the entry**

Current text (the full `impeccable-cli` entry's `pinned` line, `contract-paths` list, and `assertions` list):

```yaml
    pinned: "3.6.0"
    # This is a shared dev host: other sessions running bare `npx impeccable`
    # (no --no-install, no version pin) periodically refresh npm's local npx
    # cache to whatever is then "latest" on the registry, and `npx --no-install`
    # here resolves against that cache non-deterministically — this drifted
    # exact-pin twice (#1900, then #2277) with no behavioral change between
    # 3.6.0 and 4.1.0 either time. `floor` accepts any installed version >= the
    # pin instead of requiring an exact match; a real behavioral break is still
    # caught by this dependency's own fixtures below, which run regardless.
    version-mode: floor
    upstream:
      repo: "pbakaus/impeccable"
      tag-prefix: "cli-v"
    contract-paths:
      - "cli/engine/cli/main.mjs"
      - "cli/engine/registry/antipatterns.mjs"
    assertions:
      - file: "plugin/skills/design-wrapper/impeccable-cli.md"
        claims: "findings JSON is written to stdout, not stderr"
        upstream-path: "cli/engine/cli/main.mjs"
        must-match: "process.stdout.write(formatFindings"
      - file: "plugin/skills/design-wrapper/impeccable-cli.md"
        claims: "a clean scan prints an empty JSON array rather than nothing"
        upstream-path: "cli/engine/cli/main.mjs"
        must-match: "process.stdout.write('[]"
```

Replace with:

```yaml
    pinned: "4.1.0"
    # This is a shared dev host: other sessions running bare `npx impeccable`
    # (no --no-install, no version pin) periodically refresh npm's local npx
    # cache to whatever is then "latest" on the registry, and `npx --no-install`
    # here resolves against that cache non-deterministically — this drifted
    # exact-pin twice (#1900, then #2277) with no behavioral change between
    # 3.6.0 and 4.1.0 either time. `floor` accepts any installed version >= the
    # pin instead of requiring an exact match; a real behavioral break is still
    # caught by this dependency's own fixtures below, which run regardless.
    version-mode: floor
    upstream:
      repo: "pbakaus/impeccable"
      tag-prefix: "cli-v"
    # Between cli-v3.6.0 and cli-v4.0.0 the engine was rewritten from JS to
    # Rust (`crates/` in the upstream repo) and is now distributed as a
    # compiled, per-platform binary the npm shim downloads/execs — the npm
    # package itself ships only `cli/bin/` + LICENSE (its own `files` field).
    # `cli/engine/cli/main.mjs` and `cli/engine/registry/antipatterns.mjs`
    # (#2314) no longer exist anywhere under the installed root, so the only
    # file left that this contract can meaningfully name — one the installed
    # package actually ships, with a real counterpart in the upstream tree —
    # is the shim itself.
    contract-paths:
      - "cli/bin/cli.js"
    # The two claims below ("findings JSON on stdout, not stderr"; "a clean
    # scan prints [] on stdout") are still true at 4.1.0 — traced live against
    # crates/detect/src/cli.rs at cli-v4.1.0 (`ctx.io.out(&format!("{text}\n"))`
    # under `if json_mode`; `ctx.io.out("[]\n")` for a clean scan) — but that
    # Rust source is never installed locally; the shipped artifact is a
    # compiled binary with no local text left to grep. `checkAssertions` only
    # ever reads files under the installed root, so no upstream-path will ever
    # resolve for this engine again — these assertions are retired, not
    # relocated (#2314). Both claims stay independently verified end-to-end by
    # the fixtures immediately below (a real `detect` run against a real
    # binary is stronger evidence than a static grep ever was) and by
    # tests/impeccable-cli-contract.test.js's own live `detect` calls.
    assertions: []
```

- [ ] **Step 3: Verify the edit loads and validates**

```bash
node -e "
const {loadManifest} = require('./tools/upstream-drift/manifest.js');
const m = loadManifest('./tools/upstream-drift/manifest.yml');
const e = m.dependencies.find(d => d.name === 'impeccable-cli');
console.log(JSON.stringify({pinned: e.pinned, contractPaths: e['contract-paths'], assertionCount: e.assertions.length}, null, 2));
"
```

Expected: no thrown error (schema-valid), and:

```json
{
  "pinned": "4.1.0",
  "contractPaths": [
    "cli/bin/cli.js"
  ],
  "assertionCount": 0
}
```

- [ ] **Step 4: Verify the deterministic checks now report `ok`**

```bash
node tools/upstream-drift/run.js findings --dep impeccable-cli
```

Expected: `[]` (empty findings array — no drift). Before this task's edit, this same command reported two `assertion-missing-file` findings (confirmed during planning) — this step's expected output is the red→green flip for this task.

- [ ] **Step 5: Commit**

```bash
git add tools/upstream-drift/manifest.yml
git commit -m "$(cat <<'EOF'
Re-pin impeccable-cli to 4.1.0; retire two now-unresolvable assertions

The engine moved from inline JS to a compiled Rust binary between
cli-v3.6.0 and cli-v4.0.0 — cli/engine/cli/main.mjs no longer exists
under the installed root, so the two assertions citing it can never
resolve again. Both claims stay verified by this entry's own fixtures.

refs #2314
EOF
)"
```

---

### Task 2: Move the doc's pin comment to `@4.1.0`

**Files:**
- Modify: `plugin/skills/design-wrapper/impeccable-cli.md:3`

**Interfaces:**
- Consumes: Task 1's manifest `pinned: "4.1.0"` — `tests/impeccable-cli-contract.test.js`'s first test asserts this file's pin comment equals `ENTRY.pinned` from the manifest, so this task's edit must match Task 1's value exactly.
- Produces: nothing a later task in this plan consumes.

- [ ] **Step 1: Run the failing test first**

```bash
node --test tests/impeccable-cli-contract.test.js
```

Expected: FAIL — the first test ("impeccable-cli.md pins the same version the drift manifest does") fails with a message naming `impeccable-cli.md pins 3.6.0 but tools/upstream-drift/manifest.yml pins 4.1.0` (Task 1 already moved the manifest side; this file hasn't moved yet).

- [ ] **Step 2: Edit the pin comment**

Current text (`plugin/skills/design-wrapper/impeccable-cli.md:3`):

```
<!-- upstream-pin: impeccable-cli@3.6.0 -->
```

Replace with:

```
<!-- upstream-pin: impeccable-cli@4.1.0 -->
```

- [ ] **Step 3: Run the test again to verify it passes**

```bash
node --test tests/impeccable-cli-contract.test.js
```

Expected: PASS — all 6 tests pass, none skipped (an "absent" skip only fires when `checkVersion` finds nothing installed at all; this host has 4.1.0 resolvable via `npx --no-install impeccable --version`, confirmed during planning).

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/design-wrapper/impeccable-cli.md
git commit -m "$(cat <<'EOF'
impeccable-cli.md: move pin comment to @4.1.0

Keeps the doc's pin comment and manifest.yml's pinned value agreeing,
per this file's own warning against two independent pins drifting.

refs #2314
EOF
)"
```

---

### Task 3: Fix the now-stale worked example in `judge-procedure.md`

**Files:**
- Modify: `.claude/skills/upstream-drift/judge-procedure.md` (the "Map the contract root" worked-example table, currently naming `impeccable-cli`'s contract path as `cli/engine/cli/main.mjs`)

**Interfaces:**
- Consumes: Task 1's new `contract-paths: ["cli/bin/cli.js"]` — this task's edit must cite the same path.
- Produces: nothing a later task consumes (this file is prose read by a human/agent running a future JUDGE, not read by any test in this repo).

- [ ] **Step 1: Locate the current table row**

```bash
grep -n "impeccable-cli" .claude/skills/upstream-drift/judge-procedure.md
```

Expected: one row in the "Map the contract root" worked-example table reading (verified during planning):

```
| `impeccable-cli` | `$(npm root -g)/impeccable/` | `cli/engine/cli/main.mjs` | `cli/engine/cli/main.mjs` | *(empty — identity)* |
```

- [ ] **Step 2: Edit the row**

Replace that row with:

```
| `impeccable-cli` | `$(npm root -g)/impeccable/` | `cli/bin/cli.js` | `cli/bin/cli.js` | *(empty — identity)* |
```

(Still an identity/empty contract root — the npm shim ships at the same relative path in both the installed root and the upstream repo, same as before; only the cited path changed, since `cli/engine/cli/main.mjs` no longer exists in either place as of cli-v4.0.0 — #2314.)

- [ ] **Step 3: Verify no other stale reference remains**

```bash
grep -rn "cli/engine/cli/main.mjs\|cli/engine/registry/antipatterns.mjs" .claude/skills/upstream-drift/ tools/upstream-drift/
```

Expected: no output (both retired paths fully swept from the maintainer-tooling tree — Task 1 already removed the manifest's own citations).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/upstream-drift/judge-procedure.md
git commit -m "$(cat <<'EOF'
judge-procedure.md: fix stale impeccable-cli worked-example contract path

cli/engine/cli/main.mjs no longer exists upstream as of cli-v4.0.0 (the
engine moved to a compiled Rust binary) — the worked example now cites
cli/bin/cli.js, matching manifest.yml's own updated contract-paths.

refs #2314
EOF
)"
```

---

### Task 4: File a follow-up backlog record for the engine-rewrite capability finding

This task performs the record's third Deliverable ("Run the full upstream-drift capability JUDGE... to catch any other drift or new capability") — the JUDGE itself already ran during planning (diffing `cli-v3.6.0` → `cli-v4.1.0`, the resolved installed/latest tag pair): the dominant capability finding is the engine rewrite itself. This task captures that finding as a follow-up record rather than expanding this record's own re-pin scope, per this project's "Follow-up ideas" convention (`plugin/skills/build/SKILL.md`'s Common Step 4: "an opportunistic improvement or idea outside the current spec's scope... file it via `/claude-tweaks:capture`... rather than inflating this build's scope").

**Files:** none (no code change — this task's deliverable is a filed GitHub issue).

**Interfaces:**
- Consumes: the capability-JUDGE finding already gathered during planning (below) — no earlier task's output.
- Produces: nothing a later task consumes.

- [ ] **Step 1: File the backlog record**

Invoke `/claude-tweaks:capture` with this content (a capability finding, not a bug — `type:task` if the capture flow asks, since it's investigative/documentation follow-up work):

```
Title: Impeccable CLI's engine moved from inline JS to a compiled Rust binary (cli-v3.6.0 → cli-v4.1.0) — audit whether impeccable-cli.md needs to document the new failure modes

## Current State

Between cli-v3.6.0 and cli-v4.0.0, pbakaus/impeccable's CLI engine was rewritten from JavaScript (shipped inline in the npm package, under cli/engine/) to Rust (crates/ in the upstream repo), compiled to a per-platform binary. The npm package (impeccable@4.1.0) is now a thin shim (cli/bin/cli.js, ~95 lines) that locates or downloads the actual engine binary — from an optionalDependency package (@impeccable/cli-<os>-<arch>) or a checksum-verified download from GitHub releases, cached at ~/.impeccable/bin/<engine-version>/ — where <engine-version> is a SEPARATE version scheme (engine-v0.1.5 observed) decoupled from the npm package's own version (4.1.0) that `impeccable --version` reports.

This was discovered while re-pinning tools/upstream-drift/manifest.yml's impeccable-cli entry from 3.6.0 to 4.1.0 (#2314) — the two behavioral claims impeccable-cli.md made about the old JS engine (findings-to-stdout, empty-array-on-clean-scan) are still true at 4.1.0 (verified against the new Rust source, crates/detect/src/cli.rs at cli-v4.1.0), but the manifest's static-assertion mechanism can no longer check them at all, since there's no local text source left to grep — only fixtures (real `detect` executions) can verify behavior against this artifact going forward.

## Deliverables

Read plugin/skills/design-wrapper/impeccable-cli.md in full against the new shim/binary architecture and judge whether it needs new content: does the wrapper need to document or handle a download failure, a checksum mismatch, an unsupported platform (no matching @impeccable/cli-<os>-<arch> package and no cached/downloadable binary), or the IMPECCABLE_BIN/IMPECCABLE_HOME/IMPECCABLE_DOWNLOAD_BASE env var overrides the shim now supports? None of these failure modes existed under the old inline-JS architecture, and the wrapper doc was written entirely against that architecture.

Decide whether tools/upstream-drift/manifest.yml's impeccable-cli entry needs a new fixture (or a documented accepted gap) covering an engine-download failure, given the existing two fixtures only exercise the happy path.

## Acceptance Criteria

A decision is recorded (either "no new content needed, out of scope because X" or a concrete new section added to impeccable-cli.md) for each failure mode named above.

If a new fixture is added, it passes against the installed 4.1.0 binary.
```

- [ ] **Step 2: Confirm the record was created**

The `/claude-tweaks:capture` invocation itself reports the created record's number/link — record it in this build's handoff (Common Step 7), it needs no separate commit.
