# Impeccable CLI Engine/Binary Migration Audit (#2480) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the new engine-binary-resolution failure modes and env var overrides that Impeccable's cli-v4.0.0+ shim architecture introduced, and record an explicit decision on whether `tools/upstream-drift/manifest.yml`'s impeccable-cli entry needs a new fixture for an engine-download failure.

**Architecture:** `impeccable-cli.md` currently documents only the pinned CLI's JSON output contract and its own transport-level failure modes (timeout, malformed output). Since cli-v4.0.0, `npx impeccable` is a thin shim (verified against the installed `impeccable@4.1.0`'s `cli/bin/cli.js` at `/Users/thomasholknielsen/.npm/_npx/1a4eb60c8f6b0f89/node_modules/impeccable/cli/bin/cli.js`) that resolves a separate, per-platform Rust binary before running any subcommand except `--version`. This plan adds one new subsection to `impeccable-cli.md` documenting that resolution failure mode (exit 127, stderr-only message, empty stdout — already safely absorbed by the existing "malformed" skip path) and the three env var overrides (`IMPECCABLE_BIN`/`IMPECCABLE_HOME`/`IMPECCABLE_DOWNLOAD_BASE`), corrects the exit-code taxonomy prose to mention 127, and records the fixture decision as an inline comment in `manifest.yml` next to the entry it concerns (no new fixture — the replay harness's `checkOneFixture` in `tools/upstream-drift/checks.js` hard-requires the named stream to parse as JSON, and this failure's stderr message is plain text, so the failure mode is not expressible as a passing fixture today without extending that harness — a separate piece of work, captured as a follow-up).

**Tech Stack:** Markdown (skill doc), YAML (manifest), no code changes.

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-2480/.claude-tweaks/pipelines/2026-09-17T194605-record-2480/work/2480-spec.md` (materialized from GitHub issue #2480)

## Global Constraints

- No new fixture is added to `manifest.yml` — the decision is "documented accepted gap," recorded inline.
- No code changes — this is a documentation + one YAML comment change.
- The new doc content must be traceable to a concrete evidence source (the installed shim's actual source), not inferred from release notes — per this repo's `verify-third-party-source-not-just-open` convention.

---

### Task 1: Document engine-resolution failure modes and record the fixture decision

**Files:**
- Modify: `plugin/skills/design-wrapper/impeccable-cli.md` (insert a new subsection; edit two existing sentences)
- Modify: `tools/upstream-drift/manifest.yml` (add a comment block above the `impeccable-cli` entry's `fixtures:` key, ~line 49)

**Interfaces:**
- Consumes: nothing (no other task in this plan).
- Produces: nothing consumed elsewhere (single-task plan).

- [ ] **Step 1: Insert the new subsection into `impeccable-cli.md`**

Insert the following new subsection immediately after the "Advisory path — fixture-proven." paragraph (the paragraph ending "...gets both directions right, because it is the one field the exit code itself is computed from.") and immediately before the `## Sample invocation (canonical)` heading:

```markdown
### Engine binary resolution failures (shim architecture, 4.1.0+)

Since cli-v4.0.0, `impeccable` is a thin npm shim (`cli/bin/cli.js`) around a
per-platform Rust binary — `--version` is answered by the shim itself and
never touches the engine, but every other subcommand (including `detect`)
first has to **locate** that binary, in this order:

1. `$IMPECCABLE_BIN`, if set and it points at an existing file.
2. The `@impeccable/cli-<os>-<arch>` optional dependency, if installed.
3. The version-pinned cache at `$IMPECCABLE_HOME/bin/<engine-version>/`
   (default `~/.impeccable/bin/<engine-version>/`; `<engine-version>` is the
   **engine's own** version — a separate scheme from the npm package version
   `--version` reports).
4. A checksum-verified download from `$IMPECCABLE_DOWNLOAD_BASE` (default
   `https://github.com/pbakaus/impeccable/releases/download`) — refused if
   the release's `.sha256` sidecar is missing/empty or the digest doesn't
   match.

**When none of the four resolve** — a download failure, a checksum mismatch,
an unsupported platform with no matching optional-dependency package and no
downloadable asset, or a network-less/offline environment — the shim writes
a human-readable message to **stderr** and exits **127** (`no binary for
{os}-{arch}. Install {package}, set IMPECCABLE_BIN, or download
impeccable-{os}-{arch} v{version} from {base} into {cache-path}.`; a
checksum/sidecar failure additionally prepends its own `impeccable:
{message}` line ahead of that one). **Stdout is always empty in this case**
— the existing defensive parsing rules above already treat empty/non-JSON
stdout as the `malformed` skip (rule 6), so this failure mode already
degrades safely without any wrapper behavior change; it does not fail the
gate.

The one thing to get right when diagnosing it: **`npx impeccable --version`
succeeding is not evidence the engine binary resolved** — unlike the
version-pin-mismatch skip (`availability.md`), this failure is invisible to
that check, so it needs its own install_hint rather than reusing
`availability.md`'s pin-verification wording:

> "Engine binary could not be located or downloaded — set `IMPECCABLE_BIN`
> to an existing binary, install `@impeccable/cli-<os>-<arch>` for this
> platform, or verify network access to `IMPECCABLE_DOWNLOAD_BASE` (default
> GitHub releases)."

**Env var overrides**, useful for CI/offline pinning or troubleshooting:

| Var | Effect |
|---|---|
| `IMPECCABLE_BIN` | Bypass resolution entirely — run this exact binary path. |
| `IMPECCABLE_HOME` | Override the cache root (default `~/.impeccable`) — the version-pinned binary is read from and downloaded to `$IMPECCABLE_HOME/bin/<engine-version>/`. |
| `IMPECCABLE_DOWNLOAD_BASE` | Override the release base URL for the download fallback (default `https://github.com/pbakaus/impeccable/releases/download`) — e.g. an internal mirror. |

Verified against the installed 4.1.0 shim's own source (`cli/bin/cli.js`),
not inferred from release notes.
```

- [ ] **Step 2: Correct the exit-code taxonomy in the existing "Defensive parsing rules" list**

In the same file, in rule 2 of the numbered "Defensive parsing rules" list, change:

```
Exit code otherwise distinguishes only ran (0 or 2) from crashed (1, a usage error).
```

to:

```
Exit code otherwise distinguishes ran (0 or 2) from crashed (1, a usage error, or 127, the shim's own engine-binary-not-found exit — see [Engine binary resolution failures](#engine-binary-resolution-failures-shim-architecture-410) below).
```

And in rule 6, change:

```
6. **Exit code 1, or stdout that does not parse as JSON** → malformed; return the skip object below.
```

to:

```
6. **Exit code 1 or 127, or stdout that does not parse as JSON** → malformed; return the skip object below.
```

- [ ] **Step 3: Record the fixture decision inline in `manifest.yml`**

In `tools/upstream-drift/manifest.yml`, immediately above the `impeccable-cli` entry's `fixtures:` key (the line reading exactly `    fixtures:`, currently followed by the `warning.html`/`clean.html` runs), insert this comment block at the same 4-space indent as the sibling `assertions:`/`fixtures:` keys:

```yaml
    # Engine-download-failure fixture: accepted gap, not added (#2480).
    # tools/upstream-drift/checks.js's checkOneFixture hard-requires the
    # named expect.stream to parse as JSON; the shim's locate()/download()
    # failure path (IMPECCABLE_BIN/HOME/DOWNLOAD_BASE all exhausted) writes a
    # plain-text message to stderr, which this harness cannot express as a
    # passing fixture today. Extending checkOneFixture with a text/substring
    # assertion mode would make this fixture expressible — filed as a
    # follow-up backlog record, not folded into this decision-only change.
    fixtures:
```

- [ ] **Step 4: Run the existing test suites that cover these two files**

Run: `node --test tests/impeccable-cli-contract.test.js tools/upstream-drift/tests/manifest.test.js tools/upstream-drift/tests/checks.test.js`
Expected: PASS (0 failures) — the contract test replays the same two existing fixtures against the installed 4.1.0 binary unchanged; the manifest/checks tests validate `manifest.yml`'s schema, which a YAML comment does not affect.

- [ ] **Step 5: Run the generic skill-conventions suite**

Run: `node --test tests/skill-conventions.test.js`
Expected: PASS — confirms the new subsection and edited sentences don't break any structural convention this repo enforces across `plugin/skills/**/*.md` (frontmatter shape, byte budgets, etc.). The file grows from ~12.8KB to ~15.3KB, well under any ceiling this suite enforces.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/design-wrapper/impeccable-cli.md tools/upstream-drift/manifest.yml
git commit -m "Document impeccable-cli shim's engine-resolution failure mode and env var overrides

Impeccable's CLI engine moved from inline JS to a compiled Rust binary
(cli-v3.6.0 -> cli-v4.1.0): npx impeccable is now a thin shim that
locates/downloads a per-platform binary before running any subcommand
except --version. Documents the resulting failure mode (exit 127, plain-text
stderr, empty stdout -- already absorbed by the existing malformed-output
skip path) and the IMPECCABLE_BIN/IMPECCABLE_HOME/IMPECCABLE_DOWNLOAD_BASE
env var overrides. Records the fixture decision (no new fixture -- the
upstream-drift replay harness requires a JSON payload on the asserted
stream, and this failure emits plain text) as an inline comment in
manifest.yml next to the entry it concerns.

refs #2480

Claude-Session: https://claude.ai/code/session_01LmMCG6vpyAcDkkKJgVkAAN"
```

---

## Self-review

- **Spec coverage:** Deliverables item 1 (audit + judge whether new content is needed for download failure / checksum mismatch / unsupported platform / env var overrides) — covered by Step 1's new subsection and Step 2's taxonomy fix, all four failure modes converge to the same exit-127/stderr signature per the shim source read above. Deliverables item 2 (decide on a new manifest fixture) — covered by Step 3's inline decision comment, backed by the concrete `checkOneFixture` JSON-only constraint found in `tools/upstream-drift/checks.js`. Acceptance Criteria 1 ("a decision is recorded ... for each failure mode") — satisfied by Steps 1-3. Acceptance Criteria 2 ("if a new fixture is added, it passes against the installed 4.1.0 binary") — vacuous, since no fixture is added; Step 4 proves the two *existing* fixtures still pass against the installed 4.1.0 binary regardless.
- **Placeholders:** none — every step names exact file paths, exact insertion points, and exact verbatim text to add or change.
- **Type consistency:** n/a (no code, no function signatures).
