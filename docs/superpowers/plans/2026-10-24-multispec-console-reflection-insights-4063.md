# Multi-spec Review Console has no Reflection insights section; reflect insights fall to Pending review (#4063) Implementation Plan

**Goal:** Give the multi-spec Review Console its own Reflection insights section, as the single-spec console already has, so staged `wrap-up-reflect-insights.md` rows render under that section's stance, not under the Pending review catch-all.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T170256-record-4063/work/4063-spec.md` (materialized from GitHub issue #4063)

**Size headroom:** `plugin/skills/flow/multispec-review-console.md` is 49,657 B against `RAIL_BYTES` 52,500 (94.6%, near ceiling). The additions below must stay under ~2,000 B. Keep each edit to a clause, and do not restate `wrap-up/review-console.md` step 10's mechanics; cite it.

---

### Task 1: Add the Reflection insights section to the multi-spec console (site 10 of `review-console-section-addition`)

**Files:**
- Modify: `plugin/skills/flow/multispec-console-template.md` — add a `#### Reflection insights (Approve all applies each row's recommended destination; Override drills each item)` heading after `#### Upstream feedback` and before `#### Not run / Failed`, matching the single-spec render position (`wrap-up/console-template.md`, where Reflection insights follows Upstream feedback). Its table is `| R# | Spec | Insight | Causal | Recommended Destination |`, aggregated across every `spec-{N}/staged/wrap-up-reflect-insights.md` plus the parent run dir's own (the batch-scope reflect pass, `multispec-batch-curation.md`, tagged `batch`). The Approve-all default and the D4/D5-informational rule are cited from `wrap-up/console-template.md`'s Reflection insights section, not restated. Omit the section when no file was staged.
- Modify: `plugin/skills/flow/multispec-review-console.md`:
  - Step 2 read list: add `Reflection insights` after `Upstream feedback`.
  - Numbering rules' Canonical render order: add `Reflection insights` after `Upstream feedback`.
  - Numbering rules' non-batch paragraph: Three → Four sections (and "own four non-batch sections", matching `review-console-interactive.md`). Add the `R`-prefixed sequence (`R1`, `R2`, …), aggregated across every spec's `staged/wrap-up-reflect-insights.md` plus the parent's, drilled via `_shared/batched-item-drill.md`. "four sequences" → "five sequences".
  - Auto-resolution short-circuit: `Q#`/`M#` → `Q#`/`M#`/`R#` as if Approve all had been chosen (`SECTION_STANCES[INSIGHTS]` is `approve`).
  - Present the consolidated console: options 1 and 3 name `R#`. The terminal-decision paragraph says Approve all applies every `R#` row's recommended destination (D4/D5 informational). The Override paragraph adds the `R#` drill (`_shared/batched-item-drill.md`, chunked within one insights file).
  - On approval: a new step `4.5.`, which avoids renumbering. `tests/scratch-worktree-remote-branch-delete.test.js` pins `9. Archive`, and steps 8/9 are cited elsewhere. The step applies each insights file per `wrap-up/review-console.md` "On approval" step 10, against the directory the file came from. "Implement now" edits fold into step 7's commit.
  - On override step 4: name `R#` alongside `Q#`/`M#`/`U#`.
- Test: `tests/reflect-wrap-up-insights-staging-conformance.test.js` — append multi-spec pins, with the section name read from `SECTIONS.INSIGHTS`, never hand-typed:
  - the template has exactly one `#### Reflection insights (` heading, between Upstream feedback and Not run / Failed;
  - `multispec-review-console.md` carries `Upstream feedback, Reflection insights` exactly twice (the step-2 read list and the Canonical render order);
  - the Numbering rules name the `R`-prefixed sequence;
  - On approval step 4.5 cites `review-console.md` step 10.
  - Each assertion is a helper, and each has a go-red control that doctors the live text in memory (the `console-shadow-dup-outcomes-conformance.test.js` pattern). For example, deleting the heading must make the helper throw.

#### Exact edits (use verbatim — each `old` anchor is unique in its file today)

**E1 — `plugin/skills/flow/multispec-console-template.md`:** insert this block immediately before the line `#### Not run / Failed (if any spec didn't complete cleanly)` (keep one blank line between blocks):

````markdown
#### Reflection insights (Approve all applies each row's recommended destination; Override drills each item)

Render this section only when any spec's reflect pass, or the batch-scope reflect pass in the parent run dir (`multispec-batch-curation.md`), staged `staged/wrap-up-reflect-insights.md`. Aggregated across every spec in the run plus the parent's own — `Spec` reads `batch` for a parent-level row — and each file's table rows are renumbered into one `R#` sequence. The Approve-all default and the D4/D5-informational rule are `wrap-up/console-template.md`'s Reflection insights section, per file.

| R# | Spec | Insight | Causal | Recommended Destination |
|---|---|---|---|---|
| R1 | batch | Retry helper swallowed the last error, hiding the real cause | systemic | Implement now -> Skill: error-handling |
| R2 | 159 | Token refresh and session expiry share no clock source | — | Defer — genuinely-larger |

Omit the section entirely when no spec (and no parent-level pass) staged an insights file.
````

**`plugin/skills/flow/multispec-review-console.md`** — nine in-place replacements (Edit tool, exact strings):

- E2 (step 2 read list): `Queue writes, Memory updates, Upstream feedback). This read is unconditional` → `Queue writes, Memory updates, Upstream feedback, Reflection insights). This read is unconditional`
- E3 (Canonical render order): `(\`wrap-up/refused-proposals.md\`), Memory updates, Upstream feedback.` → `(\`wrap-up/refused-proposals.md\`), Memory updates, Upstream feedback, Reflection insights.`
- E4 (Numbering rules count): `Three sections sit outside that global sequence and are never counted among the named batch sections, exactly as \`wrap-up/review-console-interactive.md\`'s own three non-batch sections` → `Four sections sit outside that global sequence and are never counted among the named batch sections, exactly as \`wrap-up/review-console-interactive.md\`'s own four non-batch sections`
- E5 (Numbering rules R# sequence): `plus the parent run dir's own. Do not restart any of the four sequences` → `plus the parent run dir's own. **Reflection insights** use a separate \`R\`-prefixed sequence (\`R1\`, \`R2\`, …), drilled via \`_shared/batched-item-drill.md\`'s multiSelect chunking under Override — aggregated across every spec's \`staged/wrap-up-reflect-insights.md\` plus the parent run dir's own. Do not restart any of the five sequences`
- E6 (Auto-resolution short-circuit): ``batch sections and `Q#`/`M#` as if Approve all had been chosen`` → ``batch sections and `Q#`/`M#`/`R#` as if Approve all had been chosen``
- E7 (option 1 and option 3 descriptions, two replacements): `or declined (otherwise)."\`` → `or declined (otherwise); apply every R# row's recommended destination."\`` — and — `also the only path that drills Q#/M#/U# individually."\`` → `also the only path that drills Q#/M#/U#/R# individually."\``
- E8 (terminal-decision paragraph): `with no further prompt. Choosing Override is what still drills them individually, below.` → `with no further prompt. Approve all also applies every \`R#\` row's recommended destination (D4/D5 rows stay informational). Choosing Override is what still drills them individually, below.`
- E9 (Override drill): after the paragraph ending `files every \`U#\` row unconditionally, tag or not).` add a blank line and this new paragraph: `**Reflection insights**, under Override, resolve via \`_shared/batched-item-drill.md\`'s multiSelect chunking (pre-checked to Apply), chunked within one insights file — never across specs or sections — as \`wrap-up/review-console-interactive.md\`'s \`R#\` drill does.`
- E10 (On approval — new step, no renumbering): insert immediately before the line `5. Apply skill updates and create new skills (from each spec's Skills curation row)` this line: `4.5. For \`R#\` reflection insights: apply each staged \`wrap-up-reflect-insights.md\` (every \`spec-{N}/staged/\` and the parent's) per \`wrap-up/review-console.md\` "On approval" step 10, against the directory the file came from — Approve all applies each row's recommended destination, Override only the rows its drill left checked; D4/D5 rows stay informational, and "Implement now" edits fold into step 7's commit.`
- E11 (On override step 4): `Upstream feedback (\`U#\`) resolves via the shared batch contract under override, the same way` → `Upstream feedback (\`U#\`) resolves via the shared batch contract and Reflection insights (\`R#\`) via \`_shared/batched-item-drill.md\` under override, the same way` — and, in the same step, `none of the three can be bulk-resolved` → `none of the four can be bulk-resolved`

(The backslash-escaped backticks above are literal backticks in the file.)

**E12 — append to `tests/reflect-wrap-up-insights-staging-conformance.test.js`** (end of file; reuses the file's existing `read`, `section`, `SECTIONS`, `test`, `assert`):

```js
// --- multi-spec console (#4063): review-console-section-addition site 10 --------------
// The multi-spec console carries its own Reflection insights heading, both section lists,
// and R# handling. Each helper is the single assertion its live test and go-red control call.

const MULTISPEC_TEMPLATE = read('plugin', 'skills', 'flow', 'multispec-console-template.md');
const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');
const INSIGHTS_HEAD = `\n#### ${SECTIONS.INSIGHTS} (`;
const NOT_RUN_HEAD = '\n#### Not run / Failed (';

function assertMultispecHeading(templateText) {
  const idx = templateText.indexOf(INSIGHTS_HEAD);
  assert.notEqual(idx, -1, `multispec-console-template.md has no "#### ${SECTIONS.INSIGHTS} (" heading`);
  assert.equal(templateText.indexOf(INSIGHTS_HEAD, idx + 1), -1, `more than one "#### ${SECTIONS.INSIGHTS} (" heading`);
  const upstream = templateText.indexOf(`\n#### ${SECTIONS.UPSTREAM} (`);
  const notRun = templateText.indexOf(NOT_RUN_HEAD);
  assert.ok(upstream !== -1 && notRun !== -1, 'the Upstream feedback or Not run / Failed heading is missing — the order check has no anchors');
  assert.ok(upstream < idx && idx < notRun, `"#### ${SECTIONS.INSIGHTS} (" is not between ${SECTIONS.UPSTREAM} and Not run / Failed`);
  assert.match(templateText.slice(idx, notRun), /\| R# \| Spec \|/, 'the multi-spec Reflection insights table has no R#/Spec columns');
}

function assertMultispecOrder(consoleText) {
  const adjacent = `${SECTIONS.UPSTREAM}, ${SECTIONS.INSIGHTS}`;
  const count = consoleText.split(adjacent).length - 1;
  assert.equal(count, 2, `multispec-review-console.md carries "${adjacent}" ${count} times, expected 2 (the step-2 read list and the Canonical render order)`);
}

function assertMultispecRHandling(consoleText) {
  const rules = section(consoleText, '## Numbering rules', '\n## ');
  assert.match(rules, /\*\*Reflection insights\*\* use a separate `R`-prefixed sequence/, 'the multi-spec Numbering rules give Reflection insights no R# sequence');
  assert.match(consoleText, /^4\.5\. For `R#` reflection insights: .*`wrap-up\/review-console\.md` "On approval" step 10/m, 'multi-spec On approval has no R# step citing review-console.md step 10');
}

function doctor(text, from, to) {
  const out = text.replace(from, to);
  assert.notEqual(out, text, `control did not change the text: ${from}`);
  return out;
}

test('multispec-console-template.md renders a #### Reflection insights heading after Upstream feedback, with R# rows (#4063)', () => {
  assertMultispecHeading(MULTISPEC_TEMPLATE);
});

test('control: deleting the multi-spec Reflection insights heading fails assertMultispecHeading', () => {
  const mutated = doctor(MULTISPEC_TEMPLATE, INSIGHTS_HEAD, '\n#### Something else (');
  assert.throws(() => assertMultispecHeading(mutated), { message: /has no "#### Reflection insights \(" heading/ });
});

test('control: moving the heading below Not run / Failed fails assertMultispecHeading (order message)', () => {
  const start = MULTISPEC_TEMPLATE.indexOf(INSIGHTS_HEAD);
  const notRun = MULTISPEC_TEMPLATE.indexOf(NOT_RUN_HEAD);
  assert.ok(start !== -1 && notRun !== -1 && start < notRun);
  const block = MULTISPEC_TEMPLATE.slice(start, notRun);
  const without = MULTISPEC_TEMPLATE.slice(0, start) + MULTISPEC_TEMPLATE.slice(notRun);
  const at = without.lastIndexOf('\n```');
  const permuted = without.slice(0, at) + block + without.slice(at);
  assert.notEqual(permuted, MULTISPEC_TEMPLATE);
  assert.throws(() => assertMultispecHeading(permuted), { message: /is not between/ });
});

test('multispec-review-console.md names Reflection insights after Upstream feedback in both section enumerations (#4063)', () => {
  assertMultispecOrder(MULTISPEC_CONSOLE);
});

test('control: dropping Reflection insights from either enumeration fails assertMultispecOrder', () => {
  const adjacent = `${SECTIONS.UPSTREAM}, ${SECTIONS.INSIGHTS}`;
  const once = doctor(MULTISPEC_CONSOLE, adjacent, SECTIONS.UPSTREAM);
  assert.throws(() => assertMultispecOrder(once), { message: /carries .* 1 times, expected 2/ });
  const twice = doctor(once, adjacent, SECTIONS.UPSTREAM);
  assert.throws(() => assertMultispecOrder(twice), { message: /carries .* 0 times, expected 2/ });
});

test('multispec-review-console.md gives Reflection insights an R# sequence and an On approval step citing review-console.md step 10 (#4063)', () => {
  assertMultispecRHandling(MULTISPEC_CONSOLE);
});

test('control: removing the R# sequence or the On approval step fails assertMultispecRHandling', () => {
  const noSeq = doctor(MULTISPEC_CONSOLE, '**Reflection insights** use a separate', '**Reflection insights** use the');
  assert.throws(() => assertMultispecRHandling(noSeq), { message: /no R# sequence/ });
  const noStep = doctor(MULTISPEC_CONSOLE, '4.5. For `R#` reflection insights:', 'For reflection insights:');
  assert.throws(() => assertMultispecRHandling(noStep), { message: /no R# step/ });
});
```

- [ ] **Step 1: Failing test** — append the pins and their controls; run `node --test tests/reflect-wrap-up-insights-staging-conformance.test.js`. Expected: FAIL (the template has no `#### Reflection insights (` heading yet).
- [ ] **Step 2: Implement** — the template and console edits above.
- [ ] **Step 3: Run** `node --test tests/reflect-wrap-up-insights-staging-conformance.test.js tests/console-shadow-dup-outcomes-conformance.test.js tests/scratch-worktree-remote-branch-delete.test.js` — PASS. Then `wc -c plugin/skills/flow/multispec-review-console.md` must be < 52500.
- [ ] **Step 4: Commit** — one commit, `Add Reflection insights section to the multi-spec Review Console — R# rows, render order, and pins` with `refs #4063`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (heading, render order, `R#` handling) → the template and console bullets. AC1 (heading in the same render position with `R#` handling) → the template heading after Upstream feedback, plus the Numbering, approval and override `R#` edits. AC2 (a conformance test pins the heading and goes red without it) → Test bullet 1 and its control. AC3 (`npm test` passes) → Common Step 5.
- **Placeholders:** none.
