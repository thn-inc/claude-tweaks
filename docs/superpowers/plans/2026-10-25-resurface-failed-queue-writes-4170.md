# Re-surface failed Queue writes and unfiled can't-tell filings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Queue-writes item the unattended Review Console resolved `apply` but could not execute, and a can't-tell filing it planned but never created, both read as residue (listed with a paste-ready line, refusing archival) instead of archiving as done.

**Architecture:** Two mechanisms, one per failure shape. (1) A sanctioned, locked post-execution rewrite of one `console.json` item (`console-resolve.js --set-item <id> --resolution keep-staged --reason <text>`, backed by a new `lib/console/item-resolution.js`) that step 7 and `refused-proposals.md` call on a failed execution; `keep-staged` is already residue. (2) The residue reader (`lib/console/residue.js`) treats every `console.json` `filings` entry whose fingerprint has no `filed as #N (work-fingerprint …)` line in the same dir's `decisions.md` as a `filing-pending` residue item — the option "the residue reader checks `filings` against created records", reusing #4171's filed-evidence reader (`FILED_LINE_RE`/`filedRecords`, moved into `residue.js`) — so nothing has to remember to rewrite a can't-tell item, and a session that dies after `console-resolve.js` still leaves residue. Every residue surface (`console-residue.js`, the session-start notice, the re-rendered Needs-a-human block, both archival refusals) reads through `readRunResidue`/`formatResidueLines`, so they pick both up.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T152441-record-4170/work/4170-spec.md` (worktree copy)

**Scope keywords:** filing-pending, set-item, item-resolution, filedRecords, consoleResidueHint

## Global Constraints

- `UNRESOLVED_RESOLUTIONS` stays exactly `pending`, `keep-staged` (pinned by `residue.test.js`, and read by `backfill.js`/`backfill-apply.js`/`console-backfill.js`, which must not start treating a planned filing as backfill work). `filing-pending` is a derived residue word, never a stored resolution.
- The rewrite only demotes: the one legal transition is `apply` → `keep-staged`. It never resolves anything, so it needs no `consoleAutoResolve` ceiling check.
- Run-dir writer conventions (`gh-api-module-pattern`'s `cli-wrapper-contract.md`): `--run` through `lib/stage-item/write.js`'s `resolveTarget` (exit 3 unanchored/missing), exit 2 malformed, no exit 1; RMW under `lib/file-lock.js`'s `withLock`, landed by `lib/atomic-write.js`'s `writeFileAtomic`.
- `residue.js` stays a leaf (requires only `fs`/`path`): `reconcile/archive-merged.js` and `hooks/session-residue.js` load it at module load, and `reconcile/index.js` must not pull `wrap-up/pack.js` at load (#4060) — so `finding-outcomes.js` imports the moved filed-evidence reader from `residue.js`, never the reverse.
- `finding-outcomes.js` keeps exporting `FILED_LINE_RE` and `filedRecords` (re-export) — `tests/auto-merge-short-circuit-cant-tell.test.js` and `tests/bin-lib/console/finding-outcomes.test.js` import them from there.
- `plugin/skills/flow/multispec-review-console.md` is at 50,862 / 52,500 B (`RAIL_BYTES`) — do not edit it; it already defers to `review-console.md` step 7. `review-console.md` 33,010 B, `refused-proposals.md` 2,622 B, `review-console-appendix.md` 15,440 B — all far from the rail.
- Commit subjects `{Verb} {what} — {detail}`, body `refs #4170` (never `closes`/`fixes`), ending `Claude-Session: https://claude.ai/code/session_014kynwBUBcb1BYy54Pdqu6S`.

## Review Focus

1. **A deduplicated can't-tell finding** (`console-filings.js` reports it under `deduped`, logged `already filed as #N (work-fingerprint …)`) must read resolved, not pending — `FILED_LINE_RE` already accepts `already `; Task 1 pins it.
2. **An acknowledged console** (`residueAcknowledgedAt` set) whose item a later failed execution rewrites to `keep-staged` must surface again — the rewrite drops the stale acknowledgment (Task 2 pins it).
3. **A PR-rendered `console.json`** (`prNumber`/`commentIds`, no `mode: 'auto-resolve'`) is never rewritten by `--set-item` — exit 5, byte-identical file (Task 2).
4. **A `decisions.md` that is absent or unreadable** next to a console with `filings` fails closed — every filing reads `filing-pending` (Task 1).
5. **An item id carrying a `'`** in the re-run command's `--only '…'` is shell-escaped `'\''` (Task 1).

---

### Task 1: Planned can't-tell filings with no record read as residue

**Files:**
- Modify: `plugin/bin/lib/console/residue.js`
- Modify: `plugin/bin/lib/console/finding-outcomes.js` (drop its own `FILED_LINE_RE`/`filedRecords` definitions; `require('./residue')` and re-export both unchanged)
- Test: `tests/bin-lib/console/residue.test.js`

**Interfaces:**
- Produces (all exported from `residue.js`):
  - `FILING_PENDING_RESOLUTION = 'filing-pending'`
  - `FILED_LINE_RE`, `filedRecords(decisions: string) -> Map<fingerprint, number>` — moved verbatim from `finding-outcomes.js` (same regex, first line wins).
  - `pendingFilings(consoleJson, decisions: string) -> item[]` — one item per `consoleJson.filings` entry (`{item: string, fingerprint: string}`; malformed entries skipped) whose fingerprint has no `filedRecords(decisions)` entry: the `consoleJson.items` element whose `id === entry.item` spread (or `{ id: entry.item }` when none), with `resolution: 'filing-pending'` and `reason: "planned can't-tell filing has no record yet (no filed or deduped line in decisions.md)"`. `[]` when `filings` is absent or not an array.
  - `consoleResidueItems(consoleJson, decisions = '') -> item[]` — `[...unresolvedItems(consoleJson), ...pendingFilings(consoleJson, decisions)]`.
  - `filingRerunCommand({ consoleDir, ids: string[], pluginRoot? }) -> string` — `{bin} --run "{consoleDir}" --existing <issues.json> --out-dir <dir> --only '{ids joined ","}'`, where `{bin}` is `node "{pluginRoot}/bin/console-filings.js"` when `pluginRoot` is given, else bare `console-filings.js`; each `'` in the joined ids written `'\''`.
- Changes:
  - `readRunResidue` feeds `splitMissing` with `consoleResidueItems(parsed, decisions)`, where `decisions` is the console dir's `decisions.md` read through the same `readFile` seam — only when `parsed.filings` is a non-empty array; any read failure reads as `''` (fails closed: every filing pending).
  - `formatResidueLines` passes `pluginRoot` to `itemLines`; a `filing-pending` item gets, after its usual lines, `    re-run filing: {filingRerunCommand({consoleDir, ids: [item.id], pluginRoot})}` and `      (<issues.json>: gh issue list --state all --json number,body --limit <N>; file each printed proposal through wrap-up/review-console.md step 7)`.
  - Header comment: name the `filing-pending` residue word and why it is derived, not stored.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/console/residue.test.js` (import the new names alongside the existing ones). Fixture helper `plannedFilingConsole(dir, decisions)` writes `console.json` `{ resolved: true, mode: 'auto-resolve', items: [{ id: 'tiebreak:aaaaaaaaaaaa', section: 'Low-confidence findings', resolution: 'filed', reason: 'r' }], filings: [{ item: 'tiebreak:aaaaaaaaaaaa', fingerprint: 'consolefinding-0123abcd', title: 't' }] }` and, when `decisions !== null`, `decisions.md`.
  - `AC3.1: a console whose planned can't-tell filing has no filed line reports it filing-pending` — `decisions` = `'## /wrap-up\n'` → `readRunResidue(dir).consoles[0].items.map(i => [i.id, i.resolution, i.section])` deep-equals `[['tiebreak:aaaaaaaaaaaa', 'filing-pending', 'Low-confidence findings']]`; `missing` `[]`.
  - `AC4.1: a filed or deduplicated planned filing reads resolved` — for each of `- AUTO 10:00:00 — Queue write: tiebreak:aaaaaaaaaaaa filed as #501 (work-fingerprint consolefinding-0123abcd). Reversibility: n/a.` and the same with `already filed as #77` → `readRunResidue(dir).consoles` deep-equals `[]`.
  - `a SKIP or STAGED line naming the fingerprint is not filed evidence` — the filed line with `- SKIP ` / `- STAGED ` in place of `- AUTO ` → still one `filing-pending` item.
  - `an absent decisions.md fails closed: every planned filing is pending` — `decisions = null` → one `filing-pending` item.
  - `a planned filing with no matching console item is still listed by its id` — `items: []` → item `{ id: 'tiebreak:aaaaaaaaaaaa', resolution: 'filing-pending' }`.
  - `AC3.1: formatResidueLines names the console-filings.js --only re-run for a filing-pending item` — lines include `    re-run filing: node "/p/bin/console-filings.js" --run "${dir}" --existing <issues.json> --out-dir <dir> --only 'tiebreak:aaaaaaaaaaaa'` and a line starting `      (<issues.json>: gh issue list --state all --json number,body`.
  - `filingRerunCommand escapes a single quote and omits node without a plugin root` — `filingRerunCommand({ consoleDir: '/r', ids: ["a'b", 'c'] })` === `` console-filings.js --run "/r" --existing <issues.json> --out-dir <dir> --only 'a'\''b,c' ``.
  - `consoleResidueItems on a console with no filings equals unresolvedItems` — `CONSOLE_2821` → same ids as `unresolvedItems(CONSOLE_2821)`.
  - `the SessionStart banner scan lists a clean run whose console holds a planned filing with no record` — mirror the existing `#4172` banner test (`scanUnresolvedConsoles`) with `plannedFilingConsole`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/residue.test.js`
Expected: FAIL — `FILING_PENDING_RESOLUTION`/`filingRerunCommand` undefined, no `filing-pending` item (existing tests still pass)

- [ ] **Step 3: Implement** the Interfaces above in `residue.js`; move `FILED_LINE_RE`/`filedRecords` (and their comments) out of `finding-outcomes.js`, which now `require('./residue')` for them and re-exports them in its unchanged `module.exports`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/console/residue.test.js tests/bin-lib/console/finding-outcomes.test.js tests/auto-merge-short-circuit-cant-tell.test.js tests/bin-lib/console/backfill-apply.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** — `Count a planned can't-tell filing with no record as console residue — filing-pending` (stage the three files by path).

---

### Task 2: A sanctioned post-execution rewrite of one console.json item

**Files:**
- Create: `plugin/bin/lib/console/item-resolution.js`
- Modify: `plugin/bin/console-resolve.js` (header comment, `USAGE`, `parseArgs`, `run`, the re-render path's `needsAHumanBlock` input)
- Modify: `plugin/bin/console-residue.js` (`acknowledge` runs under the same lock)
- Test: `tests/bin-lib/console/item-resolution.test.js` (new), `tests/bin-lib/console/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `consoleResidueItems`, `readRunResidue`, `formatResidueLines`.
- Produces (`item-resolution.js`):
  - `CONSOLE_LOCK = '.console.lock'` — the lock dir beside `console.json` (`withLock(path.join(dirname(consolePath), CONSOLE_LOCK), …)`), shared with `console-residue.js`'s ack.
  - `REWRITE_FROM = Object.freeze({ 'keep-staged': Object.freeze(['apply']) })` — target resolution → the stored resolutions it may replace.
  - `rewriteItemResolution({ consolePath, id, resolution, reason, at }) -> { status: 'rewrote', from, item } | { status: 'unchanged', item } | { status: 'refused', why }` — refuses (no write) when `console.json` is absent (`why: 'no console.json'`), does not parse or is not an object, is not this CLI's shape (`mode !== 'auto-resolve'`), holds no item with that `id`, holds more than one, or the item's resolution is not in `REWRITE_FROM[resolution]` (`why` names the from/to pair). An item already at `resolution` is `unchanged` (no write). On `rewrote` the item becomes `{ ...item, resolution, reason, rewrittenFrom: from, rewrittenAt: at }`, every other field and item is kept, and a top-level `residueAcknowledgedAt` is deleted (an acknowledgment predates the new residue). Throws on a write failure.
- Produces (`console-resolve.js`): a second invocation shape `console-resolve.js --run <dir> --set-item <id> --resolution keep-staged --reason <text>`. `parseArgs` returns `{ setItem, resolution, reason }` for it; exit 2 when `--set-item` lacks `--resolution`/`--reason` (or either is empty), when `--resolution` is not a `REWRITE_FROM` key, or when `--set-item` is combined with `--policy`/`--dry-run`/`--json`; `--resolution`/`--reason` without `--set-item` is also exit 2. After `resolveTarget` (exit 3 as today), the set-item path runs before the ceiling check: `rewrote` → appends one `/wrap-up` decisions entry (`formatEntry({ status: 'AUTO', step: 'Review Console', text: "Console item {id} ({section}): rewritten {from} → {resolution} after execution — {reason}", reversibility: 'n/a' })` via `appendEntry`), prints `console-resolve.js: {id} rewritten {from} → {resolution} in {consolePath}`, exit 0; `unchanged` → prints `… already {resolution} — nothing rewritten`, no log, exit 0; `refused` → stderr `console-resolve.js: {why} — nothing written`, exit 5; a thrown write → stderr, exit 3. `USAGE` lists both shapes and is added to `module.exports` (Task 4's prose-code twin reads it).
- The idempotent re-render (`resolved: true` path) builds its Needs-a-human block from `consoleResidueItems(existing, <runDir>/decisions.md or '')` so a resumed wrap-up still shows an unfiled planned filing; the fresh-resolution block and `--json`'s `unresolved` are unchanged (filings are about to run in that same pass).

- [ ] **Step 1: Write the failing tests.**
  - `tests/bin-lib/console/item-resolution.test.js` (tmp dir per test, console.json written by the test):
    - `rewrites an apply item to keep-staged, recording rewrittenFrom/rewrittenAt and keeping every other field` — two items (`leftover-1.md` apply, `wrap-up-memory-1.md` apply) + `merge`/`filings` fields → `status: 'rewrote', from: 'apply'`; stored `leftover-1.md` = `{ id, section, resolution: 'keep-staged', reason: 'record create failed (exit 1)', rewrittenFrom: 'apply', rewrittenAt: '2026-10-25T12:00:00.000Z' }`; the other item, `merge` and `filings` deep-equal before.
    - `drops a residueAcknowledgedAt the new residue postdates` — stored ack present → absent after `rewrote`.
    - `an item already keep-staged is unchanged and the file is byte-identical`.
    - `refuses without writing` — table over: absent file (`no console.json`), `'{not json'`, a PR console (`{ prNumber: 42, commentIds: ['IC_1'], items: [{ id: 'leftover-1.md', resolution: 'apply' }] }`), unknown id, two items sharing the id, a `filed` item → each `status: 'refused'` and (when the file existed) bytes unchanged.
  - `tests/bin-lib/console/cli.test.js` (reuse `mainCheckoutWithRun`/`baseDeps`):
    - `AC1.1: a Queue-writes item whose execution failed ends keep-staged in console.json and readRunResidue reports it` — `staged: { 'leftover-1.md': 'Title: x\n\nbody\n' }`; `run(['--run', runDir, '--policy', 'console-auto'])` → 0; then `run(['--run', runDir, '--set-item', 'leftover-1.md', '--resolution', 'keep-staged', '--reason', 'record create failed (exit 1)'])` → 0; console.json item `resolution: 'keep-staged'`, `rewrittenFrom: 'apply'`; `decisions.md` matches `/Console item leftover-1\.md \(Queue writes\): rewritten apply → keep-staged after execution — record create failed \(exit 1\)\. Reversibility: n\/a\.$/m`; `readRunResidue(runDir).consoles[0].items.map(i => i.id)` = `['leftover-1.md']`; `formatResidueLines(…)` includes `    cat "${path.join(runDir, 'staged', 'leftover-1.md')}"`.
    - `AC4.1: a successful Queue write keeps apply and leaves no residue` — same fixture, no `--set-item` → item `apply`; `readRunResidue(runDir).consoles` = `[]`.
    - `AC3.1: a console whose can't-tell filings never ran reports the planned filing, and the re-render names the --only re-run` — build the can't-tell verdict exactly as the existing `#3949 AC5` test does (`resolveTiebreak` + `formatEntry`); first `--policy console-auto` run → 0 and its stdout has no `Needs a human`; `readRunResidue(runDir).consoles[0].items` = one `{ id: 'tiebreak:'+r.id, resolution: 'filing-pending' }`; a second `--policy console-auto` run (re-render) prints `Needs a human — 1 item(s)` and `--only 'tiebreak:${r.id}'`; then append (via `appendEntry` + `formatEntry`) the text `tiebreak:${r.id} filed as #501 (work-fingerprint ${cj.filings[0].fingerprint})` → `readRunResidue(runDir).consoles` = `[]` (AC4.1's filed half end-to-end).
    - `--set-item needs no unattended ceiling` — `autonomy: 'trusted'`, a stored auto-resolve console with an `apply` item → exit 0, rewritten.
    - `--set-item refusals exit 5 and write nothing` — no console.json; unknown id.
    - `--set-item malformed invocations exit 2` — missing `--reason`; `--resolution apply`; `--set-item` with `--policy console-auto`; `--resolution` without `--set-item`.
    - `--set-item with a --run outside the main checkout exits 3` — mirror the existing `#1932 AC5` exit-3 test.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/cli.test.js`
Expected: FAIL after Step 1 — `Cannot find module …/item-resolution`, and `--set-item` exits 2 as an unknown flag (existing cli tests still pass)

- [ ] **Step 3: Implement** the Interfaces above; wrap `console-residue.js`'s `acknowledge` body in `withLock(path.join(path.dirname(consolePath), CONSOLE_LOCK), …)`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/cli.test.js tests/bin-lib/console/residue.test.js tests/bin-lib/console/residue-cli.test.js tests/bin-lib/hooks/session-residue.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** — `Add console-resolve.js --set-item — record a failed execution keep-staged after an unattended console`.

---

### Task 3: Archival refusals name the console-filings.js --only re-run

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`filingRerunRemedy`, `consoleResidueHint`, `module.exports`)
- Modify: `plugin/bin/hooks.js` (`runArchiveRun`'s console-residue branch)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`, `tests/archive-run-verb.test.js`

**Interfaces:**
- Consumes: Task 1's `readRunResidue`, `FILING_PENDING_RESOLUTION`, `filingRerunCommand`.
- Produces: `filingRerunRemedy(runDir) -> string` — `''` unless an unacknowledged console of the run holds a `filing-pending` item; else `re-run the planned filing(s): {one filingRerunCommand({ consoleDir, ids }) per such console (no pluginRoot), joined '; '}, then file each printed proposal through wrap-up/review-console.md step 7`. `consoleResidue`'s return shape is NOT widened (its two `deepStrictEqual` tests stay as they are).
- `consoleResidueHint`: the `unresolved: …` part becomes `unresolved: {names} — {filingRerunRemedy}; or {consoleAckRemedy}` when the remedy is non-empty, unchanged otherwise.
- `hooks.js archive-run`: when `items > 0`, push `filingRerunRemedy(runDir)` (when non-empty) into `remedies` before `consoleAckRemedy(runDir)`.

- [ ] **Step 1: Write the failing tests.**
  - `archive-merged.test.js`: helper `plannedFilingRunDir()` (console.json as Task 1's `plannedFilingConsole`, `decisions.md` with no filed line).
    - `AC3.1: a console holding a planned filing with no record reads residue and the hint names the console-filings.js --only re-run` — `readConsoleState(runDir)` === `'residue'`; `consoleResidue(runDir)` deep-equals `{ items: 1, unreadable: [], names: ['tiebreak:aaaaaaaaaaaa (filing-pending)'] }`; `consoleResidueHint(runDir)` includes `` re-run the planned filing(s): console-filings.js --run "${runDir}" --existing <issues.json> --out-dir <dir> --only 'tiebreak:aaaaaaaaaaaa', then file each printed proposal through wrap-up/review-console.md step 7; or review them, then run console-residue.js --ack --run "${runDir}" ``.
    - `filingRerunRemedy is empty for a residue console with no planned filing` — the existing `prConsoleRunDir([['f1', 'filing-failed']])` → `''`, and `consoleResidueHint` still matches the existing `#4172` regex.
    - `AC4.1: once the filed line is logged the run reads resolved` — append the filed line → `readConsoleState` === `'resolved'`.
  - `archive-run-verb.test.js`:
    - `AC3.1: archive-run refuses a console whose can't-tell filings never ran, naming the console-filings.js --only re-run` — `runDirFixture('clean')` + the planned-filing console → stdout matches `/archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed; re-run the planned filing\(s\): console-filings\.js --run ".*" --existing <issues\.json> --out-dir <dir> --only 'tiebreak:aaaaaaaaaaaa', then file each printed proposal through wrap-up\/review-console\.md step 7; review them, then run console-residue\.js --ack --run .*\) — unresolved: tiebreak:aaaaaaaaaaaa \(filing-pending\)\n$/`; run dir not moved.
    - `AC4.1: archive-run archives once the planned filing's filed line is logged` — same fixture plus the filed line in `decisions.md` → no `archival refused`, run dir moved to `archive/`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js`
Expected: FAIL after Step 1 — `filingRerunRemedy is not a function`; the archive-run stdout lacks `re-run the planned filing(s)` (existing tests still pass)

- [ ] **Step 3: Implement** the Interfaces above.

- [ ] **Step 4: Run to verify they pass** — same command, Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `Name the console-filings.js --only re-run in console-residue archival refusals`.

---

### Task 4: Skill prose — failed executions route to the rewrite, unfiled filings are residue

**Files:**
- Modify: `plugin/skills/wrap-up/refused-proposals.md` (final paragraph → new `## A failed execution is not a refusal` section)
- Modify: `plugin/skills/wrap-up/review-console.md` (step 7's shadow-dup and failed-create sentences, step 7's human-present "carried as a failed filing" parenthetical, the "Can't-tell filings (#3949)" paragraph's last two sentences)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (the `console.json` mechanics paragraph, after the `residueAcknowledgedAt` sentence)
- Test: `tests/console-shadow-dup-outcomes-conformance.test.js`, `tests/review-console-unattended-no-ask-conformance.test.js`, new `tests/console-failed-execution-residue-conformance.test.js`

**Interfaces:**
- Consumes: Task 2's `console-resolve.js --set-item` (USAGE), Task 1's `filing-pending`.

Exact text (implementer may only re-wrap lines):

`refused-proposals.md` — replace the last sentence of the final paragraph (`A *failed* create … renders in Queue writes as today.`) with a new section after that paragraph:

~~~markdown
## A failed execution is not a refusal

A *failed* create (transport error on a valid proposal) is not a refusal — it renders in Queue
writes as today — and neither is a `.shadow-dup` copy whose composer exits non-zero
(`review-console.md` step 7). When `console-resolve.js` auto-resolved this console, its
`console.json` still records the item `apply`, so the run would archive with it unfiled. Record it
for a human instead:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "{item-run-dir}" --set-item '{name}' --resolution keep-staged --reason '{why}'
```

`{name}` is the item's staged filename; `{why}` is `record create failed (exit {code})` or
`shadow-dup-proposal.js exited {code}`. The item then reads as residue — `console-residue.js` and
the session-start notice list it with its `cat` line, and archival refuses the run until a human
acknowledges it. Exit 5 means there is no auto-resolved `console.json` to rewrite (a human-present
console, where the failure is already in front of a human): nothing more to do. A can't-tell
finding's filing is never rewritten this way; it stays residue until its filed line is logged
(`review-console.md`'s Can't-tell filings).
~~~

(Outer `~~~` fence is plan-only; in the file the bash block is an ordinary ```` ``` ```` fence.)

`review-console.md` step 7:
- `… — the copy stays in \`staged/\`, the item is not filed this run, and that \`SKIP\` line is its trace.` → `… — the copy stays in \`staged/\`, the item is not filed this run, and that \`SKIP\` line is its trace; then record it per \`refused-proposals.md\`'s failed-execution rewrite, \`{why}\` = \`shadow-dup-proposal.js exited {code}\`.`
- `A failed \`gh issue create\` on the proposal follows \`refused-proposals.md\`'s failed-create line.` → `A failed \`gh issue create\` on the proposal follows \`refused-proposals.md\`'s failed-execution rewrite.`
- `(the same needs-human re-run line, archive path included)` → `(with the Can't-tell filings paragraph's re-run command, archive path included)`.

`review-console.md` "Can't-tell filings" — replace from `` `console.json` already records those items `filed`, so they are not residue … `` through the paragraph's end with:

`` Until its filed or deduped line is logged, every `console.json` `filings` entry reads as `filing-pending` residue (`bin/lib/console/residue.js`), so a failed or never-run filing is not lost: `console-residue.js --run` — the source of the run's final human-facing stop's Needs-a-human section — and the session-start residue notice list each with its re-run, `node "${CLAUDE_PLUGIN_ROOT}/bin/console-filings.js" --run "{item-run-dir}" --existing "{EXISTING}" --out-dir "{FILINGS}" --only '{item},…'` (`{EXISTING}` re-fetched as above; once the run dir is archived, `--run` is the run's `.claude-tweaks/pipelines/archive/{run-id}` copy, which `resolveTarget` accepts), and archival refuses the run until each is filed or a human acknowledges it. ``

`review-console-appendix.md` — after `` `residueAcknowledgedAt`, written only by `console-residue.js --ack`/`--ack-all` (#3370); `` insert: `` an item's stored resolution may later be rewritten by `console-resolve.js --set-item` (`refused-proposals.md`'s failed-execution rewrite — `apply` → `keep-staged`, adding `rewrittenFrom`/`rewrittenAt`, and dropping a stale `residueAcknowledgedAt`), and a `filings` entry whose fingerprint has no filed line in that dir's `decisions.md` reads as `filing-pending` residue (#4170); ``

- [ ] **Step 1: Update and add the conformance tests.**
  - `console-shadow-dup-outcomes-conformance.test.js`: `STEP7_FACTS` — change the `failed gh issue create` fact's pattern to `/A failed \`gh issue create\` on the proposal follows \`refused-proposals\.md\`'s failed-execution rewrite/`; add `['a failed composer is recorded for a human', /then record it per \`refused-proposals\.md\`'s failed-execution rewrite, \`\{why\}\` = \`shadow-dup-proposal\.js exited \{code\}\`/]`. The two controls that doctor `' and that \`SKIP\` line is its trace.'` (the FAILED-only and "next console" controls) re-anchor on `' and that \`SKIP\` line is its trace;'`, keeping their asserted messages.
  - `review-console-unattended-no-ask-conformance.test.js`: replace the `CARRY`/`CARRY_CHANNELS` pair and its test with `AC3.1: an unfiled can't-tell filing reads as residue with its --only re-run` — the short-circuit section (whitespace-collapsed) includes `` every `console.json` `filings` entry reads as `filing-pending` residue `` and `` --only '{item},…' `` and `archival refuses the run`, and does not include `so they are not residue`; control: doctoring `` reads as `filing-pending` residue `` away goes red through the same helper.
  - New `tests/console-failed-execution-residue-conformance.test.js` (live-prose carve-out, `[IL-80]`, same helper/control style as the shadow-dup suite — one `assert*` helper per fact, each control doctors the live text and expects that helper to throw):
    - `refused-proposals.md has the failed-execution section and its command` — section heading present; the bash block's single line matches `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "{item-run-dir}" --set-item '{name}' --resolution keep-staged --reason '{why}'`; the old `renders in Queue writes as today.` is no longer the paragraph's closing text outside the section.
    - `prose-code twin: every flag the rewrite command passes appears in console-resolve.js's USAGE` (import `USAGE` from `console-resolve.js`, Task 2).
    - `AC1.1: the documented rewrite, run on a console-auto fixture whose Queue write failed, leaves the item keep-staged and readRunResidue reports it` — build the `mainCheckoutWithRun`-style fixture inline (git init, policy `autonomy: unattended`, run dir with `staged/leftover-1.md` and `work/7-spec.md`), run `console-resolve.js`'s `run` with `--policy console-auto` and deps `{ cwd, mainRoot, stdout, stderr, now, execFile }` where `execFile` is a stub shaped like `cli.test.js`'s `fakeExec` (answers `git rev-parse`, `gh issue view`, `git apply`), then the extracted command's argv with `{item-run-dir}` → run dir, `{name}` → `leftover-1.md`, `{why}` → `record create failed (exit 1)` → exit 0, item `keep-staged`, `readRunResidue` lists `leftover-1.md`.
    - `AC2.1: a shadow-dup compose failure (exit 2 or 3) takes the same path and its SKIP line still appears` — for `code` in `['2', '3']`: fixture `staged: { 'leftover-1.md': 'a', 'leftover-1.md.shadow-dup': 'b' }` (divergent → `apply`); console-auto run; then step 7's SKIP command (reuse the extraction `step7SkipArgv` does: the first `log-decision.js` command in step 7) and the extracted rewrite with `{why}` → `shadow-dup-proposal.js exited ${code}`, `{name}` → `leftover-1.md.shadow-dup` → `decisions.md` has exactly one `- SKIP … Shadow-dup proposal (skipped): condition: shadow-dup-proposal.js exited ${code} for leftover-1.md.shadow-dup` line, console.json's `.shadow-dup` item is `keep-staged` with reason `shadow-dup-proposal.js exited ${code}`, and `readRunResidue` lists it.
    - control: `a rewrite command with a flag console-resolve.js lacks is refused by the same run` — doctored `--set-item` → `--bogus` → exit 2.

- [ ] **Step 2: Run to verify the new/changed assertions fail on the current prose**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/console-failed-execution-residue-conformance.test.js`
Expected: FAIL after Step 1 — the new facts are absent from step 7, the new section is absent from `refused-proposals.md`, the Can't-tell paragraph still says `so they are not residue`

- [ ] **Step 3: Apply the exact prose above** to the three skill files.

- [ ] **Step 4: Run to verify they pass** — the Step 2 command plus `node --test tests/deferral-gate-conformance.test.js tests/console-resolve-conformance.test.js tests/auto-merge-short-circuit-cant-tell.test.js tests/bin-lib/skill-audit/context-cost.test.js`. Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `Route a failed Queue write to the console rewrite and treat an unfiled can't-tell filing as residue — wrap-up prose`.

---

### Task 5: Reference docs

**Files:**
- Modify: `docs/plugin-structure.md` (line 38's `residue.js` / `finding-outcomes.js` descriptions — add `filing-pending`, `pendingFilings`/`consoleResidueItems`/`filingRerunCommand`, the moved `FILED_LINE_RE`/`filedRecords` with finding-outcomes re-exporting; a new `item-resolution.js` entry; line 157's console-resolve.js command line gains the `--set-item` shape)
- Modify: `docs/hooks.md` line 36 (the residue banner also lists a `filing-pending` planned filing and a rewritten `keep-staged` item)
- Modify: `docs/reconcile-checks.md` ~line 265 (a `console-residue` skip's hint names the `console-filings.js --only` re-run when a planned filing has no record)

- [ ] **Step 1: Edit** each location in place, one or two sentences each, matching the surrounding style.
- [ ] **Step 2: Verify** — Run: `git grep -c "filing-pending" -- docs/plugin-structure.md docs/hooks.md docs/reconcile-checks.md` / Expected: one line per file, each count ≥1.
- [ ] **Step 3: Commit** — `Document the console item rewrite and filing-pending residue — plugin-structure, hooks, reconcile-checks`.

---

## Verification before the whole-branch review

- **Real-input probe (plan-authoring Real-input + Independent-count checks):** run `collectUnresolvedConsoles` from the worktree's `plugin/bin/lib/hooks/session-residue.js` against the main checkout (`/Users/thomasholknielsen/Code Workspaces/claude-tweaks`, `{ limit: Infinity, window: Infinity, pluginRoot: '/p' }`) and count items whose resolution is `filing-pending`. Independent count, taken at authoring time with a scratch scan of every top-level and `archive/` `console.json` (and `spec-*/console.json`): **0** consoles carry a non-empty `filings` array, so the expected `filing-pending` count is exactly **0** and the run count must equal the count `origin/main`'s code reports (no historical run newly flagged).
- **Verbatim-command check:** the rewrite command in `refused-proposals.md` cannot run before Task 2 lands; Task 4's extract-and-run tests run it verbatim, so it is covered at execution, not at authoring (flagged here, per the check).
- Full suite via `skills/test/verification.md` at Common Step 5.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (sanctioned, anchored, locked rewrite) | 2 |
| Deliverable 2 (step 7 shadow-dup + failed create, refused-proposals failed-create) | 4 |
| Deliverable 3 (can't-tell filing reads as residue until record exists or deduped — residue reader checks `filings` against created records) | 1 |
| Deliverable 4 (Needs-a-human block + session-start notice list it with paste-ready line) | 1 (formatResidueLines feeds both), 2 (re-render block) |
| AC1.1 | 2, 4 |
| AC2.1 | 4 |
| AC3.1 | 1, 2, 3 |
| AC4.1 | 1, 2, 3 |
| AC4.2 (`npm test` passes) | Common Step 5 full suite |
