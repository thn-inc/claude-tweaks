# Policy Schema — Canonical Config Lever Index

Every project-config lever claude-tweaks skills read, in one place — the way `_shared/work-record.md`'s Config Keys table indexes the work-record system's keys. `bin/lib/policy-schema.js` owns the same keys as data (name, type/enum, default) plus `auditPolicy(repoRoot)`, a deterministic validator. If this table and that file disagree, one of them has a bug — fix, don't fork.

`.claude-tweaks/policy.yml` is the canonical **and only** home for every lever below — no key in this table is read from CLAUDE.md. `worktree-always` is additionally enforced mechanically by `bin/lib/hooks/pre-tool-use.js`, which reads `policy.yml` directly. A recognized key still sitting in a project's CLAUDE.md no longer applies to anything; `auditPolicy()` reports it under `migratableKeys` and `/claude-tweaks:init --update`'s Config Home Drift check offers to move it. Sibling file: `.claude-tweaks/verify-scope.json` — `verify.js --scope`'s path-to-suite declaration (#1922); not a policy key, never read by `resolve-policy.js`.

## Canonical read path

`bin/resolve-policy.js` is THE canonical way skill prose reads any policy or run-config value:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" [--values | --all] [--run "$PIPELINE_RUN_DIR"] <key> [<key>…]
```

For shell-variable capture, `--values` prints one plain value per line in request order instead of the JSON envelope — coerced values render natively (`true`, `14`); an unset no-default key and an unknown key each print an empty line (the same empty string the retired grep pipeline produced); `model-profiles` has no scalar form and is an invocation error under `--values`. List-typed keys (e.g. `merge-sensitive-paths`) resolve to the raw comma-separated string in both modes when configured — callers split on `,`; only the unset default is a JSON `[]`, which `--values` renders as an empty line (same empty-means-none reading as the retired grep).

The `${CLAUDE_PLUGIN_ROOT}` spelling is a model-resolved placeholder, not a live env var — the substitution contract is `docs/skill-authoring.md`'s "Plugin-root references (`CLAUDE_PLUGIN_ROOT`)" section; follow it, it is not restated here.

Output is a single JSON object keyed by requested key. Each key resolves to the envelope `{value, source}` with `source ∈ run-config | policy | default`; precedence is run `config.yml` (when `--run` is given) → `policy.yml` → schema default. Integers and booleans come back as native JSON types. Optional envelope fields:

- `"renamed-from"` — the value arrived via a `RENAMED_KEYS` alias (deprecated key name in the source file)
- `"invalid": true` — a present-but-rejected value degraded to the schema default; distinct from known-but-unset, which is `source: "default"` with no flag
- `{"error": "unknown-key"}` — the requested key is not in the schema (no value/source)

Two carve-outs:

- The PreToolUse hook's `worktree-always` read stays an in-process `bin/lib/policy.js` call — hot path, never shells out.
- `model-profiles` is policy-only (the `--run` overlay never applies) and returns `{value: null, source: "default"}` when the block is absent. Any fragment-reader failure — a malformed block, or a malformed sibling model key such as `frontier-run-cap` (the reader parses all four model keys; its throws aren't sub-classified) — degrades to `{value: null, source: "default", invalid: true}`.

**Derived-default keys** come in two shapes; both are live, so a new derived key picks one deliberately and states the choice in its row.

*Shape A — resolve-time derivation, no static default* (`integration-model`, `merge-verification`): the `POLICY_KEYS` row carries no static `default`; the derivation's one prose statement lives here (`_shared/integration-model.md`'s forge-detection ladder; the `merge-verification` coverage block below) with a code twin in `bin/lib/` (`policy-schema.js`'s `detectIntegrationModel`; `merge-verification.js`'s `deriveMergeVerification`); `bin/resolve-policy.js` computes it only for an *absent* key (`source: "default"`, no `invalid` flag), never overwriting an `invalid: true` envelope; and `/claude-tweaks:help`'s policy mode renders the default as `computed (…)`.

*Shape B — in-loop derivation over a static base default* (`housekeeping-auto-merge`, #580): the row keeps a static `default` as the base (`false`, the `supervised` base), so schema default and effective default differ; the derivation runs inside `bin/lib/policy-schema.js`'s `resolvePolicyKeys` (`deriveHousekeepingAutoMerge`); it fires for any entry that resolved `source: "default"` — unset **and** set-but-invalid (the `invalid: true` flag survives, the value is derived) — and keeps `source: "default"` because that field is the derived-vs-explicit attribution surface its consumers read. Pick B when an existing consumer must keep reading the value as a plain default; A otherwise. `/claude-tweaks:help`'s policy mode renders B's explicitly-set default as `computed (derived from autonomy)`, and surfaces an unset/still-derived divergence via a Notable-defaults finding, both per that skill's own render contract (#636).

Consolidating the two is deferred until a further derived lever appears (#580's ledger). Adding a lever of either shape also walks `_shared/auto-mode-contract.md`'s "Adding a new policy lever" checklist when it is Manifesto-visible.

`--all` emits the whole resolved config in one call: every schema key mapped to its `{value, source}` envelope plus its metadata fields and shape (`summary`, `category`, `tier`, `type`, `default` — `default` is JSON `null` when the row has none, which consumers read as "no default"). It composes with `--run`, takes no key arguments, and is mutually exclusive with `--values`. Renderers (the `/claude-tweaks:help` policy mode, init's policy review) consume this instead of enumerating key names by hand.

## `resolveValue` — canonical coercion contract

`bin/lib/policy-schema.js` also exports `resolveValue(key, rawValue)`: look up `key` in
`POLICY_KEYS`, validate `rawValue` against that entry's `type` (`boolean`, `integer`, `enum`,
`string`, `list`, `opaque`), and fall back to the entry's `default` whenever `rawValue` is
absent, empty, or fails validation — never throwing on malformed input. `integer` and `boolean`
entries are additionally coerced to their native JS type; other types pass through unchanged once
validated. A `string` entry rejects whitespace by default (a mistyped branch name); an entry carrying
`allowWhitespace: true` — today only `release-hook`, a shell command — accepts it. An unrecognized
`key` returns `rawValue` untouched (nothing to coerce against).
`bin/lib/issues/trust.js`'s `resolveRevertWindowDays` is the first caller
(`trust-revert-window-days`); any future lever of the same shape — read a policy key, coerce with a
typed fallback to a documented default — should call `resolveValue` rather than re-deriving its own
parsing.

## Metadata fields

Every `POLICY_KEYS` row carries three human-facing fields alongside its shape: `summary`, `category`, and `tier`. `tests/policy-schema-metadata.test.js` pins completeness (a future lever cannot ship metadata-less), the category set against the mapping table below, the core-tier cap, and the no-duplication rule — the same prose↔constant pattern as `tests/hooks-gate-coverage.test.js`.

- **`summary`** — one plain-language sentence stating *what changes when you move this lever* (style target ≤ ~120 chars; hard test ceiling 140). It never restates the key name or type, and carries no implementation citations. This is a different altitude from each key's Meaning column in the sections below: the summary is for a project owner scanning their config; the Meaning prose is the deep contract for skill authors. Neither replaces the other, and no summary text may be duplicated into this file (test-enforced).
- **`category`** — one of the values in `POLICY_CATEGORIES` (exported beside `POLICY_KEYS`). The mapping below assigns every key-bearing section of this file to a category; it is many-sections-to-one-category, and a key may individually carry a different category than its section when its subject genuinely differs (the section mapping is orientation, the per-key field is truth).
- **`tier`** — `core` or `advanced`. Decision rule: `core` = levers that change what the pipeline may *do without a human* — enforcement gates, autonomy/trust posture, merge/execution defaults, integration identity. Tuning caps, thresholds, retention, and cosmetic/reporting knobs are `advanced`. The core tier is capped at 12 keys (enforced, not advisory).

| Section | Category |
|---------|----------|
| Worktree & execution | `pipeline-behavior` |
| Integration model | `merge-safety` |
| Project facts | `autonomy-trust` |
| Dispatch & merge | `merge-safety` |
| Review | `pipeline-behavior` |
| Documentation | `housekeeping` |
| Harness-health budgets | `health-sweeps` |
| Health-sweep filing | `health-sweeps` |
| Code-health focus verticals | `health-sweeps` |
| Auto-mode levers | `pipeline-behavior` |
| Model profiles | `models` |
| Additional levers | `housekeeping` |

## Key naming

Every key in `POLICY_KEYS` (and every `RENAMED_KEYS` replacement name) is a **flat kebab-case identifier** — `^[a-z0-9]+(-[a-z0-9]+)*$`, no dots. The full rule (why no dots, the `-floor`/`-ceiling`/`-cap` suffix vocabulary, one spelling per concept, renames only through `RENAMED_KEYS`, and the deliberate `auto-mode` keep verdict) lives in `_shared/policy-key-naming.md`; `tests/policy-key-naming.test.js` pins both files.

## Worktree & execution

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `worktree-always` | `policy.yml` only — no CLAUDE.md path exists | `/claude-tweaks:init`, `/claude-tweaks:build`, `_shared/git-discipline.md`; mechanically enforced by `bin/lib/hooks/pre-tool-use.js` | `false` (unenforced) | Whether covered operations must occur inside a linked git worktree — see the coverage block below for exactly which |
| `execution-strategy` | `policy.yml` | `/claude-tweaks:build`, `_shared/git-discipline.md` | `subagent` | `/claude-tweaks:build`'s execution axis, one key with two value classes: `subagent`/`batched` set the default when no argument is passed (an explicit argument still overrides); `subagent-only`/`batched-only` lock the axis — the other value is not offered and a contradicting explicit argument is substituted with an inline notice (see build/SKILL.md's Execution axis paragraph). `execution.always` is a deprecated alias: `migrate` maps `subagent` → `subagent-only` and `batched` → `batched-only`; a malformed value null-migrates to the schema default (`subagent`, unlocked); when both keys are set, the `execution-strategy` line wins (uniform alias rule — the audit/init drift check surfaces the conflict) |
| `git-strategy` | `policy.yml` | `/claude-tweaks:build`, `/claude-tweaks:flow` | `worktree` | Default value of the Git axis when no argument is passed — matches /claude-tweaks:build's own documented default and /claude-tweaks:flow's intrinsic one. Set current-branch to opt a project out of worktree isolation by default; an explicit argument still wins, and worktree-always overrides both |

### `worktree-always` coverage — canonical

Moved to `_shared/policy-schema-coverage.md` — its "`worktree-always` coverage" and "Teardown gate coverage" sections carry the gate-coverage lists, exemptions, and procedural consequences (split out per #635, ceiling headroom). Cite that file, not this stub.

## Integration model

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `integration-model` | `policy.yml` | `/claude-tweaks:init` (Step 20 offer) | unset — computed at resolve time by `bin/resolve-policy.js`'s `detectIntegrationModel` (forge detection), never a schema literal | `pr-first`/`local-merge` — which backend a project integrates through. Explicit value validates and wins outright (ordinary enum validation, unconditional); detection runs only when the key is absent. See `_shared/integration-model.md` for the full resolution ladder, run-scoped pinning, and consumer table |
| `merge-verification` | `policy.yml` (per-run override via the Manifesto's `config.yml`, lever 11) | `/claude-tweaks:flow` Manifesto (lever row); merge-site consumers land in #560 | unset — derived at resolve time by `bin/lib/merge-verification.js` (wired through `bin/resolve-policy.js`), never a schema literal; see the coverage block below | `merge-when-green`/`wait`/`off` — how much CI verification a merge into the integration branch requires. Explicit value validates and wins outright; derivation runs only when the key is absent — an invalid value surfaces as `invalid: true` (an empty `--values` line), never silently overwritten by derivation, exactly as `integration-model` above. `bin/resolve-policy.js` is the only resolution path — there is deliberately no in-process resolver twin (the merge sites read the lever through the CLI, `_shared/pr-first-merge.md` Step 2.5), so no second contract exists to diverge from it. `wait` is explicit-config-only (the ladder never derives it) — it is the runtime fallback merge sites degrade to when `--auto` arming is unavailable, not a default. Read via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values merge-verification` |
| `merge-authorization` | `config.yml` only — a live Manifesto `confirm`/`hybrid` override answer (lever 13); **never** `.claude-tweaks/policy.yml` (deliberate exclusion, see `_shared/auto-mode-contract.md`'s Bookend Architecture section) | `/claude-tweaks:flow` Manifesto (lever row); `wrap-up/review-console.md`'s Auto-merge short-circuit | `ask` | `ask`/`pre-authorized` — pre-authorizes, for this run only, that the run should merge itself once every HARD-GATE is green and the suite is proven. Read via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values merge-authorization`; a `policy.yml` value is silently discarded by the resolver (falls back to `ask`, `source: default`) rather than winning as it would for every other lever — the one deliberate exception to the standard 4-level precedence chain. Its `POLICY_KEYS` row carries `policySourceExcluded: true` (#839), the generic flag both the resolver's discard and `auditPolicy()`'s `sourceExcludedKeys` finding key off — a project owner who sets it in `policy.yml` anyway gets a named, non-silent finding rather than a value that looks effective but never is. Registering a second such lever needs only that flag, no new code. |

### `merge-verification` derivation — canonical

Moved to `_shared/policy-schema-coverage.md` — its "`merge-verification` derivation" section carries the four-branch derivation and code twin (split out per #635, ceiling headroom). Cite that file, not this stub.

## Project facts

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `project-maturity` | `policy.yml` (the machine flag; CLAUDE.md's Philosophy section holds a separate narrative description, not this flag) | `/claude-tweaks:init` Phase 3, `/claude-tweaks:build`, `/claude-tweaks:specify` | `greenfield` (absent or invalid value) | `greenfield`/`pre-launch`/`early-production`/`established` — scales `/build`'s test-discipline instruction and `/specify`'s decomposition strategy |
| `auto-mode` | `policy.yml` | `/claude-tweaks:flow`, `/claude-tweaks:tidy`, `/claude-tweaks:build` standalone | unset (`/flow` still defaults to `auto`) | `default-on`/`default-off` — whether standalone `/build` and unattended `/tidy` firings default to auto mode |
| `integration-branch` | `policy.yml` only | `/claude-tweaks:routine`, `/claude-tweaks:dispatch`, `/claude-tweaks:wrap-up`, `/claude-tweaks:build`, `/claude-tweaks:flow`, `/claude-tweaks:assess-agent-autonomy`, plus the `SessionStart` worktree reaper (`bin/lib/hooks/worktree-reap.js` — the one non-skill consumer) — all via `_shared/integration-branch.md` | unset (each consumer keeps its own fallback; for the reaper that fallback is to reap nothing) | The branch where finished work lands and new work starts. Set it on any repo whose active development branch isn't its GitHub default — a `dev` → `staging` → `main` model — where the default is the one branch nothing should be measured against |
| `autonomy` | `policy.yml` | `/claude-tweaks:capture` (born-`ready` filing), `/claude-tweaks:backlog refine` (`refine-mode.md` Step 3's advisory trust consequence lines — the ceiling also decides whether that fetch runs at all, gated to `trusted`+ or `--trust` — and Step 3.6; its headless posture's machine-grant chain, `refine-headless.md`, reached via `--source routine\|sweep` or the deprecated `grant` alias), `/claude-tweaks:ledger`, `/claude-tweaks:wrap-up` (the bookkeeping capabilities below) — all via `_shared/autonomy-ceiling.md` | `supervised` | `supervised`/`trusted`/`unattended` — a **ceiling on autonomous action, not a level**. `bin/lib/issues/trust.js`'s per-class evidence (rendered read-only by `/claude-tweaks:help` and `/claude-tweaks:backlog overview`) moves the level; this lever only ever caps it — a class that has earned trust still cannot exceed the configured ceiling, and lowering the ceiling revokes immediately without destroying the evidence history. Resolved by `bin/lib/issues/autonomy.js` — `resolveCeiling` picks the tier by precedence, `permittedGrants` maps `(ceiling, trust row)` to a concrete permission set, and `bookkeepingPermissions(ceiling)` maps the ceiling alone (no trust row needed) to the bookkeeping capabilities `_shared/autonomy-ceiling.md`'s own table enumerates. `_shared/autonomy-ceiling.md` is the contract for all of this. `trusted` also unlocks born-`ready` filing for classes whose verdict is `clean`; `unattended` additionally unlocks machine-originated grants, gated behind the `grant-origination-enabled` opt-in below — `refine`'s headless posture is the one path that acts on it. At `supervised` — the default — trust is computed and displayed and never acted on, and none of the bookkeeping capabilities are unlocked |
| `trust-revert-window-days` | `policy.yml` | `bin/lib/issues/trust.js` (evidence engine), consumed by `_shared/trust-table.md`'s Fetch section | `14` | Minimum age in days since a closed record's tracker `closedAt` before its unreverted closing commit(s) count as known-good **operational** evidence in the trust table, alongside `demo:*` disposition evidence — see `_shared/autonomy-ceiling.md`. A malformed value (`0`, negative, non-integer) falls back to the default rather than throwing |
| `grant-origination-enabled` | `policy.yml` | `/claude-tweaks:backlog refine`'s headless posture (via `bin/lib/issues/grant-gate.js`) | `false` | The reserved second opt-in `_shared/autonomy-ceiling.md` names (read as `grantOriginationEnabled` in `permittedGrants`) — `autonomy: unattended` alone never authorizes a machine-originated grant; this key is the other half. A human sets it deliberately in a project's `policy.yml`; no skill ever writes it |
| `fleet-daily-grant-cap` | `policy.yml` | `/claude-tweaks:backlog refine`'s headless posture (via `bin/lib/issues/grant-gate.js`) | unset (uncapped) | Positive integer capping how many machine grants the headless posture may issue per UTC day, counted from today-dated audit-comment markers. Absent means no cap — optional-when-absent, not a hard requirement of the machine-grant path |
| `risk-floor` | `policy.yml` | `/claude-tweaks:backlog refine`'s headless posture (via `bin/lib/issues/grant-gate.js` gate 5), `/claude-tweaks:demo`'s binary gate | `high` | `low`/`medium`/`high`/`always` — the risk tier at or above which `bin/lib/issues/oversight-floor.js`'s `exceedsOversightFloor` denies machine origination and requires a human review. `always` unconditionally denies regardless of the record's own tier. Shared with `size-floor` below — not prefixed `demo-`/`grant-`, since more than one consumer reads the same pair |
| `size-floor` | `policy.yml` | `/claude-tweaks:backlog refine`'s headless posture (via `bin/lib/issues/grant-gate.js` gate 5), `/claude-tweaks:demo`'s binary gate | `high` | `low`/`medium`/`high`/`always` — the size tier at or above which `exceedsOversightFloor` denies machine origination, symmetric with `risk-floor` above |
| `grant-sampling-every` | `policy.yml` | `/claude-tweaks:help` Stage 1 (`bin/lib/issues/grant-sampling.js`) | `10` | Flags every Nth machine-granted (audit-marker, like `fleet-daily-grant-cap`) merged record still `demo:pending`, in the Needs Attention table, with a `/claude-tweaks:demo #{n}` action (#310) |

## Dispatch & merge

Canonical defaults for the keys in this section also live in `_shared/work-record.md`'s Config keys table — if the two disagree, that file wins for these specific keys (it's the older, most-cited source); update both together.

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `dispatch-retry-ceiling` | `policy.yml` | `/claude-tweaks:dispatch` | `3` | Consecutive autonomous build failures before `bot:blocked` + `auto:*` removal |
| `dispatch-batch-size` | `policy.yml` | `/claude-tweaks:dispatch` | `3` | Default drain budget — max groups one bare `/dispatch` drain firing attempts **sequentially**, one after another (never concurrently — see #155); remainder stays unclaimed in the queue for a later firing to select. Per-firing override: `--budget <n\|all>` |
| `dispatch-pick-max-concurrent` | `policy.yml` | `/claude-tweaks:dispatch` | `3` | Deprecated alias for `dispatch-batch-size` — still resolves, emits one warn-tier notice per invocation. Removal condition: `skills/dispatch/deprecated-aliases.md` |
| `dispatch-group-size-guard` | `policy.yml` | `/claude-tweaks:dispatch` | `10` | Caps how many members a file-overlap group may have before the drain's ranking (bare, or its deprecated `next` alias) excludes it — an oversized group still resolves normally via explicit `/dispatch #N`/`#N,#M` naming (a human present, explicitly naming it, is itself the required surfacing) |
| `dispatch-fastlane-bundle-cap` | `policy.yml` | `/claude-tweaks:dispatch` | `3` | Caps how many non-overlapping `ceremony:fast-lane` singleton groups `queue-pull-script.md` folds into one multi-spec group after file-overlap grouping, sharing one preflight/wrap-up tail across the bundle instead of paying it per record — `0` turns bundling off, reproducing pre-#1910 grouping exactly |
| `auto-merge-max-lines` | `policy.yml` | `/claude-tweaks:dispatch`, `/claude-tweaks:assess-agent-autonomy` | `40` | Auto-merge blast-radius guideline (lines) — a weighted input to the `merge-check` verdict, not a hard cutoff |
| `auto-merge-max-files` | `policy.yml` | `/claude-tweaks:dispatch`, `/claude-tweaks:assess-agent-autonomy` | `2` | Auto-merge blast-radius guideline (files) — same weighted treatment |
| `merge-sensitive-paths` | `policy.yml` | `/claude-tweaks:assess-agent-autonomy`, `/claude-tweaks:review` | `[]` (empty) | Comma-separated path globs forcing a hard needs-human floor in the `merge-check` verdict, and feeding `/review`'s diff-heuristic risk proxy |
| `work-links` | `policy.yml` | Work-record system (`/claude-tweaks:dispatch`, `/claude-tweaks:wrap-up`, etc.) | `body-text` | Native sub-issue/blocked-by APIs vs. `Blocked by #N` body-text lines |
| `pr-unarmed-age-hours` | `policy.yml` | `_shared/github-pr-scan.md`'s `repo-wide` scope | `24` | How long a green, gate-passed, granted PR may sit with `--auto` unarmed before the sweep surfaces `[pr-unarmed]` |
| `unsettled-age-hours` | `policy.yml` | `_shared/github-pr-scan.md`'s `repo-wide` scope | `24` | How long a live claim or stale `bot:in-progress` may sit with no PR progress before the sweep surfaces `[unsettled]` |
| `grant-veto-window-hours` | `policy.yml` | `/claude-tweaks:dispatch`'s Auto-merge gate (`dispatch/settle-and-merge.md`), `/claude-tweaks:wrap-up`'s Auto-merge short-circuit (`wrap-up/auto-merge-short-circuit.md`) | `24` | How long a machine-granted `auto:merge-pending` grant must sit unvetoed before either site matures it to `auto:merge` (#309). `0` and negative values are schema-invalid (`min: 1`) and surface in `auditPolicy`'s invalid-values report rather than silently resolving to the default — `grant-maturation.js`'s own runtime guard still floors any absent-or-invalid value to the 24h default as belt-and-braces |
| `housekeeping-auto-merge` | `policy.yml` | `/claude-tweaks:tidy` Step 7.5 (creation-time arm, primary — #581), `_shared/github-pr-scan.md`'s `repo-wide` scope (sweep backstop, tidy PRs only), `/claude-tweaks:wrap-up`'s `residue-sweep.md` (creation-time arm only, no sweep backstop — #435) | derived from `autonomy`: `true` at `trusted`/`unattended`, else `false` | When it resolves true, tidy arms a green, marker-stamped Step-7 PR at creation (Step 7.5) — or, if that failed or the PR pre-dates the grant, via the sweep backstop; otherwise it stages like any other unarmed PR. Residue-sweep reuses the same lever for its own `<!-- wrap-up-residue-pr -->`-marked PR (same "auto-arm a housekeeping PR" semantic) but only arms at creation — the sweep backstop does not recognize that marker. An explicit key wins over the derivation in both directions (#580) |

## Review

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `review-effort-floor` | `policy.yml` | `/claude-tweaks:review` | unset (no floor) | Project-level floor (`low`/`medium`/`high`/`xhigh`/`max`) that raises (never lowers) the resolved review-effort tier |

## Documentation

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `doc-convention-adr` | `policy.yml` | `/claude-tweaks:wrap-up`'s Decision records curation row, via `_shared/existing-convention-detection.md` | unset (detect and ask on conflict) | Which convention wins when this repo's existing decision records disagree with the plugin's. `plugin` conforms forward, `project` resolves form from the corpus and any project skill. Written *by* the plugin after the user answers once at the Review Console — never a key a project fills in up front. Records **which source wins**, not a grammar, which is what keeps it flat-encodable |
| `doc-convention-tutorial` | `policy.yml` | `/claude-tweaks:wrap-up`'s Docs curation row (D2), via `_shared/existing-convention-detection.md` | unset (detect and ask on conflict) | Same shape as `doc-convention-adr`, for the Tutorial genre — written after the user answers a `[tutorial-convention]` Review Console row |
| `doc-convention-how-to` | `policy.yml` | `/claude-tweaks:wrap-up`'s Docs curation row (D2), via `_shared/existing-convention-detection.md` | unset (detect and ask on conflict) | Same shape as `doc-convention-adr`, for the How-To genre — written after the user answers a `[how-to-convention]` Review Console row |
| `doc-convention-reference` | `policy.yml` | `/claude-tweaks:wrap-up`'s Docs curation row (D2), via `_shared/existing-convention-detection.md` | unset (detect and ask on conflict) | Same shape as `doc-convention-adr`, for the Reference genre — written after the user answers a `[reference-convention]` Review Console row |
| `doc-convention-explanation` | `policy.yml` | `/claude-tweaks:wrap-up`'s Docs curation row (D2), via `_shared/existing-convention-detection.md` | unset (detect and ask on conflict) | Same shape as `doc-convention-adr`, for the Explanation genre — written after the user answers a `[explanation-convention]` Review Console row |
| `doc-convention-journey` | `policy.yml` | `/claude-tweaks:journeys` Step 2, via `_shared/existing-convention-detection.md` | unset (detect and ask on conflict) | Same shape as `doc-convention-adr`, for the Journey genre. In a pipeline run, `/claude-tweaks:journeys` stages the conflict for the Wrap-Up Review Console's `[journey-convention]` row rather than asking mid-build (journeys is not part of `/claude-tweaks:wrap-up`'s curation engine, but the console still resolves this row); invoked standalone with no pipeline run directory, `/claude-tweaks:journeys` asks and writes the key directly |

## Harness-health budgets

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `harness-health-scoped-rule-budget` | `policy.yml` | `/claude-tweaks:harness-health` | `30` | Line-count budget for path-scoped `.claude/rules/*.md` files |
| `harness-health-always-loaded-budget` | `policy.yml` | `/claude-tweaks:harness-health` | `150` | Line-count budget for CLAUDE.md and unscoped rule files |

## Health-sweep filing

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `health-open-cap` | `policy.yml` | `/claude-tweaks:code-health`, `/claude-tweaks:harness-health`, `/claude-tweaks:docs-health`, `/claude-tweaks:journey-health` — via `bin/lib/health-core/digest.js` | `10` | Per-origin open-singleton-finding cap. At or above this count, a brand-new finding that would otherwise file its own issue is appended to that origin's digest issue instead (see each skill's FILE step). A regressed-reopen always bypasses the cap. `0` disables the throttle (unconditional filing, matching pre-#235 behavior); unset applies the default — 10 |

## Code-health focus verticals

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `experiment-flag-patterns` | `policy.yml` | `/claude-tweaks:code-health` `focus=experiment-cleanup` — `bin/lib/code-health/candidates-experiment-cleanup.js` | unset (`[]` — vertical inactive) | Comma-separated regex-source strings naming this repo's own feature-flag/experiment idiom — call-site patterns (e.g. `isEnabled\(['\"]([\w.-]+)['\"]`) or registry-entry patterns, each with a first capture group that is the flag identifier. Empty/absent means the generator is inactive: the focus run reports "no flag idiom configured" and never falls back to scanning the whole repo (IL-115 — absence of configuration is not a resolution failure). Example: `experiment-flag-patterns: isEnabled\(['\"]([\w.-]+)['\"]` |
| `experiment-flag-exclude` | `policy.yml` | `/claude-tweaks:code-health` `focus=experiment-cleanup` — `bin/lib/code-health/candidates-experiment-cleanup.js` | unset (`[]`) | Comma-separated kill-switch name substrings (case-insensitive) — a flag whose identifier matches any of these, or the shipped defaults `emergency`/`circuit`/`kill`, is never emitted as a candidate regardless of how many decision signals fired. Extends the defaults, never replaces them. Example: `experiment-flag-exclude: rollback,failsafe` |

## Auto-mode levers

These resolve from `policy.yml`. `/claude-tweaks:init` does not generate them into CLAUDE.md — omitting a lever means its default, so writing every lever out contradicts the "omit means default" principle.

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `scope-creep` | `policy.yml` | `/claude-tweaks:build` | `add-to-plan` | `add-to-plan`/`stop-and-ask`/`drop` |
| `overlap` | `policy.yml` (via `/flow` Manifesto only — no standalone direct-read site exists) | `/flow` Manifesto → `/claude-tweaks:specify` | `companion` | `companion`/`extend`/`skip`/`replace` |
| `design-intent` | `policy.yml` (via `/flow` Manifesto/`config.yml`; a standalone invocation with no pipeline run dir asks the user inline instead of reading CLAUDE.md) | `/claude-tweaks:specify` | `none` | `none`/`bold`/`quiet`/`minimal`/`delightful`/`onboarding` |
| `ui-stack` | `policy.yml` (via `/claude-tweaks:specify` Step 2.5c2; a standalone invocation with no policy value asks the user inline instead) | `/claude-tweaks:specify` → `/claude-tweaks:build`/`design-wrapper` | unset (no schema default) | Free-form string — the component library/styling approach a frontend build should use (e.g. `shadcn/ui + Tailwind`), or an explicit no-preference answer. Never a fixed enum: unlike `design-intent`, there is no closed set of UI stacks to enumerate |
| `design-critique` | `policy.yml` (via `/flow` Manifesto/`config.yml`, or the resolver directly outside a pipeline run) | `/claude-tweaks:design-wrapper` `review` mode (Step 3.8 critic dispatch, #598) | `auto` | `off`/`auto`/`full` — how eagerly project-local craft critics run at review time; `auto` keys on `DESIGN.md` presence or a `Design-intent:` line, per `skills/design-wrapper/critics.md`. Critique only — writing-context assembly (`_shared/design-craft.md`) is untouched by every value |
| `leftover-default` | `policy.yml` (via `/flow` Manifesto/`config.yml` only — leftover routing is inherently pipeline-scoped, no standalone site exists) | `/claude-tweaks:wrap-up` | `defer` | `defer`/`backlog`/`drop` |
| `auto-fix-threshold` | `policy.yml` (via `/flow` Manifesto/`config.yml` only — no standalone direct-read site exists) | `/claude-tweaks:test` | `lint+type` | `lint-only`/`lint+type`/`lint+type+test` |
| `review-auto-apply-ceiling` | `policy.yml` (via `/flow` Manifesto/`config.yml` only — no standalone direct-read site exists) | `/claude-tweaks:review` | `low` | `none`/`low`/`medium` auto-apply ceiling — the maximum severity applied without asking (`medium` = Low and Medium auto-apply, High staged, Critical prompted); ceiling-conditional default at `unattended` — see `_shared/autonomy-ceiling.md` |
| `review-auto-apply-prose-exempt` | `policy.yml` — not Manifesto-collected (unlike its sibling `review-auto-apply-ceiling`); still resolves inside a piped `/flow` run via `--run "$PIPELINE_RUN_DIR"`, just with no `config.yml` entry to source from | `/claude-tweaks:review` | `true` | When `true`, a finding whose fix touches only `skills/**/*.md`/`docs/**/*.md` auto-applies one severity tier above the resolved `review-auto-apply-ceiling`, capped at `medium` — see `skills/review/step3-routing.md` |
| `specify-auto-continue` | `policy.yml` — no run dir exists at the check point (brainstorming completes before any pipeline run starts), so the resolver is invoked with no `--run` flag | `/claude-tweaks:specify` (the brainstorming → specify handoff) | `false` | When `true`, immediately invokes `/claude-tweaks:specify` on an approved, committed brainstorming design doc instead of waiting for a separate manual command — every one of `/specify`'s own decomposition-mode gates still runs, since this is the identical invocation a human would type by hand. See `skills/specify/SKILL.md`'s Auto-continue section |
| `design-ceremony` | `policy.yml` — no run dir exists at the check point (brainstorming completes before any pipeline run starts, same timing as `specify-auto-continue` above) | `/claude-tweaks:specify` (its three `/superpowers:brainstorming` invocation sites) | `standard` | `fast-lane`/`standard` — on `fast-lane`, `/specify` prepends one consolidation sentence to the `/superpowers:brainstorming` Skill-tool call's `args`, asking the Architectural path to present its remaining design sections as one consolidated block once the decision-carrying questions are answered and the approach is chosen, instead of gating each section — brainstorming's own final approval gate is never removed. Composed via `bin/compose-brainstorm-args.js`; full procedure in `specify/brainstorming-ceremony.md` |
| `tidy-aggressiveness` | `policy.yml` | `/claude-tweaks:tidy` | `moderate` | `conservative`/`moderate`/`aggressive` |
| `superpowers-plans-retention` | `policy.yml` | `/claude-tweaks:wrap-up`'s cleanup-planning item 1 (`cleanup-procedures.md`) | `keep-forever` | `keep-forever` (never delete `docs/superpowers/plans/*.md` — this plugin's own ADR-0007 convention) / `prune-after-wrapup` (delete this spec's own plan/spec file(s) as part of cleanup) / `ask` (stage the decision for the Wrap-Up Review Console) |

## Model profiles

Registered by #219; the resolver that actually reads these five is `bin/lib/model-profiles/profiles.js` (`resolve()`). Full canonical-home/owner-skill/default/meaning table: `policy-schema-model-profiles.md` (split out per IL-70 — merged branch content pushed this file over its ceiling).

| Key |
|---|
| `model-stance` |
| `frontier-run-cap` |
| `model-ceiling` |
| `model-profiles` |
| `research-mode` |

## Additional levers

These levers resolve from `.claude-tweaks/policy.yml`, like every other lever in this file. `/claude-tweaks:init`'s CLAUDE.md template generates none of them — omitting a lever means its default. `backlog-fetch-limit` also appears in `_shared/work-record-config.md`'s table — if the two disagree, that file wins for that key, per the same rule the "Dispatch & merge" section states.

| Key | Canonical home | Owner skill(s) | Default | Meaning |
|---|---|---|---|---|
| `depth-survey` | `policy.yml` | `/claude-tweaks:flow` | unset (enabled) | `off` disables the end-of-run Depth Opportunities survey project-wide (mirrors the `no-deepen` per-run flag) |
| `creative-survey` | `policy.yml` | `/claude-tweaks:flow` | unset (enabled) | `off` disables the end-of-run Creative Opportunities survey project-wide (mirrors the `no-creative` per-run flag) |
| `backlog-fetch-limit` | `policy.yml` | `/claude-tweaks:help`, `/claude-tweaks:tidy`, `/claude-tweaks:backlog` | `1000` | Cap on `gh issue list --limit` for every `_shared/record-queue-fetch.md` consumer — `gh` auto-paginates internally; this bounds how many rows before a truncation warning fires, not a hard cutoff on backlog size. The limit bounds closed-record coverage, never open completeness — when the `--state all` union hits the cap, `record-queue-fetch.md`'s read-fresh-or-fetch block completes the open set with a second `--state open` fetch (#1919), so the *open* set stays complete even when closed-record coverage is truncated at the newest `{limit}` |
| `record-snapshot-ttl-seconds` | `policy.yml` | `/claude-tweaks:backlog`, `/claude-tweaks:capture`, `/claude-tweaks:specify`, `_shared/trust-table.md`, `/claude-tweaks:help`, `/claude-tweaks:tidy`, `/claude-tweaks:visualize` | `300` | Freshness window for the session-scoped record snapshot (`_shared/record-queue-fetch.md`) — a consumer reads the cached `/tmp/ct-records-{session-id}.json` while its mtime is younger than this many seconds, and re-fetches once it ages past it |
| `scope-keywords-required` | `policy.yml` | `/claude-tweaks:build` | `false` | When `true`, `/build`'s plan-audit Check B refuses to start if any matched files aren't in the plan AND the plan/design has no `Scope keywords:` field — otherwise (default `false`) this is informational only, a warning |
| `branch-divergence-check` | `policy.yml` | `/claude-tweaks:build`, `/claude-tweaks:flow` | `true` | Pre-flight branch-divergence check — whether `/build`'s and `/flow`'s pre-flight step compares the current branch against its upstream and offers rebase-vs-continue; `false` skips this check. `merge-check` is a deprecated alias (identity `migrate`) — its collision with `/claude-tweaks:assess-agent-autonomy`'s `merge-check` verdict mode was resolved by this rename in #331 |
| `port-services` | `policy.yml` | `bin/lib/hooks/session-start.js` (`bin/lib/ports/ensure.js`) | `[]` (empty — port isolation off) | Comma-separated service names naming this checkout's own dev-server processes — the first maps to `PORT`, each later one to `{NAME}_PORT` (sanitized upper-snake-case), all offsets from one 10-port block SessionStart leases via `bin/lib/ports/registry.js` (#1791) and writes into `.env.local`/`.env`. Not an auto-mode lever — read directly by the hook, never a Manifesto question. An entry failing `^[a-z][a-z0-9-]*$` is dropped and reported, not fatal; more than 10 (the registry's `BLOCK_SIZE`) valid entries cannot fit one block and disables port isolation for the session entirely. The managed region's first line is `CLAUDE_TWEAKS_LEASE={base}` (#1927) — a stable per-checkout token a project may key non-port resources on, e.g. a test database name. |
| `release-hook` | `policy.yml` (seeded commented-out by `/claude-tweaks:init` Step 21) | `bin/release-local.js` (unit 4 of #2250) | unset | Shell command the local engine runs after `v{version}` is tagged — the project's publish/mirror/deploy hook. Not read under `pr-first`, where the `release: published` workflow is the hook (needs a PAT — `GITHUB_TOKEN`-created releases do not trigger it). Not a Manifesto lever — write it unquoted or in one matched pair of quotes; a `#` ends the value |
| `release-train` | `policy.yml` (seeded commented-out by `/claude-tweaks:init` Step 21) | `/claude-tweaks:release --train` (unit 6 of #2250) | `false` | `true` allows the unattended train to cut minor/patch releases without a click; honored only when `autonomy` resolves `unattended`, otherwise the run logs a refusal and behaves on-demand. Not a Manifesto lever |
| `specify-budget` | `policy.yml` | `/claude-tweaks:specify` | `5` | Default attempt-count budget for a bare `/specify` drain invocation with no `--budget` flag — sibling of `dispatch-batch-size` above; `n`/`all` semantics are canonical in `_shared/record-batch-input.md`'s `--budget` section (#1491) |
