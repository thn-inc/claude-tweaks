# Refused review-followup ledger settlement (#4772) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Review Console refusal reopens whichever ledger row's Resolution names the refused staged path, which covers `review-followup-*` as well as `ledger-record-*`. `ledger-format.md` records this as the one named exception to "never a reopen", and `ledger/SKILL.md` points at it.

**Architecture:** Prose-only change to three skill files, plus one conformance block in `tests/deferral-gate-conformance.test.js`. The block pins content-anchored strings in each edited span, and each pin has a go-red control that runs the same assertion function against mutated text.

**Tech Stack:** Markdown skill files; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-11-01T182343-record-4772/work/4772-spec.md`

**Scope keywords:** `ledger-record-`, `review-followup-`, `never a reopen`, `proposal refused — no defer reason`, `Reopening resolved items`

## Global Constraints

- The literal note text `proposal refused — no defer reason` stays byte-identical.
- No `DEFER_REASONS` value appears in any edited text (AC5). The existing `refused-proposals.md never hardcodes the vocabulary` test must keep passing.
- `ledger-format.md` holds the one canonical statement of the exception. `refused-proposals.md` and `ledger/SKILL.md` point at it and never restate its rationale.
- Never write the literal tokens `TBD`, `TODO`, or `<!-- ambiguity:` in authored prose.
- Byte headroom against `RAIL_BYTES` (52,500 B): `refused-proposals.md` 3,964 B, `ledger-format.md` 36,275 B, `ledger/SKILL.md` 14,355 B. Each grows by under 600 B, so all stay far below the rail.
- Commit message style: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer.

## Review Focus

1. **Path-prefix collision.** A refused `staged/review-followup-1.md` must not reopen a row whose Resolution names `staged/review-followup-10.md`. The prose must say the match is on the exact path. Pinned by an anchor in Task 1.
2. **Multi-spec console.** The row to reopen lives in the ledger of the run dir whose `staged/` holds the item (`spec-{N}/`), not the parent's. Pinned by an anchor in Task 1.
3. **A proposal no row names.** This falls through to the unchanged no-ledger-origin branch: it stays staged and dies at `close-run`. That branch's sentence must survive the edit. Pinned by an anchor in Task 1.
4. **`--dry-run`.** The reopen is previewed, not applied, and the dry-run sentence must survive. Pinned by an anchor in Task 1.
5. **The note text and the staged-file deletion.** Both must survive verbatim, because readers may grep the note. Pinned in Task 1.

## Prose decisions (exact text the implementer writes)

**`plugin/skills/wrap-up/refused-proposals.md`, `## Ledger origin`.** Replace the paragraph's first sentence, from "When the refused proposal came from a ledger item" through "(the ledger item is the durable trace).", with:

> When a ledger row's Resolution names the refused proposal's staged path (`staged/{name}` — the exact path, so `staged/review-followup-1.md` never matches a row naming `staged/review-followup-10.md`): set that row's status back to `open` with note `proposal refused — no defer reason`, so the ledger's own nothing-left-behind gate resurfaces it on the next resolve; delete the staged file (the ledger item is the durable trace). Today's producers are `staged/ledger-record-*.md` (the ledger resolve gate's Defer/Keep) and `staged/review-followup-*.md` (`/review` Step 3's record proposal). In a multi-spec run the row is in the ledger of the run dir whose `staged/` holds the item. This is the one reopen `_shared/ledger-format.md`'s Resolution-text requirements allow.

Keep the rest of the paragraph unchanged: the "A refused proposal with **no** ledger origin …" sentences, and the `--dry-run` paragraph after it.

**`plugin/skills/_shared/ledger-format.md`, `**Resolution-text requirements.**` paragraph.** Insert right after the sentence "Terminal statuses are final — a wrong fix gets a new item, never a reopen.":

> The one exception: a `deferred` row whose Resolution names a staged record proposal that the Review Console refuses for want of a valid `Defer-reason:` returns to `open` — its deferral never completed (`wrap-up/refused-proposals.md`'s Ledger origin).

**`plugin/skills/ledger/SKILL.md`, Anti-Patterns row.** Replace

`| Reopening resolved items | Terminal statuses are final — if the fix was wrong, create a new item |`

with

`| Reopening resolved items | Terminal statuses are final — if the fix was wrong, create a new item. The one exception, a refused staged proposal's row returning to \`open\`, is \`_shared/ledger-format.md\`'s Resolution-text requirements |`

## No-change classifications (behavior-change prose sweep)

- `plugin/skills/_shared/auto-decision-log.md:152`: the `REFUSED` row ("kept staged (or flipped its ledger item back to `open`)") stays accurate. No change.
- `docs/journeys/close-a-run-whose-ledger-holds-an-incomplete-deferral-3327.md:40`: it is about incomplete deferrals, and "Terminal statuses are final" still holds with a named exception. No change.
- Pin grep (`git grep -n -F` over `tests` and `plugin` for `proposal refused — no defer reason`, `came from a ledger item`, `never a reopen`, `Reopening resolved items`) hits only the three edited files. No other test needs re-pointing.

---

### Task 1: Pin and apply the refused-proposal reopen rule

**Role:** transcription

**Files:**
- Modify: `plugin/skills/wrap-up/refused-proposals.md` (`## Ledger origin`, lines 38-45)
- Modify: `plugin/skills/_shared/ledger-format.md` (line 65, `**Resolution-text requirements.**`)
- Modify: `plugin/skills/ledger/SKILL.md` (line 163, Anti-Patterns row)
- Test: `tests/deferral-gate-conformance.test.js` (new block after the existing `// --- #622` block's last test)
- Waived `bin/lib/console/residue.js`: the spec's Gotchas cite it only as context for the unattended-console surfacing gap, which is out of scope. No step reads or changes it.
- Waived `flow/multispec-review-console.md`: the spec's Gotchas cite it as a consumer that inherits the change through its existing `refused-proposals.md` citation. Step 3's multi-spec sentence covers it, and the file itself needs no change.

**Interfaces:**
- Consumes: the file's existing `read(rel)` helper, its `LEDGER` constant (`ledger-format.md` text), and `DEFER_REASONS`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing tests.** Add a block headed `// --- #4772: a refused staged proposal reopens the row naming its path — the one named reopen ---` with three span extractors and three assertion functions, each called by a positive test and by a go-red control:

```js
const REFUSED_MD = read('plugin/skills/wrap-up/refused-proposals.md');
const LEDGER_SKILL = read('plugin/skills/ledger/SKILL.md');

function ledgerOriginSection(md) {
  const start = md.indexOf('\n## Ledger origin\n');
  assert.ok(start >= 0, 'refused-proposals.md has no "## Ledger origin" section');
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end < 0 ? undefined : end);
}
function resolutionTextParagraph(md) {
  const start = md.indexOf('**Resolution-text requirements.**');
  assert.ok(start >= 0, 'ledger-format.md has no Resolution-text requirements paragraph');
  const end = md.indexOf('\n\n', start);
  return md.slice(start, end < 0 ? undefined : end);
}
function reopeningRow(md) {
  const line = md.split('\n').find((l) => l.startsWith('| Reopening resolved items |'));
  assert.ok(line, 'ledger/SKILL.md has no "Reopening resolved items" row');
  return line;
}

function assertLedgerOrigin(section) {
  assert.ok(!section.includes('came from a ledger item'), 'Ledger origin still keys on the ledger-record-* filename');
  for (const anchor of [
    "Resolution names the refused proposal's staged path",
    'the exact path',
    '`staged/ledger-record-*.md`',
    '`staged/review-followup-*.md`',
    'the run dir whose `staged/` holds the item',
    '`proposal refused — no defer reason`',
    'delete the staged file',
    'with **no** ledger origin',
    "`_shared/ledger-format.md`'s Resolution-text requirements",
  ]) assert.ok(section.includes(anchor), `Ledger origin is missing: ${anchor}`);
}
function assertReopenException(paragraph) {
  const rule = paragraph.indexOf('never a reopen.');
  const exception = paragraph.indexOf('The one exception:');
  assert.ok(rule >= 0, 'the "never a reopen" rule is gone');
  assert.ok(exception > rule, 'the reopen exception must follow the "never a reopen" rule');
  for (const anchor of ['returns to `open`', 'its deferral never completed', '`wrap-up/refused-proposals.md`'])
    assert.ok(paragraph.includes(anchor), `the reopen exception is missing: ${anchor}`);
}
function assertReopeningRowPointer(row) {
  assert.ok(row.includes("`_shared/ledger-format.md`'s Resolution-text requirements"), 'the anti-pattern row does not point at the exception');
}
```

Tests, named with their AC clause ids:
- `AC1.1, AC1.2: Ledger origin keys on the row naming the refused staged path, review-followup- included`: `assertLedgerOrigin(ledgerOriginSection(REFUSED_MD))`.
- `AC1.1 go-red: the ledger-record-*-only opening fails the Ledger origin pin`: `assert.throws(() => assertLedgerOrigin(OLD_OPENING))`, where `OLD_OPENING` is the live section with its first sentence replaced by the pre-change sentence `When the refused proposal came from a ledger item (\`staged/ledger-record-*.md\`): set that item's status back to \`open\` with note \`proposal refused — no defer reason\`, so the ledger's own nothing-left-behind gate resurfaces it on the next resolve; delete the staged file (the ledger item is the durable trace).` Build it by splicing the live section text: cut from the index of `When a ledger row` to the end of the first `(the ledger item is the durable trace).`, and replace that span with the old sentence. Before the throw assertion, assert that the result differs from the live section (`assert.notEqual`). This leaves the new "Today's producers…" sentences in place, so the control isolates the `came from a ledger item` exclusion.
- `AC2.1: ledger-format.md records the refused-proposal reopen as the one exception`: `assertReopenException(resolutionTextParagraph(LEDGER))`.
- `AC2.1 go-red: removing the exception sentence fails the pin`: `assert.throws(() => assertReopenException(para.replace(/ The one exception:[^]*?Ledger origin\)\./, '')))`. Before the throw assertion, assert that the replace changed the string (`assert.notEqual(mutated, para)`).
- `AC3.1: ledger/SKILL.md's Reopening row points at the exception`: `assertReopeningRowPointer(reopeningRow(LEDGER_SKILL))`.
- `AC3.1 go-red: the pre-change row fails the pin`: `assert.throws(() => assertReopeningRowPointer('| Reopening resolved items | Terminal statuses are final — if the fix was wrong, create a new item |'))`.
- `AC5.2: no DEFER_REASONS value in the three edited spans`: for each `v` of `DEFER_REASONS`, assert none of the new Ledger origin sentences (`ledgerOriginSection(REFUSED_MD)` sliced from `When a ledger row` to `A refused proposal with **no**`; the untouched no-origin sentence after that point already says "a reflect tangential", which is pre-existing text outside AC5's "edited text"), the `The one exception:` sentence of `resolutionTextParagraph(LEDGER)`, or `reopeningRow(LEDGER_SKILL)` includes `v`. Slice the sentence from its index to the end of the next `Ledger origin).`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/deferral-gate-conformance.test.js`
Expected: FAIL after Step 1. The AC1.1/AC1.2, AC2.1 and AC3.1 positive tests fail. AC5.2 throws inside its extractor, because `The one exception:` is absent. The three go-red controls pass, since they expect a throw. Existing tests pass.

- [ ] **Step 3: Apply the three prose edits** exactly as written in "Prose decisions" above. Use Edit, anchored on the quoted old text.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/deferral-gate-conformance.test.js`
Expected: PASS, every test including `refused-proposals.md never hardcodes the vocabulary` (AC5.1).

- [ ] **Step 5: Commit**

```bash
git add tests/deferral-gate-conformance.test.js plugin/skills/wrap-up/refused-proposals.md plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md
git commit -m "Reopen a refused staged proposal's ledger row by its path — cover review-followup-, record the one reopen exception"
```

AC6.1 (`npm test` passes) is covered by `/claude-tweaks:build` Common Step 5's full verification run, not by a task step.

- [ ] **Step 6: AC4.1 file-revert proof.** For each of the three skill files, one at a time: run `git show HEAD~1:{path}` and write its output over `{path}`. Run `node --test tests/deferral-gate-conformance.test.js > {scratch}/ac4-{n}.txt 2>&1; echo exit=$?`. Confirm a non-zero exit and that the failing test's name is the matching AC1/AC2/AC3 test. Then restore with `git checkout HEAD -- {path}`. Confirm `git status --porcelain` is clean before the next file. Record the three results as one AC-evidence entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. The text file holds one line naming `AC4` and each file → its failing test name and exit code. The PR body quotes those red lines at wrap-up.
