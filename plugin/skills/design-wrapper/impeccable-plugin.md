# Impeccable Plugin — Context Signals (Layer 0)

<!-- upstream-pin: impeccable-plugin@4.0.2 -->
*Contract pinned to the Impeccable **plugin** 4.0.2 and proven by `tests/impeccable-plugin-contract.test.js`, which resolves the installed plugin from the cache and executes `gatherSignals()` against it. A prose re-verification pass is not a substitute for running that test — see the same rationale in `impeccable-cli.md`'s pin statement (`[IL-89]`).*

The **plugin** and the **CLI** are two independent artifacts on two independent version lines. `impeccable-cli.md` pins `impeccable-cli`; this file pins `impeccable-plugin`. Conflating them is the documented root cause of the drift `tools/upstream-drift/manifest.yml` exists to catch, and that manifest carries the two as separate entries for exactly this reason.

Reference for **Layer 0**, the wrapper's enrichment layer. Layer 0 executes Impeccable's own `context-signals.mjs` and folds its output into the wrapper's decisions. It is cheap (no LLM call, no detector run, no file writes) and entirely optional.

This file also hosts the **shared plugin-root resolver** (`## Resolution` below). Layer 0 is its first consumer but no longer its only one: the other consumers in the table below run different scripts out of the same plugin root. The resolver is named and specified once here precisely so every additional consumer imports it rather than re-deriving it (`[IL-32]`). Everything outside `## Resolution` — the output shape, the trust rules, the Layer 0 framing — remains Layer-0-specific.

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

The wrapper resolves the pinned plugin from the Claude Code plugin cache. Every step reads the artifact itself.

### `resolveImpeccablePlugin({searchRoot}) -> {root, version} | null`

**One resolver, every consumer.** Every consumer needs the same answer — "where is the pinned Impeccable plugin?" — so the procedure below is specified once, under this name, and each consumer derives its own script path from the returned `root`. A second copy of these four steps is the duplication `[IL-32]` names; do not add one.

`searchRoot` defaults to `~/.claude/plugins/cache` (see "Injectable search root" below). The return is `{root, version}` on a hit and `null` on a miss, with the miss distinguished per the degradation table below — a bare `null` collapses "absent" into "off-pin" and reports a fixable install problem as an unfixable absence.

#### Procedure

1. **Glob** `<search-root>/*/impeccable/*/.claude-plugin/plugin.json`, where `<search-root>` defaults to `~/.claude/plugins/cache`. The first `*` is the marketplace directory; the second is the version directory.
2. **Read each candidate's own `version` field.** Never infer the version from the directory name — a stale or mislabeled cache directory is precisely the drift this pin exists to catch, not to reproduce.
3. **Select the candidate whose `version` equals the pin** in this file's `<!-- upstream-pin: impeccable-plugin@X.Y.Z -->` comment. Several versions coexist in the cache routinely (4.0.2 and 3.0.6 both sit there on the machine this contract was recorded against), so this is a select-from-many, not a read-the-one.
4. **The plugin root** is two segments up from the matched `plugin.json` — the directory containing `.claude-plugin/`. That directory is the returned `root`; the matched `version` is the returned `version`.

#### Script paths per consumer

Derived from the returned `root`. The resolver itself resolves no script — it answers only "which plugin root is at the pin," and each consumer appends its own path:

| Consumer | Script |
|---|---|
| Layer 0 (all modes) | `<root>/skills/impeccable/scripts/context-signals.mjs` |
| `doctor` mode (`modes/doctor.md`) | `<root>/skills/impeccable/scripts/doctor.mjs` |

Every consumer's script ships inside the same plugin at the same pin, so one successful resolve serves them all — a `doctor` invocation never re-globs the cache when Layer 0 already resolved in the same wrapper call. `explore` mode (`modes/explore.md`) no longer resolves through this procedure — it resolves through the `impeccable-engine` module instead (#2979, #2982), which finds the active install directly rather than globbing this resolver's plugin cache.

### Never resolve via `${CLAUDE_PLUGIN_ROOT}`

`${CLAUDE_PLUGIN_ROOT}` is **claude-tweaks' own** plugin root. Reading a version from it reports *this* plugin's version under Impeccable's name — a wrong-artifact answer that looks entirely healthy. `[IL-89]` names the rule ("resolve the running build from the artifact, never from install metadata"); this is its wrong-artifact form.

### Injectable search root

The search root is a parameter with a default, not a constant. Without one, the only way to test the version-mismatch branch is to mutate or hide the developer's real `~/.claude/plugins/cache` — which `tests/impeccable-plugin-contract.test.js` must never do. It points the search root at a committed fixture cache tree instead.

### The pin is not pedantry

`context-signals.mjs` **does not exist** at 3.0.6, the other version cached on the recording machine. Nor does `doctor.mjs` — verified against the same cache, so the pin is load-bearing for *every* consumer of this resolver, not just Layer 0. A resolver that took "some Impeccable plugin is installed" for an answer would resolve a path that isn't there. Version-mismatch is a real, load-bearing distinction, not a strictness preference.

## Degradation

Three conditions all degrade to a skip. The skip reason must distinguish them — collapsing them reports a fixable install problem as an unfixable absence.

The first two rows are **resolver-level**: they are the two ways `resolveImpeccablePlugin` returns `null`, and they read identically for every consumer. The third is **per-consumer** — each consumer runs a different script, so each detects and words its own execution failure. `doctor` mode's wording is in `modes/doctor.md`.

| Condition | Level | Detected by | Skip reason |
|---|---|---|---|
| **Absent** | Resolver | The glob matched no candidate directory at all | `Impeccable plugin not installed` |
| **Version mismatch** | Resolver | Candidates found, none at the pin | `Impeccable plugin {found} does not match the pinned {pinned}` — `{found}` names **every** version found, as a list |
| **Execution failure** | Per-consumer | The pinned script resolves but exits non-zero, writes to stderr, or emits stdout that does not parse as JSON | `Impeccable context signals unavailable (execution failed)` (Layer 0's wording) |

Naming every version found is the point, and the plural is load-bearing: two cached copies on one machine is an ordinary observed state, so "what was found" is a list, not a value. A reason naming one of two installed versions sends the user chasing the wrong one.

**Execution failure is a skip, never an exception.** Exit 0 / empty stderr / JSON on stdout is an *observation* from one run of one version, not a guarantee. `context-signals.mjs` promises internally that "every probe is best-effort and never throws" — but that promise covers the probes, not the module load, not the imports it resolves at load time, and not the process. A version-matched script that fails must not propagate an exception into every `/tidy` and `/flow` run.

In all three cases Layers 1-3 run unchanged and every mode completes normally — **for Layer 0**. That immunity is Layer 0's property, not the table's: Layer 0 is enrichment, so losing it changes no outcome. A consumer for which the plugin *is* the work degrades differently — `doctor` mode returns a skip object of its own, because a `doctor` run with no `doctor.mjs` has no result to report. Read a row here for how to *detect and word* a condition, not for what it costs the caller.

## Invocation

Two entry points, both at the resolved script path.

**As a module** (preferred — returns the object directly, no parse step):

```js
import { gatherSignals } from '<plugin-root>/skills/impeccable/scripts/context-signals.mjs';
const signals = await gatherSignals(cwd);   // cwd defaults to process.cwd()
```

**As a CLI:**

```bash
node <plugin-root>/skills/impeccable/scripts/context-signals.mjs
```

Writes `JSON.stringify(signals, null, 2)` plus a trailing newline to stdout.

### Arguments resolution

**The CLI entrypoint accepts no flags.** Its `cli()` calls `gatherSignals(process.cwd())` and never reads `process.argv` — there is no `--json` (JSON is the only output), no target argument, and no cwd override. The exported `gatherSignals(cwd = process.cwd())` takes a working directory and nothing else.

This is not a gap to work around. It is the fact that makes `scan.targets` a *fallback* substitute only, never an override of a caller-supplied file list (see the trust table): there is no argument that would scope it.

### Working directory

Run from the project root. Every signal is computed relative to `cwd` — `PRODUCT.md`/`DESIGN.md` discovery, the `.impeccable/critique/` lookup, the git shell-outs, and `scan.targets`' path existence checks. `productPath`, `designPath`, `critique.latest.file`, and `scan.targets` are all returned **relative to `cwd`**, unlike the Impeccable CLI's absolute finding paths.

### `git.changedFiles` is read live, with no injection point

`gitSignals()` shells out via `execFileSync` on every call:

- `git diff --name-only <base>...HEAD` when a local `main` or `master` exists **and** differs from the current branch;
- otherwise `git status --porcelain` against the working tree.

There is no parameter, environment variable, or flag that supplies a synthetic changed-file list. Two consequences, both load-bearing:

1. `scan.targets` cannot be scoped by a caller, so it may only replace the wrapper's own unscoped fallback — never an explicit target list.
2. `tests/impeccable-plugin-contract.test.js` replays a **frozen fixture** for anything asserting over `scan.targets`, because a live run asserts over whatever happens to be uncommitted at that moment.

### Timeout

Use the Bash tool's default timeout. The dominant cost is the dev-server probe — seven TCP connects issued in parallel with a 250 ms timeout each — so a call completes in well under a second. Treat a timeout as an **execution failure** per the degradation table.

## Output shape

`gatherSignals()` returns exactly these five keys. This file is the **single source of truth** for the shape; `SKILL.md` and the mode files reference it and must not restate it. Three copies of the CLI contract is what let Phase 1's bug survive two verification passes.

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
| `scan.targets` / `scan.via` | Target resolution, all modes | Replaces the wrapper's `git diff --name-only` **fallback**, and only **after** Layer 3 has ruled the change frontend — and the per-file trigger-extension/path filter still applies to the substituted list afterward (`scan.targets` is a scannability predicate, not a frontend one). Never overrides an explicit caller-supplied target list — per "Arguments resolution" it is computed from the live working tree with no injection point, so substituting it would silently widen a scoped invocation. Empty `targets` takes the git-diff fallback too: "did not resolve" and "resolved but returned nothing" reach the same place. |
| `setup.platform` | `/claude-tweaks:design-wrapper`'s return (surfaced), track resolution (acts) | **Authoritative when non-null**, including against a record's own `Surface:` line — except on the `terminal` track, where `Surface:` wins (`SKILL.md`'s track table; the disagreement is still named in `surface_track_override`) — but never silently: a disagreement is named in `surface_track_override`. `null` is not a failure and not an absence of opinion; it falls back to `Surface:`, where `mobile` resolves to the native track with `adaptive` **inferred**. The full table, the closed value domain it rests on, and the `desktop` assumption live in `SKILL.md`'s track-resolution section — do not restate them here. |
| `setup.hasProduct` / `setup.hasDesign` | `pre-build`, `doctor` | Whether Impeccable's own project context exists. **`doctor` gates on this**: both false means the project has no Impeccable artifacts to audit, and `doctor` skips before spawning `doctor.mjs` (see `modes/doctor.md`). Still not surfaced in the wrapper return — `doctor` consumes them internally rather than re-exporting them. |
| `critique.latest` | `review` | A cached score with P0/P1 counts, free. Advisory context only — it never replaces a live `critique` run and never changes `result`. |
| `devServer.running` / `devServer.ports` | `live` | **Veto only** — `false` skips, `true` does not authorize. The probe is a bare TCP connect against seven fixed ports: it cannot tell whose server answered, and it is silent about every port it did not check, so `false` only vetoes a target whose port is in that set. See `modes/live.md`. |

## Surfaced in the wrapper's return

`setup.platform` is surfaced as a top-level `platform` field on **every** wrapper return shape — see `SKILL.md`'s `## Output contract`. It is the only Layer 0 signal in the return today; each remaining signal becomes a field when the record that consumes it lands, rather than being surfaced speculatively.

## Open items (tracked in parent design doc)

- ~~**Native routing**~~ — **closed.** `setup.platform` now drives track resolution in `SKILL.md`, with the `Surface:` fallback's precedence stated there and each of its four rows walked through in `native-routing.md`. `test` and `live` skip explicitly on the native track rather than returning a pass the web-only detector could not have failed.
- ~~**`doctor` integration**~~ — **closed.** `doctor` mode landed and consumes `setup.hasProduct` / `setup.hasDesign` as its project-context precondition (see the trust table above and `modes/doctor.md`). They remain deliberately unsurfaced in the wrapper return: the consumer reads them internally, so surfacing them would add a field with no reader.
- **Cache lifetime** — the wrapper re-executes `gatherSignals()` per invocation. The call is sub-second, so there is no caching today; if a pipeline run ever calls several modes in sequence, a per-run memo keyed on `cwd` is the obvious next step.
