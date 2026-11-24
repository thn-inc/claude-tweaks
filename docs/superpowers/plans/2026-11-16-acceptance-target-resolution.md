# Acceptance Target Resolution and Local Pre-Merge Park Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve where the human's acceptance check runs (`local` | `dev`) and, under control mode, park a `local` run before merge with the PR open, durable state on the record (label + packet), the run archived, the claim released and the worktree removed; `/claude-tweaks:accept #N` re-enters from the PR branch.

**Architecture:** All decisions live in code under `plugin/bin/lib/accept/` (pure resolver, pure park/packet helpers, an ordered park executor with injected steps, a git re-entry helper) and one CLI, `plugin/bin/accept-park.js` (`decide`, `park`, `parked`, `reenter`, `reenter-check`, `reenter-remove`). Every merge-capable site (pr-first-merge Step 2.9, the pipeline driver's merge step, tidy's Arm ready PR, dispatch close-out) calls that CLI instead of restating the rule. The durable parked identity is exactly: acceptance facet `pending` (either spelling, via `acceptanceOf`) AND the packet's Deploy status section carrying `target: local` and `reason: awaiting-local-acceptance`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI via injectable runner, git.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T100844-record-4615/work/4615-spec.md` (record #4615)

## Global Constraints

- Resolution precedence (highest wins): a kept risk flag (forces `local`) > a per-item override > the policy default `acceptance-target`; absent everything the default is `local`.
- `resolveAcceptanceTarget({ keptRiskFlags, itemOverride, policyDefault })` → `{ target: 'local'|'dev', reason: 'risk-flag'|'item-override'|'policy'|'default'|'invalid-input' }`. `keptRiskFlags`: `string[]` of category slugs (`[]` = no flags; `null`/any non-array/an array holding a non-string = unreadable → `invalid-input`). `itemOverride`: `'local'`, `undefined` (absent) or anything else (invalid). `policyDefault`: `'local'`, `'dev'`, `undefined` (absent) or anything else (invalid). Any unreadable or invalid input resolves `local` with reason `invalid-input`. `dev` requires an affirmative valid `policyDefault: 'dev'` with a readable empty flag list.
- The override line is `Acceptance-target: local` (exactly one occurrence, lowercase), stamped only by `/claude-tweaks:specify`'s interactive path. Anything else (duplicate, a different value, `dev`) is invalid → `invalid-input` toward `local`.
- `acceptance-target` and the park are read only when `control-mode` is `on` (`isControlModeOn` in `plugin/bin/lib/policy.js` — the one comparison site); outside control mode behavior is exactly today's.
- Outcome on park: `pending-review` with reason `awaiting-local-acceptance`.
- Park cleanup order: (1) packet posted and `accept:pending` applied, (2) target, reason and head SHA written into the packet, (3) run directory archived through the existing archive-run entry point (`hooks.js close-run` then `hooks.js archive-run`), (4) claim released through the existing release-claim entry point (`releaseClaim` / `bin/release-claim.js`), (5) worktree removed last. A failure at 1-2 stops before 3 (never a half-parked item with no packet); a failure at 3-5 is reported and the item stays identifiable from label + packet alone.
- `/accept` re-entry: `git fetch origin {headRefName}` then `git worktree add .claude/worktrees/accept-{N} origin/{headRefName}` (never reusing a stale directory); "does not modify the branch" = HEAD unchanged and `git status --porcelain` shows no tracked-file changes (ignored files allowed). PR head ≠ recorded park-time SHA → withhold "Accept and merge" until checks re-run.
- Local verdict options, exactly: `Accept and merge (Recommended)`, `Accept, I'll merge`, `Broken: here's what I saw`. Cannot-run local target: `Accept (agent checks only)` and `Broken: here's what I saw`.
- No auto-merge, close or reap of a parked PR; no timeout, no nagging; an unanswered park is never auto-promoted.
- Do not build any resume dependency for "Broken" (owned by #4614).
- Scope and edit discipline (verbatim, `/build` Common Step 2): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing project skills (implementers read the named SKILL.md in `.claude/skills/` before coding): `record-body-line-addition` (Task 2 — "One reader, re-exported … every consumer calls it"; "Absent, none and malformed are three different answers"; "Detect wider than the grammar, so a variant spelling reads as malformed rather than absent"; "Preamble only, fences ignored"; its Registration sites table), `policy-key-addition` (Task 4 — dropping the `Not yet used` marker and the `NOT_YET_USED` entry), `gh-api-module-pattern` + its `cli-wrapper-contract.md` (Tasks 4-5 — injectable runner, `run(argv, deps)`, exit-code vocabulary, run-dir anchoring), `bin-source-scan-conformance`/`windows-checkout-test-parity` (new `plugin/bin` files must pass `tests/path-guard-conformance.test.js`, `tests/windows-hide-spawn-conformance.test.js`: route existence checks through `plugin/bin/lib/path-guard`, pass `windowsHide: true` on every spawn), `git-ground-truth-test-env` (Task 5's real-git fixture), `skill-prose-conformance-tests` (Task 7).
- Rail: `RAIL_BYTES` = 52,500. Current: `_shared/pr-first-merge.md` 37,320; `accept/SKILL.md` 33,581; `accept/entry-paths.md` 24,421; `_shared/dev-url-detection.md` 21,294; `_shared/console-on-pr.md` 16,799 — every prose addition below stays under 2 KB per file.
- **Composed merge bundle is at the rail:** `compose-context.js --step merge` over `_shared/pr-first-merge.md` + `_shared/pr-checklist-refresh.md` composes to 52,498 of 52,500 bytes today (plan-audit headroom, `composedNearCeiling`; cited from `wrap-up/merge-mode.md:25`, `wrap-up/auto-merge-short-circuit.md:245`, `wrap-up/execution-and-verification.md:72`, `dispatch/task-prompt.md:110`). So Step 2.9's procedure lives in a NEW lazy file `plugin/skills/_shared/local-acceptance-park.md` (read only when `decide` prints `park:true` or `parked` exits 0/6), and every byte added to `pr-first-merge.md` (the ≤300-byte Step 2.9 pointer, the Outcome-vocabulary reason) is offset in the same commit by trimming restatement inside `pr-first-merge.md` (cut restatement, never the clause telling the reader what to do), so the composed merge bundle stays ≤ 52,500 — proven by re-running `plan-audit.js {plan}` (headroom `composed` max ≤ 52,500) and `tests/bin-lib/skill-audit/*` after the edit. Do not edit `wrap-up/merge-mode.md` (it is itself in a near-rail composed bundle); its merge path reaches Step 2.9 through pr-first-merge.
- No `Risk-flags:` line is kept on #4615, so no `Proof(<slug>):` lines are owed.

## Review Focus

1. A record body carrying `Acceptance-target: local` inside a fenced code block or below the first `## ` heading must read absent, and a `**Acceptance-target:** local` / `acceptance-target: local` variant must read malformed (→ `invalid-input`), never `local` by `item-override` — pinned in Task 2.
2. A packet whose Deploy status already has a `ref:` line (dev deploy) must keep it untouched when the park writes `reason:`/`park-head:` lines; `refreshPacket`'s stale-ref check must not read `park-head:` as `ref:` — pinned in Task 3.
3. Park step 3 refusal: `archive-run` exits 0 even when it refuses; the executor must read its stdout for `claude-tweaks: archived` and report a refusal as a step-3 failure, continuing to steps 4-5 — pinned in Task 4/5.
4. A packet comment that cannot be read (gh error) during `parked` must read "unknown", and every guard must treat unknown as "do not merge" (fail closed), not as "not parked" — pinned in Tasks 3 and 4.
5. A record carrying both `accept:changes-requested` and `accept:pending` reads `changes-requested` through `acceptanceOf` (most conservative), so it is NOT parked-awaiting-local — but it also must not be auto-merged; the parked predicate returns false and the existing acceptance path governs — pinned in Task 3.

---

### Task 1: Pure acceptance-target resolver

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/accept/target.js`
- Test: `tests/bin-lib/accept/target.test.js`

**Interfaces:**
- Produces: `resolveAcceptanceTarget({ keptRiskFlags, itemOverride, policyDefault } = {}) -> { target, reason }`; exported constants `TARGETS = ['local','dev']`, `REASONS = ['risk-flag','item-override','policy','default','invalid-input']`.

- [ ] **Step 1: Write the failing tests** (`tests/bin-lib/accept/target.test.js`), one `test()` per row, names carrying the clause ids:
  - `AC1.1: kept flag beats a dev override and a dev default` — `resolveAcceptanceTarget({ keptRiskFlags: ['auth'], itemOverride: 'dev', policyDefault: 'dev' })` deepEquals `{ target: 'local', reason: 'risk-flag' }`.
  - `AC1.2: no flag, local override, dev default → item-override` — `{ keptRiskFlags: [], itemOverride: 'local', policyDefault: 'dev' }` → `{ target: 'local', reason: 'item-override' }`.
  - `AC1.3: neither → follows policy` — `{ keptRiskFlags: [], policyDefault: 'dev' }` → `{ target: 'dev', reason: 'policy' }`; and `policyDefault: 'local'` → `{ target: 'local', reason: 'policy' }`.
  - `AC1.4: nothing set → local by default` — `{ keptRiskFlags: [] }` → `{ target: 'local', reason: 'default' }`.
  - `AC2.1: every invalid override resolves invalid-input` — for each of `'dev'`, `'staging'`, `''`, `null` (the reader's duplicate/malformed sentinel, see Task 2): with `keptRiskFlags: []`, `policyDefault: 'dev'` → `{ target: 'local', reason: 'invalid-input' }`.
  - `AC2.2: every unreadable flag list resolves invalid-input` — for each of `null`, `undefined`, `'auth'`, `['auth', 3]`, `[{}]`: with `policyDefault: 'dev'` → `{ target: 'local', reason: 'invalid-input' }`. Note `undefined` flags is unreadable (the caller must pass `[]` for "no flags").
  - `AC2.3: invalid policy default resolves invalid-input` — `policyDefault` `'staging'` and `42`, flags `[]` → `{ target: 'local', reason: 'invalid-input' }`.
  - `AC2.4: absent policy default, no flags, no override → default` — same as AC1.4.
  - `AC2.5: a well-formed dev override never yields dev` — `{ keptRiskFlags: [], itemOverride: 'dev', policyDefault: 'local' }` → target `'local'` (reason `invalid-input`).
  - `never dev without an affirmative dev default`: loop over a small cartesian product of the inputs above and assert every `target === 'dev'` result has `policyDefault === 'dev'`, `Array.isArray(keptRiskFlags) && keptRiskFlags.length === 0` and `itemOverride === undefined`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/accept/target.test.js`
  Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/accept/target'`).

- [ ] **Step 3: Implement `resolveAcceptanceTarget`** in `plugin/bin/lib/accept/target.js` — pure, no requires beyond none. Evaluation order: (a) `keptRiskFlags` not an array or any element not a string → `invalid-input`; (b) non-empty → `risk-flag`; (c) `itemOverride !== undefined`: `'local'` → `item-override`, else `invalid-input`; (d) `policyDefault === undefined` → `default`; `'local'`/`'dev'` → `policy` with that target; else `invalid-input`. Header comment names #4615 and that `dev` needs an affirmative valid default.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/accept/target.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/accept/target.js tests/bin-lib/accept/target.test.js` then `git commit -m "Add acceptance-target resolver — precedence and fail-closed inputs, refs #4615"`.

### Task 2: `Acceptance-target:` body-line reader and its registration sites

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/issues/record-acceptance-target.js`
- Test: `tests/bin-lib/issues/record-acceptance-target.test.js`
- Modify: `plugin/bin/lib/issues/record.js` (re-export + header sub-module list)
- Modify: `plugin/bin/lib/issues/local-store.js` (header: the line rides in `body`, not `facets`)
- Modify: `plugin/skills/_shared/work-record.md` (a short section naming the one reader and the writer path)
- Modify: `plugin/skills/specify/spec-template.md` (metadata fenced block :16-26 gains `Acceptance-target: local` with an "(optional)" note style matching neighbours; a grammar paragraph next to :15's Risk-flags paragraph: grammar, sole writer = `/specify`'s interactive path, absent = no override, any other form reads invalid → `local`)
- Modify: `plugin/skills/specify/shaping-mode-stamping.md` (`### Metadata block` interactive branch, near :15: ask only on the interactive path whether the human wants to accept this item locally; on yes stamp `Acceptance-target: local`; never stamped under `--chained` or `next`; add the line to `### Compose-then-write-once`'s assembly block after `Risk-flags-unconfirmed:`)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/issues/` row names the new module; add a `plugin/bin/lib/accept/` row)

**Interfaces:**
- Produces: `parseAcceptanceTarget(body) -> { status: 'absent'|'ok'|'malformed', value: 'local'|'dev'|null, raw: string|null }` and `itemOverrideOf(parsed) -> 'local'|'dev'|null|undefined` (`absent` → `undefined`; `ok` → `value`; `malformed` → `null`). `null`/`'dev'` are what Task 1 reads as invalid.

- [ ] **Step 1: Write the failing tests** (`tests/bin-lib/issues/record-acceptance-target.test.js`), modeled on `tests/bin-lib/issues/record-risk-flags.test.js`:
  - `exact line reads ok local` — body `'Surface: web\nAcceptance-target: local\n\n## Overview\n'` → `{ status: 'ok', value: 'local', raw: 'Acceptance-target: local' }`; `itemOverrideOf` → `'local'`.
  - `exact dev line reads ok dev (and Task 1 rejects it)` — `'Acceptance-target: dev'` → `{ status:'ok', value:'dev' }`; `resolveAcceptanceTarget({ keptRiskFlags: [], itemOverride: itemOverrideOf(p), policyDefault: 'dev' }).reason === 'invalid-input'`.
  - `AC2.1: duplicated line reads malformed` — two `Acceptance-target: local` lines → `status: 'malformed'`, `itemOverrideOf` → `null`.
  - `variants read malformed, not absent` — each of `'acceptance-target: local'`, `'Acceptance-target: Local'`, `'**Acceptance-target:** local'`, `'- Acceptance-target: local'`, `'> Acceptance-target: local'`, `'Acceptance_target: local'`, `'Acceptance-target: staging'`, `'Acceptance-target:'` → `status: 'malformed'`.
  - `absent when missing, fenced, or below the first ## heading, or inside frontmatter` — four bodies → `status: 'absent'`, `itemOverrideOf` → `undefined`.
  - `CRLF body reads the same as LF` — the ok body with `\r\n` → `status: 'ok'`.
  - `record.js re-exports the reader` — `require('../../../plugin/bin/lib/issues/record').parseAcceptanceTarget === parseAcceptanceTarget`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/issues/record-acceptance-target.test.js`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `parseAcceptanceTarget` reusing `record-risk-flags.js`'s preamble discipline (frontmatter skip, stop at first unfenced `^## `, fenced lines ignored via `markdown-blocks.js`'s `fencedLineMask`) — extract or import that file's `scanPreamble`-style helper only if it is exported; otherwise write a local twin with the same rules (do not refactor `record-risk-flags.js`). Wide detection regex: case-insensitive `acceptance[-_ ]?target` with optional leading `>`, one list marker, `*`/`_` emphasis; exact grammar `/^Acceptance-target: (local|dev)$/`; `readExact` only when exactly one detected line. Then the registration-site edits listed under Files (prose ≤ 600 bytes each).

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/issues/record-acceptance-target.test.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/record-risk-flags.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** — stage the listed files explicitly; message `Add Acceptance-target body-line reader — exact local override, variants malformed, refs #4615`.

### Task 3: Pure park helpers — packet Deploy-status park fields and the parked predicate

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/accept/park.js`
- Modify: `plugin/bin/lib/issues/accept-entry.js` (export the existing `sectionText`/`splitLines`/`DEPLOY` helpers only if not already exported — additive export, no behaviour change)
- Test: `tests/bin-lib/accept/park.test.js`

**Interfaces:**
- Consumes: Task 1 `resolveAcceptanceTarget`; `acceptanceOf(names)` from `plugin/bin/lib/issues/record-vocabulary.js`; `packetStateOf` / Deploy-status section helpers from `plugin/bin/lib/issues/accept-entry.js`.
- Produces:
  - `PARK_REASON = 'awaiting-local-acceptance'`.
  - `decideAcceptanceRoute({ controlMode, keptRiskFlags, itemOverride, policyDefault }) -> { consulted: boolean, park: boolean, target: 'local'|'dev'|null, reason: string|null }` — `controlMode !== true` → `{ consulted:false, park:false, target:null, reason:null }` (resolver not called); else `park = (target === 'local')`.
  - `decideSeries(records: Array<{ record: number, input }>) -> { park: boolean, decisions: Array<{ record, ...decideAcceptanceRoute }> }` — each record decided on its own; `park` true when any decision parks (the series shares one PR).
  - `writeParkDeployStatus(packetBody: string, { headSha: string }) -> { body: string, changed: boolean }` — inside the packet's Deploy status section only: ensures exactly one `target: local` line (replacing any existing `target:` value), and sets/replaces `reason: awaiting-local-acceptance` and `park-head: {headSha}` lines; leaves every other line (including `ref:`) untouched; throws `TypeError` when `headSha` is not 7-64 lowercase hex or the section is absent.
  - `parkStateOf(packetBody: string|null) -> { parked: boolean, target: string|null, reason: string|null, headSha: string|null }` — `null`/non-string body → all null, `parked:false`.
  - `isParkedForLocalAcceptance({ labels, packet }) -> 'parked'|'not-parked'|'unknown'` — `packet.status` `'unreadable'`/anything not `'found'|'none'` → `'unknown'`; otherwise `'parked'` iff `acceptanceOf(namesOf(labels)) === 'pending'` AND `parkStateOf(packet.body)` has `target === 'local'` and `reason === PARK_REASON`.

- [ ] **Step 1: Write the failing tests** (`tests/bin-lib/accept/park.test.js`). Build the packet body from the real renderer where practical (`renderPacket` from `plugin/bin/lib/wrap-up/packet-render.js` with a minimal facts set), not a hand-typed string, for at least the `writeParkDeployStatus` round-trip:
  - `AC2a.1: control mode off never consults the resolver` — `decideAcceptanceRoute({ controlMode: false, keptRiskFlags: ['auth'] })` deepEquals `{ consulted:false, park:false, target:null, reason:null }`; also `controlMode: 'on'` (a string) is off.
  - `AC6.1: a dev resolution does not park` — `{ controlMode:true, keptRiskFlags:[], policyDefault:'dev' }` → `park:false, target:'dev'`.
  - `local resolution parks` — `{ controlMode:true, keptRiskFlags:[] }` → `park:true, target:'local', reason:'default'`.
  - `AC3a.1: in a two-spec series one park does not change the sibling's decision` — `decideSeries([{record:1,input:{controlMode:true,keptRiskFlags:['auth']}}, {record:2,input:{controlMode:true,keptRiskFlags:[],policyDefault:'dev'}}])` → `park:true`, `decisions[1]` is `{ record:2, consulted:true, park:false, target:'dev', reason:'policy' }`.
  - `AC3.2: park writes target, reason and head SHA into Deploy status` — round-trip: `parkStateOf(writeParkDeployStatus(body,{headSha:'abc1234'}).body)` deepEquals `{ parked:true, target:'local', reason:'awaiting-local-acceptance', headSha:'abc1234' }`; and `packetStateOf({ packet:{status:'found', body: written}, labels:[{name:'accept:pending'}] }).state === 'awaiting-local'`.
  - `park write keeps an existing ref: line and is idempotent` — body with `target: dev\nref: deadbeef` → result has `target: local`, still `ref: deadbeef`; applying twice → second `changed:false`.
  - `park-head is not read as a deploy ref` — `refreshPacket(written, { ref: 'abc1234', text: 'x' })` from `accept-entry.js` returns the body unchanged when the packet had no `ref:` line.
  - `rejects a bad head sha and a packet with no Deploy status section` — `assert.throws(..., TypeError)` for `headSha: 'HEAD'` and for a body lacking the section.
  - `parked predicate: label + packet both required` — four cases: pending+park fields → `'parked'`; pending, no park fields → `'not-parked'`; park fields, no pending label → `'not-parked'`; `demo:pending` spelling + park fields → `'parked'`.
  - `parked predicate: changes-requested outranks pending` — labels `accept:changes-requested`,`accept:pending` + park fields → `'not-parked'`.
  - `parked predicate: unreadable packet is unknown` — `packet:{status:'unreadable'}` → `'unknown'`.
  - Guard-discrimination: each predicate test above flips exactly one input from the `'parked'` case.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/accept/park.test.js`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the Produces list in `plugin/bin/lib/accept/park.js` (pure: no fs, no child_process). Field lines use the packet's existing `key: value` style; match lines with anchored regexes (`/^target:[ \t]*\S+$/`, `/^reason:[ \t]*\S+$/`, `/^park-head:[ \t]*\S+$/`) within the Deploy status section bounds only.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/accept/park.test.js tests/bin-lib/issues/accept-entry.test.js tests/accept-label-reader-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** — explicit paths; message `Add local-park packet fields and parked predicate — label plus packet, fail closed, refs #4615`.

### Task 4: Ordered park executor and the `accept-park.js` CLI (`decide`, `park`, `parked`)

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/accept/park.js` (add `runPark`)
- Create: `plugin/bin/accept-park.js`
- Modify: `plugin/bin/lib/policy-schema.js` (`acceptance-target` summary drops its `Not yet used; ` prefix — keep the rest of the sentence) and `tests/resolve-policy-control-mode.test.js` (`NOT_YET_USED` loses `'acceptance-target'`), `plugin/skills/_shared/policy-schema-read-path.md:42` (consumer column `none yet (#4608)` → `bin/accept-park.js decide (#4615)`)
- Test: `tests/bin-lib/accept/park-run.test.js`, `tests/accept-park-cli.test.js`

**Interfaces:**
- Consumes: Tasks 1-3; `parseRiskFlags` (`plugin/bin/lib/issues/record-risk-flags.js`); `parseAcceptanceTarget`/`itemOverrideOf` (Task 2); `resolvePolicyKeys` + `isControlModeOn` (`plugin/bin/lib/policy.js` / policy core used by `readRiskPolicy`); `readPacket` from `plugin/bin/lib/wrap-up/packet-gather.js` (returns `{ status, comment, … }` — map `comment.body` to the `{ status, body }` shape Task 3's predicate reads, and a thrown/failed `gh` comment read to `{ status: 'unreadable' }`), `publishPacket` (`plugin/bin/lib/wrap-up/packet-post.js`, the post-with-label path) and the same graphql `updateIssueComment` edit path it uses; the existing `acceptance-packet.js gather`/`render`/`post` pipeline (for step 1 when no packet exists); `releaseClaim` (`plugin/bin/lib/release-claim/release.js:164`); `hooks.js close-run` and `hooks.js archive-run --run` (spawned with `windowsHide: true`).
- Produces:
  - `runPark(steps: { postPacket, writeDeployStatus, archiveRun, releaseClaim, removeWorktree }) -> Promise<{ outcome: 'parked'|'park-failed', reason: 'awaiting-local-acceptance', steps: Array<{ step: 1|2|3|4|5, name, ok: boolean, detail: string }> }>` — each step is `async () => ({ ok, detail })`, a throw counts as `ok:false`. Steps 1 then 2: a failure stops (`outcome:'park-failed'`, later steps not called). Steps 3, 4, 5 always all run in order; any failure there keeps `outcome:'parked'` and is reported in `steps`.
  - Kept-flag mapping used by `decide`: `parseRiskFlags(body)` status `'ok'` → `flags`; `'unclassified'` → `[]`; `'unknown'` → `flags` (widened, non-empty, so it parks). A body read failure → `keptRiskFlags: null` (→ `invalid-input`).
  - CLI `node bin/accept-park.js decide --run <run-dir> --record <n>[,<m>…] [--repo owner/name]` → stdout one JSON line `decideSeries` result; exit 0 printed, 1 record/policy read failure, 2 malformed invocation, 3 `--run` refused (anchoring per cli-wrapper-contract). Control mode off prints `{"park":false,"decisions":[{"record":n,"consulted":false,…}]}` without fetching records.
  - CLI `node bin/accept-park.js park --run <run-dir> --record <n>[,<m>…] --pr <n> --head <sha> --worktree <path> [--worktree-mode remove|caller] [--repo owner/name]` — `--record` takes every record whose `decide` decision has `park:true` (a multi-spec series parks each such record; records that resolved `dev` get no park state) → executes `runPark` with real steps: (1) per parked record: when a packet comment exists, ensure `accept:pending` (add the label if absent); when none exists, post one through the existing `acceptance-packet.js gather --record {n} --run {run} --deploy {file holding {"target":"local"}}` → `render` (with the minimal narrative the renderer accepts — read `acceptance-packet.js`'s render input check) → `post --label accept:pending` path, so a record with no earlier packet still parks; a failed post is a step-1 failure; (2) per parked record: read the packet comment, `writeParkDeployStatus`, edit the comment in place (same graphql `updateIssueComment` path `publishPacket` uses); (3) `hooks.js close-run --run` then `hooks.js archive-run --run` (once per run), ok only when stdout contains `claude-tweaks: archived`; (4) `releaseClaim({ issueNumber, runId: basename(run), reason: 'awaiting-local-acceptance', link: pr url })` for every record the run claimed (all `--record` values plus any `dev` sibling in the same run — the run is over either way; pass the full claimed list as `--claimed <n>[,<m>…]`, defaulting to `--record`), ok on released or already-released; (5) `--worktree-mode remove` (default): `git -C <main-checkout> worktree remove --force --force <path>` — the driver creates its worktree locked (`plugin/bin/lib/driver/steps.js:516`, `worktree add --lock`) and its own teardown removes it the same way (`plugin/bin/lib/driver/settle.js:322`); a path `git worktree list --porcelain` no longer lists is `ok:true, detail:'already gone'` (branch kept — the PR is open); `caller`: step 5 reports `ok:true, detail:'caller-removes {path}'` and the caller removes it (`ExitWorktree`). Before step 3 it appends one `AUTO` decisions.md line via `log-decision.js`'s lib (`park: target local ({reason}), head {sha}; archiving run, releasing claim, removing worktree`). stdout: one JSON line `runPark` result; exit 0 `parked` (even with 3-5 failures), 1 `park-failed`, 2 malformed, 3 `--run` refused, 4 `gh` absent.
  - CLI `node bin/accept-park.js parked --record <n> [--repo owner/name]` → stdout `parked` / `not-parked` / `unknown`; exit 0 parked, 5 not-parked, 6 unknown, 2 malformed. Callers treat 0 and 6 alike: do not merge, close or reap.

- [ ] **Step 1: Write the failing tests.**
  `tests/bin-lib/accept/park-run.test.js`:
  - `AC3.1: steps run in the pinned order` — record call order of five fake steps → `[1,2,3,4,5]`, `outcome:'parked'`, `reason:'awaiting-local-acceptance'`.
  - `AC3.5: a failure at step 1 or 2 stops before archive` — step 2 returns `{ok:false}` → steps 3-5 never called, `outcome:'park-failed'`.
  - `AC3.6: a forced failure at archive, release or worktree removal is reported and the rest still run` — three sub-cases (step 3, 4, 5 throws) → all later steps still called, `outcome:'parked'`, the failing step `ok:false` with the error text in `detail`.
  `tests/accept-park-cli.test.js` (CLI `run(argv, deps)` seam, fake `gh`/`spawn`/`git` runners per `tests/bin-lib/wrap-up/packet-post.test.js`'s `fakeGh` pattern; run dir is a real temp dir under a temp main-checkout root so anchoring passes):
  - `AC2a.2: decide with control mode off reads no record` — policy without `control-mode` → JSON `park:false`, `consulted:false`, zero `gh issue view` calls.
  - `decide parks a control-mode record with no flags and no override` — policy `control-mode: on` → `park:true`, `reason:'default'`; with `acceptance-target: dev` → `park:false`, `target:'dev'`.
  - `decide reads the override and the risk-flag lines from the record body` — body with `Risk-flags: auth` + policy dev → `reason:'risk-flag'`; body with `Acceptance-target: local` + policy dev → `reason:'item-override'`; body `Risk-flags: autth` (unknown slug) → parks.
  - `AC3.3: park leaves the PR open, applies accept:pending, writes the packet, archives, releases, removes the worktree` — assert against the fake runners: no `pr merge`/`pr close` call; an `issue edit … --add-label accept:pending` call when the label was absent; one comment-edit whose body `parkStateOf` reads parked with the given head; spawn calls `close-run` then `archive-run` with `--run`; one release call; one `worktree remove <path>`; stdout JSON `outcome:'parked'`; exit 0.
  - `AC3.4: after a park no worktree and no claim remain` — use the fake runners' recorded state: the worktree list fake no longer lists the path, the claim fake reports released.
  - `archive-run's exit-0 refusal is a step-3 failure` — fake spawn prints `claude-tweaks: archive-run refused: console-unresolved` with exit 0 → step 3 `ok:false`, steps 4-5 still ran, exit 0.
  - `park with no packet posts one, then parks` — comments `[]` → the fake records a gather/render/post sequence with `--label accept:pending`, then the step-2 edit; exit 0.
  - `park whose packet post fails stops at step 1 and archives nothing` — the post fake throws → exit 1, no `close-run`/`archive-run` spawn.
  - `park removes a locked worktree` — the git fake rejects plain `worktree remove` on the path and accepts `worktree remove --force --force` → step 5 `ok:true`.
  - `a multi-record park writes park state only on the records passed` — `--record 2 --claimed 1,2` → packet edit and label only on #2, claim release on both.
  - `parked maps an unreadable packet to unknown` — the comment-read fake throws → stdout `unknown`, exit 6.
  - `--worktree-mode caller does not remove the worktree` — no `worktree remove` call; step 5 detail starts `caller-removes`.
  - `parked exit codes` — fakes for the three predicate outcomes → exits 0 / 5 / 6 with matching stdout.
  - `malformed invocations exit 2` — missing `--record`, non-numeric `--pr`, bad `--head`.
  - `the acceptance-target key is wired` — `POLICY_KEYS.find(k => k.key === 'acceptance-target').summary` does not match `/^Not yet used/` (covered by the existing `NOT_YET_USED` equality test once the list is edited — run it).

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/accept/park-run.test.js tests/accept-park-cli.test.js`
  Expected: FAIL (`runPark` not exported / CLI missing).

- [ ] **Step 3: Implement** `runPark` in `plugin/bin/lib/accept/park.js`, the CLI in `plugin/bin/accept-park.js` following `cli-wrapper-contract.md` (lazy `require` of heavy deps inside `run`, `module.exports = { run }`, `if (require.main === module)` exits with the returned code via `process.exitCode`, never `process.exit()` after a write), and the three policy edits.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/accept/park-run.test.js tests/accept-park-cli.test.js tests/resolve-policy-control-mode.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Real-input probe** — against this repo (control mode off): `node plugin/bin/accept-park.js decide --run "$PIPELINE_RUN_DIR" --record 4615` must print `{"park":false,…"consulted":false…}`; record the printed line in a `decisions.md` `AUTO` entry (`--step "AC evidence"`, `AC2a`).

- [ ] **Step 6: Commit** — explicit paths; message `Add accept-park CLI — decide, ordered park, parked predicate; wire acceptance-target, refs #4615`.

### Task 5: `/accept` re-entry helper (`reenter`, `reenter-check`, `reenter-remove`)

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/accept/reentry.js`
- Modify: `plugin/bin/accept-park.js` (three subcommands)
- Test: `tests/bin-lib/accept/reentry.test.js`

**Interfaces:**
- Consumes: Task 3 `parkStateOf`; a `git(args, { cwd })` runner; a `gh` runner.
- Produces:
  - `reenter({ record, pr, repoRoot, git, gh }) -> { worktree: string, headRefName, prHead, parkHead, moved: boolean, head: string }` — reads `gh pr view {pr} --json headRefName,headRefOid`; refuses (throws `Error` with `code:'stale-dir'`) when `{repoRoot}/.claude/worktrees/accept-{record}` already exists — never reuses it; runs `git fetch origin {headRefName}` then `git worktree add .claude/worktrees/accept-{record} origin/{headRefName}`; `moved = parkHead !== prHead` (`parkHead` from the packet; a missing park head counts as moved).
  - `reenterCheck({ worktree, expectHead, git }) -> { ok: boolean, head, dirty: string[] }` — `ok` iff `rev-parse HEAD === expectHead` and `git status --porcelain --untracked-files=no` is empty.
  - `reenterRemove({ worktree, repoRoot, git }) -> { removed: boolean }` — `git worktree remove --force <worktree>` (force only for ignored build artifacts; `reenterCheck` already proved no tracked changes).
  - CLI: `accept-park.js reenter --record <n> --pr <n>` → JSON; exit 0, 1 git/gh failure, 7 stale dir. `reenter-check --worktree <p> --expect-head <sha>` → exit 0 ok, 8 modified. `reenter-remove --worktree <p>` → exit 0/1.

- [ ] **Step 1: Write the failing tests** with a real git fixture (`git-ground-truth-test-env` skill: a temp bare "origin" plus a clone, `GIT_CONFIG_NOSYSTEM`, author env pinned, cwd pinned) and a fake `gh`:
  - `AC4.1: reenter fetches and adds the worktree from the PR branch` — the worktree path is `{clone}/.claude/worktrees/accept-42`, its HEAD equals the branch tip sha.
  - `AC4.2: before the verdict HEAD is unchanged and no tracked file changed` — `reenterCheck` ok right after `reenter`; writing an ignored file (`.gitignore` has `build/`) keeps ok; editing a tracked file → `ok:false`, `dirty` names it.
  - `AC4.3: the worktree is removed after the verdict` — `reenterRemove` → `git worktree list` no longer lists it.
  - `AC4.4: a moved PR head withholds Accept and merge` — park head `aaaaaaa` vs PR head the real tip → `moved:true`; equal → `moved:false`.
  - `a stale accept directory is refused, never reused` — pre-create the dir → throws `code:'stale-dir'`, no `worktree add` ran.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/accept/reentry.test.js`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `plugin/bin/lib/accept/reentry.js` and the CLI subcommands (use `--end-of-options` before ref/path operands on git calls; `windowsHide: true` on spawns).

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/accept/reentry.test.js tests/accept-park-cli.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** — message `Add accept re-entry helper — fresh worktree from the PR branch, head and tree checks, refs #4615`.

### Task 6: Guards — the pipeline driver's merge step refuses a parked item and parks a local target

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js` (`REASONS` gains `'awaiting-local-acceptance'`; a new sub-step immediately before the step that issues `gh pr merge`, porting pr-first-merge Step 2.9)
- Test: `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: Task 4 CLI via `deps.node(['<plugin>/bin/accept-park.js', 'parked', …])`, `decide`, and `park --worktree-mode remove`; no direct require of the park lib's gh code (all external calls through `deps`, per the module header).
- Controller rulings (Task 4 review): call `parked` with `--run {run dir}` — with control mode off it prints `not-parked`/exit 5 without any gh read, so control-mode-off merges are exactly today's; and when `park` exits 0 but its JSON `steps` carries any `ok:false` entry (e.g. step 3's archive refused on an unresolved console), put each failed step's name and detail in the stop's detail text so the run's report shows it.
- Produces: `merge()` returns `pending-review` / `awaiting-local-acceptance` (a) when `parked` exits 0 or 6, or (b) when `decide` prints `park:true` and `park` exits 0 — `park` is called with `--record` = the records whose decision parks, `--claimed` = every record of the run, `--pr`/`--head` = the PR number and head sha the step already read, `--worktree` = the driver's own run worktree path (the value its teardown removes — find the ctx field `settle.js`'s teardown reads) and `--worktree-mode remove`; the run's normal teardown for that outcome is skipped (the park owns it). `decide` exit non-zero → `pending-review` / `supplier-failed` (fail closed, no merge). `park` exit non-zero (1 park-failed, 2, 3, 4) → `pending-review` / new reason `park-failed` (added to `REASONS`), zero `pr merge` calls, normal teardown not run.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/merge.test.js`, reusing that file's deps fakes:
  - `AC3b.1: the auto-merge path never merges a parked PR` — `deps.node` fake answers `parked` with exit 0 → outcome `pending-review`, reason `awaiting-local-acceptance`, zero `pr merge` calls in the gh fake.
  - `AC3b.1: an unknown parked state also refuses` — exit 6 → same, zero `pr merge` calls.
  - `AC3.7: a local control-mode target parks instead of merging` — `parked` exit 5, `decide` prints `{"park":true,…}`, `park` prints `{"outcome":"parked",…}` → outcome `pending-review`/`awaiting-local-acceptance`, the `park` call carries `--head` equal to the PR head the step read, zero `pr merge` calls.
  - `a failed park never merges` — `park` exits 1 → outcome `pending-review`, reason `park-failed`, zero `pr merge` calls.
  - `the park call names the driver's worktree` — the recorded `park` argv carries `--worktree` equal to the worktree path the driver created and `--worktree-mode remove`.
  - `AC6.2: a dev resolution merges exactly as today` — `decide` `{"park":false}` → the existing merged-path assertions hold unchanged.
  - `AC2a.3: control mode off changes nothing` — `decide` prints `consulted:false` → existing happy-path expectations unchanged (the existing tests already run with no park fakes: default the new `deps.node` answers for `accept-park.js` to `not-parked` / `{"park":false,"decisions":[]}` in the shared fake so every existing test passes untouched).

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/driver/merge.test.js`
  Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement** the sub-step; its comment names `_shared/pr-first-merge.md` Step 2.9 as the ported section.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** — message `Park local acceptance in the driver merge step — no merge of a parked PR, refs #4615`.

### Task 7: Skill prose — the park in pr-first-merge, console-on-pr, the guards in tidy/dispatch, dev-url re-entry, /accept local verdict

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/skills/_shared/local-acceptance-park.md` — the full Step 2.9 procedure below (≈1.5 KB). Controller rulings (Task 4 review) the prose must carry: every `parked` call passes `--run "$PIPELINE_RUN_DIR"` when a run dir exists (tidy and dispatch close-out pass it when they have one, else omit it — the CLI then reads the repo-root policy); the park is the run's LAST act — nothing writes `$PIPELINE_RUN_DIR` after `park` returns (the run dir has moved to the archive and the worktree is gone), so the caller reports and ends; any `steps` entry with `ok:false` in park's JSON (step 3 can be refused on an unresolved console or console residue — the run then stays closed-not-archived until reconcile archives it) is reported in the run's final report, never swallowed; a parked record keeps `auto:build`, and dispatch's existing `open-pr` queue exclusion keeps it out of the next pull (cite it).
- Modify: `plugin/skills/_shared/pr-first-merge.md` — new `## Step 2.9: Local acceptance park (control mode)` between Step 2.5 and Step 3 as a ≤300-byte pointer naming the two CLI calls (`accept-park.js parked`, `accept-park.js decide`), the outcome `pending-review` / `awaiting-local-acceptance`, "never run Step 3", and "read `_shared/local-acceptance-park.md` only when `parked` exits 0/6 or `decide` prints `park:true`"; offset its bytes per Global Constraints' composed-bundle line. The new file's procedure: run `node "${CLAUDE_PLUGIN_ROOT}/bin/accept-park.js" parked --record {n}` for each `Fixes` record (exit 0 or 6 → do not run Step 3; outcome `pending-review`, reason `awaiting-local-acceptance`); then `accept-park.js decide --run "$PIPELINE_RUN_DIR" --record {n}[,{m}…]`; `park:false` → Step 3; `park:true` → `accept-park.js park --run … --record {every record whose decision parks} --claimed {every record of the run} --pr {pr} --head {headRefOid} --worktree {path} --worktree-mode {remove|caller}` (a non-zero `park` exit: report `pending-review` / `park-failed`, never run Step 3) (`caller` when this session stands in that worktree, then `ExitWorktree` `remove` last), report `pending-review` / `awaiting-local-acceptance` with the PR URL, never run Step 3; a multi-spec series decides per record and the shared PR parks when any record parks, the other specs having completed their own phases; control mode off: `decide` prints `consulted:false` and nothing changes. Outcome vocabulary row for `pending-review` adds `awaiting-local-acceptance (Step 2.9)`. Update the Canonical-for / shape line only if it enumerates steps.
- Modify: `plugin/skills/_shared/console-on-pr.md` — `## Headless conclusion`: one paragraph: a Step 2.9 park ends the run `pending-review` / `awaiting-local-acceptance`; the console is not a stop under control mode; the durable state is the pending label plus the packet; no timeout, no nagging.
- Modify: `plugin/skills/tidy/actions-github-issues.md` `## Arm ready PR` — before the existing labeling guard: run `accept-park.js parked` on each `Fixes` record; exit 0 or 6 → hold, not armed, report `Held (not armed): PR #{n} — parked awaiting local acceptance`; and `plugin/skills/tidy/SKILL.md` Step 7.5 template gains that held line.
- Modify: `plugin/skills/dispatch/driver-route.md` (controller ruling, Task 6 review) — when the driver's final line carries `merge.reason` `awaiting-local-acceptance` (the merge step parked with `--worktree-mode caller` because dispatch owns the worktree), the dispatching session removes the group's worktree last, by `ExitWorktree` remove or the sanctioned cleanup route the file already uses, and nothing after it writes the archived run directory; pinned by `AC3.4b: the dispatch driver route removes the worktree of a parked group` with a negative control.
- Modify: `plugin/skills/dispatch/close-out.md` step 3 — same `parked` guard before the Mark-ready call: exit 0 or 6 → stop `parked awaiting local acceptance — run /claude-tweaks:accept #{record}`; Reporting lists the outcome.
- Modify: `plugin/skills/_shared/dev-url-detection.md` — `#### Ephemeral server start`: a recreated acceptance worktree (`.claude/worktrees/accept-{N}`, `/claude-tweaks:accept` re-entry) is the worktree root for item 1's anchor; no run dir exists, so the server record goes to the session-tmp path and `/accept` stops the server when the verdict is given or the session ends; no start command → no `APP_URL`, `/accept` takes its cannot-run branch.
- Modify: `plugin/skills/accept/SKILL.md` — the `awaiting-local` state-table row (:121): when `accept-park.js parked --record {n}` exits 0, re-enter with `accept-park.js reenter --record {n} --pr {pr}` (replacing the scratch-worktree checkout for this case only), start the app per `_shared/dev-url-detection.md`, open the packet's links, run `reenter-check` before the verdict, `reenter-remove` after it; `moved:true` → say so and withhold "Accept and merge" until the checks are re-run (pr-first-merge Step 2.5). `### Verdict`: for a parked local target the options are exactly `Accept and merge (Recommended)` (merge through `_shared/pr-first-merge.md` Steps 2.5-3, required checks, no bypass), `Accept, I'll merge` (record approved, leave the PR open), `Broken: here's what I saw` (hand the description to the verdict handler, #4614 — no resume here); cannot-run (no start command, or `Surface: infra`): say so plainly and offer exactly `Accept (agent checks only)` and `Broken: here's what I saw`, running nothing. Keep the existing pinned Option 3 Skip prose untouched.
- Modify: `docs/skill-graph.md` — edges: `_shared/pr-first-merge.md` → `bin/accept-park.js`; `tidy`/`dispatch`/`accept` rows cite it (follow that file's table shape).
- Test: `tests/accept-park-prose-conformance.test.js`

**Interfaces:**
- Consumes: Task 4/5 CLI subcommands and exit codes exactly as listed there.

- [ ] **Step 1: Write the failing tests** (`tests/accept-park-prose-conformance.test.js`, live-text reads via `tests/helpers/read-skill`, each positive pin factored into one function a negative control also calls on the text with the new paragraph removed):
  - `AC3b.2: pr-first-merge Step 2.9 runs parked and decide before Step 3's first gh pr merge` — Step 2.9 heading exists; `accept-park.js" parked`, `accept-park.js" decide`, `awaiting-local-acceptance` present; index of `## Step 2.9` < index of the first `gh pr merge` fence in `## Step 3`.
  - `AC3b.3: tidy Arm ready PR holds a parked PR` — `accept-park.js" parked` precedes `run \`_shared/pr-first-merge.md\`'s Step 3`; the held line is in the SKILL.md template.
  - `AC3b.4: dispatch close-out holds a parked PR before Mark-ready`.
  - `AC3b.5: the merge-prompt path never merges a parked item` — `wrap-up/merge-mode.md` still reads the composed merge bundle (its `--step merge` … `pr-first-merge.md` command is present), and that bundle's `pr-first-merge.md` carries Step 2.9 before Step 3; plus `local-acceptance-park.md` states `pending-review` / `awaiting-local-acceptance` and "never run Step 3".
  - `composed merge bundle stays within the rail` — `wc -c` of `pr-first-merge.md` + `pr-checklist-refresh.md` (the same sum plan-audit's headroom reports) ≤ 52,500 — or rely on the existing `tests/bin-lib/skill-audit/` composed-rail test if one covers `--step merge` (grep it first and cite it instead of adding a duplicate).
  - `AC5.1: the local verdict lists exactly the three options` — the three literals in `accept/SKILL.md`'s `### Verdict` section, in order.
  - `AC4a.1: cannot-run offers exactly two options and runs nothing` — `Accept (agent checks only)` and `Broken: here's what I saw`, plus `Surface: infra`.
  - `AC4.5: /accept re-entry cites reenter, reenter-check and reenter-remove in that order`.
  - `console-on-pr names the park outcome` and `dev-url-detection names the recreated acceptance worktree`.
  - Negative controls: each pin above fails on the text with its new paragraph stripped.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/accept-park-prose-conformance.test.js`
  Expected: FAIL.

- [ ] **Step 3: Write the prose** listed under Files. Before editing, run the moved/held-prose pin grep: `git grep -n -F -e 'Arm ready PR' -e '### Verdict' -e 'awaiting-local' -e 'Headless conclusion' -- tests plugin` and re-check every hit's pinned text still matches after the edit (`tests/tidy-arm-ready-pr-acceptance-guard.test.js`, `tests/accept-skill-conformance.test.js`, `tests/acceptance-packet-wrap-up-conformance.test.js`, `tests/try-it-contract-conformance.test.js`, `tests/verify-json-acceptance-guard-conformance.test.js`, `tests/wrap-up-merge-mode-conformance.test.js`).

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/accept-park-prose-conformance.test.js tests/tidy-arm-ready-pr-acceptance-guard.test.js tests/accept-skill-conformance.test.js tests/acceptance-packet-wrap-up-conformance.test.js tests/try-it-contract-conformance.test.js tests/verify-json-acceptance-guard-conformance.test.js tests/wrap-up-merge-mode-conformance.test.js tests/acceptance-labeling-landed-check.test.js`
  Then `wc -c` on every modified `plugin/skills/**/*.md` — each under 52,500.
  Expected: PASS, all under the rail.

- [ ] **Step 5: Commit** — message `Document the local acceptance park — pr-first-merge Step 2.9, guards, accept re-entry, refs #4615`.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1-1.4 / AC2.1-2.5 | 1 |
| Deliverable 2 (override line) | 2 |
| Deliverable 3 / AC3b.1-3b.5 | 3, 4, 6, 7 |
| Deliverable 4 / AC3.1-3.7 / AC3a.1 | 3, 4, 6, 7 |
| Deliverable 5 / AC4.1-4.5 / AC4a.1 / AC5.1 | 5, 7 |
| Deliverable 6 (prose) | 7 |
| Deliverable 7 (tests) | 1-7 |
| AC2a | 3, 4, 6 |
| AC6 | 3, 6 |
| AC7 (`npm test` passes) | Common Step 5 |

Waived AC7.1: covered by `/build` Common Step 5's full verification, not a task test.

Clause-id note: plan-audit numbers the spec's sub-items (2a, 3a, 3b, 4a) inside their parent item; this plan's `AC2a`/`AC3a`/`AC3b`/`AC4a` test names map to them as follows. AC1.5 ("Each of the four rows is a test") is covered by Task 1's four AC1.1-AC1.4 tests. AC2.6 (control-mode off: output not consulted, existing merge tests untouched) is covered by Task 3's `AC2a.1`, Task 4's `AC2a.2` and Task 6's `AC2a.3` tests.

Waived _shared/pipeline-run-dir.md: read-only reference for the archive/close-run ordering; Task 4 Step 3 reads it while implementing step 3 of the park and changes nothing in it.

## Decisions taken under the record's decision rule (state in the PR body)

- Park field names in the packet's Deploy status section are `reason:` and `park-head:`, never `ref:` — `ref:` already means "the deployed commit" to `refreshPacket`.
- A multi-spec series shares one PR (`flow/multi-spec.md`: "A multi-spec run shares one PR"), so it parks when any record's target resolves `local`; each record still resolves its own target, every spec completes its own phases, park state lands only on the records that resolved `local`, and a `dev` sibling reaches its target when the shared PR is accepted and merged. Splitting a mixed series onto separate PRs would need a series-split design the record does not have and would break runs on the previous release; settled under the record's "Decision rule for any further gap" (plan-review row 1).
- Park step 5 is `git worktree remove` from the main checkout when the parking session is not inside the worktree, and `ExitWorktree` by the caller (`--worktree-mode caller`) when it is — archive-run moves the run dir first, so `teardown-run --run` cannot be used after step 3.
- An unknown parked state (packet unreadable) blocks merge, close and reap everywhere (fail closed).
- The pipeline driver's merge step (`plugin/bin/lib/driver/merge.js`, outside Key Files) is guarded too: it is a live auto-merge path, and AC3b requires it.
