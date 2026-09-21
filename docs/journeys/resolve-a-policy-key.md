---
files:
  - plugin/bin/resolve-policy.js
  - plugin/bin/lib/hooks/worktree-detect.js
  - plugin/bin/lib/policy-schema.js
  - plugin/bin/lib/policy.js
  - plugin/bin/lib/merge-verification.js
  - plugin/skills/_shared/policy-schema.md
  - plugin/skills/_shared/policy-schema-coverage.md
---

# Resolve a Policy Key Through the Canonical Read Path

**Persona:** claude-tweaks skill author (or a maintainer of a project using the plugin) who wants proof that policy resolution honors the documented precedence chain — run config, then `policy.yml`, then schema default — rather than trusting each skill's prose to have re-implemented it correctly.
**Goal:** Watch one key resolve under three configurations and confirm the returned `{value, source}` envelope changes exactly as `plugin/skills/_shared/policy-schema.md` §Canonical read path says it will.
**Entry point:** A terminal at a project checkout root (any repo with — or even without — a `.claude-tweaks/policy.yml`).
**Success state:** Three JSON objects whose `source` fields read `default`, `policy`, and `run-config` respectively, plus one `renamed-from` resolution proving the alias table is live, plus one `--all` snapshot whose every row carries `{value, source}` decorated with schema metadata, plus one direct-from-`policy.yml` read proving the enforcement hook honors the same alias table the CLI does.

## Steps

### 1. Resolve a schema default — terminal
- **URL:** `node plugin/bin/resolve-policy.js autonomy` (from this repo's checkout root — the payload lives under `plugin/` since #418; in another project, substitute the resolved plugin root per `docs/skill-authoring.md`'s plugin-root contract, which already points at the payload and so carries no `plugin/` segment)
- **Action:** Run the command in a checkout whose `policy.yml` does not set `autonomy`.
- **Should feel:** Instant and unambiguous — one JSON line, no configuration needed.
- **Should understand:** `{"autonomy":{"value":"supervised","source":"default"}}` — `source: "default"` with no `invalid` flag means known-but-unset: the value came from `POLICY_KEYS`' schema row, the single place defaults live. Two keys are the exception — `integration-model` and `merge-verification` carry no schema literal, so their `source: "default"` value is *computed* at resolve time (forge detection per `_shared/integration-model.md`; the four-branch derivation ladder in `_shared/policy-schema-coverage.md`'s `merge-verification` coverage block, run by `plugin/bin/lib/merge-verification.js`) — `node plugin/bin/resolve-policy.js --values merge-verification` on this repo prints `merge-when-green`, not an empty line. A third key derives with a different shape: `housekeeping-auto-merge` keeps its schema literal (`false`, the `supervised` base) but its unset value is derived inside `resolvePolicyKeys` from the same pass's resolved `autonomy` — on a `trusted`/`unattended` project the unset key resolves `{"value":true,"source":"default"}` (#580), and `source: "default"` is deliberately preserved so consumers can tell derived from explicit. A fourth key, `merge-authorization`, is excluded from the `policy.yml` source entirely by its own resolver special case (`#715`) — a `policy.yml` value for it is discarded outright, never merely deprioritized.
- **Red flags:** A stack trace (invocation failures are one stderr line + exit 1); an unknown key killing the whole call — `{"error":"unknown-key"}` must appear per key while siblings still resolve.

### 2. Read a configured value — `.claude-tweaks/policy.yml`
- **URL:** `node plugin/bin/resolve-policy.js autonomy worktree-always` in a checkout that sets both keys
- **Action:** Run against a project whose `policy.yml` sets `autonomy: unattended` and `worktree-always: true`.
- **Should feel:** Like one lookup replacing a grep pipeline — several keys per call, natively typed.
- **Should understand:** `source: "policy"` names the layer that decided each value; `worktree-always` comes back as boolean `true`, not the string `"true"` — coercion happens in the resolver, so no read site re-implements it. A malformed value (e.g. `trust-revert-window-days: banana`) degrades to the schema default with `"invalid": true` rather than silently activating some other source's value. A `string` key rejects whitespace by default — the rule that catches a mistyped branch name — but a schema row carrying `allowWhitespace: true` (today only `release-hook`, a shell command, #2253) accepts it, and one matched pair of surrounding quotes is stripped before validation, so `release-hook: "npm publish --access public"` resolves unquoted; a whitespace-only value is still invalid and still falls back to the default.
- **Red flags:** String-typed integers or booleans in the JSON; a deprecated key name resolving nothing — `dispatch-pick-max-concurrent: 5` must answer a request for `dispatch-batch-size` with value `5` plus `"renamed-from"`, and a pre-#332 dotted line such as `project.maturity: established` must answer a request for `project-maturity` the same way (the seven #332 renames — `review-auto-apply-ceiling`, `auto-merge-max-lines`/`-files`, `project-maturity`, `harness-health-scoped-rule-budget`/`-always-loaded-budget`, `doc-convention-adr` — are all identity aliases; a user's un-migrated `policy.yml` never silently reverts to defaults, and `/claude-tweaks:init --update`'s policy drift check — `auditPolicy` in `plugin/bin/lib/policy-schema.js` — lists each stray line under `renamedKeys` with its replacement); a quoted `release-hook` resolving with its quotes still attached, or an unmatched leading quote (an unterminated `"foo`) being silently stripped instead of left alone.

### 3. Overlay a pipeline run's config — `--run`
- **URL:** `node plugin/bin/resolve-policy.js --run "$PIPELINE_RUN_DIR" review-auto-apply-ceiling`
- **Action:** Run with `--run` pointing at an active pipeline run directory whose `config.yml` sets the requested lever.
- **Should feel:** Deterministic layering — the run's Manifesto answer wins over the project default, and `source: "run-config"` says so.
- **Should understand:** This is the whole precedence chain made mechanical: run config beats `policy.yml` beats the schema default, per key, in one call. A run dir that exists but has no `config.yml` yet is not an error — the overlay is simply absent.
- **Red flags:** A nonexistent `--run` dir resolving anything (must exit 1 with a stderr message); the overlay applying to `model-profiles` (policy-only by contract). Running this step from a **linked worktree** with a *relative* `--run` (or one pointing inside any checkout other than the main one) exits 1 with a "resolves outside the main checkout" message naming the resolved path — that is the anchored-or-outside guard (#1065, the `[IL-127]` shadow-copy protection) working as designed, not a defect; a `$PIPELINE_RUN_DIR` resolved per `_shared/pipeline-run-dir.md` is always anchored under the main checkout and passes, as does any path outside every checkout.

### 4. Snapshot the whole config — `--all`
- **URL:** `node plugin/bin/resolve-policy.js --all`
- **Action:** Run with no key arguments.
- **Should feel:** One call replacing key-by-key enumeration — the whole config, self-describing.
- **Should understand:** Every schema key returns its `{value, source}` envelope decorated with `summary`/`category`/`tier`/`type`/`default` — a JSON `null` default means no default. `--all` composes with `--run`. `--all --values` and `--all <key>` are invocation errors.
- **Red flags:** A registered key missing from the output; a row missing `summary`/`category`/`tier`; `--all` accepting key arguments.

### 5. Confirm the enforcement hook honors the same alias — `plugin/bin/lib/policy.js`
- **URL:** `node -e "console.log(require('./plugin/bin/lib/policy.js').isWorktreeAlwaysOn(process.cwd()))"`
- **Action:** Run it in a scratch checkout whose `.claude-tweaks/policy.yml` carries only the pre-#602 line `worktree.always: true`; then again with only `worktree-always: true`; then with both present and disagreeing.
- **Should feel:** The same answer every time the intent is the same — how the line is spelled is not a behavioral lever.
- **Should understand:** The PreToolUse worktree gate never calls `plugin/bin/resolve-policy.js` — it reads `policy.yml` directly through `resolveWorktreeAlways`, which consults the same `RENAMED_KEYS` table the CLI does and returns `{on, matchedKey}` rather than a bare boolean. The current name wins whenever it is present, in any file order; the retired spelling contributes only when the current one is absent. That precedence is what lets a `policy.yml` carry both lines during a migration without ambiguity. `session-start.js`'s unconditional SessionStart banner (`claude-tweaks: worktree-always: ON/OFF (matched key: {key})`) calls this same function, so its answer and the gate's answer can never disagree (`docs/incident-log.md` IL-133).
- **Red flags:** `worktree.always: true` on its own reading as policy-OFF — an un-migrated project would silently lose worktree enforcement with no error anywhere; the retired spelling winning over the current one when both are set.

## Origin
- Created during build of #329 (policy resolver CLI); step 3 and the alias red-flag in step 2 updated during build of #332 (policy-key naming convention + rename program — `review-severity-floor` → `review-auto-apply-ceiling`, seven identity aliases); step 5 added during build of #602, when the hook's own read path (`isWorktreeAlwaysOn`/`rawValue` in `plugin/bin/lib/policy.js`) became alias-aware
- No step change during build of #194 (Phase 2 doc-convention wiring) — five new keys (`doc-convention-{tutorial,how-to,reference,explanation,journey}`) were registered following `doc-convention-adr`'s exact existing shape, so step 4's `--all` snapshot already covers them with no new mechanism to demonstrate
- No step change during build of #1654 (dispatch group-size guard lever) — `dispatch-group-size-guard` was registered following `dispatch-batch-size`/`dispatch-retry-ceiling`'s exact existing `type: 'integer'` shape, so step 4's `--all` snapshot already covers it with no new mechanism to demonstrate
- Step 2 updated during build of #2253 (`release-hook`/`release-train`) — unlike #194 and #1654 above, `release-hook` did **not** follow an existing shape: it introduced `allowWhitespace` and the matched-quote strip into `resolveValue` itself, changing what the `string` type means for every key that opts in
- Corrected during build of #682 — step 5's `rawValue` helper was replaced by `resolveWorktreeAlways` (exposing `{on, matchedKey}`, consumed by both the PreToolUse gate and `session-start.js`'s new unconditional verdict banner, IL-133); step 5 updated to name the current function.
- Path-swept during build of #418 — the payload moved into `plugin/`, so every step's command and every code citation gained the `plugin/` prefix. No step's behavior, expectation, or red flag changed.
- Related specs: #328 (parent — policy read-path family), #602 (`worktree.always` → `worktree-always`, hook read path), #334 (run-config direct reads onto `--run`), #682 (`resolveWorktreeAlways` + session-start verdict banner)
