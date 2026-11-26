# manifest.json — what a run started under

`manifest.json` is a per-run file of run-start facts — the plugin version that produced the run, the lane and ceremony profile it took, a fingerprint of the resolved policy, the integration tip it builds on, and the model profile — plus close-out fields filled when the run closes: tokens by model, the list-price cost in dollars, elapsed minutes and the close time (#6009). It is one small JSON object at `{run-dir}/manifest.json`, written by claude-tweaks code only — no skill instructs a model to write it.

The code is `plugin/bin/lib/run-manifest/write.js` (`initRunManifest`, `fillRunManifest`, `MANIFEST_VERSION`, `LANES`, `CEREMONY_PROFILES`) and `plugin/bin/lib/run-manifest/facts.js` (`gatherFacts`, `FORGE_DERIVED_POLICY_KEYS`, `canonicalJson`), `plugin/bin/lib/run-manifest/cost.js` (`deriveRunCost`: the close-out fields from a run's token sources) and `plugin/bin/lib/pricing/prices.js` (`PRICES`, `priceRequest`, `priceAggregate`). The close path is `fillManifestAtClose` in `plugin/bin/lib/timing/at-close.js`. `tests/bin-lib/run-manifest/write.test.js` pins the key set, `v`, the fill rules and the unknown-field round trip; `tests/bin-lib/run-manifest/facts.test.js` pins the fact gathering; `tests/hooks-resolve-run-dir-cli.test.js` pins that `resolve-run-dir --create` still prints exactly the directory path.

Added in #5903. It is not the multi-spec `manifest.yml` (the parent run's spec list, `plugin/bin/lib/flow/manifest.js`), and not the acceptance packet's `packet-inputs/manifest.json`.

## Readers

- Dispatch (a separate repository), which, on this record's reading of the design (subject to dispatch's Phase 0 fixture confirmation), copies the object into each station visit's `manifest` and adds `machineId`, `account` and `model` itself. This page is the contract it would read: the field and file names are the ones below.

## File location and when it is written

`{run-dir}/manifest.json`, written atomically (`atomic-write.js`, tmp file then rename) with keys sorted at every depth, two-space indentation and one trailing newline, so a diff is readable.

- **At the mint.** `resolve()` in `plugin/bin/lib/hooks/run-dir-resolve.js` (reached by `hooks.js resolve-run-dir --create`) calls `initRunManifest` at both creating branches, after the directory exists: the `--standalone` branch and the `--spec-slug` branch. `initRunManifest` never overwrites an existing file, and a `--create` that adopts an existing run (resolution steps 1 and 2) writes nothing, so re-resolving a run leaves its manifest byte-identical. `resolve-run-dir` still prints only the directory path and keeps its exit codes.
- **Later, by a fill.** `fillRunManifest` sets a field a later step learns. It is called from the Manifesto, `setConfigLever`, the express gate and the driver's adoption; the writer table below names each.
- **Never fails a caller.** Both writes are best-effort: nothing throws, no caller's outcome or exit code changes, and a failed write is dropped with one stderr line (`claude-tweaks: run-manifest: …`). A manifest that exists but is not a valid JSON object is left untouched by a fill, with one such line. A fill into a run directory that does not exist writes nothing, and a fill that changes nothing (no valid field, or only values already set) creates no file. A fill into a multi-spec `spec-N/` child directory creates no manifest of its own (the one manifest lives at the top-level run directory), though one already there is filled. Both writes are best-effort and last-writer-wins: a fill is a read-modify-write with no lock, and the atomic rename prevents only a torn file, not a lost update between two concurrent fills.
- **Not run initialization.** A directory holding only `manifest.json` is not an initialized run: `resolveRunArg`'s initialized-run check (`decisions.md`, `run-state.json` or `config.yml`) and the orphaned-mint sweep do not read it.
- **No manifest on an ad-hoc run directory.** The hook-stamped `{ts}-adhoc-standalone` directories (`standalone: 'adhoc'`, minted from hook events in `plugin/bin/lib/hooks/context.js` and `post-tool-use.js`) carry no manifest: a hook event must not read `process.env` or spawn policy and git work, and the mint skips them. A reader finding none on such a directory has found nothing wrong.

## Fields

Sixteen fields: nine run-start facts and seven close-out fields (#6009), all at `v: 1` (`MANIFEST_VERSION`); no earlier field was renamed or retyped.

| Field | Type | Meaning |
|---|---|---|
| `v` | number | The format version, `1`. |
| `runId` | string | The run directory's basename. |
| `createdAt` | string | ISO-8601 UTC time of the first write. For a fill-created manifest, the time of that fill. |
| `pluginVersion` | string, nullable | The running build's version, from `CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json` (`resolvePluginVersion`), never the repository's own `plugin.json`. `null` when `CLAUDE_PLUGIN_ROOT` is unset or the file is unreadable. |
| `lane` | string | `standard`, `express`, `driver` or `unknown`: the route the run attempted first (see Lane). |
| `ceremonyProfile` | string, nullable | `fast-lane` or `standard`; `null` until set. |
| `policyHash` | string, nullable | `sha256:` and 64 hex digits: a fingerprint of the resolved policy at mint (see `policyHash`). `null` when the policy cannot be read. |
| `baseCommit` | string, nullable | The 40-hex tip of the integration branch at mint (see `baseCommit`). `null` with no remote ref or no git. |
| `modelProfile` | object, nullable | `{ "stance": "economy\|default\|max-rigor", "ceiling": "<profile name>\|null" }` from the resolved `model-stance` and `model-ceiling` (`ceiling` is `null` when unset). `null` when the policy cannot be read. |
| `tokensByModel` | object, nullable | `{ "<model id>": { "input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h" } }`, summed over every token source read. `null` when none was read. |
| `costUsd` | number, nullable | List-price dollars for the priced models, rounded once to cents after summing. `null`, never `0`, when no token source was read. |
| `priceDate` | string, nullable | The `PRICES.date` the cost used (`plugin/bin/lib/pricing/prices.js`). |
| `unpricedModels` | string[], nullable | Model ids counted in `tokensByModel` but not priced (an id the table does not know). |
| `costPartial` | boolean, nullable | `true` when some token source could not be read, so `costUsd` is a lower bound. |
| `minutes` | number, nullable | Elapsed minutes from the run's start (the mint's `createdAt`, or the first event for a fill-created manifest) to `closedAt`, one decimal. |
| `closedAt` | string, nullable | ISO-8601 UTC time the run closed, not the time of the fill: `run-state.json`'s `updatedAt` once its status is `clean`, else the last event timestamp the timing derivation saw, else `null`. |

The writer of each field is in the next table. A fill accepts the four fact fields only in these shapes and ignores anything else (the close-out fields have their own rules under Cost and close-out fields): `pluginVersion` a non-empty string, `policyHash` as above, `baseCommit` 40 lowercase hex, `modelProfile` an object whose `stance` is one of the three names and whose `ceiling` is a string or `null`.

### Writers per field

| Writer | Where | Sets |
|---|---|---|
| Mint | `initRunManifest`, called from `resolve()` in `run-dir-resolve.js` (the `mintManifest` helper) | `v`, `runId`, `createdAt`, `pluginVersion`, `lane` (`driver` for a `--spec-slug` of the form `drive-{n}`, otherwise `unknown`), `ceremonyProfile` (`null`), `policyHash`, `baseCommit`, `modelProfile`. The helper passes `cwd` but not `env`, so a driver mint, whose `resolveRunDir` call passes `env: {}`, still records `pluginVersion` from the process environment. |
| Manifesto | `writeManifesto` in `plugin/bin/lib/flow/manifesto-write.js`, after it writes `config.yml`; and `plugin/bin/set-config.js`'s `--set` batch when the batch holds every one of the 13 Manifesto levers (the `confirm` and `hybrid` Manifesto, and case-3 recovery, write `config.yml` that way) | `lane: standard`. A partial batch (the ceremony downgrade, the express lane's `configSet`) never sets the lane. |
| `setConfigLever` | `plugin/bin/lib/set-config/write.js`, when the key written is `ceremony-profile` | `ceremonyProfile`. The Manifesto, the express lane's `configSet` (which writes `ceremony-profile=fast-lane`) and a ceremony-escape-hatch downgrade all write the key through it, and a later value overwrites the earlier one. |
| Express gate | `runGate` in `plugin/bin/lib/express/cli.js`, when `--run` is given and every record's verdict is `eligible: true` | `lane: express`. An ineligible verdict leaves the lane untouched. |
| Driver adoption | `adoptRun` in `plugin/bin/lib/driver/adopt.js`, on a successful `--run` adoption of a dispatch-minted run (the driver mints nothing there, so the mint left `unknown`) | `lane: driver`. |
| Close path | `fillManifestAtClose` in `plugin/bin/lib/timing/at-close.js` (`close-run`, `teardown-run`, `archiveRunDir`'s phase write, the detached token pass; `fillKeptManifest` for a `kept` close) | `tokensByModel`, `costUsd`, `priceDate`, `unpricedModels`, `costPartial`, `minutes`, `closedAt`. A multi-spec `spec-N/` child gets no fill from this path. |

No current fill site passes `pluginVersion`, `policyHash`, `baseCommit` or `modelProfile`; the module would set one of them only while it is still `null`.

## Reading rules

- **`null` and `unknown` mean "not known yet or never known", never an error.** A bare mint writes `ceremonyProfile: null` and, unless the slug is `drive-{n}`, `lane: unknown`; both stay so until a later step fills them. Any gathered fact can also be `null` (see the field table). A run nothing writes `ceremony-profile` for (an interactive run, a standalone tidy) keeps `ceremonyProfile: null` for good. A visit with no readable manifest says the rest is unknown.
- **Ignore fields you do not know.** A reader must not fail on a key it has not seen.
- **Check both locations.** Archival moves the whole run directory, so the manifest travels to `{pipelines}/archive/{run-id}/manifest.json` with the rest. A reader must not assume the live path.
- **A fill can create the file.** A manifest created by a fill (a run minted before this shipped, or an adopted run whose mint left none) carries only the filled fields: `v`, `runId`, `createdAt` (the fill's time), the filled field or fields, and every other run-start field `null` (`lane` is `unknown` unless filled). It may also lack `minutes`, `closedAt` and the cost group: those keys are absent, not `null`, until a close fills them. A fill gathers no facts.

## Cost and close-out fields

Derived by `deriveRunCost` at close, from the same transcripts the token pass reads, and filled by `fillManifestAtClose`.

- **Absent means unknown.** `minutes` and `closedAt` are never written as `null`: when the close could not derive one, the key is simply absent. An unread cost group (no token source read) is the exception: it is written as explicit nulls for all five cost keys (`tokensByModel`, `costUsd`, `priceDate`, `unpricedModels`, `costPartial`), and a later read group replaces it. A reader reads an absent key as `null` (unknown), never as `0`.
- **`null`, never `0`.** `costUsd` is `null` when no token source was read. A row whose five token fields are all `0` is skipped (no `tokensByModel` key, no `unpricedModels` entry).
- **List-price equivalents.** Dollars are what the tokens would cost at list price, not a bill: subscription use costs nothing per token. `priceDate` names the price table's date.
- **Priced per request.** A transcript row is priced by `priceRequest` on its own model, with the Haiku long-prompt rate for a request over 100k input tokens. A row with no cache-write split prices its whole write at the 5-minute rate. A dispatch item's `tier` is never used; the row's `model` is.
- **Sources.** Session lanes read transcript rows plus the `tokens` of each headless lens-worker item in `timing.json`'s dispatch list. The driver lane reads the `usage` object on each `driver-events.jsonl` step line (the worker and review lines, and since #6009 the `merge-check` and `merge-acceptance` lines).
- **Aggregates price at base rates.** A whole-session aggregate (a driver step `usage`, a lens worker's `tokens`) is priced by `priceAggregate` at the model family's base per-token rates, never the Haiku long-prompt rate, so Haiku cost from aggregate sources is a lower bound. An aggregate with no cache-write split prices its whole write at the 5-minute rate.
- **`costPartial`.** `true` when a source named a model but could not be read (a missing transcript, a worker with no `tokens`, a driver line with a model but no `usage`). A partial group is still written, with `costPartial: true`.
- **One upgrade.** The cost group is written while the stored `costUsd` is `null` or absent, and replaced once when the stored group is `costPartial: true` and the new one is complete (`costPartial: false`). A complete group is never rewritten. A `kept` close (`fillKeptManifest`) may make that one upgrade; `timing.json` is not rewritten on that path.
- **Fill-only-null for the rest.** `minutes` and `closedAt` are set once and never overwritten, so closing a run again changes nothing. The cost group's valid shapes are all-null ("unread") or fully typed ("read"); a fill ignores any other shape.

## Lane

`lane` is the vocabulary of the dispatch station events (#5902): `standard | express | driver | unknown`. It is never guessed: it is only ever set by one of the writers above, and a mint with no known lane writes `unknown`.

`lane` means **the first route the run attempted**:

- `unknown` counts as unset, and a fill never writes `unknown`. The first known lane wins and a known lane is never overwritten.
- An express run that escalates to the normal path stays `express`.
- A record the driver adopted and then refused (`policyStep`, the origin-host gate) keeps `driver`: the fill happens at adoption, before those gates.

## `ceremonyProfile`

Set only through `setConfigLever` when the key is `ceremony-profile`, so it tracks the latest verdict: it is the one field a fill overwrites (a changed value only; the same value changes nothing). A ceremony-escape-hatch downgrade from `fast-lane` to `standard` therefore changes `ceremonyProfile` and no other field.

## `policyHash`

A fingerprint for "same policy or not", not a copy: the values are not written.

- It is `sha256:` plus the hex digest of the canonical JSON (keys sorted at every depth, no whitespace, arrays in order) of `{key: resolved value}` for every `POLICY_KEYS` entry **except `integration-model` and `merge-verification`**. Those two run forge detection, which can call `gh`; `FORGE_DERIVED_POLICY_KEYS` in `facts.js` is the one constant to edit if another key's resolution gains a network probe. The mint is deliberately free of network calls.
- The factory policy layer (#6006) is part of the resolved policy, so a value it supplies is hashed like a `policy.yml` value. The driver's mint resolves it with the parent's variable.
- No per-run `config.yml` overlay is applied (none exists at mint). Two policies that resolve to the same values hash equal; changing a hashed value changes the hash; changing only `integration-model` does not.
- It is taken at mint, the policy the run started under. A mid-run edit to `.claude-tweaks/policy.yml` is not reflected.
- It is `null` when the policy cannot be read (an unreadable `policy.yml`, any read error other than the file being absent, or a resolver failure). An absent `policy.yml` is a valid policy and hashes the defaults.

## `baseCommit`

The tip of the integration branch the run builds on, read once at mint, not the worktree's first commit.

- The branch comes from `resolveIntegrationBranch` in `plugin/bin/lib/hooks/worktree-reap.js`, the same resolver the run's worktree creation uses: the policy's pinned branch (preferring `origin/{name}` when that remote-tracking ref exists), else what `origin/HEAD` points at. The commit is then one `git rev-parse --verify` of `refs/remotes/origin/{name}` in the main checkout (`mainCheckoutRoot`), so a branch with only a local copy yields `null`.
- The worktree itself starts from local `HEAD` plus a catch-up merge of that same remote-tracking ref (`plugin/skills/build/worktree-setup.md`, `_shared/worktree-setup.md`'s Post-creation catch-up). The two agree except when local `HEAD` carries unpushed commits, or when `origin` moved after the mint.
- `null` when there is no remote-tracking ref for the integration branch, no `origin`, or no git.

## What is not in it

- **No secrets.** Every value is a version, an enum name, a sha or a hash.
- **Not copied elsewhere.** It is not written to the work record, a PR body or a staged file.
- **Not a per-run policy copy.** The policy values themselves are never written.

## Example

```json
{
  "baseCommit": "0123456789abcdef0123456789abcdef01234567",
  "ceremonyProfile": "standard",
  "closedAt": "2026-11-19T08:02:10.000Z",
  "costPartial": false,
  "costUsd": 4.82,
  "createdAt": "2026-11-19T07:31:30.000Z",
  "lane": "standard",
  "minutes": 30.7,
  "modelProfile": {
    "ceiling": null,
    "stance": "default"
  },
  "pluginVersion": "6.174.0",
  "policyHash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "priceDate": "2026-11-03",
  "runId": "2026-11-19T073130-spec-5903",
  "tokensByModel": {
    "claude-opus-4-7": {
      "cacheRead": 9200000,
      "cacheWrite1h": 0,
      "cacheWrite5m": 310000,
      "input": 52000,
      "output": 61000
    }
  },
  "unpricedModels": [],
  "v": 1
}
```

## Compatibility

A field is added, never renamed or retyped. A new field is added to the module, to this page and to `tests/bin-lib/run-manifest/write.test.js` in the same change; a reader ignores fields it does not know, which `write.test.js` pins with a `v: 2` object that carries an unknown key through a fill. Removing a field, or changing a field's type or meaning, requires a `v` bump and a note here. Current version: 1; no earlier version has been released. The seven close-out fields (#6009) were added at `v: 1`.
