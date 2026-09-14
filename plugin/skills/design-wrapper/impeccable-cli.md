# Impeccable CLI — Invocation + JSON Parsing

<!-- upstream-pin: impeccable-cli@4.1.0 -->
*Contract pinned to Impeccable CLI 3.6.0 and proven by `tests/impeccable-cli-contract.test.js`, which replays committed fixtures against the installed binary. A prose re-verification pass is not a substitute for running that test: the 3.2.1 stamp this replaces was written in good faith twice while the machine ran 2.1.8, because nothing ever compared the stamp to what was installed (`[IL-89]`).*

*The pin is enforced, not aspirational: CLI absent → the contract test skips; CLI present but off-pin → the contract test fails. That asymmetry is the safe direction — a present-but-off-pin CLI failing is what prevents a renamed or reclassified finding from silently downgrading to a pass, the exact "a check that does not run reads as a check that passed" hazard `[IL-105]` names; an absent CLI is defensible to skip because no contributor is misled by it — they were never running the gate at all. The `skip` variable in `tests/impeccable-cli-contract.test.js` is the single enforcement point for this mechanism — read it there rather than here; this paragraph states only the behavior and its rationale.*

Reference for the wrapper's `test` mode dispatch. The Impeccable CLI is a deterministic Node binary that scans frontend files for design anti-patterns without LLM cost.

## Invocation

The wrapper invokes the CLI exactly as:

```bash
npx impeccable detect --json <file1> <file2> ... <fileN>
```

| Flag | Why |
|------|-----|
| `detect` | Subcommand — runs the deterministic anti-pattern scanner |
| `--json` | Machine-readable output — required for parsing |
| `<files>` | Space-separated list of files to scan; passed positionally |

`--fast` was removed from this invocation. At the pinned 3.6.0 it is still deprecated and ignored, and passing it writes `Note: --fast is deprecated and ignored. The full scan is fast now and runs every rule.` to stderr on every call — noise in a stream the parser reads. At 2.1.8 it was not a no-op at all: it forced regex-only scanning and skipped linked stylesheets entirely, which is the degradation CLI 3.5.0's own release notes describe as turning eighteen findings into one.

### Arguments resolution

The wrapper passes the file list resolved by the preconditions:

1. The mode's `<files>` argument if explicitly provided
2. Otherwise the result of `git diff --name-only` (uncommitted, staged + unstaged)
3. Filtered to files matching the frontend trigger extensions/paths from `frontend-detection.md`

If the file list is empty after filtering, the wrapper returns `{skipped: "no frontend files in scope"}` without invoking the CLI.

### Working directory

Run the CLI from the project root (the directory containing the spec/CLAUDE.md) so relative `<files>` arguments resolve correctly. File paths in the output are absolute (the CLI resolves each target with `path.resolve()` before scanning), regardless of the working directory used to invoke it.

### Timeout

Use the Bash tool's default timeout. A single invocation completes in well under a minute even for large file lists. If the CLI times out, treat as a transient failure and return:

```json
{
  "mode": "test",
  "skipped": "Impeccable CLI timed out",
  "install_hint": "Re-run later or invoke manually with `npx impeccable detect --json <files>`"
}
```

Timeout is treated as a skip, not a failure — same rationale as the availability check (a CLI problem must not block the test gate).

## Expected JSON output schema

The CLI emits a single JSON array on stdout — one element per finding, no top-level wrapper object. Expected shape:

```json
[
  {
    "antipattern": "ai-color-palette",
    "name": "AI color palette",
    "description": "Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. Choose a distinctive, intentional palette.",
    "severity": "warning",
    "category": "slop",
    "file": "/project/src/components/Hero.tsx",
    "line": 47,
    "snippet": "from-purple-500 gradient"
  }
]
```

### Field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `antipattern` | string | Yes | Rule identifier (use for de-dup, grouping) |
| `name` | string | Yes | Short human-readable rule name |
| `description` | string | Yes | Full explanation of the anti-pattern |
| `severity` | string | Yes | Informational display value; not the classification axis (see `advisory`). Observed domain: `warning`, `advisory`, `error` — `error` is currently emitted only by rules reachable through the browser/URL engine, not through `detect --json <files>`, so it will not appear in this wrapper's output at the pinned version. |
| `category` | string | Yes | Rule grouping (e.g. `slop`). Present since at least 3.5.0. Useful for **grouping** findings for a human; it is **not** a dispatch key — `polish` mode selects commands solely from a finding's own `suggestion` field, and deriving a command from `category` is the keyword-mapping retired in `command-map.md`'s "Step 2 — Suggestion-driven". |
| `file` | string | Yes | Absolute path (the CLI resolves before scanning) |
| `line` | integer | Yes | Line number; `0` for file-level findings (the CLI always sets this field, defaulting to `0`) |
| `snippet` | string | Yes | The matched text/pattern that triggered the finding |
| `advisory` | boolean | No — present only when `true` | Upstream's own blocking signal. `cli/engine/findings.mjs` stamps this flag from the registry's `advisory: true` key "so every consumer (CLI, JSON, hook) can partition without a registry lookup," and `main.mjs` computes the exit code from it, never from `severity`. This is the field the wrapper classifies on — see [Advisory-to-result mapping](#advisory-to-result-mapping) below. Which rule ids carry it is upstream's data and is deliberately not enumerated here — read the field off the output. Enumerating it is what drifted this file three times. |

### Advisory-to-result mapping

Derive the result from the **parsed findings' `advisory` field**, never from `severity` and never from the exit code:

| Findings after parsing stdout | Wrapper result |
|-------------------------------|----------------|
| None (`[]`) | `pass` |
| Every finding has `advisory === true` | `pass` (listed in output, does not block) |
| Any finding without `advisory === true` | `fail` (gate fails, caller blocks pipeline) |

### Schema version compatibility

The schema above is the pinned CLI version's real, verified output shape — the pin comment and contract statement at the top of this file, proven by `tests/impeccable-cli-contract.test.js`, are the authority on which version; this section does not restate it. The CLI may evolve.

### Defensive parsing rules

1. **Parse stdout unconditionally.** `--json` writes the findings array to stdout at the pinned version; stderr carries only diagnostics. Never read findings from stderr.
2. **The exit code is a whole-run summary of `advisory`, never a per-finding signal.** `main.mjs` sets it via `process.exit(primary.length > 0 ? 2 : 0)`, where `primary` is exactly the findings whose `advisory` flag is not `true` (`isAdvisory()` checks `finding.advisory === true`, the same value stamped in the JSON) — so the exit code and the JSON `advisory` field agree by construction; it is `severity` that can disagree with both (see the note after the parsing rules below for the verified specifics). Still, never derive `pass`/`fail` from the exit code: it can't tell you *which* finding needs surfacing, only whether the run as a whole had one. Always parse stdout and classify each finding by the [Advisory-to-result mapping](#advisory-to-result-mapping) below. Exit code otherwise distinguishes ran (0 or 2) from crashed (1, a usage error, or 127, the shim's own engine-binary-not-found exit — see [Engine binary resolution failures](#engine-binary-resolution-failures-shim-architecture-410) below).
3. **Unknown finding fields** → ignore. `category` was added this way.
4. **Top-level JSON is an array** → treat directly as the findings list.
5. **`severity` outside `{warning, advisory, error}`** → informational only; surface a contract-breach note naming the observed value, same as any other unexpected shape (Phase 2's drift auditor is what escalates it). It does not change `pass`/`fail` — classification never reads `severity`, so an unrecognized value has nothing left to decide.
6. **Exit code 1 or 127, or stdout that does not parse as JSON** → malformed; return the skip object below.

```json
{
  "mode": "test",
  "skipped": "Impeccable CLI returned malformed output",
  "install_hint": "Verify the pin: `npx impeccable --version` should print 3.6.0"
}
```

Malformed output is a skip, not a fail — same rationale as the availability check.

**Advisory path — fixture-proven.** `tests/fixtures/impeccable-cli/advisory.html` and `tests/fixtures/impeccable-cli/warning.html`, replayed by `tests/impeccable-cli-contract.test.js` on every test run, assert the `severity`/`advisory` divergence live rather than leaving it as a claim read off upstream source. One fixture fires a rule whose registry entry carries `advisory: true` without declaring its own `severity` — the finding reports `severity: "warning"` (the default) and `advisory: true`, and the CLI exits `0`. The other fires a rule whose registry entry declares a `severity` but no `advisory: true` — the finding reports its declared `severity` and carries no `advisory` field at all, and the CLI exits `2`. `severity` and `advisory` are populated from two different, independent registry keys, so they disagree in both directions at the pinned version; which rule ids fall on which side is upstream's data, deliberately not enumerated here for the same reason the `severity` field entry in the field reference above gives.

This is exactly why the wrapper classifies on `advisory` instead of `severity`. The CLI's own `--no-advisory` help text names em-dash overuse (`Suppress advisory findings entirely (e.g. em-dash overuse)`) as its worked example of a non-blocking finding, and that finding's `severity` field reads `"warning"` — a `severity`-keyed mapping would `fail` the gate on exactly the finding upstream calls out as safe to ignore. The opposite direction is just as real: a finding whose `severity` reads `"advisory"` but carries no `advisory: true` flag exits `2` — upstream blocks on it — so a `severity`-keyed mapping would have wrongly passed it. Classifying on `advisory` gets both directions right, because it is the one field the exit code itself is computed from.

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

**When none of the four resolve** — a download failure (network failure, missing/empty sha256 sidecar, checksum mismatch),
an unsupported platform with no matching optional-dependency package and no
downloadable asset, or a network-less/offline environment — the shim writes
a human-readable message to **stderr** and exits **127**. Any exception during
`download()` additionally prepends an `impeccable: {error.message}` line to
stderr before the main message. The main message is: `no binary for
{os}-{arch}. Install {package}@{version}, set IMPECCABLE_BIN, or download
impeccable-{os}-{arch} v{version} from {base} into {cache-path}.` A second
exit-127 cause also exists: if a binary IS successfully located, `spawnSync`
can still fail to execute it (e.g., permission denied, corrupted download),
which triggers the same exit code without the locate-phase error context.
**Stdout is always empty in both cases** — the existing defensive parsing rules above already treat empty/non-JSON
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

## Sample invocation (canonical)

```bash
$ npx impeccable detect --json src/components/Hero.tsx
```

The CLI's raw stdout for this invocation has the same shape as the sample under "Expected JSON output schema" above — repeating it here added nothing but a second copy to keep in sync, so it isn't restated. What that section doesn't show is what the wrapper hands back after processing the CLI's output:

```json
{
  "mode": "test",
  "result": "fail",
  "files_scanned": 1,
  "findings": [
    { "antipattern": "ai-color-palette", "name": "AI color palette", "description": "Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. Choose a distinctive, intentional palette.", "severity": "warning", "category": "slop", "file": "/project/src/components/Hero.tsx", "line": 47, "snippet": "from-purple-500 gradient" }
  ]
}
```

**Result rules:** see the [Advisory-to-result mapping](#advisory-to-result-mapping) table above — not restated here. This sample finding carries no `advisory` field, so `result` is `fail`.

## Open items (tracked in parent design doc)

- **Schema stability** — the CLI may change output between releases. The wrapper's defensive parsing rules above handle unknown/missing fields, but a genuinely breaking change (e.g. a new required field, or the `advisory` flag being removed or repurposed) still needs a version pin bump. This used to rely on a human re-verifying by hand after each bump — a 2026-07-20 pass caught a patch bump that had silently added a new advisory rule id, but the same manual process was written in good faith twice while the actually-installed CLI had drifted further still, because nothing compared the stamp to what was installed (`[IL-89]`, see the pin comment at the top of this file). `tests/impeccable-cli-contract.test.js` now does this mechanically: it replays committed fixtures against whatever CLI is actually installed on every test run, so drift is caught structurally instead of depending on someone remembering to re-verify.
- **Log path** — the wrapper does not currently log invocations. The parent design proposes `~/.claude-tweaks/logs/design.jsonl` for token-cost instrumentation. That path is harness-owned (skill content must not write there); add only when the harness gains a logger for this purpose.
