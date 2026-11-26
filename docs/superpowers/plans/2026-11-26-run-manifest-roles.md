# Run-manifest roles (model and effort per role) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A closed run's `manifest.json` carries `roles`: for each role in the run, how many agents ran it, on which models, and at which effort, read from what ran (transcripts, driver step lines), never from policy.

**Architecture:** `readUsage` gains a sparse per-row `effort` read from the transcript's `api-request` lines; a new pure module `plugin/bin/lib/run-manifest/roles.js` derives `roles` from the same inputs the #6009 cost derivation already uses (`costRows` on session lanes, `driver-events.jsonl` lines on the driver lane); the close path passes it to `fillRunManifest`, which stores it fill-only-null after a shape check.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T115118-record-6010/work/6010-spec.md` (record #6010)

## Global Constraints

- `manifest.json` stays `v: 1`; `roles` is added with no version bump (`docs/reference/run-manifest.md` Compatibility section).
- `roles` shape: `{ "<role>": { "agents": number, "models": { "<model id>": number }, "efforts": { "<effort level as recorded, or \"unknown\">": number } } }`.
- Session-lane role names: `session` plus `roleOf`'s names (`implementer`, `task review`, `lens reviewer`, `whole-branch review`, `plan review`, `re-review`, `unlabelled`) — reuse `roleOf` / the item's `role`, never a second pattern list.
- Driver-lane role names are keys of `ROLES` in `plugin/bin/lib/driver/roles.js` (`implementer`, `reviewer`, `merge-check`, `acceptance`, ...).
- An effort string outside `low`/`medium`/`high`/`max` is kept as the string seen. A missing effort is `unknown`, never inferred from a profile.
- `manifest.lane` selects the source: `driver` reads driver step lines only; every other lane reads transcript rows/items only.
- Nothing in the close path may throw because of `roles`: a failure is one stderr line, and `closedAt`/`minutes`/cost still fill.
- Every existing `readUsage` test passes unchanged.
- Model ids and effort strings come from transcripts: build count objects with `Object.fromEntries` over a `Map` (or the `defineProperty` pattern `cost.js` uses), so an id such as `__proto__` is an ordinary own key.
- Governing skill `.claude/skills/transcript-payload-verification/SKILL.md` (applies to Task 1's transcript read), quoted verbatim: "**Treat the transcript's real payloads as the reference shape** — not the type declaration — when writing the parsing/handling code. If the two disagree, the transcript wins for what to implement against; the type declaration is worth noting as the documented-but-inaccurate contract, so a future reader isn't tempted to "fix" the code back toward it." and "**Still write defensively.** Verifying against one session's transcript only confirms the current harness/SDK version's behavior — it doesn't guarantee future stability. Parse defensively (never throw on an unexpected shape) regardless of what the transcript showed". The other project skills naming these files (`timing-procedure-read-counting` — procedure-read rows; `shared-contract-extraction` — `mergeUsage`; `windows-checkout-test-parity` — path separators; `pre-tool-use-gate-exemptions`; `driver-step-addition` — `adopt.js`'s lane fill) govern code this plan does not change.

Waived plugin/bin/lib/driver/roles.js: read only — Task 2 requires its `ROLES` export and its test pins `DRIVER_STEP_ROLES` against it.
Waived plugin/bin/lib/timing/derive.js: read only — Task 2 requires `roleOf`; the per-agent effort tally lives in `roles.js` instead (Premise corrections, last bullet).

## Premise corrections (probed 2026-11-26, Claude Code 2.1.302 / 2.1.322 / 2.1.325)

- **Effort location.** The spec's Current State says assistant lines carry effort at `message.output_config.effort`. A survey of 14,878 transcripts (main and `subagents/agent-*.jsonl`) on this machine found **zero** assistant lines with that field. Effort is recorded on the `type: "api-request"` line written before each request, at `params.output_config.effort` (`params.model` beside it), e.g. `{"type":"api-request","timestamp":"…","version":"2.1.325","querySource":"repl_main_thread","params":{"model":"claude-opus-5-5","output_config":{"effort":"high"},…}}`; subagent files carry `querySource: "agent:builtin:general-purpose"` and their own effort (`medium` observed). Every assistant turn's lines follow its request's `api-request` line. So an assistant row's effort is the effort of the most recent preceding `api-request` line in the same file.
- **Driver step lines carry no `role` field.** The role is implied by `step`: `worker` → `implementer` (including the review fix round's `fix: true` relaunch), `review` → `reviewer`, `merge-check` → `merge-check`, `merge-acceptance` → `acceptance`. Effort is the line's own `effort` field (#5942), model its `model` field (#5917); older lines lack both.
- **`deriveRoles` input.** `timing.json` holds no main-session rows, so `deriveRoles` takes the same inputs as `deriveRunCost` (`{ manifest, rows, items, events }`), not `{ timing, events }`.
- **Sparse `effort` key.** `transcript.test.js` line 216 deep-equals a whole assistant row; an always-present `effort: null` key would change that existing test. Following the `asks`/`answers` precedent in the same function, `effort` is present only on an assistant row whose request recorded one; absent reads as "no effort recorded".
- **Driver worker transcripts are not resolved at close.** The driver lane's close fill reads only `driver-events.jsonl` (at-close.js: "Not deadline-gated: the driver lane's cost reads only the local driver-events.jsonl"); resolving each worker's transcript by `sessionId` would add unbounded transcript reads to that path. The spec marks it optional; the driver lane records the launch's `model` and `effort`, else `unknown`. Documented in `docs/reference/run-manifest.md`.
- **No `derive.js` change.** The per-agent effort tally is computed in `roles.js` from each item's `usageRows` (already on the pre-strip items `costRows.items` carries), so `timing.json`'s byte-pinned goldens (`tests/bin-lib/timing/golden.test.js`) do not change.

## Review Focus

- A transcript whose `api-request` lines carry no `output_config` (an older Claude Code): every turn counts under `unknown`, no throw.
- An `api-request` line with a non-string or empty `effort` (`{}`, `null`, `""`): counts as `unknown`, never as the key `"null"` or `""`.
- A model id or effort string of `__proto__` / `constructor`: an ordinary own key in `roles`, never reaching `Object.prototype`.
- A manifest that already carries `roles` (a second close): unchanged, `changed` excludes `roles`.
- A `roles` derive that throws or returns an invalid shape at close: `closedAt`, `minutes` and the cost group still fill; one stderr line.

---

### Task 1: `readUsage` returns each assistant row's effort

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (`readUsage`, around lines 298-429, and its header comment)
- Test: `tests/bin-lib/timing/transcript.test.js` (append)

**Interfaces:**
- Produces: a `readUsage` assistant row has `effort: string` when the most recent `api-request` line before it in the file has `params.output_config.effort` as a non-empty string; otherwise the row has no `effort` key. User rows never have it. No existing row field changes.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/timing/transcript.test.js`; write fixtures to `scratchDir('ct-effort-')` files)

Header comment above the tests: `// #6010 effort fixtures, format probed 2026-11-26 on Claude Code 2.1.302/2.1.322/2.1.325: effort is on type "api-request" lines at params.output_config.effort, never on assistant lines.`

Helper `reqLine(ts, effort)` → `JSON.stringify({ type: 'api-request', timestamp: ts, version: '2.1.325', querySource: 'repl_main_thread', params: { model: 'claude-opus-5-5', output_config: effort === undefined ? undefined : { effort } } })`. Assistant lines use the existing `aLine` shape (`{ timestamp, message: { role: 'assistant', id, model, usage, content: [] } }`).

```js
test('#6010 AC1.1: readUsage gives each assistant row the effort of the api-request line before it (high on two turns, medium on one)', async () => {
  // req(high) A(m1) req(high) A(m2a) A(m2b, same id) req(medium) A(m3) user
  const rows = await readUsage(file);
  const a = rows.filter((r) => r.role === 'assistant');
  assert.deepEqual(a.map((r) => r.effort), ['high', 'high', 'high', 'medium']);
  assert.equal('effort' in rows.find((r) => r.role === 'user'), false);
});
test('#6010 AC1.2: no api-request effort -> no effort key on any row (reads as null: row.effort ?? null)', async () => {
  // req() with no output_config, then two assistant lines; also a file with no api-request lines at all
  for (const r of rows) assert.equal('effort' in r, false);
});
test('#6010: a non-string or empty effort is not recorded', async () => {
  // req({}) req(null) req('') each followed by an assistant line -> no effort key on any
});
test('#6010 format guard: the probed-format fixture yields an effort on at least one assistant turn', async () => {
  // fixture: three request/assistant pairs in the probed format; fails loudly if the reader stops seeing effort
  assert.ok(rows.some((r) => r.role === 'assistant' && typeof r.effort === 'string'), 'transcript format changed: no assistant turn has an effort');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#6010" tests/bin-lib/timing/transcript.test.js`
Expected: FAIL (the AC1 and format-guard tests: `effort` is `undefined` on every row)

- [ ] **Step 3: Implement in `readUsage`**

Keep `let currentEffort = null;` in the stream closure. In the `line` handler, after JSON.parse and **before** the `timestamp`/`message.role` skip: when `entry.type === 'api-request'`, set `currentEffort` to `entry.params.output_config.effort` if that is a non-empty string, else `null`, then `return`. On an assistant row, `if (currentEffort !== null) row.effort = currentEffort;` (every line of a message.id gets it). Update the header comment block above `readUsage` with one sentence naming the source field and the sparse key.

- [ ] **Step 4: Run tests to verify they pass, and the whole file**

Run: `node --test tests/bin-lib/timing/transcript.test.js`
Expected: PASS, 0 failures (every pre-existing test unchanged — AC1.2's "every existing readUsage test passes unchanged": `git diff` shows only appended lines in this test file)

- [ ] **Step 4b: Real-input probe with an independent count (scratch, not committed)**

Run `readUsage` over the real subagent transcript `/Users/thomasholknielsen/.claude-accounts/mette-outlook-synthetic-1/projects/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/00d6a92c-9e45-4bfa-9b8d-5e86bed4b455/subagents/agent-a08d9586a1c348a98.jsonl` (a scratchpad script; tally `turnStart` assistant rows by `effort ?? 'unknown'`).
Expected: `{ medium: 207 }` — independently, that file has 207 `type: "api-request"` lines (all `params.output_config.effort: "medium"`) and 207 unique assistant `message.id`s (counted 2026-11-26 with a plain JSON.parse loop). Any `unknown` or a total other than 207 is a stop: report it, do not adjust the test.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/timing/transcript.js tests/bin-lib/timing/transcript.test.js
git commit -m "Read each turn's effort from the transcript — refs #6010"
```

### Task 2: `deriveRoles` in `plugin/bin/lib/run-manifest/roles.js`

**Files:**
- Create: `plugin/bin/lib/run-manifest/roles.js`
- Test: `tests/bin-lib/run-manifest/roles.test.js` (new)

**Interfaces:**
- Consumes: Task 1's sparse `row.effort`; `roleOf` from `plugin/bin/lib/timing/derive.js`; `ROLES` from `plugin/bin/lib/driver/roles.js`; items as `collectDispatches` returns them (`role`, `rawModel`, `tokens`, `usageRows`, `description`, `kind`).
- Produces: `deriveRoles({ manifest, rows, items, events }) -> roles | null`; `validRoles(value) -> boolean`; `DRIVER_STEP_ROLES` (frozen `{ worker: 'implementer', review: 'reviewer', 'merge-check': 'merge-check', 'merge-acceptance': 'acceptance' }`). Exported: `{ deriveRoles, validRoles, DRIVER_STEP_ROLES }`. Never throws.

Rules (pure, no fs):
- Effort tally of a row list: count rows with `role === 'assistant' && turnStart === true`; key = `row.effort` when a non-empty string, else `'unknown'`.
- **Session lanes** (`manifest.lane !== 'driver'`, including a null manifest):
  - `session`: from `rows` — only when at least one assistant turn exists: `{ agents: 1, models: { <each distinct row.model that is a string and not '<synthetic>'>: 1 }, efforts: tally(rows) }`.
  - Each item: role = `item.role` if a string, else `roleOf(item.description)`. `agents += 1`. Model: `'unknown'` when `item.tokens` is not an object (transcript unreadable), else `item.rawModel ?? item.transcriptModel ?? item.metaModel ?? 'unknown'`; `models[model] += 1`. Efforts: add `tally(item.usageRows)` when `usageRows` is an array; otherwise add nothing.
  - No session entry and no items → `null`.
- **Driver lane** (`manifest.lane === 'driver'`): each `events` object whose `step` is a key of `DRIVER_STEP_ROLES` and that is a launch (own `model` non-empty string, or `usage` an object): role = `DRIVER_STEP_ROLES[step]`; `agents += 1`; `models[line.model || 'unknown'] += 1`; `efforts[line.effort as non-empty string, else 'unknown'] += 1` (driver efforts count launches; no turns are read). No launch → `null`.
- `validRoles(v)`: `v` is a plain object, and every value is a plain object with `agents` a non-negative integer and `models`/`efforts` plain objects whose values are all non-negative integers.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/run-manifest/roles.test.js`

Build rows via real `readUsage` over fixture files (as `cost.test.js` does) for AC2/AC6, so Task 1's reader is exercised end to end; items are plain objects shaped like `collectDispatches` items (`{ description, role: roleOf(description), rawModel, tokens: {…}, usageRows }`).

```js
test('#6010 AC2.1: three implementers (two sonnet medium, one opus high) and one lens 3a dispatch', () => {
  const roles = deriveRoles({ manifest: { lane: 'standard' }, rows: [], items });
  assert.deepEqual(roles.implementer, { agents: 3, models: { 'claude-sonnet-5-5': 2, 'claude-opus-5-5': 1 }, efforts: { medium: 4, high: 1 } });
  assert.equal(roles['lens reviewer'].agents, 1);
}); // effort counts are the fixture transcripts' turn counts: sonnet agents 2 + 2 medium turns, opus agent 1 high turn
test('#6010 AC3.1: a description no roleOf pattern matches counts under unlabelled', ...);
test('#6010 AC4.1: driver lane, implementer launch on sonnet and reviewer on opus, no effort -> unknown', () => {
  const events = [{ step: 'worker', status: 'ok', model: 'sonnet', usage: { input_tokens: 1 } }, { step: 'review', status: 'ok', model: 'opus', usage: { input_tokens: 1 } }, { step: 'claim', status: 'ok' }];
  assert.deepEqual(deriveRoles({ manifest: { lane: 'driver' }, events }), {
    implementer: { agents: 1, models: { sonnet: 1 }, efforts: { unknown: 1 } },
    reviewer: { agents: 1, models: { opus: 1 }, efforts: { unknown: 1 } },
  });
});
test('#6010 AC6.1: the main session appears as session with its own model ids and effort counts', ...); // rows from readUsage over a 2-turn high + 1-turn medium fixture -> { agents: 1, models: { 'claude-opus-5-5': 1 }, efforts: { high: 2, medium: 1 } }
test('#6010: an unreadable-transcript item counts under model unknown and adds no efforts', ...); // { description: 'implement task 1', role: 'implementer', rawModel: 'sonnet', tokens: null } -> { agents: 1, models: { unknown: 1 }, efforts: {} }
test('#6010: a driver line effort is kept as seen, a fix relaunch counts as implementer, lane selects the source', ...); // worker effort 'xhigh' and worker fix:true -> implementer agents 2, efforts { xhigh: 1, unknown: 1 }; driver manifest ignores rows/items; session manifest ignores events
test('#6010: __proto__ as a model id and as an effort is an own key', ...); // assert Object.hasOwn(roles.implementer.models, '__proto__') and Object.getPrototypeOf({}) untouched
test('#6010: no source -> null', ...); // session lane with rows [] and items []; driver lane with only non-launch lines
test('#6010: DRIVER_STEP_ROLES names only roles defined in driver/roles.js ROLES', () => {
  for (const r of Object.values(DRIVER_STEP_ROLES)) assert.ok(Object.hasOwn(ROLES, r), r);
});
test('#6010: validRoles accepts derived output and rejects bad shapes', ...); // false for: null, [], { x: null }, { x: { agents: -1, models: {}, efforts: {} } }, { x: { agents: 1.5, … } }, { x: { agents: 1, models: { a: '1' }, efforts: {} } }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/run-manifest/roles.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/run-manifest/roles'`

- [ ] **Step 3: Implement `plugin/bin/lib/run-manifest/roles.js`** per the Rules above, with a header comment in the style of `cost.js` (what it reads per lane, that `models` counts agents and `efforts` counts turns — launches on the driver lane — and that `unknown` means no effort was recorded). A code comment on `DRIVER_STEP_ROLES` says renaming a driver role changes manifest `roles` keys (a contract, #6010).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/run-manifest/roles.test.js`
Expected: PASS, 0 failures

- [ ] **Step 4b: Real-input probe with an independent count (scratch, not committed)**

Run `deriveRoles({ manifest: { lane: 'driver' }, events })` over the real `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-24T143536-drive-4247/driver-events.jsonl` (parsed one JSON line at a time).
Expected: `{ implementer: { agents: 2, models: { sonnet: 2 }, efforts: { medium: 2 } }, reviewer: { agents: 1, models: { opus: 1 }, efforts: { medium: 1 } } }` — independently (counted 2026-11-26 with a JSON.parse loop), that file has two `"step":"worker"` lines (one with `fix: true`), both `model: "sonnet"`, `effort: "medium"`, and one `"step":"review"` line with `model: "opus"`, `effort: "medium"`, all three carrying `usage`; no other line carries `model`. Reconcile with `grep -c '"step":"worker"'` (2), `grep -c '"step":"review"'` (1) and `grep -c '"model"'` (3) on the file; a mismatch is a stop.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-manifest/roles.js tests/bin-lib/run-manifest/roles.test.js
git commit -m "Derive each role's models and efforts for the run manifest — refs #6010"
```

### Task 3: Fill `roles` at close and document it

**Files:**
- Modify: `plugin/bin/lib/run-manifest/write.js` (`fillRunManifest`, header comment, exports)
- Modify: `plugin/bin/lib/timing/at-close.js` (`fillManifestAtClose`, header comment)
- Modify: `docs/reference/run-manifest.md` (field table + a `roles` section)
- Test: `tests/bin-lib/run-manifest/write.test.js` (append), `tests/bin-lib/timing/at-close.test.js` (append, beside the AC6.1/AC6.3 manifest tests around line 1624)

**Interfaces:**
- Consumes: Task 2's `deriveRoles`, `validRoles`.
- Produces: `fillRunManifest(runDir, { roles })` stores `roles` only while `manifest.roles == null` and `validRoles(roles)`; a non-null, non-undefined `roles` that fails `validRoles` is not stored and writes one stderr line `claude-tweaks: run-manifest: roles failed the shape check, not written\n` (via `d.stderr`), while the other passed fields still apply. `fillManifestAtClose` passes `roles` whenever it derives cost (`withCost`).

Proof(public-contract): `manifest.json` gains only the additive nullable `roles` key at `v: 1` — the at-close test asserts every pre-existing manifest field is byte-for-byte unchanged after the fill and that a second close changes nothing, and `docs/reference/run-manifest.md` documents the key, its role names and their sources.

- [ ] **Step 1: Write the failing tests**

`write.test.js`:
```js
test('#6010: fillRunManifest stores roles fill-only-null', ...); // first fill -> changed includes 'roles'; second fill with a different valid roles -> changed excludes 'roles', file unchanged
test('#6010: an invalid roles is not stored, one stderr line, other fields still fill', ...); // fields { closedAt: '2026-11-26T12:00:00.000Z', roles: { x: { agents: -1, models: {}, efforts: {} } } } -> changed ['closedAt'], stderr has exactly one line matching /roles failed the shape check/
```
`at-close.test.js` (reuse the helpers the AC6.1 test at line 1624 uses):
```js
test('#6010 AC5.1 AC5.2: after the close path fills a fixture run, manifest.json carries roles and every other field unchanged; closing again changes nothing', async () => {
  // fixture main transcript with api-request effort lines; assert manifest.roles.session.efforts deep-equals the fixture's turn counts,
  // every key present before the close (v, runId, createdAt, lane, ...) has its prior value, and a second close leaves the file byte-identical
});
test('#6010: a roles derive that throws still fills closedAt, minutes and the cost group', async () => {
  // stub require.cache / module.exports seam per the file's existing throw tests; assert roles absent and closedAt non-null
});
test('#6010: driver lane at the close path records roles from driver-events.jsonl', async () => {
  // extend the driver-lane fixture shape of the test at line 1858: worker line model 'sonnet' effort 'medium' -> roles.implementer { agents: 1, models: { sonnet: 1 }, efforts: { medium: 1 } }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#6010" tests/bin-lib/run-manifest/write.test.js tests/bin-lib/timing/at-close.test.js`
Expected: FAIL after Step 1 (`roles` is never written)

- [ ] **Step 3: Implement**

`write.js`: after the cost group block, the `roles` fill described in Interfaces; add `roles` to the header comment's fill list. `at-close.js` `fillManifestAtClose`: inside `if (withCost)`, derive `roles` with `deriveRoles({ manifest, rows, items, events })` from the same inputs the cost derive receives (driver: `input.events`; session lanes: `costRows.rows` and `costRows.items`) inside its own `try`/`catch` that calls `warnManifestFailure` and leaves `roles` unset; set `fields.roles` when non-null. Add one sentence to the module header naming `roles` (#6010).

`docs/reference/run-manifest.md`: add `roles` to the field table (object, nullable, added at `v: 1`, filled at close on the token paths, fill-only-null) and a `### roles` section stating: role names (`session`, the `roleOf` names, the driver role names from `plugin/bin/lib/driver/roles.js` via the step mapping `worker`→`implementer`, `review`→`reviewer`, `merge-check`→`merge-check`, `merge-acceptance`→`acceptance`) and where each comes from; `models` counts agents, `efforts` counts turns (launches on the driver lane); effort is read from each transcript's `api-request` lines (`params.output_config.effort`), and `unknown` means the transcript (or the driver launch line) recorded no effort; an agent whose transcript could not be read counts under model `unknown` with no efforts; driver worker transcripts are not resolved at close; renaming a driver role changes these keys.

- [ ] **Step 4: Run tests to verify they pass, plus the neighbouring suites**

Run: `node --test tests/bin-lib/run-manifest/ tests/bin-lib/timing/at-close.test.js tests/bin-lib/timing/transcript.test.js tests/bin-lib/timing/golden.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-manifest/write.js plugin/bin/lib/timing/at-close.js docs/reference/run-manifest.md tests/bin-lib/run-manifest/write.test.js tests/bin-lib/timing/at-close.test.js
git commit -m "Fill each role's model and effort into the manifest at close — refs #6010"
```
