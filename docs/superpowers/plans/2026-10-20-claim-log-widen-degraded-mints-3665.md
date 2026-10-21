# Widen the claim-log-only class (#3665) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run dir whose `decisions.md` holds only `/flow` Step 2.8 bookkeeping (a claim line, canonical or paraphrased, plus Step 2.8 file-overlap / `bot:in-progress` projection lines) still classifies `claim-log-only`, so hook fallback attribution and `/flow` preflight adoption keep treating it as an unadopted mint.

**Architecture:** All shape knowledge stays in `plugin/bin/lib/log-decision/claim-log.js`'s `classifyDecisions`. The two readers (`isUnadoptedMint`/`isClaimLogOnlyMint` in `plugin/bin/lib/hooks/context.js`, `decisionsHasContent` in `plugin/bin/lib/flow/preflight.js`) are not edited — they already compare `classifyDecisions(...) === 'claim-log-only'` / `=== 'content'` and inherit the widened class. Task 2 only adds regression tests through those readers.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T200642-record-3665/work/3665-spec.md`

## Global Constraints

- Fail closed: every line the classifier cannot positively recognise stays `content`. `claim-log-only` still needs at least one claim line — a file holding only bookkeeping lines (no claim) is `content`.
- No second copy of the shape check in either reader (spec Deliverable 2).
- `verify-run-bookends.js` (`hasCanonicalClaimLogFor`), `dispatch/first-call-artifact-check.js` (`hasCanonicalClaimLogFor`) and `pre-tool-use.js` (`hasClaimLogFor`) must stay byte-unchanged in behavior: do not touch `hasClaimLogFor`, `hasCanonicalClaimLogFor`, `isClaimLogEntry`, or `paraphrasedClaimNumbers`.
- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #3665` (never `closes`/`fixes`), end with `Claude-Session: https://claude.ai/code/session_017fRzMhhknYotFN8c5d1Y1o`.

## Design decisions (made at plan time — do not re-decide)

1. **Paraphrased claim lines count only when complete.** A line counts as a claim when `isClaimLogEntry(line)` OR (`paraphrasedClaimNumbers(line).length > 0` AND the line ends with the `Reversibility:` suffix, regex `/\sReversibility: [^.\s][^.]*\.$/`). Reason: `paraphrasedClaimNumbers` alone accepts a canonical claim line truncated mid-write (`…claimed #2861 (bin/claim-targets.js, transpor`), and the existing assertion `classifyDecisions(REAL_SINGLE.slice(0, -30)) === 'content'` ("a claim line truncated mid-write", `tests/bin-lib/log-decision/claim-log.test.js:93`) must keep passing. Every #3012 real paraphrase fixture in that test file ends with the suffix. **As built (Task 1 review ruling + whole-branch review fix, 59e200225):** a paraphrase must also be claim-anchored — the parsed entry's location (spec prefix stripped) matches `CLAIM_ANCHOR_RE`, or, for a `log-decision` location or a line `parseEntry` cannot parse, the text before `Reversibility:` does — so a later-step line that merely mentions a claim (`Manifesto: …; Step 2.8 claimed #7.`) stays `content`.
2. **Bookkeeping lines are matched by their Step 2.8 location, not their exact text.** Real-input probe (2026-10-20, every archived `decisions.md` under the main checkout's `.claude-tweaks/pipelines/archive/`): 17 lines mention `Step 2.8 file-overlap`; only 1 is the verbatim `claim-targets.md:117` SKIP text — the others are model-worded AUTO/SCANNED/SKIP variants (`Step 2.8 file-overlap warning: #3401 overlaps open …`, `Step 2.8 file-overlap check: …`, `Step 2.8 file-overlap warning (skipped): condition: PIPELINE_RUN_DIR set on entry …`, `Step 2.8 file-overlap warning (retry): …`). An exact-text matcher would leave the #3337 contamination open for most real degraded runs, the same reason #3012 added paraphrase recognition for claims. The predicate: `parseEntry(line)` is non-null; `status` ∈ {`AUTO`, `SKIP`, `SCANNED`}; the location with any `spec #N — ` prefix stripped matches `/^Step 2\.8 (?:file-overlap (?:warning|check)|bot:in-progress projection)\b/`; and the line ends with the `Reversibility:` suffix. Anything else — a `log-decision:` location, a STAGED/REFUSED/KEPT-PROMPT status, a bare `Step 2.8:` location that is not a claim (e.g. `claim contested`) — stays `content`. This departs from the spec's literal "the two `SKIP` shapes" on purpose; both documented shapes are a subset and are pinned by a writer/parser test against `claim-targets.md`'s argv.

Waived AC4.2: the full `npm test` suite runs centrally in `/build` Common Step 5 and the `/test` gate, never inside a task dispatch.

## Review Focus

1. A claim line truncated mid-write (canonical or paraphrased) beside a valid claim — must stay `content`. Pinned in Task 1.
2. A file holding only a Step 2.8 bookkeeping line and no claim line — must stay `content` (nothing claimed). Pinned in Task 1.
3. The dispatch first-call model line (`- AUTO {time} — Dispatch group [7]: first-call model resolved to … (source: …). Reversibility: n/a.`, `dispatch/task-prompt.md`) beside a claim — must stay `content`, since `docs/skill-graph.md:240` says a change to `classifyDecisions`'s claim-log-only membership must re-check that write's timing. Pinned in Task 1.
4. A contested or FAILED claim line, or a `log-decision:`-located overlap note, beside a valid claim — must stay `content`. Pinned in Task 1.
5. A Step 2.8 bookkeeping line under a foreign heading (`## /build`) — the heading line itself must keep the file `content`. Pinned in Task 1.

---

### Task 1: Widen `classifyDecisions` and pin its new membership

**Files:**
- Modify: `plugin/bin/lib/log-decision/claim-log.js` (header comment lines 1-8; new predicate near `isClaimLogEntry`; `classifyDecisions` at lines 99-117; `module.exports`)
- Modify: `tests/bin-lib/log-decision/claim-log.test.js` (append tests)
- Modify: `plugin/skills/flow/steps-and-gates.md:70` (case 2 parenthetical) — 39,135 B today, rail 52,500 B; this adds under 200 B
- Modify: `docs/hooks.md:21` (unadopted-mint sentence)

**Interfaces:**
- Produces: `isClaimStepBookkeepingEntry(line: string) -> boolean` (exported from `claim-log.js`) and the widened `classifyDecisions(text) -> 'absent'|'empty'|'claim-log-only'|'content'` (same signature, same four values).

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/log-decision/claim-log.test.js`, importing `isClaimStepBookkeepingEntry` alongside the existing destructure. Fixtures (use verbatim):

```js
const OVERLAP_SKIP = '- SKIP 18:42:05 — Step 2.8 file-overlap warning (skipped): condition: preflight-records.js exited non-zero or gh unavailable → fallback: overlap warning not computed; claim proceeds on the named targets only. Reversibility: n/a.';
const DEGRADED_SKIP = "- SKIP 18:42:07 — Step 2.8 bot:in-progress projection (degraded): condition: label still absent on #2861 after one mergeLabelNames retry → fallback: claim kept; dispatch's label pre-filter will not see this hold. Reversibility: n/a.";
const OVERLAP_NOTE = '- AUTO 21:08:24 — Step 2.8 file-overlap warning: #3401 overlaps open #2869, #3004 on plugin/skills/build/dispatch.md (untracked file overlap) — warning only; proceeding with the named target alone. Reversibility: n/a.';
const PARAPHRASED = '- AUTO 07:42:07 — spec #827 — flow/claim-targets: Claimed issue #827 for this run (claims-registry blob write, state: absent -> live). Reversibility: high.';
```

Tests and assertions:
- `"claim-targets.md's two documented Step 2.8 SKIP commands produce lines isClaimStepBookkeepingEntry accepts (#3665 writer/parser pin)"`: read `plugin/skills/flow/claim-targets.md`; collect every line containing `--status SKIP --step "Step 2.8` (assert exactly 2); from each extract the `--step "…"` and `--text "…"` values with a regex, replace `{n}` with `2861`, build `formatEntry({ status: 'SKIP', now: NOW, step, text, reversibility: 'n/a' })`; assert `isClaimStepBookkeepingEntry(line) === true` and `classifyDecisions(`${REAL_SINGLE}${line}\n`) === 'claim-log-only'`.
- `'classifyDecisions: a claim plus Step 2.8 bookkeeping lines is claim-log-only (#3665)'`: `${REAL_SINGLE}${OVERLAP_SKIP}\n` → `'claim-log-only'`; `${REAL_SINGLE}${DEGRADED_SKIP}\n` → `'claim-log-only'`; `${REAL_SINGLE}${OVERLAP_NOTE}\n` → `'claim-log-only'`; `## /flow\n${OVERLAP_SKIP}\n${REAL_SINGLE.split('\n')[1]}\n${DEGRADED_SKIP}\n` → `'claim-log-only'` (order-independent).
- `'classifyDecisions: a complete paraphrased claim line counts as a claim (#3665)'`: `## /flow\n${PARAPHRASED}\n` → `'claim-log-only'`; `## /flow\n${PARAPHRASED}\n${DEGRADED_SKIP}\n` → `'claim-log-only'`; the #3012 line `'- AUTO -- Step 2.8 claim: both #1447 and #1446 claimed successfully under runId 2026-08-29T232244-record-1446 (claim-targets.js exit 0). Reversibility: high.'` alone → `'claim-log-only'`.
- `'classifyDecisions: the widened class still fails closed (#3665 Review Focus)'` (covers AC4.1; the Manifesto and build-line cases at lines 98-99 of this file stay as they are), each → `'content'`:
  - `${REAL_SINGLE}${PARAPHRASED.slice(0, -40)}\n` (truncated paraphrase)
  - `${REAL_SINGLE.slice(0, -30)}` (existing truncated canonical — re-asserted)
  - `## /flow\n${OVERLAP_SKIP}\n` and `## /flow\n${DEGRADED_SKIP}\n` (bookkeeping, no claim)
  - `${REAL_SINGLE}- AUTO 18:50:00 — Dispatch group [2861]: first-call model resolved to claude-opus-5-5 (source: policy). Reversibility: n/a.\n`
  - `${REAL_SINGLE}- AUTO 21:08:27 — Step 2.8: claim contested: #3004 held live by run 2026-10-16T190307-record-2734 (claimed 19:07:35, ttl 72h). Reversibility: n/a.\n`
  - `${REAL_SINGLE}- AUTO 08:00:00 — Step 2.8: claimed #3012 — FAILED (exit 4). Reversibility: n/a.\n`
  - `${REAL_SINGLE}- AUTO 18:43:35 — log-decision: Step 2.8 file-overlap warning check skipped as redundant. Reversibility: n/a.\n`
  - `${REAL_SINGLE}- STAGED 18:42:05 — Step 2.8 file-overlap warning: x. Reversibility: n/a.\n`
  - `${REAL_SINGLE}## /build\n${OVERLAP_SKIP}\n`
  - `${REAL_SINGLE}${OVERLAP_SKIP.slice(0, -20)}\n` (truncated bookkeeping)
- `'isClaimStepBookkeepingEntry: location-anchored, complete, AUTO/SKIP/SCANNED only (#3665)'`: true for `OVERLAP_SKIP`, `DEGRADED_SKIP`, `OVERLAP_NOTE`, `'- SCANNED 16:48:50 — Step 2.8 file-overlap warning: preflight-records.js over the 2 targets: no overlap. Reversibility: n/a.'`, `'- AUTO 15:02:24 — Step 2.8 file-overlap check: #418 groups alone. Reversibility: n/a (informational).'`, and `OVERLAP_SKIP.replace('— Step 2.8', '— spec #7 — Step 2.8')`; false for `REAL_SINGLE.split('\n')[1]` (a claim is not bookkeeping), `'## /flow'`, `''`, the STAGED and `log-decision:` lines above, `'- AUTO 10:00:00 — Step 2.8: claim contested for #7. Reversibility: n/a.'`, `'- AUTO 10:00:00 — Step 2.85 file-overlap warning: x. Reversibility: n/a.'`, and `OVERLAP_SKIP.slice(0, -20)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/log-decision/claim-log.test.js`
Expected: FAIL — `isClaimStepBookkeepingEntry is not a function`.

- [ ] **Step 3: Implement in `plugin/bin/lib/log-decision/claim-log.js`**
  - Add `const COMPLETE_RE = /\sReversibility: [^.\s][^.]*\.$/;` and `const BOOKKEEPING_LOCATION_RE = /^Step 2\.8 (?:file-overlap (?:warning|check)|bot:in-progress projection)\b/;` and `const BOOKKEEPING_STATUSES = new Set(['AUTO', 'SKIP', 'SCANNED']);`
  - `function isClaimStepBookkeepingEntry(line)`: `parseEntry(line)` non-null, status in the set, `entry.location.replace(/^spec #\d+ — /, '')` matches `BOOKKEEPING_LOCATION_RE`, `COMPLETE_RE.test(String(line))`. Header comment cites #3665 and the two `claim-targets.md` SKIP shapes plus the model-worded variants (design decision 2).
  - `classifyDecisions`: per non-blank, non-`SECTION_HEADING` line — claim if `isClaimLogEntry(line) || (COMPLETE_RE.test(line) && paraphrasedClaimNumbers(line).length > 0)` → `claims += 1`; else `isClaimStepBookkeepingEntry(line)` → continue; else return `'content'`. Return `claims > 0 ? 'claim-log-only' : 'content'` (unchanged). Update its comment block to name the three accepted line kinds and #3665.
  - Update the file's header comment (lines 6-8): `isClaimLogEntry` stays exact; `classifyDecisions` now also accepts complete paraphrased claims and Step 2.8 bookkeeping lines (#3665).
  - Add `isClaimStepBookkeepingEntry` to `module.exports`.

- [ ] **Step 4: Update prose**
  - `plugin/skills/flow/steps-and-gates.md:70`: replace `no \`decisions.md\` content beyond Step 2.8's own claim-log lines — \`claim-targets.md\` logs them before this step, and the pack recognises them via \`bin/lib/log-decision/claim-log.js\`, #2861)` with `no \`decisions.md\` content beyond Step 2.8's own claim-log lines — its claim, canonical or paraphrased, and its file-overlap / \`bot:in-progress\` projection notes; \`claim-targets.md\` logs them before this step, and the pack recognises them via \`bin/lib/log-decision/claim-log.js\`, #2861, #3665)`.
  - `docs/hooks.md:21`: replace `one holding only \`flow\` Step 2.8's claim-log lines (\`classifyDecisions\` → \`'claim-log-only'\`, #3363;` with `one holding only \`flow\` Step 2.8's claim-log lines — its claim, canonical or paraphrased, plus its file-overlap / \`bot:in-progress\` projection notes (\`classifyDecisions\` → \`'claim-log-only'\`, #3363, #3665;`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/bin-lib/log-decision/claim-log.test.js`
Expected: PASS, 0 failures (the pre-existing `classifyDecisions` test at line 84 included).

- [ ] **Step 6: Real-input probe** — run the new predicate over every `Step 2.8 file-overlap` line in the main checkout's archived run dirs and reconcile with an independent count:

Run: `grep -rh "Step 2.8 file-overlap" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive" --include=decisions.md > {scratch}/overlap-lines.txt` then `node -e "const {isClaimStepBookkeepingEntry:f}=require('./plugin/bin/lib/log-decision/claim-log');const l=require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);console.log(l.length,l.filter(f).length)" {scratch}/overlap-lines.txt`
Independent count: `grep -c "— Step 2.8 file-overlap" {scratch}/overlap-lines.txt`
Expected (as of 2026-10-20): `17 14`, and the independent count `14` — the 3 rejected lines are the `log-decision:`-located ones. Record the printed numbers in the task report; a later archive can raise both counts, but accepted must equal the independent count.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/log-decision/claim-log.js tests/bin-lib/log-decision/claim-log.test.js plugin/skills/flow/steps-and-gates.md docs/hooks.md
git commit -m "Widen classifyDecisions' claim-log-only class — Step 2.8 bookkeeping and complete paraphrased claims stay a fresh mint, refs #3665"
```

---

### Task 2: Reader regression cases through hook attribution and preflight adoption

**Files:**
- Modify: `tests/hooks-run-attribution.test.js` (append after the #3363 block ending at line 279)
- Modify: `tests/bin-lib/flow/preflight.test.js` (append after the `AC2.1 … (#3363)` test at line 435-441)

**Interfaces:**
- Consumes: Task 1's widened `classifyDecisions` (no direct import — exercised through `ctxLib.resolveRun` and `computeAdoption`).
- Readers are NOT modified. Sole-site proof (run 2026-10-20): `git grep -n "classifyDecisions" -- plugin` → `plugin/bin/lib/hooks/context.js:76`, `:91`, `plugin/bin/lib/flow/preflight.js:159` (plus the definition and imports). If an implementer finds a need to edit `context.js` or `preflight.js`, STOP and report — that would be the second copy of the shape check the spec forbids.

- [ ] **Step 1: Write the failing tests** — fixtures in both files (verbatim, `#7` to match the existing `CLAIM_ONLY`):

```js
const OVERLAP_SKIP_LINE = '- SKIP 18:42:05 — Step 2.8 file-overlap warning (skipped): condition: preflight-records.js exited non-zero or gh unavailable → fallback: overlap warning not computed; claim proceeds on the named targets only. Reversibility: n/a.\n';
const DEGRADED_SKIP_LINE = "- SKIP 18:42:07 — Step 2.8 bot:in-progress projection (degraded): condition: label still absent on #7 after one mergeLabelNames retry → fallback: claim kept; dispatch's label pre-filter will not see this hold. Reversibility: n/a.\n";
const PARAPHRASED_ONLY = '## /flow\n- AUTO 07:42:07 — spec #7 — flow/claim-targets: Claimed issue #7 for this run (claims-registry blob write, state: absent -> live). Reversibility: high.\n';
const DEGRADED_MINTS = [
  ['overlap-skip', `${CLAIM_ONLY}${OVERLAP_SKIP_LINE}`],
  ['degraded-projection-skip', `${CLAIM_ONLY}${DEGRADED_SKIP_LINE}`],
  ['paraphrased-claim', PARAPHRASED_ONLY],
];
```

Covers AC1.1 (overlap-skip entry), AC2.1 (degraded-projection and paraphrased entries), AC3.1 (the preflight tests).

`tests/hooks-run-attribution.test.js`, one test per `DEGRADED_MINTS` entry (loop generating `test(...)`), name `` `fallback never selects a degraded Step 2.8 mint: ${kind} (no run-state.json) (#3665)` ``: `cwd = project()`, `real = mkRun(cwd, '2026-07-01T090000-real', { status: 'active' })`, `mint = mkRun(cwd, '2026-07-02T090000-mint', null)` with `decisions.md` = the text; assert `ctxLib.resolveRun(cwd, {}, 'me')` and `ctxLib.resolveRun(cwd, {}, null)` both deep-equal `{ dir: real, attribution: 'fallback' }`. Plus one test `'a degraded Step 2.8 mint plus a Manifesto line is adopted (#3665)'`: the overlap-skip text + `'- AUTO 18:43:00 — Manifesto: levers written. Reversibility: n/a.\n'`, only that dir → `{ dir: mint, attribution: 'fallback' }`.

`tests/bin-lib/flow/preflight.test.js`, one test per entry, name `` `AC: degraded Step 2.8 mint (${kind}) beside fallback-only events.jsonl → case 2, not case 3 (#3665)` ``: `adoptionFor(text, { 'events.jsonl': <the same two fallback-attributed lines the #3363 AC2.1 test uses> })` → `a.case === 2`, `a.hasOtherContent === false`, `a.backfills` deep-equals `[]`. Plus one test: the overlap-skip text + `'- AUTO 18:42:16 — Manifesto: design-critique resolved to auto (source: default). Reversibility: n/a.\n'` → `a.case === 3`.

- [ ] **Step 2: Run tests to verify they fail against the pre-Task-1 classifier**

Run: `node --test tests/hooks-run-attribution.test.js tests/bin-lib/flow/preflight.test.js`
Expected: FAIL after Step 1 when `claim-log.js` is the pre-Task-1 version (the three degraded mints resolve as adopted / case 3). With Task 1 landed these pass by design (no reader change), so prove discrimination with a revert probe: copy the current file aside, write `git show HEAD~1:plugin/bin/lib/log-decision/claim-log.js` over it, run the command above, then restore the copy — swap, run and restore in ONE Bash command so a timeout cannot strand the old file. Quote the failing test names in the report.

- [ ] **Step 3: Run tests to verify they pass**

Run: `node --test tests/hooks-run-attribution.test.js tests/bin-lib/flow/preflight.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 4: Run every suite that reads a Step 2.8 fixture**

Run: `node --test tests/bin-lib/log-decision/claim-log.test.js tests/hooks-run-attribution.test.js tests/bin-lib/flow/preflight.test.js tests/hooks-run-dir-resolve.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/verify-run-bookends.test.js tests/bin-lib/dispatch/first-call-artifact-check.test.js tests/flow-claim-preflight.test.js tests/dispatch-flow-rundir-handoff.test.js tests/dispatch-flow-rundir-handoff-fixture.test.js tests/dispatch-model-profile-conformance.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS, 0 failures. (List derived from `git grep -ln "Step 2.8" -- tests`, minus suites unrelated to decisions.md classification.)

- [ ] **Step 5: Commit**

```bash
git add tests/hooks-run-attribution.test.js tests/bin-lib/flow/preflight.test.js
git commit -m "Pin degraded Step 2.8 mints through hook attribution and preflight adoption — readers inherit the widened class, refs #3665"
```
