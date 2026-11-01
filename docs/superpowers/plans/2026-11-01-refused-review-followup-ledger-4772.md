# Refused review-followup ledger settlement (#4772) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Review Console refusal reopens the `deferred` row in the run's active ledger whose Resolution names the refused staged path. This covers `review-followup-*` as well as `ledger-record-*`. In a multi-spec run that path is spec-qualified, so it is unique. `ledger-format.md` records the reopen as the one named exception to "never a reopen", and `ledger/SKILL.md` points at it.

**Architecture:** Prose-only change to four skill files, plus one conformance block in `tests/deferral-gate-conformance.test.js`. The block pins content-anchored strings in each edited span, with whitespace collapsed so hard-wrapping can't split an anchor. Each pin has a go-red control that runs the same assertion function against mutated text.

**Tech Stack:** Markdown skill files; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-11-01T182343-record-4772/work/4772-spec.md`, including its `## Plan Review Clarifications`, which replace Deliverable 1's per-run-dir ledger sentence.

**Scope keywords:** `ledger-record-`, `review-followup-`, `never a reopen`, `proposal refused — no defer reason`, `Reopening resolved items`, `spec-{N}/staged/`

## Global Constraints

- The literal note text `proposal refused — no defer reason` stays byte-identical.
- No `DEFER_REASONS` value appears in any edited text (AC5). The existing `refused-proposals.md never hardcodes the vocabulary` test must keep passing.
- `ledger-format.md` holds the one canonical statement of both rules: the reopen exception and the spec-qualified staged path. `refused-proposals.md`, `ledger/SKILL.md` and `review/step3-routing.md` point at it and never restate its rationale.
- Only a `deferred` row reopens (plan-review decision). An `acknowledged` row is never touched.
- Never write the literal tokens `TBD`, `TODO`, or `<!-- ambiguity:` in authored prose.
- Byte headroom against `RAIL_BYTES` (52,500 B): `refused-proposals.md` 3,964 B, `ledger-format.md` 36,275 B, `ledger/SKILL.md` 14,355 B, `review/step3-routing.md` 37,852 B. Each grows by under 700 B, so all stay far below the rail.
- Commit message style: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer.

## Review Focus

1. **Multi-spec slot collision.** Two specs can each stage `staged/review-followup-1.md`. The shared ledger must tell them apart by the spec-qualified path `spec-{N}/staged/review-followup-1.md`, and the refusal must match that exact string, never a bare `staged/{name}` or a prefix/glob such as `staged/review-followup-1*`. Pinned by anchors in Task 1.
2. **Status gate.** Only a `deferred` row reopens. An `acknowledged` row that names the same path is left alone. Pinned by the `` `deferred` row `` anchor in Task 1.
3. **A proposal no row names.** This falls through to the unchanged no-ledger-origin branch: it stays staged and dies at `close-run`. That branch's sentence must survive the edit. Pinned in Task 1.
4. **The completeness check still sees a spec-qualified path.** `pack.js`'s `LEDGER_DEFERRED_STAGED_RE` is `/\bstaged\//`, which matches `spec-1/staged/x.md`, so a spec-qualified deferral is still complete (#3327). Verified by reading the regex, no change needed. Step 4 confirms it with a one-line `node -e` probe.
5. **`--dry-run` and the staged-file deletion.** The reopen is previewed under dry-run, and the deletion sentence survives. Pinned in Task 1.

## Prose decisions (exact text the implementer writes)

**`plugin/skills/wrap-up/refused-proposals.md`, `## Ledger origin`.** The old text runs across lines 40-43 with these exact line breaks. Use it as the Edit `old_string`:

```
When the refused proposal came from a ledger item (`staged/ledger-record-*.md`): set that item's
status back to `open` with note `proposal refused — no defer reason`, so the ledger's own
nothing-left-behind gate resurfaces it on the next resolve; delete the staged file (the ledger
item is the durable trace).
```

Replace it with the text below, hard-wrapped at about 100 columns to match the file. The tests collapse whitespace, so where the lines break doesn't matter:

> When a `deferred` row in the run's active ledger (`_shared/ledger-format.md`'s resolution rule) names the refused proposal's staged path in its Resolution — the exact path, spec-qualified in a multi-spec run (`spec-{N}/staged/{name}`, so two specs' `staged/review-followup-1.md` never match each other's row): set that row's status back to `open` with note `proposal refused — no defer reason`, so the ledger's own nothing-left-behind gate resurfaces it on the next resolve; delete the staged file (the ledger item is the durable trace). Today's producers are `staged/ledger-record-*.md` (the ledger resolve gate's Defer/Keep) and `staged/review-followup-*.md` (`/review` Step 3's record proposal). This is the one reopen `_shared/ledger-format.md`'s Resolution-text requirements allow.

Keep the rest of the paragraph unchanged: the "A refused proposal with **no** ledger origin …" sentences, and the `--dry-run` paragraph after it.

**`plugin/skills/_shared/ledger-format.md`, `**Resolution-text requirements.**` paragraph (line 65, one physical line).** Make two insertions.
- (a) Right after "Terminal statuses are final — a wrong fix gets a new item, never a reopen.", insert:
  > The one exception: a `deferred` row whose Resolution names a staged record proposal that the Review Console refuses for want of a valid `Defer-reason:` returns to `open` — its deferral never completed (`wrap-up/refused-proposals.md`'s Ledger origin).
- (b) Right after "and the staged proposal path (`staged/…`) or, once created, the record reference (`#N`, or the issue/PR URL) that carries it.", insert:
  > In a multi-spec run, whose one ledger is shared by specs that each number their own `staged/` slots, that path is written spec-qualified — `spec-{N}/staged/{name}` — so it names one proposal.

**`plugin/skills/ledger/SKILL.md`, Anti-Patterns row.** Replace

`| Reopening resolved items | Terminal statuses are final — if the fix was wrong, create a new item |`

with

`| Reopening resolved items | Terminal statuses are final — if the fix was wrong, create a new item. The one exception, a refused staged proposal's row returning to \`open\`, is \`_shared/ledger-format.md\`'s Resolution-text requirements |`

**`plugin/skills/review/step3-routing.md`, the record-proposal ledger write.** Replace the unique substring

``its Resolution naming `staged/review-followup-{n}.md`, the way``

with

``its Resolution naming `staged/review-followup-{n}.md` (`spec-{N}/staged/review-followup-{n}.md` in a multi-spec run, per `_shared/ledger-format.md`'s Resolution-text requirements), the way``

Leave the `--stage-path staged/review-followup-{n}.md` log-line argument unchanged. It is a run-dir-relative path for `review-routing-line.js`, not a ledger Resolution.

## No-change classifications (behavior-change prose sweep)

- `plugin/skills/_shared/auto-decision-log.md:152`: the `REFUSED` row ("kept staged (or flipped its ledger item back to `open`)") stays accurate. No change.
- `docs/journeys/close-a-run-whose-ledger-holds-an-incomplete-deferral-3327.md:40`: it is about incomplete deferrals, and "Terminal statuses are final" still holds with a named exception. No change.
- `ledger-format.md`'s Defer/Keep bullets (lines 151, 186, 255, 256: "the Resolution names the staged path, `staged/ledger-record-{slug}.md`") inherit insertion (b) from the same file's Resolution-text requirements. No change.
- Pin grep (`git grep -n -F` over `tests` and `plugin` for `proposal refused — no defer reason`, `came from a ledger item`, `never a reopen`, `Reopening resolved items`, `its Resolution naming`) hits only the edited files. No other test needs re-pointing.

---

### Task 1: Pin and apply the refused-proposal reopen rule

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/refused-proposals.md` (`## Ledger origin`, lines 38-45)
- Modify: `plugin/skills/_shared/ledger-format.md` (line 65, `**Resolution-text requirements.**`)
- Modify: `plugin/skills/ledger/SKILL.md` (line 163, Anti-Patterns row)
- Modify: `plugin/skills/review/step3-routing.md` (the "Staging a record proposal" paragraph's ledger-write sentence)
- Test: `tests/deferral-gate-conformance.test.js` (new block after the existing `// --- #622` block's last test)
- Waived `bin/lib/console/residue.js`: the spec's Gotchas cite it only as context for the unattended-console surfacing gap, which is out of scope. No step reads or changes it.
- Waived `flow/multispec-review-console.md`: the spec's Gotchas cite it as a consumer that inherits the change through its existing `refused-proposals.md` citation. The spec-qualified path rule covers it, and the file itself needs no change.

**Interfaces:**
- Consumes: the file's existing `read(rel)` helper, its `LEDGER` constant (`ledger-format.md` text), and `DEFER_REASONS`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing tests.** Add a block headed `// --- #4772: a refused staged proposal reopens the deferred row naming its path — the one named reopen ---`:

```js
const REFUSED_MD = read('plugin/skills/wrap-up/refused-proposals.md');
const LEDGER_SKILL = read('plugin/skills/ledger/SKILL.md');
const STEP3_ROUTING = read('plugin/skills/review/step3-routing.md');
const flat = (s) => s.replace(/\s+/g, ' ');

function ledgerOriginSection(md) {
  const start = md.indexOf('\n## Ledger origin\n');
  assert.ok(start >= 0, 'refused-proposals.md has no "## Ledger origin" section');
  const end = md.indexOf('\n## ', start + 1);
  return flat(md.slice(start, end < 0 ? undefined : end));
}
function resolutionTextParagraph(md) {
  const start = md.indexOf('**Resolution-text requirements.**');
  assert.ok(start >= 0, 'ledger-format.md has no Resolution-text requirements paragraph');
  const end = md.indexOf('\n\n', start);
  return flat(md.slice(start, end < 0 ? undefined : end));
}
function reopeningRow(md) {
  const line = md.split('\n').find((l) => l.startsWith('| Reopening resolved items |'));
  assert.ok(line, 'ledger/SKILL.md has no "Reopening resolved items" row');
  return line;
}
function newOriginSentences(section) {
  const i = section.indexOf('When a `deferred` row');
  const j = section.indexOf('A refused proposal with **no**');
  assert.ok(i >= 0 && j > i, 'new Ledger origin sentences not found');
  return section.slice(i, j);
}
function exceptionSentence(paragraph) {
  const i = paragraph.indexOf('The one exception:');
  assert.ok(i >= 0, 'no reopen exception sentence');
  return paragraph.slice(i, paragraph.indexOf('Ledger origin).', i) + 'Ledger origin).'.length);
}

function assertLedgerOrigin(section) {
  assert.ok(!section.includes('came from a ledger item'), 'Ledger origin still keys on the ledger-record-* filename');
  for (const anchor of [
    'When a `deferred` row',
    "the run's active ledger",
    "names the refused proposal's staged path in its Resolution",
    'the exact path',
    '`spec-{N}/staged/{name}`',
    '`staged/ledger-record-*.md`',
    '`staged/review-followup-*.md`',
    '`proposal refused — no defer reason`',
    'delete the staged file',
    'with **no** ledger origin',
    'Under `--dry-run`',
    "`_shared/ledger-format.md`'s Resolution-text requirements",
  ]) assert.ok(section.includes(anchor), `Ledger origin is missing: ${anchor}`);
}
function assertReopenException(paragraph) {
  const rule = paragraph.indexOf('never a reopen.');
  const exception = paragraph.indexOf('The one exception:');
  assert.ok(rule >= 0, 'the "never a reopen" rule is gone');
  assert.ok(exception > rule, 'the reopen exception must follow the "never a reopen" rule');
  for (const anchor of ['a `deferred` row whose Resolution names a staged record proposal', 'returns to `open`', 'its deferral never completed', '`wrap-up/refused-proposals.md`'])
    assert.ok(paragraph.includes(anchor), `the reopen exception is missing: ${anchor}`);
}
function assertSpecQualifiedPath(paragraph) {
  assert.ok(paragraph.includes('In a multi-spec run,') && paragraph.includes('that path is written spec-qualified — `spec-{N}/staged/{name}`'), 'ledger-format.md does not state the spec-qualified staged path');
}
function assertReopeningRowPointer(row) {
  assert.ok(row.includes("`_shared/ledger-format.md`'s Resolution-text requirements"), 'the anti-pattern row does not point at the exception');
}
function assertStep3Pointer(md) {
  assert.ok(flat(md).includes("(`spec-{N}/staged/review-followup-{n}.md` in a multi-spec run, per `_shared/ledger-format.md`'s Resolution-text requirements)"), 'step3-routing.md does not spec-qualify its ledger Resolution path');
}

const OLD_FIRST = flat("When the refused proposal came from a ledger item (`staged/ledger-record-*.md`): set that item's status back to `open` with note `proposal refused — no defer reason`, so the ledger's own nothing-left-behind gate resurfaces it on the next resolve; delete the staged file (the ledger item is the durable trace).");
const OLD_ROW = '| Reopening resolved items | Terminal statuses are final — if the fix was wrong, create a new item |';

test('AC1.1, AC1.2: Ledger origin keys on the deferred row naming the refused staged path, review-followup- included', () => {
  assertLedgerOrigin(ledgerOriginSection(REFUSED_MD));
});
test('AC1.1 go-red: the ledger-record-*-only opening fails the Ledger origin pin', () => {
  const s = ledgerOriginSection(REFUSED_MD);
  const end = s.indexOf('(the ledger item is the durable trace).') + '(the ledger item is the durable trace).'.length;
  const mutated = s.slice(0, s.indexOf('When a `deferred` row')) + OLD_FIRST + s.slice(end);
  assert.notEqual(mutated, s);
  assert.throws(() => assertLedgerOrigin(mutated));
});
test('AC2.1: ledger-format.md records the refused-proposal reopen as the one exception, deferred rows only', () => {
  assertReopenException(resolutionTextParagraph(LEDGER));
});
test('AC2.1 go-red: removing the exception sentence fails the pin', () => {
  const p = resolutionTextParagraph(LEDGER);
  const mutated = p.replace(/ The one exception:[^]*?Ledger origin\)\./, '');
  assert.notEqual(mutated, p);
  assert.throws(() => assertReopenException(mutated));
});
test('ledger-format.md spec-qualifies a multi-spec staged path, and step3-routing.md points at it (plan-review clarification)', () => {
  assertSpecQualifiedPath(resolutionTextParagraph(LEDGER));
  assertStep3Pointer(STEP3_ROUTING);
});
test('go-red: dropping the spec-qualification sentence or the step3 pointer fails the pins', () => {
  const p = resolutionTextParagraph(LEDGER);
  const mutated = p.replace(/ In a multi-spec run, whose one ledger[^]*?names one proposal\./, '');
  assert.notEqual(mutated, p);
  assert.throws(() => assertSpecQualifiedPath(mutated));
  assert.throws(() => assertStep3Pointer(STEP3_ROUTING.replace(/ \(`spec-\{N\}\/staged\/review-followup-\{n\}\.md` in a multi-spec run[^)]*\)/, '')));
});
test('AC3.1: ledger/SKILL.md\'s Reopening row points at the exception', () => {
  assertReopeningRowPointer(reopeningRow(LEDGER_SKILL));
});
test('AC3.1 go-red: the pre-change row fails the pin', () => {
  assert.throws(() => assertReopeningRowPointer(OLD_ROW));
});
test('AC5.2: no DEFER_REASONS value in the edited spans', () => {
  const spans = [newOriginSentences(ledgerOriginSection(REFUSED_MD)), exceptionSentence(resolutionTextParagraph(LEDGER)), reopeningRow(LEDGER_SKILL)];
  for (const v of DEFER_REASONS) for (const s of spans) assert.ok(!s.includes(v), `edited text names Defer-reason value ${v}`);
});
```

`newOriginSentences` stops at `A refused proposal with **no**` because the untouched no-origin sentence after it already says "a reflect tangential". That is pre-existing text outside AC5's "edited text".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/deferral-gate-conformance.test.js`
Expected: FAIL after Step 1. A scratch run of this exact block against today's files gave 7 fail and 2 pass. Failing: the AC1.1/AC1.2, AC2.1, AC3.1 and spec-qualification positive tests; the AC2.1 and spec-qualification go-red controls, whose `notEqual` fails because the sentence they remove is absent; and AC5.2, whose extractor throws. Passing: the AC1.1 and AC3.1 go-red controls. Existing tests pass.

- [ ] **Step 3: Apply the four prose edits** exactly as written in "Prose decisions" above. Use Edit, with each `old_string` copied from the current file, line breaks included.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/deferral-gate-conformance.test.js`
Expected: PASS, every test including `refused-proposals.md never hardcodes the vocabulary` (AC5.1). Then confirm Review Focus 4 with `node -e "process.exit(/\bstaged\//.test('spec-1/staged/review-followup-1.md')?0:1)"`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/deferral-gate-conformance.test.js plugin/skills/wrap-up/refused-proposals.md plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md plugin/skills/review/step3-routing.md
git commit -m "Reopen a refused staged proposal's deferred ledger row by its path — cover review-followup-, spec-qualify multi-spec paths"
```

AC6.1 (`npm test` passes) is covered by `/claude-tweaks:build` Common Step 5's full verification run, not by a task step.

- [ ] **Step 6: AC4.1 file-revert proof.** For each of the four skill files, one at a time: run `git show HEAD~1:{path}` and write its output over `{path}`. Run `node --test tests/deferral-gate-conformance.test.js > {scratch}/ac4-{n}.txt 2>&1; echo exit=$?`. Confirm a non-zero exit, and confirm the failing test names include the matching AC1/AC2/AC3/spec-qualification test. Then restore with `git checkout HEAD -- {path}`. Confirm `git status --porcelain` is clean before the next file. Record the results as one AC-evidence entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. The text file holds one line naming `AC4` and each file → its failing test names and exit code. The PR body quotes those red lines at wrap-up.
