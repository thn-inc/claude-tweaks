# SDD Deferral-Ruling Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop SDD rulings that defer work from bypassing the fix-now test and from being auto-ratified at `autonomy: unattended` (#3880).

**Architecture:** Two halves. The producer half is prose in `plugin/skills/build/dispatch.md`: a deferral ruling runs `_shared/deferral-gate.md`'s fix-now test (against the spec's AC literal text) when it is written, and the carry-forward stamps a `Defers: yes|no` header (plus `Defer-reason:` on a deferral) into `staged/sdd-ruling-{N}.md`. The console half is code in `plugin/bin/lib/console/resolve.js`: under `console-auto`, an `sdd-ruling-*` item whose header does not prove it safe resolves `pending` instead of `apply`. `wrap-up/review-console-appendix.md` states the console rule; a conformance test pins both halves' prose and the prose-code reason literals.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T062405-record-3880/work/3880-spec.md`

## Global Constraints

- `DEFER_REASONS` in `plugin/bin/lib/issues/record.js` is the vocabulary's only code home — import it, never copy the six values.
- A non-deferral ruling (a settled design decision, `Defers: no`) resolves exactly as today (`apply`, section Pending review, reason `Approve-all default (patch validated with git apply --check first)`).
- `classifyStagedItem(filename)` stays prefix-only for `sdd-ruling-*` (no reason) — `bin/stage-item.js` calls it with no text to detect `unmapped-prefix`; the new check lives in `stagedItems()`, not in `classifyStagedItem`.
- Skill files stay under `RAIL_BYTES` (52,500 B): `dispatch.md` is 31,062 B and `review-console-appendix.md` 12,879 B on the merge base; this plan adds roughly 1.5 KB and 0.8 KB respectively — ample headroom.
- `npm test` passes in full (spec AC5). Commit messages `{Verb} {what} — {detail}`, `refs #3880`, never `closes`/`fixes`.

Waived AC5.1: the full `npm test` run is `/build`'s Common Step 5 and `/flow`'s test gate, not a per-task test step.

## Review Focus

1. A `Defer-reason:` that appears only inside the quoted `Ruling:` header line, or in the body after the first blank line, must not count as the header key — otherwise a quoted reason auto-ratifies an unreasoned deferral. (Task 1 test `reason-in-ruling-line-or-body-does-not-count`.)
2. A ruling staged before this change (no `Defers:` line) reaching a console built after it must resolve `pending — sdd-ruling-unclassified`, never `apply`. (Task 1 test `no-defers-line-is-unclassified`.)
3. A CRLF-written staged file (Windows checkout) must parse its header values without a trailing `\r` making `no` read as unclassified. (Task 1 test `crlf-header-parses`.)
4. `build-deviation-*` items (the contract-beats-spec form, same header shape) are untouched by the new check. (Task 1 test `build-deviation-unaffected`.)
5. Two `Defer-reason:` header lines (ambiguous) resolve `pending`, never `apply` with either one. (Task 1 test `two-defer-reasons-pending`.)

---

### Task 1: Console half — `sddRulingDeferralReason` in `resolve.js`

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (add the function + constants near `parseCategory`; wire into `stagedItems`; extend `module.exports`)
- Test: `tests/bin-lib/console/resolve.test.js` (update the `sdd-ruling-1.md` entry of `EVERY_SECTION` at line 50 to carry `Defers: no` after its `Ruling:` line; add the tests below)

**Interfaces:**
- Produces: `SDD_RULING_REASONS = Object.freeze({ NO_DEFER_REASON: 'sdd-ruling-deferral-no-defer-reason', UNCLASSIFIED: 'sdd-ruling-unclassified' })` and `sddRulingDeferralReason(text: string|null|undefined) => string|null` (null = resolve as today), both exported from `resolve.js`. Task 2's conformance test imports `SDD_RULING_REASONS`.

Semantics of `sddRulingDeferralReason(text)` (header = the lines before the first blank line, split on `/\r?\n/`, each line right-trimmed):
- `text` null/undefined (unreadable) → `UNCLASSIFIED`.
- `defers` = value of the header line matching `/^Defers:[ \t]*(\S+)$/`, lower-cased; `reasons` = values of every header line matching `/^Defer-reason:[ \t]*(\S*)$/` (line-start anchored — a `Defer-reason:` mid-line inside `Ruling: …` never matches).
- Deferral when `defers === 'yes'` or `reasons.length > 0`. A deferral returns null only when `reasons.length === 1 && DEFER_REASONS.includes(reasons[0])`; else `NO_DEFER_REASON`.
- Not a deferral and `defers === 'no'` → null. Otherwise (no `Defers:` line, or a value other than yes/no) → `UNCLASSIFIED`.

In `stagedItems`, after the refused check and after `classifyStagedItem` (only when it returned no reason), for `s.name` matching `/^sdd-ruling-/`: `const r = sddRulingDeferralReason(s.text); if (r) return { id: s.name, section, resolution: 'pending', reason: r };`.

- [ ] **Step 1: Write the failing tests (covers AC3.1, AC4.1)** in `tests/bin-lib/console/resolve.test.js`, a `RULING(headerLines)` helper building `'Title: ruling\nKind: sdd-ruling\nRuling: Task 2: Ruling: defer the guard to a follow-up — cheaper — costs a re-read\n' + headerLines + 'Staged-at: abc123\nLedger: docs/plans/x-ledger.md#5\n\nratify / reverse\n'`, each test resolving one staged `sdd-ruling-N.md` via `resolveAll({ runDir: fixture({ staged, headers: [7] }), policy: 'console-auto', deps: deps() })` and asserting on that item:
  - `defers-no-resolves-apply`: `Defers: no\n` → `resolution === 'apply'`, `reason === SECTION_STANCES['Pending review'].reason`, `section === 'Pending review'` (AC4).
  - `defers-yes-valid-reason-resolves-apply`: `Defers: yes\nDefer-reason: needs-human-decision\n` → `'apply'`.
  - `defers-yes-no-reason-pending`: `Defers: yes\n` → `resolution === 'pending'`, `reason === 'sdd-ruling-deferral-no-defer-reason'` (AC3).
  - `defers-yes-invalid-reason-pending`: `Defers: yes\nDefer-reason: minor\n` → pending, `sdd-ruling-deferral-no-defer-reason`.
  - `two-defer-reasons-pending`: `Defers: yes\nDefer-reason: genuinely-larger\nDefer-reason: blocked-external\n` → pending, `sdd-ruling-deferral-no-defer-reason`.
  - `reason-key-without-defers-line-is-a-deferral`: `Defer-reason: bogus\n` (no `Defers:`) → pending, `sdd-ruling-deferral-no-defer-reason`.
  - `no-defers-line-is-unclassified`: `''` → pending, `sdd-ruling-unclassified`.
  - `reason-in-ruling-line-or-body-does-not-count`: staged text whose `Ruling:` line ends `— Defer-reason: genuinely-larger` and whose body (after the blank line) has `Defer-reason: genuinely-larger`, header with `Defers: yes` and no `Defer-reason:` header line → pending, `sdd-ruling-deferral-no-defer-reason`.
  - `crlf-header-parses`: `RULING('Defers: no\n').replace(/\n/g, '\r\n')` → `'apply'`.
  - `build-deviation-unaffected`: staged `build-deviation-1.md` with `Kind: build-deviation` and no `Defers:` line → `'apply'`.
  - Unit test on the exported function: `sddRulingDeferralReason(null) === 'sdd-ruling-unclassified'`; `sddRulingDeferralReason('Defers: YES\nDefer-reason: blocked-dependency\n\nx') === null` (case-insensitive yes/no); `classifyStagedItem('sdd-ruling-1.md')` still deep-equals `{ section: 'Pending review' }`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — `sddRulingDeferralReason`/`SDD_RULING_REASONS` undefined, and the pending-expecting tests resolve `apply`. (The `defers-no`, `valid-reason`, `crlf`, `build-deviation` cases may already pass — they are the AC4 controls; the existing `resolveAll resolves one item per section` test must still pass after the fixture gains `Defers: no`.)

- [ ] **Step 3: Implement** `SDD_RULING_REASONS`, `sddRulingDeferralReason`, the `stagedItems` wiring, and the exports in `plugin/bin/lib/console/resolve.js`, requiring `DEFER_REASONS` from `../issues/record`. Add a short comment naming #3880 and `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet as the prose twin.

- [ ] **Step 4: Run to verify they pass, and prove discrimination**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS. Then, in a scratch worktree (never in place), delete the `reasons.length === 1` condition (accept any reason) and confirm `two-defer-reasons-pending` goes red; replace the line-start anchor with an unanchored match and confirm `reason-in-ruling-line-or-body-does-not-count` goes red; make an absent `Defers:` return null and confirm `no-defers-line-is-unclassified` goes red.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve.test.js
git commit -m "Gate console-auto ratification of deferral SDD rulings — pending without a valid Defer-reason (refs #3880)"
```

### Task 2: Producer half and console prose — `dispatch.md`, appendix bullet, conformance test

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (line 14's paragraph: a new bold-led sentence after the `**Review findings go through the deferral gate (#3004).**` block, and the carry-forward header-block clause)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (the `- \`apply\` on an \`sdd-ruling-*\` item` bullet, ending `…never at step 1.` around line 95)
- Create: `tests/build-sdd-ruling-deferral-gate.test.js`

**Interfaces:**
- Consumes: `SDD_RULING_REASONS` from `plugin/bin/lib/console/resolve.js` (Task 1).

Exact text to insert in `dispatch.md`, immediately after the sentence ending `Severity alone ("minor", "fine to defer") is never a reason.`:

> **Deferral rulings go through the same gate (#3880).** In the same invocation instruction, also direct `/superpowers:subagent-driven-development` that a `Ruling:` whose decision defers work — leaves a finding or a required change unfixed in this build, whether routed to a follow-up record, left as pre-existing, or ruled out of scope — runs `_shared/deferral-gate.md`'s fix-now criteria when it is written, checked against this spec's `## Acceptance Criteria` as literal text from the materialized spec at `{run-dir}/work/{n}-spec.md`. A deferred item an acceptance criterion's literal text covers, or one that meets every fix-now criterion, is not ruled: it goes to the current fix loop (the fix wave, for a final-review ruling) and is fixed in this build, so it never reaches the Review Console. A deferral that fails the gate is written with exactly one `Defer-reason: {value}` from that file's vocabulary appended to its `Ruling:` line; that file's bad reasons (pre-existing in a touched file, out of scope, minor) never fail the gate.

Replace the header-block clause `a header block \`Title:\` (the one-liner, truncated to the console's row width) / \`Kind: sdd-ruling\` / \`Ruling:\` (the \`progress.md\` line verbatim) / \`Staged-at:\` (short HEAD sha)` with:

> a header block `Title:` (the one-liner, truncated to the console's row width) / `Kind: sdd-ruling` / `Ruling:` (the `progress.md` line verbatim) / `Defers:` (`yes` when the ruling defers work, per the deferral-ruling rule above, else `no` — always written) / `Defer-reason:` (on a `Defers: yes` ruling only, the one value its line carries — omitted when it carries none, which leaves the item for a human at the console) / `Staged-at:` (short HEAD sha)

Append to the appendix `sdd-ruling-*` bullet, as its final sentences (same two-space continuation indent):

> Under `console-resolve.js --policy console-auto` (unattended) an `sdd-ruling-*` item resolves `apply` (ratify) only when its staged header shows it is safe (#3880): `Defers: no` — a settled design decision, resolved exactly as before — or `Defers: yes` with exactly one `Defer-reason:` header line whose value is in `_shared/deferral-gate.md`'s vocabulary. A deferral without a valid reason resolves `pending — sdd-ruling-deferral-no-defer-reason`; a header with no `Defers:` line, or an unreadable file, resolves `pending — sdd-ruling-unclassified`, since the console cannot tell whether it defers. Neither is ever auto-ratified.

- [ ] **Step 1: Write the failing conformance test (covers AC1.1, AC2.1, AC3.1)** `tests/build-sdd-ruling-deferral-gate.test.js` (style of `tests/build-sdd-ledger-residue-carryforward.test.js`: `readText` from `./helpers/read-skill`, the `ws()` whitespace-tolerant helper), with tests:
  - `producer: a deferral ruling runs the fix-now gate against AC literal text when written` — `DISPATCH` matches `/\*\*Deferral rulings go through the same gate \(#3880\)\.\*\*/`, `ws("runs `_shared/deferral-gate.md`'s fix-now criteria when it is written, checked against this spec's `## Acceptance Criteria` as literal text")`, and `ws('is fixed in this build, so it never reaches the Review Console')` (AC1).
  - `producer: a failing deferral carries exactly one Defer-reason` — matches `ws('written with exactly one `Defer-reason: {value}` from that file\'s vocabulary')` (AC2).
  - `producer: the staged header carries Defers and Defer-reason between Ruling and Staged-at` — matches `/`Ruling:`.*?`Defers:`.*?always written.*?`Defer-reason:`.*?`Staged-at:`/s`.
  - `console prose: the appendix sdd-ruling bullet states the console-auto rule with the code's reason literals` — the appendix contains `--policy console-auto`, `` `Defers: no` ``, and both `pending — ${SDD_RULING_REASONS.NO_DEFER_REASON}` and `pending — ${SDD_RULING_REASONS.UNCLASSIFIED}` (prose-code twin).
  - `control: a mutated appendix missing the reason literal fails the twin` — `APPENDIX.replace(SDD_RULING_REASONS.UNCLASSIFIED, 'x')` no longer contains `pending — sdd-ruling-unclassified`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/build-sdd-ruling-deferral-gate.test.js`
Expected: FAIL on the four prose assertions (the text is absent).

- [ ] **Step 3: Apply the three prose edits above** to `dispatch.md` (two sites) and `review-console-appendix.md`, verbatim.

- [ ] **Step 4: Run the new test and every suite that pins these two files**

Run: `node --test tests/build-sdd-ruling-deferral-gate.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/build-contract-beats-spec-literal.test.js tests/bin-lib/console/resolve.test.js`
Expected: PASS. Then `git grep -l -F 'review-console-appendix.md' -- tests` and `git grep -l -F 'build/dispatch.md' -- tests` and run every listed file; all PASS. `wc -c plugin/skills/build/dispatch.md plugin/skills/wrap-up/review-console-appendix.md` both under 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/dispatch.md plugin/skills/wrap-up/review-console-appendix.md tests/build-sdd-ruling-deferral-gate.test.js
git commit -m "Route SDD deferral rulings through the fix-now gate — Defers/Defer-reason staged header, console rule stated (refs #3880)"
```
