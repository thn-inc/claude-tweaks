# SDD Ruling Console Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every load-bearing SDD `Ruling:` line to a human at the wrap-up Review Console as a ratify-or-reverse row, instead of filing it as a terminal `observation` ledger row nobody reads.

**Architecture:** Three prose files and one code file change. `build/dispatch.md`'s carry-forward instruction reclassifies a first-match `Ruling:` line as load-bearing and tells SDD's Finish step to append an `open` ledger row and then stage `staged/sdd-ruling-{N}.md` (ledger first, so the staged file's `Ledger:` back-reference names the item number). `bin/lib/console/resolve.js` gains `sdd-ruling` in the Pending-review `.md` prefix regex so the console routes it under the `apply` stance, which the wrap-up console prose now defines as **ratify**; `reverse` is the Override vocabulary that files a born-ready reversal record. Two conformance suites pin the mapping, the staging call, the order, the no-run-directory branch, and a both-ways prose-code twin pin between the regex alternation and the appendix prefix list.

**Tech Stack:** Markdown skill prose, Node 18+ `node --test`, existing `bin/stage-item.js` / `log-decision.js` / `wrap-up-engine.js finish-console` machinery (no new CLI).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T190411-spec-3401/work/3401-spec.md` (worktree-local copy of the materialized record #3401)

**Scope keywords:** sdd-ruling

## Global Constraints

- Edit only the carry-forward sentence span of `plugin/skills/build/dispatch.md` line 14 — the line is pinned byte-exactly by many suites (`build-sdd-final-review-capture`, `build-ac-forwarding-verification`, `build-dispatch-status-token-and-tree-immutability`, `foreground-execution-instruction`, `dispatch-no-stash-conformance`, `ceremony-profile-roster`, …). Verified at plan time: `grep -rln -F "status \`deferred\` for a \`minor" tests/` returns only `tests/build-sdd-ledger-residue-carryforward.test.js`; `grep -rn -F "copying first is what keeps" tests/` returns nothing; `grep -rn -F "as that step already describes" tests/` returns nothing; `grep -rn -F 'its Status is never left' tests/` returns nothing; `grep -rn -F 'Override specific items" is chosen' tests/` returns nothing.
- These literals from the existing line 14 MUST survive unchanged (pinned by the carry-forward suite's other tests): `Carry forward surviving SDD ledger residue before Finish`; `` `<workspace>/progress.md` line matching `minor (deferred):`, `parked —`, or `Ruling:` ``; `a line matching more than one marker is copied once, under its first match in that order`; `SDD 6.3.0+ ledgers its pre-flight, fix-loop breaker and final-review decisions as `Ruling:` lines instead of stopping for the human`; `before deleting the plan's workspace (`rm -rf <workspace>`), it must copy`.
- `grep -c 'or \`observation\` for a \`parked —\` or \`Ruling:\` line' plugin/skills/build/dispatch.md` must print `0` after Task 1 (AC2.1); `grep -c 'first marker match is \`Ruling:\`'` and `grep -c 'sdd-ruling-{N}'` each at least `1` (AC2.2, AC2.3).
- Byte ceilings: shared 51,200-byte ceiling on every `plugin/skills/**/*.md`. Measured on the merge base: `dispatch.md` 17,139 B; `review-console-appendix.md` 10,186 B; `review-console-interactive.md` 19,456 B; `review-console.md` 24,327 B. No file-specific or per-skill pin exists for any of the four (`grep -rn -E "review-console(-appendix|-interactive)?\.md|dispatch\.md" tests/ | grep -E "byteLength|wc -c|CEILING"` returns nothing). Headroom is ample; no split needed.
- `Defer-reason: genuinely-larger` is the vocabulary value for a reversal record (`_shared/deferral-gate.md` line 51/65: clears the floor). Never leave a staged record proposal reason-less.
- Status vocabulary stays the closed enum: `open`, `accepted`, `deferred`, `observation` (`_shared/ledger-format.md`). No change to `ledger-format.md`, `nothing-left-behind.md`, or `/claude-tweaks:ledger`.
- The ratify write-back path is `wrap-up/review-console.md` step 11's `finish-console --approve-all` `ledger` array (verified at plan time: `plugin/bin/wrap-up-engine.js` lines 545-574 take `{item, status, resolution}` and flip rows via `lib/wrap-up/ledger-write`). Add no second write path.
- Commit messages: `{Verb} {what} — {detail}` imperative style, each ending with the trailer `Claude-Session: https://claude.ai/code/session_01KVGNZPTZZBckdFvhaag1be`. Stage specific files only; never `git stash`, never `git reset`.
- Work only inside the worktree: `cd "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow-spec-3401"` — `pwd` and `git rev-parse --show-toplevel` must print that path before any commit.

## Review Focus

1. A `progress.md` line carrying both `parked —` and `Ruling:` — must stay `observation` (first match `parked —`), never become an `open` ruling row. Pinned in Task 1 (the three-way mapping sentence + the "first match" rule remain in one span).
2. A ruling carried forward with the staged file written *before* the ledger row — the `Ledger:` back-reference would name a non-existent item. Pinned in Task 1 (ledger-then-file order assertion).
3. A standalone `/build` with no `$PIPELINE_RUN_DIR` — must stage nothing and keep the row `open`, not `observation`. Pinned in Task 1 (no-run-directory branch assertion).
4. `sdd-ruling` added to the regex but not the appendix list (or vice versa) — the twin pin must go red in both directions. Pinned in Task 2 (two negative-control tests sharing the positive assertion function).
5. A bare `skip` on a ruling row at the Override prompt — must be refused, naming `ratify`/`reverse`. Pinned in Task 3 (prose pin on `review-console-interactive.md`).

---

### Task 1: Reclassify first-match `Ruling:` lines in `dispatch.md` and pin the three-way mapping

**Files:**
- Modify: `plugin/skills/build/dispatch.md:14` (the carry-forward span only)
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the literal prose phrases `sdd-ruling-{N}`, `first marker match is `Ruling:``, and the staged header block names (`Title:` / `Kind: sdd-ruling` / `Ruling:` / `Staged-at:` / `Ledger:`) that Task 3's appendix bullet and Task 2's regex refer to by name.

- [ ] **Step 1: Replace the mapping test and add the new pins**

In `tests/build-sdd-ledger-residue-carryforward.test.js`, replace the test named `dispatch.md: the directive names the destination — the run ledger's Add Item operation, phase build, deferred/observation status` with these tests (AC1.1, AC2.1–AC2.3):

```js
test('AC1.1 AC2.1: the directive maps deferred-minor → deferred, parked → observation, Ruling → open (three-way, first match wins)', () => {
  assert.match(
    DISPATCH,
    /this build's own open items ledger \(`\/claude-tweaks:ledger`'s Add Item operation\) — phase `build`, status `deferred` for a `minor \(deferred\):` line, `observation` for a `parked —` line, or `open` for a `Ruling:` line/
  );
  assert.doesNotMatch(DISPATCH, /or `observation` for a `parked —` or `Ruling:` line/, 'the pre-#3401 two-way mapping must be gone');
});

test('AC2.2: the classification rule — a first-match Ruling: line is load-bearing — is stated with its reason', () => {
  assert.match(DISPATCH, /whose first marker match is `Ruling:` is load-bearing — every pre-flight, mid-run, breaker, and residual final-review ruling/);
  assert.match(DISPATCH, /SDD writes the bare form only where it decided in lieu of a human, and the residual final-review shape has no pinned prefix to sniff/);
  assert.match(DISPATCH, /a `parked —` line's first match is `parked —`, so the match order already separates the two classes/);
});

test('AC2.3: the run-directory branch stages staged/sdd-ruling-{N}.md via stage-item.js --allocate, ledger first then the file, and logs STAGED', () => {
  assert.match(DISPATCH, /Item `SDD ruling — \{one-liner\}: ratify or reverse at the Review Console \(staged\/sdd-ruling-\{N\}\.md\)`/);
  assert.match(DISPATCH, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stage-item\.js" --run "\$PIPELINE_RUN_DIR" --id "sdd-ruling-\{N\}" --file \{tmp\} --allocate/);
  assert.match(DISPATCH, /`Title:`.*?`Kind: sdd-ruling`.*?`Ruling:`.*?`Staged-at:`.*?`Ledger: \{ledger path\}#\{item-number\}`/);
  assert.match(DISPATCH, /STAGED \{time\} — SDD ruling carried forward: staged\/sdd-ruling-\{N\}\.md — "\{one-liner\}"\. Reversibility: high\./);
  const ledgerIdx = DISPATCH.indexOf('(1) append the ledger row — phase `build`, status `open`');
  const fileIdx = DISPATCH.indexOf('(2) write the staged file via');
  assert.ok(ledgerIdx > 0 && fileIdx > ledgerIdx, 'ledger row (1) must precede the staged-file write (2)');
  assert.match(DISPATCH, /ledger first, then the file/);
});

test('the no-run-directory branch keeps the row open, stages nothing, and hands the ruling to the Step 7 handoff', () => {
  assert.match(DISPATCH, /\*\*No run directory\*\* \(standalone `\/claude-tweaks:build`, no `\$PIPELINE_RUN_DIR`\): no console will read `staged\/`, so append the ledger row with status `open` and the same Item text minus the staged path, stage nothing, and list each ruling in the Step 7 handoff/);
  assert.match(DISPATCH, /`Accept` = ratify, `Keep`\/`Defer` = reverse as a follow-up, `Fix anyway` = reverse now/);
  assert.match(DISPATCH, /a ruling's text states a decision, not a defect, so it does not qualify on its own/);
});
```

Also update the file's header comment's second sentence to read `... copy surviving SDD deferred-minor / parked / Ruling ledger lines ...` (one word added; no test pins the comment).

- [ ] **Step 2: Run the suite to verify the new tests fail against the unchanged prose**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: FAIL — the four new tests fail (`AC1.1 AC2.1` on the three-way regex, `AC2.2`, `AC2.3`, and the no-run-directory test); the six untouched tests pass. This red run is the AC1.1 proof that the new mapping assertion fails against the pre-change `dispatch.md` — quote its summary line in the task report.

- [ ] **Step 3: Rewrite the carry-forward span in `plugin/skills/build/dispatch.md` line 14**

Replace exactly this span (it begins after `into this build's own open items ledger (`/claude-tweaks:ledger`'s Add Item operation)`):

```
 — phase `build`, status `deferred` for a `minor (deferred):` line or `observation` for a `parked —` or `Ruling:` line — a line matching more than one marker is copied once, under its first match in that order — using the line's own one-liner (the text following the marker) as the ledger Item description.
```

with:

```
 — phase `build`, status `deferred` for a `minor (deferred):` line, `observation` for a `parked —` line, or `open` for a `Ruling:` line — a line matching more than one marker is copied once, under its first match in that order — using the line's own one-liner (the text following the marker) as the ledger Item description. A line whose first marker match is `Ruling:` is load-bearing — every pre-flight, mid-run, breaker, and residual final-review ruling — because SDD writes the bare form only where it decided in lieu of a human, and the residual final-review shape has no pinned prefix to sniff; a `parked —` line's first match is `parked —`, so the match order already separates the two classes. For each load-bearing ruling, ledger first, then the file: (1) append the ledger row — phase `build`, status `open`, Item `SDD ruling — {one-liner}: ratify or reverse at the Review Console (staged/sdd-ruling-{N}.md)`; then (2) write the staged file via `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$PIPELINE_RUN_DIR" --id "sdd-ruling-{N}" --file {tmp} --allocate` (`{N}` a per-invocation counter from 1; `--allocate` for the same clobber reason `build-deviation-{N}` carries it) with a header block `Title:` (the one-liner, truncated to the console's row width) / `Kind: sdd-ruling` / `Ruling:` (the `progress.md` line verbatim) / `Staged-at:` (short HEAD sha) / `Ledger: {ledger path}#{item-number}` (the item number step (1) just assigned — the reason for the order) and a body holding the ruling text, the task number when the line carries one, and the two dispositions (ratify / reverse); then (3) log `STAGED {time} — SDD ruling carried forward: staged/sdd-ruling-{N}.md — "{one-liner}". Reversibility: high.` under `## /build` via `log-decision.js`. The Review Console's Pending review section resolves it — `apply` there means ratify (`wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet). **No run directory** (standalone `/claude-tweaks:build`, no `$PIPELINE_RUN_DIR`): no console will read `staged/`, so append the ledger row with status `open` and the same Item text minus the staged path, stage nothing, and list each ruling in the Step 7 handoff; a later standalone `/claude-tweaks:wrap-up`'s resolve gate drills it per item with its existing vocabulary — `Accept` = ratify, `Keep`/`Defer` = reverse as a follow-up, `Fix anyway` = reverse now — and Phase 1's fix-now criteria apply as written (a ruling's text states a decision, not a defect, so it does not qualify on its own).
```

Everything else on line 14 stays byte-identical. The whole line stays one line (no inserted newlines).

- [ ] **Step 4: Run the suite and the AC greps**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: PASS (10 tests, 0 failures).

Run: `grep -c 'or \`observation\` for a \`parked —\` or \`Ruling:\` line' plugin/skills/build/dispatch.md; grep -c 'first marker match is \`Ruling:\`' plugin/skills/build/dispatch.md; grep -c 'sdd-ruling-{N}' plugin/skills/build/dispatch.md`
Expected: `0` (grep exits 1 on zero matches — that is the expected output), then `1`, then `1`.

Run: `node --test tests/build-sdd-final-review-capture.test.js tests/build-ac-forwarding-verification.test.js tests/build-dispatch-status-token-and-tree-immutability.test.js tests/foreground-execution-instruction.test.js tests/dispatch-no-stash-conformance.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS — the neighbouring line-14 pins are untouched.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/dispatch.md tests/build-sdd-ledger-residue-carryforward.test.js
git commit -m "Reclassify first-match SDD Ruling lines as load-bearing — open row + staged sdd-ruling-{N}.md in dispatch.md carry-forward (refs #3401)

Claude-Session: https://claude.ai/code/session_01KVGNZPTZZBckdFvhaag1be"
```

---

### Task 2: Route `sdd-ruling-*` to Pending review in `resolve.js` and pin the prose-code twin

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js:51` (the Pending-review `.md` prefix regex)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md:67-68` (the parenthesized prefix list only — the bullet's new semantics are Task 3)
- Test: `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces: `classifyStagedItem('sdd-ruling-1.md')` → `{ section: 'Pending review' }` (no `reason`); `resolveAll` resolution `apply` for an `sdd-ruling-*` item. Exported helper names used only inside the test file: `pendingMdPrefixesFromCode()`, `pendingMdPrefixesFromProse(text)`, `assertPendingPrefixTwin(codeSet, proseSet)`.

- [ ] **Step 1: Add the section/resolution pins and the twin-pin tests**

In `tests/bin-lib/console/resolve.test.js`:

1. In the `classifyStagedItem maps every known prefix …` test's `expect` map, add `'sdd-ruling-1.md': 'Pending review'` on the line with the other Pending-review `.md` prefixes (AC3.1).
2. In `EVERY_SECTION`, add `'sdd-ruling-1.md': 'Title: ruling\nKind: sdd-ruling\nRuling: Task 2: Ruling: keep the guard — cheaper than the alternative — costs a re-read if wrong\nStaged-at: abc123\nLedger: docs/plans/x-ledger.md#5\n\nratify / reverse\n'`, and in the `resolveAll resolves one item per section …` test add `assert.strictEqual(by['sdd-ruling-1.md'].resolution, 'apply');` (AC4.1 — `apply` is the ratify stance).
3. Append these tests at the end of the file (AC4.1, AC4.2):

```js
// Prose-code twin pin (#3401): resolve.js's Pending-review `.md` prefix
// alternation and review-console-appendix.md's prose prefix list name the
// same closed set. Both directions, so a prefix added to one side alone
// goes red; the two negative controls below run the same assertion the
// positive test runs, against a mutated input.
const APPENDIX = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'review-console-appendix.md'), 'utf8');

function pendingMdPrefixesFromCode(map = SECTION_MAP) {
  const rows = map.filter(([re, section]) => section === 'Pending review' && /^\^\(.*\)-$/.test(re.source));
  assert.strictEqual(rows.length, 1, 'exactly one Pending-review .md prefix alternation in SECTION_MAP');
  return rows[0][0].source.slice(2, -2).split('|').sort();
}

function pendingMdPrefixesFromProse(text = APPENDIX) {
  const m = /- `apply` on a \*\*Pending review\*\* item[\s\S]*?a staged `\.md` proposal \(([^)]*)\)/.exec(text);
  assert.ok(m, 'the appendix `apply` on Pending review bullet with its parenthesized `.md` prefix list is present');
  const prefixes = [...m[1].matchAll(/`([a-z-]+)-\*`/g)].map((x) => x[1]).sort();
  assert.ok(prefixes.length > 0, 'the prose list names at least one prefix');
  return prefixes;
}

function assertPendingPrefixTwin(codeSet, proseSet) {
  assert.deepStrictEqual(codeSet, proseSet, 'SECTION_MAP Pending-review .md prefixes and review-console-appendix.md prose list must name the same set');
}

test('AC4.1: the Pending-review .md prefix alternation and the appendix prose list name the same set, both ways (#3401 twin pin)', () => {
  const code = pendingMdPrefixesFromCode();
  const prose = pendingMdPrefixesFromProse();
  assert.ok(code.includes('sdd-ruling'), 'sdd-ruling is in the regex');
  assert.ok(prose.includes('sdd-ruling'), 'sdd-ruling is in the prose list');
  assertPendingPrefixTwin(code, prose);
});

test('AC4.2 (control): removing sdd-ruling from the regex alone makes the twin pin fail', () => {
  const mutated = SECTION_MAP.map(([re, s]) => (s === 'Pending review' && /^\^\(.*\)-$/.test(re.source)
    ? [new RegExp(re.source.replace('|sdd-ruling', '').replace('sdd-ruling|', '')), s]
    : [re, s]));
  assert.throws(() => assertPendingPrefixTwin(pendingMdPrefixesFromCode(mutated), pendingMdPrefixesFromProse()));
});

test('AC4.2 (control): removing sdd-ruling-* from the appendix prose alone makes the twin pin fail', () => {
  const mutated = APPENDIX.replace(/,?\s*`sdd-ruling-\*`/, '');
  assert.notStrictEqual(mutated, APPENDIX, 'the mutation removed the prose entry');
  assert.throws(() => assertPendingPrefixTwin(pendingMdPrefixesFromCode(), pendingMdPrefixesFromProse(mutated)));
});
```

- [ ] **Step 2: Run the suite to verify the new tests fail**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — the `maps every known prefix` test fails on `sdd-ruling-1.md` (`reason` is `unmapped-prefix`), the `resolveAll` test fails (`pending` ≠ `apply`), the AC4.1 twin test fails (`sdd-ruling` in neither side), and both controls fail (`assert.throws` finds nothing thrown because both sides are still equal without it). Pre-existing tests pass.

- [ ] **Step 3: Add `sdd-ruling` to the regex and to the prose list**

`plugin/bin/lib/console/resolve.js` line 51 — change `[/^(polish-suggestion|visual-review|design-decision|build-deviation|simplify|deepen)-/, SECTIONS.PENDING],` to `[/^(polish-suggestion|visual-review|design-decision|build-deviation|simplify|deepen|sdd-ruling)-/, SECTIONS.PENDING],`.

`plugin/skills/wrap-up/review-console-appendix.md` line 68 — change `` `visual-review-*`, `design-decision-*`, `build-deviation-*`, `simplify-*`, `deepen-*`) applied `` to `` `visual-review-*`, `design-decision-*`, `build-deviation-*`, `simplify-*`, `deepen-*`, `sdd-ruling-*`) applied ``.

- [ ] **Step 4: Run the suite and the AC3 probe**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS (every test, including the three new twin tests).

Run: `node -e "const {classifyStagedItem}=require('./plugin/bin/lib/console/resolve.js'); console.log(JSON.stringify(classifyStagedItem('sdd-ruling-1.md')))"`
Expected: `{"section":"Pending review"}` exactly (no `reason` key).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js plugin/skills/wrap-up/review-console-appendix.md tests/bin-lib/console/resolve.test.js
git commit -m "Route sdd-ruling-* staged items to Pending review — regex + appendix prefix list, pinned both ways (refs #3401)

Claude-Session: https://claude.ai/code/session_01KVGNZPTZZBckdFvhaag1be"
```

---

### Task 3: Define ratify/reverse console semantics in the wrap-up prose and pin them

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-appendix.md:69-70` (insert one bullet after the `apply` on Pending review bullet)
- Modify: `plugin/skills/wrap-up/review-console-interactive.md:60` (insert one paragraph after the "If "Override specific items" is chosen…" line)
- Modify: `plugin/skills/wrap-up/review-console.md:110` (append one clause to step 1)
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js` (the record's own suite grows a console-prose section)

**Interfaces:**
- Consumes: the prefix `sdd-ruling-*` (Task 2) and the staged header names `Ledger:` / `Ruling:` (Task 1).
- Produces: the prose contract `apply` = ratify → ledger `accepted`; `reverse` → `staged/ledger-record-sdd-ruling-{N}.md` + ledger `deferred` `reversed → #{new record}`; Override vocabulary `ratify {#}` / `reverse {#}`, bare `skip {#}` refused.

- [ ] **Step 1: Add the console-prose pins**

Append to `tests/build-sdd-ledger-residue-carryforward.test.js`:

```js
const APPENDIX = read('plugin', 'skills', 'wrap-up', 'review-console-appendix.md');
const INTERACTIVE = read('plugin', 'skills', 'wrap-up', 'review-console-interactive.md');
const CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');

test('AC5.1: the appendix maps apply on an sdd-ruling-* item to ratify (ledger accepted) and reverse to a born-ready reversal record (ledger deferred, reversed →)', () => {
  assert.ok((APPENDIX.match(/sdd-ruling/g) || []).length >= 2, 'prefix list plus the Resolution-to-step bullet');
  // Each literal below sits on one physical line of the wrapped bullet (Task 3 Step 3 gives the exact wrap).
  assert.match(APPENDIX, /- `apply` on an `sdd-ruling-\*` item — still step 1, but it executes no code change: it/);
  assert.match(APPENDIX, /writes the item's `Ledger:` row back to `accepted`, Resolution/);
  assert.match(APPENDIX, /`ratified at Review Console — \{the ruling's own "— why" clause\}`/);
  assert.match(APPENDIX, /through `finish-console`'s existing `ledger` array/);
  assert.match(APPENDIX, /`reverse`[\s\S]*?composes a born-ready record proposal exactly as/);
  assert.match(APPENDIX, /`_shared\/ledger-format\.md`'s Phase 3 `Keep` does \(`specShapedBody`/);
  assert.match(APPENDIX, /`Origin: SDD ruling reversed at Review Console`; `Defer-reason: genuinely-larger`/);
  assert.match(APPENDIX, /stages it as `staged\/ledger-record-sdd-ruling-\{N\}\.md`,/);
  assert.match(APPENDIX, /routes it through step 7 in the same pass, and/);
  assert.match(APPENDIX, /writes the row back to `deferred`, Resolution `reversed → #\{new record\}`/);
});

test('AC5.2: the interactive console names ratify/reverse as the Override vocabulary for a ruling row and refuses a bare skip', () => {
  assert.match(INTERACTIVE, /the Override vocabulary for one is `ratify \{#\}` \/ `reverse \{#\}`/);
  assert.match(INTERACTIVE, /A bare `skip \{#\}` on one is refused with a one-line notice naming the two/);
  assert.match(INTERACTIVE, /SDD already decided, so the human confirms or files the reversal, never leaves it undecided/);
});

test('review-console.md step 1 points an sdd-ruling-* write-back at the appendix bullet', () => {
  assert.match(CONSOLE, /an `sdd-ruling-\*` item's write-back follows `review-console-appendix\.md`'s `sdd-ruling-\*` bullet \(ratify → `accepted`; reverse → `deferred`\), not the patch table/);
});
```

- [ ] **Step 2: Run the suite to verify the three new tests fail**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: FAIL — exactly the three new console-prose tests fail; the Task 1 tests pass.

- [ ] **Step 3: Write the three prose additions**

`plugin/skills/wrap-up/review-console-appendix.md` — insert this bullet immediately after the `apply` on Pending review bullet (after the line ending `as that step already describes for a non-patch item.`), before the `apply` on a `Q#` item bullet:

```
- `apply` on an `sdd-ruling-*` item — still step 1, but it executes no code change: it
  writes the item's `Ledger:` row back to `accepted`, Resolution
  `ratified at Review Console — {the ruling's own "— why" clause}` (under Approve all,
  through `finish-console`'s existing `ledger` array — `review-console.md` step 11).
  `reverse` (the Override vocabulary for a ruling row, `review-console-interactive.md`)
  composes a born-ready record proposal exactly as
  `_shared/ledger-format.md`'s Phase 3 `Keep` does (`specShapedBody`; Current State = the
  ruling and the finding it ruled on; Deliverables = the reversal;
  `Origin: SDD ruling reversed at Review Console`; `Defer-reason: genuinely-larger`),
  stages it as `staged/ledger-record-sdd-ruling-{N}.md`,
  routes it through step 7 in the same pass, and
  writes the row back to `deferred`, Resolution `reversed → #{new record}`. The console
  cannot change code for a reversal — the fix wave is closed — so filing is the only
  reverse action.
```

Use exactly these line breaks (two-space continuation indent, as the neighbouring bullets) — every Step 1 pin is a phrase that sits on one of these physical lines.

`plugin/skills/wrap-up/review-console-interactive.md` — insert this paragraph after the line `If "Override specific items" is chosen, the skip/modify list is ordinary free-text chat in the next message, …` (line 60), separated by blank lines:

```
**`sdd-ruling-*` rows (Pending review, #3401):** the Override vocabulary for one is `ratify {#}` / `reverse {#}` — `ratify` is step 1's `apply` (`review-console-appendix.md`'s `sdd-ruling-*` bullet; ledger row → `accepted`), `reverse` files the reversal record per that same bullet (ledger row → `deferred`). A bare `skip {#}` on one is refused with a one-line notice naming the two — `#{#} is an SDD ruling — reply `ratify {#}` or `reverse {#}`; skip is not available` — because SDD already decided, so the human confirms or files the reversal, never leaves it undecided.
```

`plugin/skills/wrap-up/review-console.md` line 110 (step 1) — append, after `its Status is never left `open` for a finding this step just applied`, the clause: ` — an `sdd-ruling-*` item's write-back follows `review-console-appendix.md`'s `sdd-ruling-*` bullet (ratify → `accepted`; reverse → `deferred`), not the patch table`.

- [ ] **Step 4: Run the suites and the AC5 greps**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js tests/bin-lib/console/resolve.test.js`
Expected: PASS (both files; the Task 2 twin pin is unaffected because the bullet's parenthesized list was not touched).

Run: `grep -c 'sdd-ruling' plugin/skills/wrap-up/review-console-appendix.md; grep -c 'reverse' plugin/skills/wrap-up/review-console-interactive.md`
Expected: a number `>= 2`, then a number `>= 1`.

Run: `wc -c plugin/skills/wrap-up/review-console-appendix.md plugin/skills/wrap-up/review-console-interactive.md plugin/skills/wrap-up/review-console.md`
Expected: every value below `51200`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/review-console-appendix.md plugin/skills/wrap-up/review-console-interactive.md plugin/skills/wrap-up/review-console.md tests/build-sdd-ledger-residue-carryforward.test.js
git commit -m "Define ratify/reverse console semantics for sdd-ruling-* rows — appendix bullet, Override vocabulary, step-1 clause (refs #3401)

Claude-Session: https://claude.ai/code/session_01KVGNZPTZZBckdFvhaag1be"
```

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 — classification rule beside the mapping, with reason | Task 1 |
| Deliverable 2 — run-directory staged surface (ledger row, `stage-item.js --allocate`, header block, STAGED log, ledger-then-file) | Task 1 |
| Deliverable 3 — console semantics (`resolve.js` regex; appendix prefix list + bullet; interactive vocabulary; `review-console.md` step 1 clause) | Task 2 (regex, prefix list), Task 3 (bullet, vocabulary, clause) |
| Deliverable 4 — no-run-directory branch | Task 1 |
| Deliverable 5 — tests (mapping pin, classification, staging call, order, no-run-dir; `sdd-ruling-1.md` section + `apply`; twin pin) | Task 1, Task 2 |
| AC1.1 (carry-forward suite passes, new assertion red pre-change) | Task 1 Step 2 (red) / Step 4 (green) |
| AC2.1–AC2.3 (three greps) | Task 1 Step 4 |
| AC3.1 (`classifyStagedItem` probe) | Task 2 Step 4 |
| AC4.1–AC4.2 (resolve suite incl. twin pin, controls go red) | Task 2 |
| AC5.1–AC5.2 (appendix greps/wording, interactive refuses bare skip) | Task 3 |
| AC6.1 (`npm test` in full) | `/build` Common Step 5 — runs centrally after all tasks |
