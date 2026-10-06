# Impeccable Plugin — Context Signals (Layer 0)

<!-- upstream-pin: impeccable-plugin@4.5.0 impeccable-engine@0.1.11 -->
*Last verified against the Impeccable **plugin** 4.5.0 (project scope) and its cached **engine** 0.1.11, with the Layer 3 non-equivalence assertion below still pinned and proven by `tests/impeccable-plugin-contract.test.js`. Both numbers are last-verified-against markers, not exact pins this file's resolution enforces — see "Last verified version, not an exact pin" below. Resolution and execution are owned by `plugin/bin/lib/impeccable-engine/index.js` (record #2979) and covered by `tests/bin-lib/impeccable-engine/*.test.js` — this file documents the CLI contract that wraps it, not a parallel implementation. A prose re-verification pass is not a substitute for running those tests — see the same rationale in `impeccable-cli.md`'s pin statement (`[IL-89]`).*

The **plugin** and the **CLI** are two independent artifacts on two independent version lines. `impeccable-cli.md` pins `impeccable-cli`; this file pins `impeccable-plugin`. Conflating them is the documented root cause of the drift `tools/upstream-drift/manifest.yml` exists to catch, and that manifest carries the two as separate entries for exactly this reason.

Reference for **Layer 0**, the wrapper's enrichment layer. Layer 0 runs `plugin/bin/impeccable-engine.js run signals` and folds the returned JSON envelope into the wrapper's decisions. It is cheap (no LLM call, no detector run, no file writes) and entirely optional.

Resolving and invoking the installed plugin is **the engine module's job**, not this file's. `plugin/bin/lib/impeccable-engine/index.js`'s `resolve()`/`run()` are the one implementation every consumer calls — Layer 0 here, `doctor` (`modes/doctor.md`), and `explore`'s sibling sub-issue. The CLI's `resolve` subcommand is documented once, in `## Resolution` below, precisely so no consumer re-derives it (`[IL-32]`). Everything outside `## Resolution` — the output shape, the trust rules, the Layer 0 framing — remains Layer-0-specific.

## Layer 0 — what it can and cannot decide

**Layer 0 gates nothing.** It enriches; it has no veto and no skip power of its own. Layers 1-3 remain the only things that can stop a dispatch. A Layer 0 that is absent, off-pin, or broken changes no mode's outcome — every mode continues to work with Layers 1-3 unchanged. **Degradation is never a failure.**

The precise boundary, because one signal reads like a counter-example:

| | Layer 0 |
|---|---|
| Adds a branch to the **detection** chain (frontend vs. not) | Never. Layers 1-3 own that question end to end. |
| Informs a **mode's own** precondition, after detection has already passed | Yes, in exactly one place today — `devServer.running` in `live` (see the trust table). |

That is not a Layer 0 gate: `live`'s dev-server precondition is `live`'s, and it is reached only once Layers 1-3 have already said "dispatch." Layer 0 supplies the value; the mode owns the decision. Nothing in Layer 0 can turn a frontend change into a skip.

### Why Layer 3 is not redundant with `scan.targets`

`scan.targets` looks like a frontend-file list. It is not one, and it cannot replace Layer 3.

`scanTargets()` filters on `SCANNABLE_EXT` — the set of extensions Impeccable's **detector engine can parse**:

```
.html .htm .css .scss .jsx .tsx .js .ts .vue .svelte .astro
```

`.js` and `.ts` are in that set unconditionally, with no path qualification. `frontend-detection.md`'s Layer 3 lists both under **negative cases**: bare `.ts`/`.js` outside a trigger path are "typically server, lib, or utility code" and must not match. The two predicates answer different questions:

- `scan.targets` answers **"what could the detector parse?"** — a scannability predicate.
- Layer 3 answers **"is this change frontend?"** — the frontend predicate.

They diverge on real input. Run against this repository with a dirty tree, `scan.targets` returns Node test and library files — `.js` files under `tests/` and `bin/` — in a repo with no UI at all. Layer 3 correctly rejects every one of them.

Nothing upstream computes a frontend predicate, so deleting or weakening Layer 3 in favour of `scan.targets` would silently widen every mode onto backend diffs. `tests/impeccable-plugin-contract.test.js` carries a permanent assertion of this non-equivalence against a frozen fixture — frozen because an assertion about *this repo's current* diff is a scheduled failure timed to the next commit (`[IL-80]`).

## Resolution

The engine module resolves the active install itself — read `installed_plugins.json`, select the best project-or-user-scope entry for the calling session's working directory, confirm the 4.2.2+ launcher exists, then probe the cached design-engine binary. Every consumer calls the same two functions (`resolve()`/`run()`, `plugin/bin/lib/impeccable-engine/index.js`) via the CLI wrapper — nothing here re-derives that procedure.

### `node "${CLAUDE_PLUGIN_ROOT}/bin/impeccable-engine.js" resolve`

**One resolver, every consumer.** Every consumer needs the same answer — "is there a usable Impeccable install, and where is its plugin root?" — so this is the one call every consumer makes (Layer 0 here, `doctor` via `run doctor`, `explore`'s sibling sub-issue via `run concept-seed`). A second resolver beside it would be the duplication `[IL-32]` names; do not add one.

Prints one JSON envelope to stdout:

- **`{ok: true, pluginRoot, launcher, pluginVersion, engineVersion, scope}`** — `pluginRoot` is the plugin's install directory (the value `native-routing.md`'s dispatch rule reads); `launcher` is the resolved `impeccable`/`impeccable.cmd` script path; `pluginVersion`/`engineVersion` are the installed plugin's and cached engine's own version strings — informational, not a gate; `scope` is `"project"` or `"user"` (a project-scope entry wins over the user-scope install when both exist for this working directory).
- **`{ok: false, reason, fix?, detail?}`** — one of the six reasons in `## Degradation` below.

A `run <verb>` call (`## Invocation`) resolves internally first and returns the identical `{ok: false, ...}` shape on a resolution failure — a consumer never needs to call `resolve` before `run` just to check.

### Never resolve via `${CLAUDE_PLUGIN_ROOT}`

`${CLAUDE_PLUGIN_ROOT}` is **claude-tweaks' own** plugin root — it is where `impeccable-engine.js` itself lives, not where Impeccable is installed. Reading a version from it reports *this* plugin's version under Impeccable's name — a wrong-artifact answer that looks entirely healthy. `[IL-89]` names the rule ("resolve the running build from the artifact, never from install metadata"); this is its wrong-artifact form. The engine module's own `resolve()` return is the only source for Impeccable's `pluginRoot`/`pluginVersion`.

### Last verified version, not an exact pin

Earlier versions of this file pinned Layer 0's resolution to one exact plugin version, selected by globbing the plugin cache. The engine module drops that constraint deliberately: `resolve()` accepts any install carrying the 4.2.2+ launcher and a cached engine binary, regardless of exact version, because the launcher's own `engine-probe`/verb dispatch is the real compatibility boundary now. The `<!-- upstream-pin: impeccable-plugin@4.5.0 impeccable-engine@0.1.11 -->` comment above records the plugin and engine versions this file's prose was **last verified against**, not versions this resolver enforces — `tools/upstream-drift/manifest.yml` is where an exact-version contract (`tests/impeccable-plugin-contract.test.js`'s Layer 3 assertion) still lives.

## Degradation

Six conditions, all returned as `{ok: false, reason, fix?, detail?}` by `plugin/bin/lib/impeccable-engine/index.js` (`FAILURE_REASONS` — treat this list as authoritative; a module change to it is the one thing that could make this table stale). Three carry a canned `fix` string from the module itself; the other three carry only a `detail` naming what went wrong, because there is no single fix to print.

| `reason` | Meaning | User-facing skip wording | Fix |
|---|---|---|---|
| `not-installed` | No `impeccable@impeccable` entry in `installed_plugins.json` at all | `Impeccable plugin not installed` | `/plugin install impeccable@impeccable (Impeccable 4.2.2 or later)` (the module's own `fix` string) |
| `upgrade-required` | An install exists, but its launcher script (`skills/impeccable/scripts/impeccable[.cmd]`) is missing — an install older than 4.2.2 | `Impeccable plugin is older than 4.2.2 (no engine launcher)` | `/plugin update impeccable@impeccable to 4.2.2 or later` (the module's `fix` string also names the missing launcher path) |
| `engine-not-installed` | The launcher exists but `engine-probe` failed — the design-engine binary isn't cached yet | `Impeccable design engine not cached` | Run the launcher's own `engine-probe` subcommand (the module's `fix` string is the exact command for this machine) |
| `shape-mismatch` | The verb ran and returned JSON, but it didn't match the expected `signals`/`doctor`/… shape | `Impeccable {verb} output did not match the expected shape` | `detail` names the first field that failed validation — usually an engine/plugin version skew; re-run `engine-probe` or update the plugin |
| `exec-failed` | The launcher exited non-zero, or crashed before producing output | `Impeccable {verb} unavailable (execution failed)` | `detail` carries the last lines of stderr — report it; usually a transient environment issue, not an install problem |
| `timeout` | The run exceeded the engine module's 60-second timeout | `Impeccable {verb} timed out` | Retry; a persistent timeout points at something hanging inside the launcher, not this wrapper |

**Execution failure is a skip, never an exception.** A single observed run — exit 0, clean JSON — is an observation from one run of one install, not a guarantee. `run()` wraps every spawn in a `try`/`catch` and every `reason` above is a returned value, never a thrown error reaching the caller — the same "neither function throws" contract the module's own header comment states.

In every case Layers 1-3 run unchanged and every mode completes normally — **for Layer 0**. That immunity is Layer 0's property, not the table's: Layer 0 is enrichment, so losing it changes no outcome. A consumer for which the plugin *is* the work degrades differently — `doctor` mode returns a skip object of its own (`modes/doctor.md`), because a `doctor` run with no engine has no result to report. Read a row here for how to *detect and word* a condition, not for what it costs the caller.

## Invocation

One entry point — the CLI, which never throws and always prints exactly one JSON line:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/impeccable-engine.js" run signals
```

Branch on the envelope: `{ok: true, value: {setup, critique, git, devServer, scan}}` — the Output shape below — or `{ok: false, reason, fix?, detail?}` per `## Degradation` above. `signals` ignores `--help` and executes unconditionally — never document or invoke it with `--help`.

### Arguments

**`run signals` accepts no arguments.** `validateVerbArgs('signals', args)` requires `args.length === 0`; any argument makes the CLI exit 2 with a usage error before it ever resolves or spawns anything. This is not a gap to work around. It is the fact that makes `scan.targets` a *fallback* substitute only, never an override of a caller-supplied file list (see the trust table): there is no argument that would scope it.

### Working directory

Run from the project root. Every signal is computed relative to the engine's working directory — `PRODUCT.md`/`DESIGN.md` discovery, the `.impeccable/critique/` lookup, the git shell-outs, and `scan.targets`' path existence checks. `productPath`, `designPath`, `critique.latest.file`, and `scan.targets` are all returned **relative to that directory**, unlike the Impeccable CLI's absolute finding paths.

### `git.changedFiles` is read live, with no injection point

The `signals` verb shells out to git on every call — `git diff --name-only <base>...HEAD` when a local `main` or `master` exists **and** differs from the current branch, otherwise `git status --porcelain` against the working tree. There is no parameter, environment variable, or flag that supplies a synthetic changed-file list. Two consequences, both load-bearing:

1. `scan.targets` cannot be scoped by a caller, so it may only replace the wrapper's own unscoped fallback — never an explicit target list.
2. `tests/impeccable-plugin-contract.test.js` replays a **frozen fixture** for anything asserting over `scan.targets`, because a live run asserts over whatever happens to be uncommitted at that moment.

### Timeout

The engine module enforces its own 60-second timeout (`DEFAULT_TIMEOUT_MS`) and returns `{ok: false, reason: 'timeout'}` rather than hanging the caller. The dominant real-world cost is the dev-server probe inside `signals` — seven TCP connects issued in parallel with a 250 ms timeout each — so a successful call completes in well under a second; a `timeout` result means the launcher itself is stuck, not that the probe is merely slow.

## Output shape

The `signals` verb returns exactly these five keys in its `value` field. This file is the **single source of truth** for the shape — the engine module's `validateSignals()` encodes the same fields; `SKILL.md` and the mode files reference this file and must not restate it. Three copies of the CLI contract is what let Phase 1's bug survive two verification passes.

```json
{
  "setup":     { "hasProduct": true, "productPath": "PRODUCT.md", "hasDesign": true, "designPath": "DESIGN.md", "hasCode": true, "platform": null },
  "critique":  { "latest": null },
  "git":       { "isRepo": true, "branch": "main", "base": null, "changedFiles": [], "changedCount": 0 },
  "devServer": { "running": true, "ports": [8080] },
  "scan":      { "targets": ["."], "via": "root" }
}
```

### Field reference

| Field | Type | Notes |
|---|---|---|
| `setup.hasProduct` | boolean | A `PRODUCT.md` resolved through Impeccable's own context resolution |
| `setup.productPath` | string \| null | Relative to `cwd`; `null` when absent |
| `setup.hasDesign` | boolean | A `DESIGN.md` resolved the same way |
| `setup.designPath` | string \| null | Relative to `cwd`; `null` when absent |
| `setup.hasCode` | boolean | `package.json` exists, or any of `src` `app` `pages` `site` `public` `components` `lib` |
| `setup.platform` | `web` \| `ios` \| `android` \| `adaptive` \| null | See "Why `platform` is usually null" below |
| `critique.latest` | object \| null | Newest `.md` in `.impeccable/critique/` (filenames are timestamp-prefixed, so a lexical sort is chronological), frontmatter-parsed |
| `critique.latest.slug` | string \| null | Critique target slug |
| `critique.latest.score` | number \| null | `null` when the frontmatter value is absent or non-numeric |
| `critique.latest.p0` / `.p1` | number \| null | Priority-0 / priority-1 counts, same coercion rule |
| `critique.latest.timestamp` | string \| null | As written in the frontmatter |
| `critique.latest.file` | string | Path relative to `cwd` |
| `git.isRepo` | boolean | `false` collapses `branch`/`base` to `null` and both file fields to empty |
| `git.branch` | string \| null | `git rev-parse --abbrev-ref HEAD` |
| `git.base` | `main` \| `master` \| null | The diff base — **`null` whenever the current branch *is* the base**, which is the common case on `main`. Not an error. |
| `git.changedFiles` | string[] | **Capped at 50.** From `<base>...HEAD` when `base` is non-null, otherwise from the working tree via `git status --porcelain` |
| `git.changedCount` | number | The **uncapped** total — compare against `changedFiles.length` to detect truncation |
| `devServer.running` | boolean | True when any probed port accepted a TCP connection |
| `devServer.ports` | number[] | Ascending. Probed set: `3000 4200 4321 5173 5174 8000 8080` |
| `scan.targets` | string[] | Relative to `cwd`, and capped at 50 **on the `git-changes` branch only** — the other three branches return at most a handful of directory names by construction. **Not a frontend-file list** — see the trust table and the Layer 3 section above |
| `scan.via` | `git-changes` \| `source-dir` \| `html` \| `root` \| null | Which of the four resolution branches produced `targets` |

### `scan.via` resolution order

First branch that yields anything wins:

1. **`git-changes`** — changed files filtered to `SCANNABLE_EXT` and to paths that still exist on disk
2. **`source-dir`** — whichever of `src` `app` `components` `pages` `public` exist
3. **`html`** — a root `index.html`
4. **`root`** — `["."]`, when `hasCode` is true but no conventional source dir exists
5. Otherwise `{targets: [], via: null}`

### Why `platform` is usually null

`platform` requires a literal `Platform` section in `PRODUCT.md` naming exactly `web`, `ios`, `android`, or `adaptive` (a list naming both native targets — `ios, android` — also resolves to `adaptive`; anything else, including prose or a negation, returns `null`).

**`null` is the expected common case, not an error.** Verified `null` against this repository, which has a `PRODUCT.md` — it simply carries no `Platform` section. Any consumer that reads `platform` must treat `null` as "unknown," and falls back to the record's `Surface:` body-metadata line.

## Per-signal trust rules

| Signal | Consumer | Rule |
|---|---|---|
| `scan.targets` / `scan.via` | Target resolution, all modes | Replaces the wrapper's `git diff --name-only` **fallback**, and only **after** Layer 3 has ruled the change frontend — and the per-file trigger-extension/path filter still applies to the substituted list afterward (`scan.targets` is a scannability predicate, not a frontend one). Never overrides an explicit caller-supplied target list — per "Arguments" it is computed from the live working tree with no injection point, so substituting it would silently widen a scoped invocation. Empty `targets` takes the git-diff fallback too: "did not resolve" and "resolved but returned nothing" reach the same place. |
| `setup.platform` | `/claude-tweaks:design-wrapper`'s return (surfaced), track resolution (acts) | **Authoritative when non-null**, including against a record's own `Surface:` line — except on the `terminal` track, where `Surface:` wins (`SKILL.md`'s track table; the disagreement is still named in `surface_track_override`) — but never silently: a disagreement is named in `surface_track_override`. `null` is not a failure and not an absence of opinion; it falls back to `Surface:`, where `mobile` resolves to the native track with `adaptive` **inferred**. The full table, the closed value domain it rests on, and the `desktop` assumption live in `SKILL.md`'s track-resolution section — do not restate them here. |
| `setup.hasProduct` / `setup.hasDesign` | `pre-build`, `doctor` | Whether Impeccable's own project context exists. **`doctor` gates on this**: both false means the project has no Impeccable artifacts to audit, and `doctor` skips before running the engine's `doctor` verb (see `modes/doctor.md`). Still not surfaced in the wrapper return — `doctor` consumes them internally rather than re-exporting them. |
| `critique.latest` | `review` | A cached score with P0/P1 counts, free. Advisory context only — it never replaces a live `critique` run and never changes `result`. |
| `devServer.running` / `devServer.ports` | `live` | **Veto only** — `false` skips, `true` does not authorize. The probe is a bare TCP connect against seven fixed ports: it cannot tell whose server answered, and it is silent about every port it did not check, so `false` only vetoes a target whose port is in that set. See `modes/live.md`. |

## Surfaced in the wrapper's return

`setup.platform` is surfaced as a top-level `platform` field on **every** wrapper return shape — see `SKILL.md`'s `## Output contract`. It is the only Layer 0 signal in the return today; each remaining signal becomes a field when the record that consumes it lands, rather than being surfaced speculatively.

## Open items (tracked in parent design doc)

- ~~**Native routing**~~ — **closed.** `setup.platform` now drives track resolution in `SKILL.md`, with the `Surface:` fallback's precedence stated there and each of its four rows walked through in `native-routing.md`. `test` and `live` skip explicitly on the native track rather than returning a pass the web-only detector could not have failed.
- ~~**`doctor` integration**~~ — **closed.** `doctor` mode landed and consumes `setup.hasProduct` / `setup.hasDesign` as its project-context precondition (see the trust table above and `modes/doctor.md`). They remain deliberately unsurfaced in the wrapper return: the consumer reads them internally, so surfacing them would add a field with no reader.
- **Cache lifetime** — the wrapper re-invokes `run signals` per invocation. The call is sub-second, so there is no caching today; if a pipeline run ever calls several modes in sequence, a per-run memo keyed on `cwd` is the obvious next step.
