# Driver Worker Explicit Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every headless worker the pipeline driver launches gets an explicit `--model`, picked per role by the `policyOnly` policy key `express-driver-models` and resolved through `profiles.js` `resolve()` as an unattended resolution; a role with no resolvable model is refused, never launched on the account's default.

**Architecture:** `roles.js` holds `DRIVER_ROLE_PROFILES` (one default work profile per `ROLES` entry) and `POLICY_DRIVER_ROLES` (the four roles policy may set). `policy-schema.js` resolves the new block key (policy.yml only, per-role merge over the four policy roles' defaults; `explorer` keeps a code-only default). The driver's one policy read (`steps.js` `policyStep` through `express/policy.js`'s `defaultResolvePolicy`) now also returns `model-profiles` and `model-ceiling`, refuses invalid model policy before any claim, and pre-flights every role. `launch.js`'s `launchTracked` is the one resolution point: `roleModel(role, shared.policy)` → `model` passed to `launchWorker`, and returned beside the envelope so each worker-launching step writes `model` on its event line.

**Tech Stack:** Node 18+, CommonJS, `node:test`. Single-file runs: `node --test <file>`; several files: `node tools/run-tests.js <file> <file> …` (a multi-file bare `node --test` is refused by the repo guard).

**Spec:** `.claude-tweaks/pipelines/2026-11-19T062113-spec-5915-5917/spec-5917/work/5917-spec.md`

Scope keywords: launchTracked, launchJudge, defaultResolvePolicy, roleModel, DRIVER_ROLE_PROFILES, MODEL_POLICY_KEYS, express-driver-models

## Global Constraints

- Defaults (spec Deliverable 1, verbatim values): `implementer: standard`, `reviewer: capable`, `merge-check: standard`, `acceptance: standard`. `express-driver-models` accepts only those four keys (spec Plan Review Clarifications, Reading A); `explorer`, the fifth `ROLES` entry, gets the code-only default `standard` in `DRIVER_ROLE_PROFILES` and is not a settable key — a policy row naming `explorer`, or any key outside the four, is a schema error. Profile names are exactly `fast`, `standard`, `capable`, `frontier`; anything else is a schema error.
- Models are family aliases (`haiku`, `sonnet`, `opus`), never versioned ids; tests derive expected aliases from `PROFILES[...]`.model (`plugin/bin/lib/model-profiles/profiles.js`), never write them as literals except in the live probe's recorded header text.
- `resolve(profile, { policy, unattended: true })` is the only resolution; `policy` passed to it holds only `model-profiles` (the parsed map) and `model-ceiling` (a profile name) when set. `model-stance` and `frontier-run-cap` are not read: stance moves effort only (its frontier degrade equals the unattended one) and the cap is never reached because unattended degrades frontier first (`profiles.js` lines 125-136).
- Fail closed: no code path launches a worker without a `model`; a refusal is an `Error` with `code: 'DRIVER_MODEL_REFUSED'` and a message starting `no model for driver role <role>: `, thrown before `deps.launchWorker`/`deps.runner` is called.
- `driver-events.jsonl`: fields are added, never renamed. The new field is `model` (the requested alias). Every `worker` line names the model its launch was given, the launcher-throw path included: `launchTracked` attaches the resolved `model` to an error thrown after resolution (`err.model`), and the worker step reports it (Task 7). A launch-time refusal (`DRIVER_MODEL_REFUSED`, nothing resolved, nothing started) writes no `worker` line at all (spec Plan Review Clarifications, Reading A): the step returns `noLine: true`, which `defineStep` passes through and `run.js`'s loop honors by halting without emitting the step line; the final line still carries the stop (Task 6). The `review`, `merge-check` and `merge-acceptance` lines keep their own stop or verdict line on a refusal, with no `model` and the code in `detail` (unreachable in a real run: the policy step's pre-flight refuses first).
- The key is `policyOnly: true`; a run `config.yml` never sets it (it is also read from `policyRaw` only, as `risk-path-globs` is).
- This repo's `.claude-tweaks/policy.yml` is not edited (defaults apply).
- Not changed (stated, not deferred silently): the resolved profile's `effort` is not passed to the worker (`composeArgs` has no effort flag). Wrap-up files a backlog record via `/claude-tweaks:capture` if the controller judges it material.
- Commit style: `{Verb} {what} — {detail}`, body `Refs #5917`, last line the executing session's `Claude-Session:` attribution line. Stage files by explicit path.
- `RAIL_BYTES` (52,500 B): `plugin/skills/_shared/policy-schema.md` is 51,129 B; Task 2 adds about 200 B (headroom ≈ 1,170 B left). `policy-schema-model-profiles.md` 2,730 B → about 3,600 B. `policy-schema-coverage.md` 44,447 B → about 44,480 B.
- Governing skill `.claude/skills/policy-key-addition`, quoted verbatim:
  - "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion"
  - "Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary`"
  - "State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
  - "A malformed value arrives as `source: 'default'` with `invalid: true`, never as a non-default source, so a `source !== 'default'` guard never sees it. Key such a guard on `invalid`, and build its test fixture from a real `resolvePolicyKeys` reply rather than a hand-written one"
  - "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s \"Canonical read path carve-outs\"" and "is also named in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`"
  - "**A block key's resolver and audit must cut comments the same way.** … A new map key reuses one of the two rules rather than writing a third: `stripComment` (a `#` anywhere ends the line) when no value can hold `#`"
  - "**A key joining a family reaches only the callers that list it.** … export one key-list constant beside the consumer … and route each caller through it."
- Governing skill `.claude/skills/driver-step-addition`, quoted verbatim:
  - "Event fields may be added but never renamed, because the settle unit reads the final line's `stop`"
  - "Every comparison with those captures goes through `baselineCalls`" and "Capture the happy path's call signatures, event `[step, status]` pairs and per-line key sets on the unmodified code as literal constants (`BASE_CALLS_PLAIN`, `BASE_CALLS_FIX`, `BASE_LINES_*`, `BASE_KEYS_*` in `run.test.js`)."
  - "Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`"
  - "Launch workers through `plugin/bin/lib/driver/launch.js` (`readCeilings`, `launchTracked`, `WIN32_CLAUDE_BIN`). Never copy the launch wiring."
  - "`docs/driver.md` | Copied by hand. A few tests in `run.test.js` pin named rules in it"
  - No step, stop class or durable side effect is added, so the `STEP_NAMES`, `interruptClass` and settle sites do not apply. The one loop change is the generic `noLine` result flag (Task 6); it names no step, so `AC13.1`'s step-literal scan of `run.js` stays clean.
- Governing skill `.claude/skills/headless-worker-launch`, quoted verbatim:
  - "Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off."
  - "A new launch site calls `launchTracked` rather than wrapping the runner itself."
  - Anti-pattern row: "A live smoke or probe prompt that leaves the worker to phrase its own Bash commands | The model rewrites them … tell it to run each command exactly as written, as the `AC7` prompt does"
  - Anti-pattern row: "Writing a schema `required` list or a field list as an array literal that starts with `'status'` | `tests/git-status-optional-locks.test.js` reads it as a git argument list"
- `_shared/auto-mode-contract.md` "Adding a new policy lever" walk (Deliverable 1): items 1-4 do not apply — `express-driver-models` is not a Manifesto lever (no `express-driver*` key appears in `flow/manifesto.md`, `flow/manifesto-overrides.md`, `help/reference-card.md`, `help/context-flow.md` or `auto-mode-contract.md`; grep run while authoring returned 0 hits in each); item 5, the enforcement site, is `plugin/bin/lib/driver/launch.js` (Tasks 4 and 6). Task 2's verify step runs the checklist's grep.

## Scope-keyword hits classified no-change

- `plugin/bin/lib/driver/run.js` — `realDeps.resolvePolicy` (line 656) already routes to `defaultResolvePolicy`, which Task 3 changes; `newCtx`, `interruptClass` and `finalEvent` need nothing (no new side effect, the final line is unchanged). Its step loop (line 432) is modified by Task 6 for `noLine`.
- `plugin/bin/lib/express/cli.js`, `plugin/bin/lib/express/queue.js` — call `defaultResolvePolicy` without `model-profiles`, so Task 3's overlay never runs for them.
- `plugin/bin/lib/wrap-up/pack.js`, `tests/bin-lib/wrap-up/pack.test.js` — a different, same-named `defaultResolvePolicy`; untouched.
- `docs/journeys/launch-a-rights-limited-headless-worker-5217.md` — says every driver launch goes through `launchTracked`; still true.

## Assumptions verified while authoring

- policy-step (spec Gotcha 7) — **reversed in part.** `steps.js:197` stores `deps.resolvePolicy(POLICY_KEYS.slice())` as `{key: {value, source}}` (`steps.js:219`), not the raw policy object `resolve()` takes, and `POLICY_KEYS` (`steps.js:119-124`) holds no model key. Worse, the driver's resolver (`express/policy.js:37-40` → `policy-schema.js` `resolvePolicyConfig`) returns `model-profiles` as the placeholder `{value: null, source: 'default'}` (`policy-schema.js:677-680`); only the CLI core overwrites it (`resolve-policy.js:164-177`). Plan: add `MODEL_POLICY_KEYS` to `POLICY_KEYS` (Task 6), make `defaultResolvePolicy` overlay `model-profiles` from the `policyRaw` it already read (Task 3), and build `resolve()`'s `policy` from the entries' `.value`s inside `roleModel` (Task 4) — still one policy read.
- stop-class (spec Gotcha 8) — **confirmed for the implementer, partly for the others.** A launcher throw in `launchImplementerAndCheck` is rethrown (`steps.js:741-748`) and `defineStep`'s catch turns it into `fail` with `detail: err.message` and the worker step's class `pre-push` (`steps.js:138-139`), which `stopObject` copies to the final line's `stop.detail` (`run.js:251`); outcome `express-escalated`. `review.js:782-785` turns any throw into `reviewer launch failed${codeSuffix(err)}` (codeSuffix, `review.js:1035`, appends an `[A-Z0-9_]+` code), so a `DRIVER_MODEL_REFUSED` code reaches the review line. `judgment-io.js:95-97` drops the error (`${label} launch failed`); Task 7 appends the code. No new stop class is needed. Because Task 6's policy-step pre-flight resolves every role before the claim, a model refusal in a real run stops at `policy` (class `refused`, nothing written, the role named in `stop.detail`); the launch-time refusal stays as the second layer, and in the worker step it no longer travels the throw path above: `launchImplementerAndCheck` returns `{ status: 'fail', detail: err.message, noLine: true }` for it, so no `worker` line is written while the final line keeps `stop.step: 'worker'`, class `pre-push` and the refusal as `stop.detail`.
- unknown-key (spec Gotcha 9) — **confirmed.** An older build never requests the key (`resolvePolicyKeys` resolves only requested keys, `policy-schema.js:672-765`); `parseFlatLines` drops a key line with an empty value and skips indented lines (`policy-schema.js:424-446`), and `auditPolicy`'s only block reads are `model-profiles` (`extractMapEntry`, `policy-schema.js:1014`) and `risk-path-globs` (`policy-schema.js:1064`), so `unrecognizedKeys` never names it. No other reader flags policy.yml keys (grep `unrecognizedKeys` / `auditPolicy(`: only `help/policy.md`, `harness-health/SKILL.md`, `init/*` call `auditPolicy`). Moot for this record anyway: the plan does not commit the key to `.claude-tweaks/policy.yml`.

## Premise departures

- Spec: `ROLES` has four roles (lines 244-249). Tree: five — `explorer` too (`roles.js:260-266`), with no driver launch site. Plan (user decision, Reading A): `DRIVER_ROLE_PROFILES` covers all five, `explorer` with a code-only `standard`; the policy map accepts only the four spec roles (`POLICY_DRIVER_ROLES`); AC6's test stays a total check over `ROLES`.
- Spec: the resolved map comes straight from `resolve()`'s policy. Plan: `model-profiles` needs a resolver change first (Task 3), because the driver's read path never returned it.
- Spec Key Files list `judgment-io.js` for "the judgment workers' event lines"; those lines are emitted by `judgments.js` (`merge-check`) and `acceptance.js` (`merge-acceptance`), which Task 8 modifies.

## Acceptance coverage

- AC1.1 → Task 6 tests `AC1.1: unset key composes --model <standard> for the implementer and <capable> for the reviewer` (launch.test.js, real `launchWorker` argv) and `AC1.1 (driver): …` (run.test.js).
- AC2.1 → Task 6 test `AC2.1: implementer: fast in policy.yml composes --model <fast>`; resolver half in Task 2 test `AC2.1: a policy.yml block sets one role and keeps the others`.
- AC2.2 → Task 2 tests `AC2.2: a run config block never sets express-driver-models` (lib and CLI `--run`); Task 6 test `AC2.2: the same block in config.yml composes the default model`.
- AC3.1 → Task 4 test `AC3.1: model-ceiling standard clamps the reviewer to the standard model`; Task 6 argv test `AC3.1 (argv)`.
- AC4.1 → Task 4 test `AC4.1: frontier resolves to the capable model (unattended)`.
- AC5.1 → Task 4 tests `AC5.1: a role absent from the map is refused, naming it` / `AC5.1: a resolve() throw is refused, naming the role`; Task 6 tests `AC5.1: launchTracked refuses before any runner call`, `AC5.1 (driver): a role missing from the resolved map stops the run at the policy step, final line names it` and `AC5.1 (driver): a launch-time refusal writes no worker line, the final line names the role`.
- AC6.1 → Task 1 test `AC6.1: every ROLES entry has a default profile` plus its go-red control.
- AC7.1 → Task 7 tests `AC7.1: every worker line carries the model its launch was given`, `AC7.1: a worker launch that returns no envelope still names its model` and `AC7.1: a launcher that throws after the model resolved still names it`; the refused launch's absent line is Task 6's `AC5.1 (driver)` test above.
- AC8.1 → Task 10 (live probe, recorded in `worker.js`'s header).
- Read only, not modified: `plugin/bin/lib/model-profiles/profiles.js` (Global Constraints cite its stages; `roleModel` calls `resolve()` unchanged) and `plugin/skills/_shared/auto-mode-contract.md` (checklist walk in Global Constraints).
- Waived `.claude/skills/policy-key-addition`, `.claude/skills/driver-step-addition`, `.claude/skills/headless-worker-launch`: read only; quoted in Global Constraints.
- Waived `.claude-tweaks/policy.yml`: read only for Gotcha 9; not modified (see Assumptions).

## Review Focus

1. A malformed `express-driver-models` block (unknown role — `explorer` included —, unknown profile, repeated role, inline value, tab or 4-space indent) must refuse the run at the policy step, never fall back to defaults — Task 2 parser tests and Task 6 `invalid model policy` test.
2. A `model-profiles` row naming a non-alias model (`claude-sonnet-4-5`) must refuse (resolve throws in `profileOfModel`) before the claim, while a malformed sibling key the driver never reads (`frontier-run-cap: abc`) must not refuse anything or be blamed on `model-profiles` — Task 3, Task 4 and Task 6 tests.
3. A hand-built `shared.policy` without the model keys (another caller, a future step) must refuse, not launch on the account default — Task 4 `role map unreadable` test, Task 6 `AC5.1` launchTracked test.
4. The review fix round's implementer launch must not overwrite the `review` line's `model` (the reviewer's) — Task 7 test on the fix rig.
5. A floor-decided merge-check (no launch) must keep its event extra exactly `{ verdict, floor }` (no `model: undefined`) — Task 8 characterization of `judgments-merge-check.test.js:315`.

---

### Task 1: Default work profile per driver role

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/driver/roles.js` (beside `ROLES`, ~line 260; `module.exports`, line 476)
- Test: `tests/bin-lib/driver/roles.test.js`

**Interfaces:**
- Produces, exported from `roles.js`:
  - `DRIVER_ROLE_PROFILES` — deep-frozen `{ implementer: 'standard', reviewer: 'capable', explorer: 'standard', 'merge-check': 'standard', acceptance: 'standard' }` (every `ROLES` entry; `explorer`'s row is code-only).
  - `POLICY_DRIVER_ROLES` — frozen `['implementer', 'reviewer', 'merge-check', 'acceptance']`, the only roles `express-driver-models` may set.

- [ ] **Step 1: Write the failing tests** in `roles.test.js` (import `DRIVER_ROLE_PROFILES`, `POLICY_DRIVER_ROLES`, `ROLES` from roles.js, `PROFILES` from `plugin/bin/lib/model-profiles/profiles.js`). Besides the block below: `POLICY_DRIVER_ROLES: exactly the four spec roles, each in ROLES` — `assert.deepStrictEqual([...POLICY_DRIVER_ROLES], ['implementer', 'reviewer', 'merge-check', 'acceptance'])`, every entry `Object.hasOwn(ROLES, r)`, `!POLICY_DRIVER_ROLES.includes('explorer')`, `Object.isFrozen(POLICY_DRIVER_ROLES)`.

```js
// One assertion function, shared by the pin and its go-red control.
function assertEveryRoleHasProfile(roles, profiles) {
  assert.deepStrictEqual(Object.keys(profiles).sort(), Object.keys(roles).sort());
  for (const [role, profile] of Object.entries(profiles)) assert.ok(Object.hasOwn(PROFILES, profile), `${role}: ${profile}`);
}
test('AC6.1: every ROLES entry has a default profile', () => {
  assertEveryRoleHasProfile(ROLES, DRIVER_ROLE_PROFILES);
  assert.deepStrictEqual({ ...DRIVER_ROLE_PROFILES }, { implementer: 'standard', reviewer: 'capable', explorer: 'standard', 'merge-check': 'standard', acceptance: 'standard' });
  assert.ok(Object.isFrozen(DRIVER_ROLE_PROFILES));
});
test('AC6.1 (go-red control): a role added to ROLES without a default fails the check', () => {
  assert.throws(() => assertEveryRoleHasProfile({ ...ROLES, scout: { tools: ['Read'], settings: false } }, DRIVER_ROLE_PROFILES));
  assert.throws(() => assertEveryRoleHasProfile(ROLES, { ...DRIVER_ROLE_PROFILES, reviewer: 'turbo' }));
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `node --test tests/bin-lib/driver/roles.test.js`
Expected: FAIL after Step 1 — `DRIVER_ROLE_PROFILES` is undefined (`Cannot convert undefined or null to object`).

- [ ] **Step 3: Implement** — add `DRIVER_ROLE_PROFILES` and `POLICY_DRIVER_ROLES` with `deepFreeze` directly under `ROLES`, with a comment: the work profile each role launches on unless policy `express-driver-models` overrides it (#5917), which it may only for the four `POLICY_DRIVER_ROLES` (`explorer` keeps its code-only row); `launch.js` resolves it through `profiles.js`; a new role needs a row here (AC6.1). Export both.

- [ ] **Step 4: Run to verify it passes** — same command; Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/driver/roles.js tests/bin-lib/driver/roles.test.js`; message `Add a default work profile per driver role — DRIVER_ROLE_PROFILES and the policy-settable roles beside ROLES`.

### Task 2: The `express-driver-models` policy key

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (new `POLICY_KEYS` row after `model-profiles` ~line 264; new `parseDriverModels`; a `resolvePolicyKeys` branch beside `risk-path-globs` ~line 681; an `auditPolicy` check beside the `risk-path-globs` one ~line 1064; export `parseDriverModels`)
- Modify: `plugin/skills/_shared/policy-schema.md` (`## Model profiles`: key-only row `` | `express-driver-models` | `` after `model-profiles`, and the intro sentence names it)
- Modify: `plugin/skills/_shared/policy-schema-model-profiles.md` (the full row)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` line 102 (`policyOnly` bullet gains `` `express-driver-models` ``)
- Test: `tests/policy-schema.test.js`
- Consumers enumerated (`git grep -n "type === 'map'"`, `BLOCK_KEYS`): `resolve-policy.js:76` derives `--values` refusal from `type: 'map'` rows (automatic, tested below); `tests/resolve-policy-control-mode.test.js:93-104` parity test runs every non-special key through lib and CLI — the key resolves inside `resolvePolicyKeys`, so it joins the parity check with no edit; `tests/resolve-policy-cli.test.js:238-255` `--all` compares `entry.default` with `row.default` — a plain object, deep-equal.

**Interfaces:**
- Consumes: `DRIVER_ROLE_PROFILES`, `POLICY_DRIVER_ROLES` (Task 1; `policy-schema.js` requires `./driver/roles`, which requires only `path-guard`).
- Produces: `POLICY_DRIVER_DEFAULTS` (in `policy-schema.js`, frozen) = `Object.fromEntries(POLICY_DRIVER_ROLES.map((r) => [r, DRIVER_ROLE_PROFILES[r]]))`, i.e. `{ implementer: 'standard', reviewer: 'capable', 'merge-check': 'standard', acceptance: 'standard' }` — no `explorer`. `resolvePolicyKeys(['express-driver-models'], { policyRaw, runConfigRaw })` →
  - unset: `{ value: { ...POLICY_DRIVER_DEFAULTS }, source: 'default' }`
  - a valid block: `{ value: { ...POLICY_DRIVER_DEFAULTS, ...rows }, source: 'policy' }` (an empty block: the four defaults, `source: 'policy'`)
  - a rejected block (including any row keyed `explorer` or another non-four role): `{ value: null, source: 'default', invalid: true }`, `onInvalid(key, raw)` called
  - `parseDriverModels(policyRaw)` → `{ present: false }` | `{ present: true, ok: true, value }` | `{ present: true, ok: false, raw }`.
- POLICY_KEYS row: `{ key: 'express-driver-models', type: 'map', keys: POLICY_DRIVER_ROLES, default: POLICY_DRIVER_DEFAULTS, policyOnly: true, summary: "Picks the work profile each pipeline driver worker role launches on; a role left out keeps its shipped default.", category: 'models', tier: 'advanced' }`, with a comment above stating the `policyOnly` decision (it chooses the model autonomous machinery spends on, so a `--run` config never sets it) and that the block is read from `policy.yml` only, like `risk-path-globs`.

- [ ] **Step 1: Write the failing tests** in `tests/policy-schema.test.js` (`const MODELS = 'express-driver-models'`; `const FOUR = { implementer: 'standard', reviewer: 'capable', 'merge-check': 'standard', acceptance: 'standard' }`; `r = (policyRaw, runConfigRaw = null) => resolvePolicyKeys([MODELS], { policyRaw, runConfigRaw })[MODELS]`):
  - Count pin: `// Last bump: 112 -> 113, #5917` and `112` → `113` on both assertions (line 46-48).
  - `express-driver-models: unset resolves the four spec roles' defaults, no explorer` — `r('')` deep-equals `{ value: FOUR, source: 'default' }` and `!Object.hasOwn(r('').value, 'explorer')`.
  - `AC2.1: a policy.yml block sets one role and keeps the others` — `r('express-driver-models:\n  implementer: fast\n')` deep-equals `{ value: { ...FOUR, implementer: 'fast' }, source: 'policy' }`; same with CRLF endings and `express-driver-models:   # note\r\n  reviewer: standard   # why\r\n` → reviewer `standard`.
  - `express-driver-models: a rejected block resolves null invalid, never a partial map` — each of these resolves `{ value: null, source: 'default', invalid: true }`: `'express-driver-models: fast\n'` (inline), `'express-driver-models:\n  scout: fast\n'` (unknown role), `'express-driver-models:\n  explorer: fast\n'` and `'express-driver-models:\n  implementer: fast\n  explorer: capable\n'` (`explorer` is not settable), `'express-driver-models:\n  implementer: turbo\n'` (unknown profile), `'express-driver-models:\n  implementer: fast\n  implementer: capable\n'` (repeat), `'express-driver-models:\n    implementer: fast\n'` (4-space), `'express-driver-models:\n\timplementer: fast\n'` (tab), `'express-driver-models:\n  implementer:\n'` (no value), `'express-driver-models:\n  implementer: fast\nexpress-driver-models:\n  reviewer: fast\n'` (second block). A block followed by a flat key ends at the dedent: `'express-driver-models:\n  implementer: fast\nautonomy: trusted\n'` → valid, implementer `fast`.
  - `AC2.2: a run config block never sets express-driver-models` — `r('', 'express-driver-models:\n  implementer: fast\n')` → defaults with `source: 'default'`; `r('express-driver-models:\n  reviewer: standard\n', 'express-driver-models:\n  implementer: fast\n').value.implementer === 'standard'`.
  - `AC2.2 via the CLI: resolve-policy.js --run ignores the block in config.yml` — with the file's `tmpRepo`/`driverCli` helpers and a run dir whose `config.yml` holds the block: `JSON.parse(stdout)[MODELS]` deep-equals the unset default entry.
  - `express-driver-models: --values refuses it, as a block key` — `driverCli(['--values', MODELS], repo)` exits non-zero with stderr matching `/--values does not support express-driver-models \(no scalar form\)/`.
  - `express-driver-models: registered policyOnly, advanced, models, map keyed by the four policy roles` — row shape checks, including `assert.deepStrictEqual([...row.keys], ['implementer', 'reviewer', 'merge-check', 'acceptance'])` and `assert.deepStrictEqual({ ...row.default }, FOUR)`.
  - `express-driver-models: auditPolicy flags an explorer row` — `writePolicy(repo, 'express-driver-models:\n  explorer: fast\n')` → exactly one `invalidValues` row with that key.
  - `express-driver-models: auditPolicy flags a rejected block once and a valid one never` — `writePolicy(repo, 'express-driver-models:\n  implementer: turbo\n')` → exactly one `invalidValues` row with that key; `'express-driver-models: fast\n'` → exactly one (the flat loop sees it first); a valid block → none, and `unrecognizedKeys` is `[]` in all three.
  - `express-driver-models: the pre-change flat reader sees nothing of the block` — `parseFlatLines('express-driver-models:\n  implementer: fast\n')` deep-equals `{}` (`parseFlatLines` is exported and unchanged by this record: it is the code an older release runs).
  - `AC11.4`-style: the `policyOnly` bullet line in `_shared/policy-schema-coverage.md` includes `` `express-driver-models` ``.

- [ ] **Step 2: Run to verify they fail**
Run: `node --test tests/policy-schema.test.js`
Expected: FAIL after Step 1 — count `112 !== 113`, and `r('')` returns `{ error: 'unknown-key' }`.

- [ ] **Step 3: Implement** — the row; `parseDriverModels(policyRaw)` using `stripComment` from `./model-profiles/policy-fragment` (no row or value can hold `#`): a column-0 line whose stripped text is exactly `express-driver-models:` opens the block (one with text after the colon → present, rejected); a second opening line → rejected; rows until the first non-blank column-0 line, comment-only and blank lines skipped; each row must match `/^ {2}([a-z-]+):[ \t]*([a-z]+)$/` with the role in `POLICY_DRIVER_ROLES` (so `explorer` is rejected), the profile in `PROFILE_NAMES`, no repeat; `raw` is the block's lines joined (as `parseRiskPathGlobs` reports it). In `resolvePolicyKeys`, a branch before the alias lookup (beside `risk-path-globs`) reads `policyRaw` only and returns the three shapes above. In `auditPolicy`, after the `risk-path-globs` check: a present-and-rejected block pushes `{ key, value: raw, expected: row }` unless the flat loop already flagged the key. Docs: `policy-schema.md` — key-only row and change the intro to "reads four of these six … `express-driver-models` (#5917) picks the profile each pipeline driver worker role resolves through it"; `policy-schema-model-profiles.md` — the full row: canonical home `policy.yml`; owners `bin/drive.js` (#5917), `bin/lib/driver/launch.js`; default `implementer: standard`, `reviewer: capable`, `merge-check: standard`, `acceptance: standard`; meaning: an indented block of `role: profile` rows for those four roles only (`fast`/`standard`/`capable`/`frontier`), a role left out keeps its default; the driver's `explorer` role is not a key (its `standard` default lives in code, `roles.js` `DRIVER_ROLE_PROFILES`); resolved through `resolve()` as an unattended launch, so `model-profiles` rows and `model-ceiling` apply and `frontier` launches on the Capable model; unset resolves the four defaults with `source: default`; an inline value, an unknown role (`explorer` included) or profile, a repeated role, a mis-indented row or a second block resolves `null` with `invalid: true`, and `drive.js` then refuses the run at its policy step; `policyOnly`. Coverage bullet: add the key to the `policyOnly` list.

- [ ] **Step 4: Run to verify they pass**
Run: `node tools/run-tests.js tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/resolve-policy-cli.test.js tests/resolve-policy-control-mode.test.js tests/bin-lib/model-profiles/policy-keys-registration.test.js`
Expected: PASS, 0 failures.
Then the checklist grep: `git grep -n -c "express-driver-models" -- plugin/skills CLAUDE.md` — expected hits in `_shared/policy-schema.md`, `_shared/policy-schema-model-profiles.md`, `_shared/policy-schema-coverage.md`; `wc -c plugin/skills/_shared/policy-schema.md` under 52,500.
Real-input probe: `node -e "const s=require('./plugin/bin/lib/policy-schema'); console.log(JSON.stringify(s.parseDriverModels(require('fs').readFileSync('.claude-tweaks/policy.yml','utf8'))), JSON.stringify(s.auditPolicy(process.cwd()).invalidValues))"` — expected `{"present":false}` and no `express-driver-models` row (this repo sets none).

- [ ] **Step 5: Commit** — the five files; message `Add the express-driver-models policy key — per-role work profile for driver workers, policyOnly block`.

### Task 3: The driver's policy read returns `model-profiles`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/model-profiles/policy-fragment.js` (export `modelProfilesEntry`)
- Modify: `plugin/bin/resolve-policy.js` lines 160-177 (call `modelProfilesEntry` instead of the inline block)
- Modify: `plugin/bin/lib/express/policy.js` (`defaultResolvePolicy`: overlay when `keys` includes `model-profiles`, from the `policyRaw` `resolvePolicyConfig` already returns)
- Test: `tests/bin-lib/model-profiles/policy-fragment.test.js`
- Test: `tests/bin-lib/express/policy.test.js`
- Consumers enumerated (`git grep -n defaultResolvePolicy`): `driver/run.js:656` (the driver, the target), `express/cli.js:487` and `express/queue.js:23` (neither requests `model-profiles`, so unchanged); `wrap-up/pack.js:108` is a different function of the same name.

**Interfaces:**
- Produces: `modelProfilesEntry(policyRaw: string|null)` → `{ value: map, source: 'policy' }` when the block is present, `{ value: null, source: 'default' }` when absent, `{ value: null, source: 'default', invalid: true }` when the block itself is malformed. It parses **only the `model-profiles` block**: it cuts the block's text (the column-0 line whose `stripComment` text is `model-profiles:` through the line before the next non-blank column-0 line; the last such block when there are several, matching `parsePolicyModelConfig`'s last-wins assignment) and runs `parsePolicyModelConfig` on that text alone, so a malformed sibling key (`frontier-run-cap: abc`, `model-stance` text) never marks `model-profiles` invalid. Decision (plan review finding b): this replaces the old catch-all, under which a bad `frontier-run-cap` would have refused every driver run as `driver model policy invalid: model-profiles`, blaming the wrong key; `resolve-policy.js`'s JSON output changes the same way for that case (its comment at lines 171-176 documented the catch-all as a known gap, and no test pins it: `git grep -n frontier-run-cap -- tests/resolve-policy-*.test.js tests/fixtures/resolve-policy` prints nothing). `parsePolicyModelConfig` itself and `resolve-profile.js` are unchanged. `defaultResolvePolicy(keys)` returns that entry for `model-profiles`.

- [ ] **Step 1: Characterize, then write the failing tests** — before editing, run `node --test tests/resolve-policy-cli.test.js` and record that `AC 9: model-profiles absent -> null/default; present -> parsed rows with source policy` and `model-profiles malformed block resolves to null/default with invalid: true` pass; they pin the CLI behavior the refactor must keep. Then:
  - `policy-fragment.test.js`: `modelProfilesEntry: present, absent and malformed` — `modelProfilesEntry('model-profiles:\n  standard:\n    model: opus\n')` → `{ value: { standard: { model: 'opus' } }, source: 'policy' }`; `modelProfilesEntry(null)` and `('autonomy: trusted\n')` → `{ value: null, source: 'default' }`; `('model-profiles:\n  standard:\n    speed: x\n')` → `{ value: null, source: 'default', invalid: true }`.
  - `policy-fragment.test.js`: `modelProfilesEntry: a malformed sibling key never marks the block invalid` — `modelProfilesEntry('frontier-run-cap: abc\nmodel-profiles:\n  standard:\n    model: haiku\n')` → `{ value: { standard: { model: 'haiku' } }, source: 'policy' }`; `modelProfilesEntry('frontier-run-cap: abc\n')` → `{ value: null, source: 'default' }` (no `invalid`); `modelProfilesEntry('model-profiles:\n  standard:\n    effort: low\nfrontier-run-cap: 5 agents\n')` → `source: 'policy'`, `value: { standard: { effort: 'low' } }`. Discrimination: with the old catch-all (whole-file `parsePolicyModelConfig`) the first and third cases resolve `invalid: true`, so these go red if the cut is removed.
  - `express/policy.test.js`, following the existing test's chdir pattern: `defaultResolvePolicy returns the model-profiles block the CLI returns (#5917)` — fixture repo with `.claude-tweaks/policy.yml` = `model-profiles:\n  standard:\n    model: opus\nmodel-ceiling: capable\n`; `defaultResolvePolicy(['model-profiles', 'model-ceiling'])` deep-equals `{ 'model-profiles': { value: { standard: { model: 'opus' } }, source: 'policy' }, 'model-ceiling': { value: 'capable', source: 'policy' } }`.

- [ ] **Step 2: Run to verify they fail**
Run: `node --test tests/bin-lib/model-profiles/policy-fragment.test.js`
Expected: FAIL after Step 1 — `modelProfilesEntry is not a function`.
Run: `node --test tests/bin-lib/express/policy.test.js`
Expected: FAIL after Step 1 — `model-profiles` resolves `{ value: null, source: 'default' }`.

- [ ] **Step 3: Implement** — `modelProfilesEntry` per Interfaces (the block cut uses `stripComment`, the one comment rule both block readers share); `resolve-policy.js` keeps its `keys.includes('model-profiles')` guard, assigns `modelProfilesEntry(policyRaw)`, and its comment drops the "a malformed sibling model key … lands here" sentence in favour of "only the block is parsed (#5917)"; `defaultResolvePolicy` destructures `policyRaw` from `resolvePolicyConfig` and applies the same guard after `computeDerivedDefaults`.

- [ ] **Step 4: Run to verify they pass**
Run: `node tools/run-tests.js tests/bin-lib/model-profiles/policy-fragment.test.js tests/bin-lib/express/policy.test.js tests/resolve-policy-cli.test.js tests/resolve-policy-lib.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS, 0 failures (`resolve-policy-lib.test.js:203`'s placeholder pin on `resolvePolicyKeys` stays true: that function is unchanged).

- [ ] **Step 5: Commit** — the five files; message `Return model-profiles from the driver's policy read — one shared reader for the CLI and defaultResolvePolicy`.

### Task 4: `roleModel` — one role's model from the resolved policy

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/launch.js`
- Create: `tests/bin-lib/driver/launch.test.js`

**Interfaces:**
- Consumes: `DRIVER_ROLE_PROFILES`, `POLICY_DRIVER_ROLES` (Task 1); `resolve` from `../model-profiles/profiles`; `neutralize` from `./events`.
- Produces (exported from `launch.js`):
  - `MODEL_POLICY_KEYS = Object.freeze(['express-driver-models', 'model-profiles', 'model-ceiling'])`
  - `MODEL_REFUSED_CODE = 'DRIVER_MODEL_REFUSED'`
  - `roleModel(role, policy) → string` (a family alias). `policy` is the policy step's `{ [key]: { value, source, invalid? } }`. Throws `Error` with `code: MODEL_REFUSED_CODE` and message `no model for driver role ${neutralize(String(role))}: ${why}`, `why` one of `role map unreadable` (a `POLICY_DRIVER_ROLES` role whose `express-driver-models` entry is missing or whose value is not a plain object), `no work profile in the role map` (a `POLICY_DRIVER_ROLES` role absent from that value, or a role in neither `POLICY_DRIVER_ROLES` nor `DRIVER_ROLE_PROFILES`), `profile ${profile} did not resolve (${neutralize(err.message)})`. The profile is `value[role]` for a `POLICY_DRIVER_ROLES` role and `DRIVER_ROLE_PROFILES[role]` for any other `ROLES` entry (today only `explorer`, whose default is code-only). Calls `resolve(profile, { policy: <only the set ones of 'model-profiles' (plain object) and 'model-ceiling' (non-empty string)>, unattended: true })`.
  - `modelPolicyRefusal(policy) → string|null`: `driver model policy invalid: ${key}` for the first `MODEL_POLICY_KEYS` entry with `invalid: true`; else the message of the first `roleModel(role, policy)` refusal over `Object.keys(DRIVER_ROLE_PROFILES)`; else `null`.

- [ ] **Step 1: Write the failing tests** in `launch.test.js`. `FOUR` is the literal four-role default map (as in Task 2). Fixtures come from real resolver replies: `const policyFrom = (policyRaw) => ({ ...resolvePolicyKeys(MODEL_POLICY_KEYS, { policyRaw }), 'model-profiles': modelProfilesEntry(policyRaw) });` (`resolvePolicyKeys` from `plugin/bin/lib/policy-schema.js`, `modelProfilesEntry` from Task 3). `M = (p) => PROFILES[p].model`.
  - `roleModel: every role resolves its default with the key unset` — for each `[role, p]` of `DRIVER_ROLE_PROFILES`: `roleModel(role, policyFrom('')) === M(p === 'frontier' ? 'capable' : p)`; reviewer is `M('capable')`, implementer `M('standard')`.
  - `roleModel: a policy row overrides one role` — `policyFrom('express-driver-models:\n  implementer: fast\n')`: implementer `M('fast')`, reviewer still `M('capable')`.
  - `roleModel: explorer resolves its code-only default, whatever the role map holds` — `roleModel('explorer', policyFrom('')) === M('standard')`, and the same with `'express-driver-models': { value: { ...FOUR, implementer: 'fast' }, source: 'policy' }` and with a role map lacking every key (`{ value: {}, source: 'policy' }`).
  - `roleModel: a malformed sibling key the driver never reads changes nothing` — `policyFrom('frontier-run-cap: abc\n')`: every role resolves its default and `modelPolicyRefusal` returns `null`; `policyFrom('frontier-run-cap: abc\nmodel-profiles:\n  standard:\n    model: haiku\n')`: implementer `M('fast')` (the block still applies).
  - `AC3.1: model-ceiling standard clamps the reviewer to the standard model` — `roleModel('reviewer', policyFrom('model-ceiling: standard\n')) === M('standard')`.
  - `AC4.1: frontier resolves to the capable model (unattended)` — `roleModel('reviewer', policyFrom('express-driver-models:\n  reviewer: frontier\n')) === M('capable')`.
  - `roleModel: a model-profiles row applies` — `policyFrom('model-profiles:\n  standard:\n    model: haiku\n')`: implementer `'haiku'` is asserted as `M('fast')`.
  - `AC5.1: a role absent from the map is refused, naming it` — `assert.throws(() => roleModel('ghost', policyFrom('')), (e) => e.code === MODEL_REFUSED_CODE && e.message === 'no model for driver role ghost: no work profile in the role map')`; and with `{ ...policyFrom(''), 'express-driver-models': { value: { reviewer: 'capable' }, source: 'policy' } }` the implementer is refused with the same `why`.
  - `AC5.1: a resolve() throw is refused, naming the role` — `policyFrom('model-profiles:\n  standard:\n    model: claude-sonnet-4-5\n')`: implementer throws, code `MODEL_REFUSED_CODE`, message matches `/^no model for driver role implementer: profile standard did not resolve \(unknown model/`.
  - `roleModel: a missing or non-object role map is refused` — policies `{}` and `{ 'express-driver-models': { value: null, source: 'default', invalid: true } }` each throw `… implementer: role map unreadable` (and `explorer` still resolves, from code).
  - `modelPolicyRefusal: invalid keys, then per-role refusals, else null` — `null` for `policyFrom('')`; `'driver model policy invalid: express-driver-models'` for `policyFrom('express-driver-models:\n  implementer: turbo\n')`; `'driver model policy invalid: model-profiles'` for `policyFrom('model-profiles:\n  standard:\n    speed: x\n')`; `'driver model policy invalid: model-ceiling'` for `policyFrom('model-ceiling: huge\n')`; the `claude-sonnet-4-5` policy returns the implementer refusal message.
  - Guard discrimination: deleting the `invalid` loop leaves the `model-ceiling: huge` case returning `null` (the ceiling resolves `null`, no throw) — that test is the one that goes red; deleting the `hasOwn` role check makes `ghost` reach `resolve(undefined)` and throw `unknown profile` under a different `why` — the exact-message assertion goes red.

- [ ] **Step 2: Run to verify they fail**
Run: `node --test tests/bin-lib/driver/launch.test.js`
Expected: FAIL — `Cannot find module` until Step 1 creates the file, then `roleModel is not a function`.

- [ ] **Step 3: Implement** the four exports in `launch.js` with the signatures above; extend the header comment: the model each launch gets is resolved here (#5917), from `express-driver-models` and the shared `model-profiles`/`model-ceiling`, never left to the account default. `launchTracked` is not changed in this task.

- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — the two files; message `Resolve a driver role's model from policy — roleModel, refusal code, policy-step check`.

### Task 5: Hand-built launch fixtures carry the driver model keys

**Role:** integration

**Files:**
- Test: `tests/bin-lib/driver/review.test.js` (`POLICY`, line 905)
- Test: `tests/bin-lib/driver/judgments-merge-check.test.js` (`POLICY`, line 17)
- Test: `tests/bin-lib/driver/merge.test.js` (`POLICY_CEILINGS`, line 2895)
- Test: `tests/bin-lib/driver/acceptance.test.js` (`shared.policy`, line 280)
- Callers enumerated (`git grep -n "express-driver-wall-clock-minutes" -- tests/bin-lib/driver`): these four plus `run.test.js` (Task 6, because its `POLICY` keys are pinned to `steps.js` `POLICY_KEYS` order by `the policy step reads every key once per run`) — every test that reaches a real `launchTracked` with a hand-built `shared.policy`.

**Interfaces:**
- Consumes: `MODEL_POLICY_KEYS`, `roleModel` (Task 4); `resolvePolicyKeys` (policy-schema.js).

- [ ] **Step 1: Write the failing tests** — one per file, against that file's own fixture: `the fixture policy carries the model keys a launch needs (#5917)` asserting `roleModel('<role>', <fixture>) === PROFILES[DRIVER_ROLE_PROFILES['<role>']].model` with role `reviewer` (review.test.js), `merge-check` (judgments-merge-check.test.js and merge.test.js), `acceptance` (acceptance.test.js).

- [ ] **Step 2: Run to verify they fail** (one command per file)
Run: `node --test tests/bin-lib/driver/review.test.js`
Expected: FAIL after Step 1 — `no model for driver role reviewer: role map unreadable`. Same for the other three files with their roles.

- [ ] **Step 3: Implement** — spread `...resolvePolicyKeys(MODEL_POLICY_KEYS, { policyRaw: '' })` into each fixture (a real resolver reply: `express-driver-models` the four-role default map, `model-profiles` and `model-ceiling` `{ value: null, source: 'default' }`).

- [ ] **Step 4: Run to verify they pass**
Run: `node tools/run-tests.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/judgments-merge-check.test.js tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/acceptance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — the four files; message `Give the driver's hand-built launch fixtures the model policy keys — real resolver reply`.

### Task 6: `launchTracked` launches on the resolved model; the policy step refuses model policy it cannot resolve

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/launch.js` (`launchTracked`)
- Modify: `plugin/bin/lib/driver/steps.js` (`POLICY_KEYS` ~line 119; `defineStep` ~line 133-157; `policyStep` ~line 197-219; `launchImplementerAndCheck`'s launch catch ~line 741)
- Modify: `plugin/bin/lib/driver/run.js` (the step loop's emit, line 432)
- Test: `tests/bin-lib/driver/launch.test.js`
- Test: `tests/bin-lib/driver/run.test.js` (`POLICY` line 333; new tests)

**Interfaces:**
- Consumes: Task 4's exports.
- Produces:
  - `launchTracked(shared, deps, ceilings, opts)` calls `roleModel(opts.role, shared.policy)` first (a throw leaves `deps.runner`, `deps.launchWorker` and `shared.activeWorker` untouched) and passes `{ ...opts, model, ceilings, platform, env, bin? }` — `model` after the spread, so a caller cannot override it. Return value unchanged in this task (the envelope).
  - `steps.js` `POLICY_KEYS` ends with `...MODEL_POLICY_KEYS`; `policyStep` calls `modelPolicyRefusal(resolved)` after the `express-driver-max-lines` guard and returns `fatal(why)` on a non-null answer — the pre-flight: every role's model is resolved before the claim, a refusal is a `refused` stop at `policy` with the role (or key) named in `stop.detail`, nothing written.
  - The no-line refusal (spec Plan Review Clarifications, Reading A: a refused launch writes no `worker` line). `launchImplementerAndCheck`'s launch catch first tests `err && err.code === MODEL_REFUSED_CODE`; for it, it sets `launch.started = false` (nothing started, so the worker test list is not swept) and returns `{ status: 'fail', detail: err.message, noLine: true }` without the HEAD and flag re-reads (no process ran). Every other throw keeps the existing path. `defineStep`'s normalized result gains `noLine: result.noLine === true && result.status !== 'ok'` (an `ok` result can never suppress its line); its catch path and the invalid-status paths set no `noLine`. `run.js`'s loop emits a step line only when `result.skip !== true && result.noLine !== true`; a `noLine` result still halts (`halt` is true for any non-`ok` status) and becomes the record's `stop`, so `finalEvent` writes `stop.step: 'worker'`, class `pre-push` and `stop.detail` = the refusal message naming the role, and settle runs the `pre-push` row as for any worker failure. The flag is generic (no step name in `run.js`).

- [ ] **Step 1: Characterize, then write the failing tests** — run `node --test tests/bin-lib/driver/run.test.js` before editing and record PASS (the `AC14.2: win32 passes bin explicitly`, ceiling and `AC7.1 (#5414)` baseline tests pin every other `launchWorker` option and the call sequence this task must keep). Then:
  - `launch.test.js` — argv through the real launcher: a helper `composedArgs(role, policyRaw, runConfigRaw = null)` builds `shared = { activeWorker: null, policy: { ...resolvePolicyKeys(MODEL_POLICY_KEYS, { policyRaw, runConfigRaw }), 'model-profiles': modelProfilesEntry(policyRaw) } }`, `deps = { platform: 'linux', env: {}, runner: (call) => { seen = call.args; return { pid: 1, kill() {}, exited: Promise.resolve({ code: 0, signal: null, stdout: '', stderr: '' }) }; }, launchWorker: (o, d) => launchWorker(o, d) }` (real `launchWorker` from `worker.js`; `cwd` and `settingsDir` two separate `scratchDir` dirs), awaits `launchTracked(shared, deps, { minutes: 1, dollars: 1 }, { role, cwd, settingsDir, prompt: 'p' })`, returns `seen`. `argModel = (args) => args[args.indexOf('--model') + 1]`.
    - `AC1.1: unset key composes --model <standard> for the implementer and <capable> for the reviewer` — `argModel(await composedArgs('implementer', '')) === M('standard')`, reviewer `M('capable')`, and `--model` appears exactly once.
    - `AC2.1: implementer: fast in policy.yml composes --model <fast>` — policyRaw `express-driver-models:\n  implementer: fast\n` → `M('fast')`.
    - `AC2.2: the same block in config.yml composes the default model` — policyRaw `''`, runConfigRaw the block → `M('standard')`.
    - `AC3.1 (argv): model-ceiling standard launches the reviewer on <standard>` → `M('standard')`.
    - `AC5.1: launchTracked refuses before any runner call` — role `ghost`: rejects with `code === MODEL_REFUSED_CODE` and message containing `ghost`; a counting `launchWorker`/`runner` were called 0 times; `shared.activeWorker === null`.
  - `run.test.js`: append to `POLICY`, in `MODEL_POLICY_KEYS` order, `'express-driver-models': resolvePolicyKeys(['express-driver-models'], { policyRaw: '' })['express-driver-models'].value` (the four-role default map, from the real resolver), `'model-profiles': null`, `'model-ceiling': null`.
    - `AC1.1 (driver): the implementer and reviewer launches carry their default models` — `harness({ policy: { 'express-driver-review': 'on' } })`; the implementer `worker` call's `args[0].model === M('standard')`, the reviewer's `M('capable')`.
    - `AC2.1 (driver): a policy row reaches the launch` — `policy: { 'express-driver-models': { ...POLICY['express-driver-models'], implementer: 'fast' } }` → implementer launch model `M('fast')`.
    - `AC5.1 (driver): a launch-time refusal writes no worker line, the final line names the role` — reach the worker step past the pre-flight: `const shared = newShared()`; `await driveRecord(7, shared, h.deps)` (its policy step fills `shared` exactly as a run does); then `shared.policy['express-driver-models'] = { value: { reviewer: 'capable', 'merge-check': 'standard', acceptance: 'standard' }, source: 'policy' }`, record the call and line counts, and `await driveRecord(8, shared, h.deps)` — record #8's policy step answers `cached`, so the pre-flight does not run again. Assert over #8's calls and lines only: no `worker` call; no line with `step === 'worker'`; the lines before it (`claim`, `run-dir`, `worktree`) are present; the final line's `stop.step === 'worker'`, `stop.class === 'pre-push'`, `stop.detail === 'no model for driver role implementer: no work profile in the role map'`. Discrimination: deleting the `run.js` `noLine` check makes a `worker` line appear; deleting the `defineStep` passthrough does the same; deleting the refusal branch in `launchImplementerAndCheck` sends the refusal down the throw path, which writes a `worker` fail line — each turns the test red.
    - `a malformed frontier-run-cap never refuses a driver run` — `policy: { 'model-profiles': modelProfilesEntry('frontier-run-cap: abc\nmodel-profiles:\n  standard:\n    model: haiku\n').value }`: the run reaches the worker step and the implementer launch model is `M('fast')`; with `modelProfilesEntry('frontier-run-cap: abc\n').value` (`null`) the launch model is `M('standard')`.
    - `AC5.1 (driver): a role missing from the resolved map stops the run at the policy step, final line names it` — `policy: { 'express-driver-models': { reviewer: 'capable' } }`: exit code 1 (fatal), no `worker` and no `claim` call, the final line's `outcome === 'refused'`, `stop.step === 'policy'`, `stop.detail === 'no model for driver role implementer: no work profile in the role map'`.
    - `invalid model policy refuses the run before the claim` — for each of the three keys, an `over.script` policy reply that returns the real `resolvePolicyKeys` entry for a malformed value (`express-driver-models:\n  implementer: turbo\n`, `model-ceiling: huge\n`) or `modelProfilesEntry('model-profiles:\n  standard:\n    speed: x\n')`, with `POLICY` values for every other key: final `stop.detail === 'driver model policy invalid: <key>'`, no claim call.
    - `a model-profiles row naming a versioned id refuses at the policy step` — `model-profiles` value `{ standard: { model: 'claude-sonnet-4-5' } }`: `stop.step === 'policy'`, detail matches `/^no model for driver role implementer: profile standard did not resolve/`.

- [ ] **Step 2: Run to verify they fail**
Run: `node --test tests/bin-lib/driver/launch.test.js`
Expected: FAIL after Step 1 — the composed argv has no `--model` (`indexOf` is -1).
Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 — `the policy step reads every key once per run` (requested keys lack the three model keys) and the new tests (launch `model` undefined; the no-line test sees a `worker` call and line).

- [ ] **Step 3: Implement** per Interfaces. `steps.js` imports `MODEL_POLICY_KEYS` and `modelPolicyRefusal` from `./launch`; update the comment above `POLICY_KEYS` to name the three model keys (#5917), and the header comment above `runImplementer` to say a model refusal returns a no-line `fail` while any other launcher throw keeps the HEAD/flag re-read and rethrow. `run.js`'s header paragraph on event lines names `noLine` beside `skip`.

- [ ] **Step 4: Run to verify they pass**
Run: `node tools/run-tests.js tests/bin-lib/driver/launch.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/judgments-merge-check.test.js tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/acceptance.test.js tests/bin-lib/driver/budget.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — the five files; message `Launch every driver worker on its policy model — launchTracked resolves it, the policy step refuses what it cannot resolve, a launch refusal writes no worker line`.

### Task 7: `model` on the worker and review event lines

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/launch.js` (`launchTracked` returns `{ envelope, model }`)
- Modify: `plugin/bin/lib/driver/steps.js` (`runImplementer`/`launchImplementerAndCheck` ~line 693-783)
- Modify: `plugin/bin/lib/driver/review.js` (`launchReviewer` ~line 767; `reviewPass`'s `extraOf` ~line 801)
- Modify: `plugin/bin/lib/driver/judgment-io.js` (`launchJudge` ~line 83-98)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Produces: `launchTracked(...) → Promise<{ envelope, model }>`; when `deps.launchWorker` throws after the model resolved (an `assertSpendCeiling` refusal, a spawn error, a bad `settingsDir`), `launchTracked` rethrows with the model attached: `const e = err instanceof Error ? err : new Error(String(err)); e.model = model; throw e;` (a refusal from `roleModel` never reaches that catch, so it carries no `model`). `launchJudge(...) → { envelope, model }` or `{ stop }`, where a refusal's stop is `${label} launch failed (DRIVER_MODEL_REFUSED)` (append `` ` (${err.code})` `` only when `err.code === MODEL_REFUSED_CODE`). `launchReviewer → { envelope, model, minutes, dollars }`. Event lines: the `worker` line names `model` for every launch that resolved one. `launchImplementerAndCheck` records it as `launch.model` from the returned `{ model }`, or from `err.model` in its launch catch before the HEAD/flag re-reads; `runImplementer` adds it once after the try/finally on every returned result (`extra: { ...(result.extra || {}), model: launch.model }` when set), which covers no envelope and the head/flag stops of both the normal and the throw path; and when the throw is rethrown, `workerStep` catches an error carrying `err.model` and returns what `defineStep`'s catch would have (`{ status: 'fail', detail: (err && err.message) || String(err) }`, the step's default class and reason) plus `extra: { tests: ctx.workerTestMode, model: err.model }`; an error without `err.model` is rethrown unchanged. A `DRIVER_MODEL_REFUSED` refusal never sets `launch.model` and keeps Task 6's no-line result, so it writes no `worker` line; the `review` line's `extraOf()` gains `model` (the reviewer's) only once the reviewer launch returned, so `notStarted` lines keep their seven keys. The fix round's implementer `model` stays off the review line (its result extra is not merged there, `review.js:1041-1065`).

- [ ] **Step 1: Write the failing tests** in `run.test.js`:
  - Widen the key captures (return-shape widening check, `git grep -n "BASE_KEYS" tests/bin-lib/driver/run.test.js`: lines 1995, 2026, 2173, 2185, 2854, 2865, 3266 all compare against these constants): `KW = [...K1, 'model', 'tests'].sort()`, a new `K5M = [...K5, 'model'].sort()` replacing `K5` in `BASE_KEYS_FIX`, and extend the comment ("the worker line `tests` (#5915) and `model` (#5917), the review line `model` (#5917)").
  - `AC7.1: every worker line carries the model its launch was given` — fix rig plus a policy implementer `fast`: each `worker` line's `model` equals the `args[0].model` of the implementer `worker` call it reports (`M('fast')`), and the `review` line's `model` equals the reviewer call's `args[0].model` (`M('capable')`), not the fix implementer's.
  - `AC7.1: a worker launch that returns no envelope still names its model` — script the implementer `worker` call to return `null`: the `worker` line is `fail` with `model === M('standard')`.
  - `AC7.1: a launcher that throws after the model resolved still names it` — script the implementer `worker` call to throw `new Error('launch blew up')` (the shape `run.test.js:1597` already uses): the `worker` line is `fail`, `detail === 'launch blew up'`, `model === M('standard')`, `tests` present; the final line's `stop.step === 'worker'`. A second case throws a non-Error (`'boom'`): the line still carries `model` and `detail === 'boom'`. Discrimination: deleting the `err.model` attach in `launchTracked` (or the `workerStep` catch) leaves the line without `model` — red.
  - Characterization of the throw path this changes: the existing launcher-throw tests (`run.test.js` lines 1597-1602, 1748, 1782-1789, 1924, 4106; `grep -n "launch blew up"`) assert `stop.detail`, HEAD/flag stops and the list-file removal, not the `worker` line's key set; they must stay green unmodified (the line only gains `model` and `tests`).
  - `AC7.1: a refused launch still writes no worker line` — rerun Task 6's two-record `AC5.1 (driver)` rig after this task's changes: still no `worker` line for #8 (the refusal path is not widened by the throw-path change).
  - `old readers tolerate the model field (#5917)` — the contract proof below.
  - Proof(public-contract): driver-events.jsonl worker and review lines (and Task 8's merge-check and merge-acceptance lines) gain only the additive field `model`, never renaming one, a refused launch writes no worker line while the final line keeps its `stop` shape, and policy.yml gains the policyOnly block key `express-driver-models` (four keys only); the test "old readers tolerate the model field" writes a real harness run's lines to a scratch dir as driver-events.jsonl twice, with `model` and with `model` deleted from every line, and asserts tools/step-yield-report.js `driverStepsOf` returns identical step rows and `unparsed: 0` for both, and that the final line's `stop` object is the same; Task 2's "pre-change flat reader sees nothing of the block" test covers the policy side.

- [ ] **Step 2: Run to verify they fail**
Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 — `BASE_KEYS_PLAIN` mismatch (worker line has no `model`) and the AC7.1 tests.

- [ ] **Step 3: Implement** per Interfaces; each caller destructures `{ envelope, model }`; `review.js` and `judgment-io.js` need no `err.model` handling (their throw paths already write a fixed-text stop, with no `model`).

- [ ] **Step 4: Run to verify they pass**
Run: `node tools/run-tests.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/launch.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/judgments-merge-check.test.js tests/bin-lib/driver/judgments.test.js tests/bin-lib/driver/acceptance.test.js tests/bin-lib/driver/merge.test.js tests/step-yield-report.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — the five files; message `Name the launch model on driver worker and review event lines — additive model field`.

### Task 8: `model` on the judgment workers' event lines

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/judgments.js` (`launchAndValidate`, `judgeMergeCheck`, `finish`, `emitEvent`)
- Modify: `plugin/bin/lib/driver/acceptance.js` (`judge` and the route functions, `runAcceptance`'s `emitStep` extra)
- Test: `tests/bin-lib/driver/judgments-merge-check.test.js`
- Test: `tests/bin-lib/driver/acceptance.test.js`

**Interfaces:**
- Consumes: `launchJudge → { envelope, model }` (Task 7).
- Produces: the `merge-check` event extra is `{ verdict, floor, model }` when the judge launch returned, `{ verdict, floor }` otherwise; `merge-acceptance` extra is `{ route, model }` when an acceptance launch returned, `{ route }` otherwise (thread `model` through `judge`'s return to `state.model`).

- [ ] **Step 1: Write the failing tests**
  - `judgments-merge-check.test.js` line 252: expected extra becomes `{ verdict: 'needs-human', floor: 'none', model: M('standard') }`; line 315's floor cases stay `{ verdict: 'needs-human', floor }` (no launch — characterization, unchanged). Add `a refused merge-check launch names the code` — fixture policy `'express-driver-models': { value: { reviewer: 'capable' }, source: 'policy' }`: no `launchWorker` call, verdict `needs-human`, event detail `merge-check launch failed (DRIVER_MODEL_REFUSED)`, extra `{ verdict: 'needs-human', floor: 'none' }`.
  - `acceptance.test.js`: a completed route's `merge-acceptance` event extra deep-equals `{ route: <route>, model: M('standard') }`; a route stopped before any launch keeps `{ route }`.

- [ ] **Step 2: Run to verify they fail**
Run: `node --test tests/bin-lib/driver/judgments-merge-check.test.js`
Expected: FAIL after Step 1 — extra lacks `model`.
Run: `node --test tests/bin-lib/driver/acceptance.test.js`
Expected: FAIL after Step 1 — extra lacks `model`.

- [ ] **Step 3: Implement** per Interfaces; never write `model: undefined` (spread it only when set).

- [ ] **Step 4: Run to verify they pass**
Run: `node tools/run-tests.js tests/bin-lib/driver/judgments-merge-check.test.js tests/bin-lib/driver/acceptance.test.js tests/bin-lib/driver/judgments.test.js tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — the four files; message `Name the launch model on the judgment workers' event lines`.

### Task 9: Document the key, its defaults, the refusal and the field

**Role:** integration

**Files:**
- Modify: `docs/driver.md` ("Event lines" paragraph line 99; "The reviewer step" line 148; "Judgment workers" ~line 222; a new `## Worker models` section after "Worker rights")
- Modify: `plugin/bin/lib/driver/events.js` (header: the worker, review, merge-check and merge-acceptance lines carry `model`, the requested alias, #5917)
- Modify: `docs/plugin-structure.md` line 128-130 (`roles.js` entry: `ROLES` lists all five roles, plus `DRIVER_ROLE_PROFILES` and `POLICY_DRIVER_ROLES`; `launch.js` entry: `roleModel`, `modelPolicyRefusal`, `MODEL_POLICY_KEYS`, and `launchTracked` resolving the model and returning `{ envelope, model }`)
- Modify: `docs/journeys/resolve-a-policy-key.md` line 47 (red-flags `policyOnly` list gains `express-driver-models`, #5917)
- Test: `tests/bin-lib/driver/run.test.js` (a docs pin beside the `AC9.1` docs tests)

- [ ] **Step 1: Write the failing test** — `docs (#5917): driver.md states the models key, its defaults and the refusal`: the `## Worker models` section text contains `express-driver-models`, each of `implementer: standard`, `reviewer: capable`, `merge-check: standard`, `acceptance: standard`, `DRIVER_MODEL_REFUSED`, `never the account's default model`, ``writes no `worker` line`` and `` `explorer` is not a key ``; the "Event lines" paragraph contains `` `model` ``; and `docs/journeys/resolve-a-policy-key.md`'s red-flags line contains `` `express-driver-models` ``.

- [ ] **Step 2: Run to verify it fails**
Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1 — no `## Worker models` section.

- [ ] **Step 3: Write the docs.** `## Worker models` states: the key, its block shape and its four keys and defaults; `` `explorer` is not a key `` (its `standard` default lives in `roles.js` `DRIVER_ROLE_PROFILES`, and a row naming it is a schema error); the per-role merge; resolution through `profiles.js` `resolve()` as unattended (`model-profiles` rows and `model-ceiling` apply; `frontier` launches on the Capable model; stance and the frontier cap do not move a driver model); the policy step refuses the run (`refused`, before the claim) for an invalid `express-driver-models`, `model-profiles` or `model-ceiling` and for any role it cannot resolve, naming the key or the role; a malformed key the driver never reads (`frontier-run-cap`) refuses nothing; a launch-time refusal (code `DRIVER_MODEL_REFUSED`) throws before any process starts, is never retried on the account's default model, and in the worker step writes no `worker` line — the final line's `stop` names the step and the role; the `model` field names the requested alias, not what ran, and is on every `worker` line whose launch resolved a model, a launcher throw's `fail` line included. The `review` and judgment lines name the code in `detail` on a refusal.

- [ ] **Step 4: Run to verify it passes** — same command; Expected: PASS, 0 failures. Behavior-change sweep (two literal phrasings of the old behavior): `` git grep -n -o -F -e "(`ROLES`: `implementer`, `reviewer`, `explorer`)" -e "launchTracked(shared, deps, ceilings, opts)" -- docs/plugin-structure.md `` returns nothing after the edit. Control run while authoring, on the current tree: it printed `docs/plugin-structure.md:128` and `docs/plugin-structure.md:130`, so the search can match its target.

- [ ] **Step 5: Commit** — the five files; message `Document driver worker models — key, defaults, refusal and the model event field`.

### Task 10: Live probe per role on each distinct default model

**Role:** judgment

**Files:**
- Test: `tests/bin-lib/driver/worker.test.js` (the opt-in `AC7/AC6.1` smoke test ~line 949; a new opt-in test after it)
- Modify: `plugin/bin/lib/driver/worker.js` (header, "What the launch rests on", lines 57-82)

- [ ] **Step 1: Write the probe tests** (both skip unless `DRIVER_LIVE_SMOKE=1`, as the existing one does):
  - In `AC7/AC6.1`, replace `model: 'haiku'` with `model: roleModel('implementer', resolvePolicyKeys(MODEL_POLICY_KEYS, { policyRaw: '' }))` — the implementer's shipped default, so the rights probe runs on the model that now launches.
  - New `AC8.1 (#5917): live probe — every role launches on each distinct default model`: `models` = the sorted distinct `roleModel(role, <that reply>)` over `Object.keys(DRIVER_ROLE_PROFILES)`; for each model × each role of `Object.keys(ROLES)`: fresh `cwd`/`settingsDir` (`tmp(t)`), a runner wrapping `worker.defaultRunner` that keeps the child's `stdout`, `launchWorker({ role, cwd, settingsDir, prompt, schema, model, ceilings: { wallClockMs: 180000, spendCeiling: 1 }, ...(role === 'implementer' ? { testCommand: 'npm test' } : {}) }, { runner })`. `schema` per role: `RESULT_SCHEMA` (implementer, explorer), `REVIEW_RESULT_SCHEMA`, `MERGE_CHECK_RESULT_SCHEMA`, `ACCEPTANCE_RESULT_SCHEMA`; assert its keys equal `Object.keys(ROLES)`. `prompt`: `Use no tool. Return exactly this structured output and nothing else: <json>` with `<json>` `{"status":"cannot-complete","title":"probe","summary":"probe"}` (implementer, explorer), `{"findings":[]}` (reviewer), `{"verdict":"needs-human","rationale":"probe"}` (merge-check), `{"tryIt":[],"observationPlan":{},"claims":[],"parentBrief":{}}` (acceptance). `t.diagnostic` per launch: role, model, `status`, `reason`, `costUsd`, and the keys of the result object's `modelUsage` parsed from the kept stdout (`null` when absent). Assert `env.status === 'ok'` per launch.
  - Default-run check: `node --test tests/bin-lib/driver/worker.test.js` → PASS with both live tests reported as skipped.

- [ ] **Step 2: Run the live probe** (spends tokens; a real `claude -p` per launch; no TTY when run from the Bash tool):
Run: `claude --version` (read-only; `2.1.325 (Claude Code)` when this plan was written — record what it prints now)
Run: `mkdir -p "$PIPELINE_RUN_DIR/evidence"`
Run: `env DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern "AC7/AC6.1|AC8.1 \(#5917\)" tests/bin-lib/driver/worker.test.js > "$PIPELINE_RUN_DIR/evidence/live-probe-5917.txt" 2>&1`
Expected: both tests pass: 10 `ok` envelopes (5 roles × `sonnet`, `opus`) and the AC7 assertions on `sonnet`.

- [ ] **Step 3: Record the result** in `worker.js`'s header, as a new bullet under "What the launch rests on": the date, CLI version, platform, login kind, TTY state, the per-role-per-model outcomes (counts of `ok`), the `modelUsage` ids the diagnostics printed, and the AC7 smoke result on the implementer's default; keep the earlier `haiku` facts as dated history. Log the AC evidence: write one line naming `AC8.1`, the command shape and the pass/fail counts to a text file, then `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "<that file>"`, citing `$PIPELINE_RUN_DIR/evidence/live-probe-5917.txt`.
  **If a live launch is impossible** (no `claude` on PATH, not logged in, network or sandbox refusal, spend refused): do not edit the header with any probe result; commit only the test changes; report `DONE_WITH_CONCERNS` naming AC8.1 as open, the exact Step 2 command, and the verbatim first error line. Never write a probe result that did not print. A partial run (some launches not `ok`) is recorded as measured, with the failing role × model cells named, and reported as a concern.

- [ ] **Step 4: Run the default suite file again** — `node --test tests/bin-lib/driver/worker.test.js`; Expected: PASS (live tests skipped).

- [ ] **Step 5: Commit** — `git add tests/bin-lib/driver/worker.test.js plugin/bin/lib/driver/worker.js`; message `Probe driver workers live on each default model — one launch per role per model, recorded in worker.js`.

## Notes for the controller

- Sole-site claim ("`launchTracked` is the one resolution point"): `git grep -n -e "launchTracked(" -e "launchWorker(" -- plugin/bin` while authoring printed the three callers `steps.js:734`, `review.js:775`, `judgment-io.js:89`, the definition `launch.js:37`, the `deps.launchWorker` call inside it, `run.js:673`'s `realDeps.launchWorker` and `worker.js`'s own definition — no driver launch bypasses `launchTracked`.
- Count-pin forms (renumbering check): the key count lives only in `tests/policy-schema.test.js:46-48` (`Last bump` line, `length` and `size` assertions); `git grep -n -e "112 keys" -e "112 policy" -e "hundred and twelve" -- plugin docs tests` returned nothing while authoring.
- Pin check for Task 2's reworded sentence: `git grep -n -c -F "four of these five" -- tests plugin` printed only `plugin/skills/_shared/policy-schema.md:1` — no test pins it.

- Blocking-verification-downgrade check: Task 10 is the live contract probe; it is not downgraded. If the implementer cannot launch live, AC8.1 stays open and is surfaced, never ruled satisfied from the code.
- Verbatim commands: `claude --version` was run while authoring (printed `2.1.325 (Claude Code)`); the Task 2 Step 4 `node -e` probe and Task 10 Step 2's live command run code this plan adds, so they are unverified until those tasks land; `git grep -n -c "express-driver-models" -- plugin/skills CLAUDE.md` returns no hit on the current tree (the absence it starts from).
- After Task 10, the full suite runs centrally (`npm test -- --full`), not in a task.
