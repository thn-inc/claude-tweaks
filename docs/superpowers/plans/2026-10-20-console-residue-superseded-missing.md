# Console residue: superseded STAGED lines and missing staged files — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Review Console and the residue banners from counting (1) a STAGED low-confidence finding a later AUTO line in the same run already confirmed, and (2) a pending item whose staged file no longer exists, as "no human has reviewed".

**Architecture:** `coordinationItems` (`plugin/bin/lib/console/resolve.js`) learns a finding key (lens + first `path:line`) and drops a STAGED line when a later `- AUTO` line carries the same key and the producer's `Confirmed` sentence. `plugin/bin/lib/console/residue.js` gains `splitMissing`, which moves an unresolved staged-file item whose `staged/{id}` is absent into a separate `missing` list with resolution `missing`; `readRunResidue` keeps a console only for its present items, and `formatResidueLines` names missing items in one line. `console-resolve.js`'s re-render "Needs a human" block uses the same split.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T190659-record-3772/work/3772-spec.md`

Scope keywords: coordinationItems, readRunResidue, formatResidueLines, unresolvedItems

## Global Constraints

- Match on lens + `path:line` (spec Deliverable 1). The AUTO line must come **later** in the same `decisions.md`.
- A STAGED line with no later elevation keeps producing its `keep-staged` item exactly as today (AC2).
- The missing resolution literal is `missing`; missing items are excluded from the unreviewed count and named in one banner line.
- `residue.js` stays read-only (no writes to console.json or staged/).

## Review Focus

- A STAGED line naming two locations (`x.js:523 (agent A) and :61 (agent B…`) — the key is the first `path:line`; an AUTO elevation of `x.js:523` supersedes it.
- An AUTO line with the same location but a different lens must NOT supersede (lens is part of the key).
- An AUTO "Confirmed" line that comes BEFORE the STAGED line must NOT supersede it ("later").
- A `decision:` item and an item without a string id are never classified missing (they have no staged file).
- A console whose every unresolved item is missing is not listed at all (zero unreviewed items).

---

### Task 1: Supersede STAGED coordination lines confirmed later in the same run

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`coordinationItems`, ~`:396-414`)
- Modify: `docs/journeys/trust-a-defect-several-review-lenses-flagged-3604.md` (step 3's "Should understand" line: add that the console also drops a STAGED line a later AUTO line confirmed for the same lens + `path:line`)
- Test: `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Produces: internal `findingKey(line: string) -> string | null` (`"{lens}|{path}:{line}"`, null when either part is absent). Not exported beyond the module unless a test needs it.

- [ ] **Step 1: Write the failing tests** (append near the existing `decisions.md STAGED coordination entries…` test)

Use an excerpt shaped like run `2026-10-17T192303-spec-3412`'s decisions.md:

```js
const SUPERSEDED = [
  '## /review',
  '- STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:158 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.',
  '- AUTO 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:158 elevated via direct-verification override (comment sentence read independently). Confirmed, low. Reversibility: high.',
  '- STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/release-merged.js:523 (agent A) and :61 (agent B, same substance) not reproduced at the same line. Staged to Review Console as low-confidence. Reversibility: high.',
  '- AUTO 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/release-merged.js:523 elevated via direct-verification override (source read independently). Confirmed, low. Reversibility: high.',
  '- STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:39 not reproduced. Staged to Review Console as low-confidence — not elevated. Reversibility: high.',
  '',
].join('\n');
```

Tests:
- `AC1.1: a STAGED low-confidence line followed by a same-lens, same path:line AUTO elevation produces no Low-confidence item (#3772)` — `resolveAll` over `SUPERSEDED`; assert no Low-confidence item's id contains `pr-state.js:158` or `release-merged.js:523` (ids are `decision:` + `line.slice(2, 60)`, so assert on the count instead): exactly 1 Low-confidence item, and it is the `pr-state.js:39` line (check via `r.items.filter(section==='Low-confidence findings').length === 1`).
- `AC2.1: a STAGED low-confidence line with no later elevation still produces its keep-staged item (#3772)` — decisions with only the `pr-state.js:39` STAGED line → one Low-confidence item, `resolution === 'keep-staged'`, `reason === SECTION_STANCES['Low-confidence findings'].reason`.
- `a same-location AUTO elevation under a different lens does not supersede (#3772)` — STAGED lens "3a" `src/a.js:4`, AUTO lens "3f" `src/a.js:4 … Confirmed.` → 1 Low-confidence item.
- `an AUTO elevation logged before the STAGED line does not supersede it (#3772)` — AUTO first, STAGED second, same key → 1 Low-confidence item.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL after Step 1 — AC1.1 sees 3 Low-confidence items, not 1.

- [ ] **Step 3: Implement in `coordinationItems`**

Two passes over `decisionLines(snapshot.decisions)` with their indices. A STAGED line at index `i` with key `k = findingKey(line)` is skipped when some line at index `j > i` matches `/^- AUTO /`, has `findingKey === k`, and matches `/\bConfirmed\b/` (case-sensitive: every producer line in `review/step3-lens-dispatch.md` — reproduced / severity contested / direct-verification override / re-confirmed by executed run — ends in the sentence `Confirmed`; lowercase `not confirmed` must not match). Key regexes: lens `/\blens\s+"?([A-Za-z0-9_-]+)"?/i` (does not match `lenses`), location `/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/` (first match). A line with no key is never superseded. Update the function's header comment to name the supersession rule and #3772.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS (all, including the pre-existing `decisions.md STAGED coordination entries…` test).

- [ ] **Step 5: Real-input probe** — run `resolveAll` (scratch script, not committed) against `.claude-tweaks/pipelines/archive/2026-10-17T192303-spec-3412` with stub `readGrants`/`gitApplyCheck`; record Low-confidence count before (via `git show HEAD~:plugin/bin/lib/console/resolve.js` copy) and after. Independent count: `grep -c '^- STAGED .*low-confidence' decisions.md` minus the number of those keys that have a later `Confirmed` AUTO line.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve.test.js` then commit `Skip console coordination items a later AUTO line confirmed — refs #3772`.

### Task 2: `missing` resolution for console items whose staged file is gone

**Files:**
- Modify: `plugin/bin/lib/console/residue.js`
- Modify: `plugin/bin/console-resolve.js` (`needsAHumanBlock`, ~`:36-42`)
- Modify: `plugin/bin/lib/hooks/session-residue.js` (header comment of `scanUnresolvedConsoles` only — the banner text itself comes from `formatResidueLines`)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/console/` row's residue.js sentence: name `splitMissing` and the `missing` resolution)
- Consumer, unchanged: `plugin/bin/console-residue.js` (reads `readRunResidue`/`formatResidueLines`; inherits the change)
- Not touched: `docs/superpowers/plans/2026-10-19-review-medium-cross-lens-corroboration.md` (a historical plan that merely names `coordinationItems`)
- Test: `tests/bin-lib/console/residue.test.js`, `tests/bin-lib/hooks/session-residue.test.js`, `tests/bin-lib/console/residue-cli.test.js`; fixture updates in any suite that `npm test` shows breaking (see Step 6)

**Interfaces:**
- Produces: `MISSING_RESOLUTION = 'missing'`; `splitMissing(items: object[], consoleDir: string, exists = fs.existsSync) -> { items: object[], missing: object[] }`. An item is missing when `typeof id === 'string'`, `id !== ''`, `!id.startsWith('decision:')`, `path.basename(id) === id`, and `!exists(path.join(consoleDir, 'staged', id))`; each missing entry is `{ ...item, resolution: 'missing', reason: \`staged file absent (was ${item.resolution})\` }`.
- Changes: `readRunResidue(runDir, { readFile, readdir, exists })` — each console becomes `{ path, items, missing, acknowledged }`; a console is kept only when `items.length > 0`. `formatResidueLines` reads `c.missing || []`. All three exported names keep their signatures otherwise. Consumers (enumerated by `grep -rn "readRunResidue\|formatResidueLines\|unresolvedItems" plugin/bin`): `console-residue.js` (`--run` print, `--ack`), `lib/hooks/session-residue.js` (`scanUnresolvedConsoles` → SessionStart banner and `--ack-all`), `console-resolve.js` (`needsAHumanBlock`).

- [ ] **Step 1: Write the failing tests** (`residue.test.js`)

- `AC3.1: readRunResidue does not count a pending item whose staged file is absent (#3772)` — console.json items: `wrap-up-docs-1.md` (pending, file absent), `polish-suggestion-1.md` (pending, file present in `staged/`). Assert `consoles[0].items.map(i=>i.id)` is `['polish-suggestion-1.md']` and `consoles[0].missing` is one entry with `id 'wrap-up-docs-1.md'`, `resolution 'missing'`.
- `AC3.2: a console whose only unresolved items are missing is not residue (#3772)` — only absent-file items → `readRunResidue(dir).consoles` deep-equals `[]`.
- `AC3.3: formatResidueLines counts present items only and names missing ones in one line (#3772)` — header `- {base}: 1 item(s) no human has reviewed (console.json)`; exactly one line starting `  not counted — staged file(s) no longer on disk: ` naming `staged/wrap-up-docs-1.md`; no `  - wrap-up-docs-1.md` item line.
- `splitMissing never classifies a decision: item or an id-less item as missing (#3772)`.
- Session banner: in `session-residue.test.js`, `AC3.4: the SessionStart console scan skips a run whose pending items' staged files are all gone (#3772)` — archived run with `PENDING('wrap-up-docs-1.md')` and no staged file → `collectUnresolvedConsoles` returns `[]`.
- CLI: in `residue-cli.test.js`, `AC3.5: console-residue.js --run does not count a missing-file item (#3772)` — mixed console → stdout header says `1 item(s)` and has the `not counted —` line.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/residue.test.js tests/bin-lib/hooks/session-residue.test.js tests/bin-lib/console/residue-cli.test.js`
Expected: FAIL after Step 1 — `splitMissing` is not a function / counts include the absent-file item.

- [ ] **Step 3: Implement** `splitMissing`, the `readRunResidue` change, and the `formatResidueLines` line. The `not counted —` line is emitted once per run, after the item loop and the `… and N more` line, before `mark reviewed:`; names are `path.relative(dir, path.join(consoleDir, 'staged', id))` joined by `, `. Update the module header comment. In `console-resolve.js`, `needsAHumanBlock` splits with `splitMissing(unresolved, path.dirname(consolePath))`, returns `''` when no present items remain, counts present items in its header, and passes `missing` to `formatResidueLines`.

- [ ] **Step 4: Fix pre-existing fixtures** that model a pending staged-file item with no staged file (now, correctly, `missing`): give each fixture helper (`mkConsole` in `session-residue.test.js`, `pendingItems`/`CONSOLE_2821` users in `residue.test.js`, and whatever Step 6 surfaces) the staged files its items name, rather than changing assertions. The existing `formatResidueLines names every item…` test asserts `reflect-1.md` is listed with no cat line — the exact behavior this record replaces: change it to expect `reflect-1.md` in the `not counted —` line and the header count to drop to 3.

- [ ] **Step 5: Run to verify they pass**

Run: `node --test tests/bin-lib/console/residue.test.js tests/bin-lib/hooks/session-residue.test.js tests/bin-lib/console/residue-cli.test.js tests/bin-lib/console/cli.test.js tests/hooks-session-start.test.js tests/console-resolve-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Full suite** — `npm test > {scratch}/npm-test.txt 2>&1; echo exit=$?`; fix any further fixture that broke for the same reason (add the staged file), never by weakening an assertion.

- [ ] **Step 7: Real-input probe** — `readRunResidue` on `.claude-tweaks/pipelines/archive/2026-10-19T131646-record-3258` (console names `wrap-up-docs-1.md`/`-2.md`; `staged/` holds `wrap-up-doc-1.md`/`-2.md`): expect `items` = the one `decision:` item and `missing` = the two `wrap-up-docs-*` items. Independent count: `ls staged/` vs console.json ids.

- [ ] **Step 8: Commit** — explicit paths only; message `Give console items with a vanished staged file a missing resolution — refs #3772`.

### Task 3: AC4.1 — every new test goes red with its fix reverted

- [ ] AC4.1: for each of Task 1's and Task 2's fixes: restore the pre-change source via `git show {base}:{path} > {path}` (never `git stash`), run the new tests, confirm each new AC test FAILS, then `git show HEAD:{path} > {path}` back to the committed fix (same command that swapped it — never leave the swap across a timeout) and confirm PASS. Record the observed red/green output in the build handoff.

## As built (architecture alignment, /build Common Step 4.5)

- **Missing-file resolution lives in `residue.js`, not `resolve.js`** (Beneficial). The spec's Key Files assigned "missing-file resolution" to `resolve.js`, but `resolveAll` builds staged items from the current `staged/` listing, so a file can only be absent *after* resolution. `splitMissing` therefore derives `missing` at read time and writes nothing to `console.json` — compatible with every console already on disk and with older installed builds.
- **Third consumer covered** (Beneficial). `console-resolve.js`'s re-render "Needs a human" block uses the same split, with its own tests (`AC3.6` in `tests/bin-lib/console/cli.test.js`), so all three residue readers agree.
- **`missingOnly`** (Beneficial, final-review fix). A console whose only unresolved items are missing is still never residue (AC3.2), but when another console in the same run is listed, its missing items are named in the same single `not counted —` line.
