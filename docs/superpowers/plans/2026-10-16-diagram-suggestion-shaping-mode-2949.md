# Diagram suggestion in /specify shaping mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:specify`'s shaping mode (the primary `#N`/comma-list path) emits the same advisory `/claude-tweaks:visualize` diagram recommendation decomposition mode's Step 2.5d already emits, sourced from one shared detection table both modes cite.

**Architecture:** Extract Step 2.5d's signal-detection table, emission cap, output format, and interactive/headless rendering split out of `plugin/skills/specify/decomposition-mode.md` into a new shared sub-file, `plugin/skills/specify/diagram-suggestion.md`. Decomposition mode's Step 2.5d shrinks to a citation of it (keeping its own framing: the "runs for every surface" note and the CLAUDE.md gate read). Shaping mode gets a new section, `### Diagram suggestion`, added to `plugin/skills/specify/shaping-mode-readback.md` (loaded on every shaping-mode entry path — interactive, bare-drain/`next` headless, and `--chained`), which cites the same shared file and runs per record against that record's already-composed body.

**Tech Stack:** Markdown (SKILL.md + sub-files), `node --test` prose-conformance tests.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T214344-record-2949/work/2949-spec.md`

Scope keywords: diagram-suggestion, diagram suggestions, Step 2.5d, visualize

## Global Constraints

- Advisory only — a diagram suggestion must never become a gate, a prompt, or an `AskUserQuestion`; it never writes record frontmatter and never invokes `/claude-tweaks:visualize` itself.
- The detection table, the "emit at most two, strongest matches, skip if none" rule, and the output format are stated once, in the new shared file — neither `decomposition-mode.md` nor the new shaping-mode section restates the table.
- `plugin/skills/specify/shaping-mode-stamping.md` and `plugin/skills/specify/shaping-mode-readback.md` are both `/specify` lazy-loaded sub-files subject to `tests/bin-lib/skill-audit/context-cost.test.js`'s `SPECIFY_SUBFILE_CEILING_BYTES` (28 * 1024 = 28672 bytes) hard ceiling — every edited/new file must stay under it. Current sizes before this plan: `shaping-mode.md` 19009 B, `shaping-mode-stamping.md` 22664 B, `shaping-mode-readback.md` 7628 B, `decomposition-mode.md` 25406 B.
- The `diagram-suggestions` CLAUDE.md flag (under its `## Design integration` heading) gates both modes identically — `disabled` or missing means no scan, no block, no log line, in either mode.
- `decomposition-mode-closeout.md`'s own `### Diagram suggestions` block/template is NOT touched — `tests/specify-net-empty-teardown.test.js` slices that file up to the literal string `### Diagram suggestions` and would break if that heading moved or were renamed.
- No code changes — this is pure skill-markdown (prose) editing plus one new `node --test` conformance test file.

## Review Focus

1. A shaped record whose body describes a genuine multi-step flow (3+ branches) must trigger at least one suggestion, while an unrelated single-file bug-fix record must trigger none — the detection table's own "skip if no signal matches" rule, now reachable from shaping mode for the first time. Pinned in Task 2.
2. A comma-list batch must cap suggestions at two **per record**, not two for the whole batch — easy to get wrong when porting a single-record rule to a loop. Pinned in Task 2.
3. Headless posture (bare drain / `next` / `--chained`) must never render the block inline — only a `STAGED` decision-log line, matching decomposition mode's own `auto`-mode behavior. Pinned in Task 2.
4. `diagram-suggestions: disabled` (or the flag missing) must leave shaping mode's visible output byte-for-byte unchanged from before this plan — no empty block, no stray log line. Pinned in Task 2.
5. Moving Step 2.5d's table out of `decomposition-mode.md` must not silently drop a case decomposition mode still needs (design-doc text + decomposed record titles, not just one record's body) — the shared file's Detection section must stay input-agnostic (works on "the given text") rather than hard-coding "the record's body." Pinned in Task 1.

---

### Task 1: Extract the shared `diagram-suggestion.md` and re-point decomposition mode's Step 2.5d at it

**Files:**
- Create: `plugin/skills/specify/diagram-suggestion.md`
- Modify: `plugin/skills/specify/decomposition-mode.md` (Step 2.5d section, lines 234-266)
- Test: `tests/specify-diagram-suggestion-shared.test.js`

**Interfaces:**
- Consumes: nothing (pure prose extraction).
- Produces: `diagram-suggestion.md`'s three named sections — `## Gate`, `## Detection`, `## Output format`, `## Rendering` — that Task 2's shaping-mode section cites by name. The six-row detection table (signal → diagram type, one row each for `state`/`er`/`sequence`/`flowchart`/`architecture`/`tree`) lives only in this file's `## Detection` section from this task onward.

- [ ] **Step 1: Write the failing test**

Create `tests/specify-diagram-suggestion-shared.test.js`:

```js
'use strict';
// #2949: the diagram-suggestion signal-detection table must live in exactly one
// place that both decomposition mode (Step 2.5d) and shaping mode cite — never
// restated per mode. This pins the shared file's required sections and content,
// and pins that decomposition-mode.md no longer carries its own copy of the table.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const SHARED = 'plugin/skills/specify/diagram-suggestion.md';
const DECOMPOSITION = 'plugin/skills/specify/decomposition-mode.md';

test('diagram-suggestion.md exists with the required sections', () => {
  const src = read(SHARED);
  assert.match(src, /^## Gate$/m, 'missing ## Gate section');
  assert.match(src, /^## Detection$/m, 'missing ## Detection section');
  assert.match(src, /^## Output format$/m, 'missing ## Output format section');
  assert.match(src, /^## Rendering/m, 'missing ## Rendering section');
});

test('diagram-suggestion.md carries the six-row detection table', () => {
  const src = read(SHARED);
  for (const type of ['`state`', '`er`', '`sequence`', '`flowchart`', '`architecture`', '`tree`']) {
    assert.ok(src.includes(type), `detection table missing a row for ${type}`);
  }
  assert.match(src, /at most \*\*two\*\*/, 'missing the emit-at-most-two rule');
  assert.match(src, /Skip emission entirely if no signal matches/, 'missing the skip-if-no-signal rule');
});

test('diagram-suggestion.md Gate section reads the CLAUDE.md diagram-suggestions flag', () => {
  const src = read(SHARED);
  const gate = src.slice(src.indexOf('## Gate'), src.indexOf('## Detection'));
  assert.match(gate, /diagram-suggestions/);
  assert.match(gate, /disabled.*or missing/i);
});

test('diagram-suggestion.md Detection section is input-agnostic (not hard-coded to one record body)', () => {
  const src = read(SHARED);
  const detection = src.slice(src.indexOf('## Detection'), src.indexOf('## Output format'));
  // Must describe scanning "the given text" / "the text" rather than naming
  // only "the record's body" or only "the design doc" — both callers reuse it.
  assert.match(detection, /the given text|Scan the text/, 'Detection section must stay caller-agnostic');
});

test('diagram-suggestion.md Rendering section states the STAGED log-line shape with a caller-supplied step id', () => {
  const src = read(SHARED);
  assert.match(src, /STAGED \{time\} — \{step-id\}: diagram-suggestion \(\{type\}\) for \{ref-or-slug\}\. Reversibility: high\./);
});

test('decomposition-mode.md Step 2.5d cites the shared file instead of restating the table', () => {
  const src = read(DECOMPOSITION);
  const at = src.indexOf('## Step 2.5d');
  assert.ok(at >= 0, 'Step 2.5d heading missing from decomposition-mode.md');
  const next = src.indexOf('\n## ', at + 1);
  const section = src.slice(at, next > 0 ? next : undefined);
  assert.match(section, /diagram-suggestion\.md/, 'Step 2.5d no longer cites diagram-suggestion.md');
  assert.ok(!section.includes('named status enums'), 'Step 2.5d still restates the detection table inline');
  assert.ok(!section.includes('foreign key'), 'Step 2.5d still restates the detection table inline');
  // Framing that stays local to decomposition mode:
  assert.match(section, /runs for every surface/);
  assert.match(section, /### Diagram suggestions/, 'Step 2.5d must still name the Step 9 summary block it feeds');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/specify-diagram-suggestion-shared.test.js`
Expected: FAIL — `plugin/skills/specify/diagram-suggestion.md` does not exist yet (ENOENT on the first `read(SHARED)` call).

- [ ] **Step 3: Write `plugin/skills/specify/diagram-suggestion.md`**

```markdown
# Specify — Diagram Suggestion (shared detection rules)

Signal-detection table and emission rules for suggesting a `/claude-tweaks:visualize` diagram
from a block of text — cited by `decomposition-mode.md`'s Step 2.5d (the design doc text plus
decomposed record titles) and `shaping-mode-readback.md`'s Diagram suggestion section (a single
shaped record's own composed body, or each record's in a comma-list batch). One detection table,
cited rather than restated, so the two modes' recommendations never drift (#2949).

## Gate

Read the `diagram-suggestions` flag from CLAUDE.md (written by `/init` Step 12, under its
`## Design integration` heading). When the flag is `disabled` or missing, skip the whole step
silently — no scan, no block, no log line. Both callers apply this gate before running Detection
below, never after.

## Detection

Scan the given text for structural signals. Use this detection table:

| Signal in the text | Diagram type (suggest) |
|----------------------|------------------------|
| Phrases like "state machine", "states:", "transitions from … to …", named status enums (3+ values) | `state` |
| Schema definitions, `entity`, `references`, `foreign key`, ORM relations between 2+ tables | `er` |
| 3+ services / actors / queues exchanging messages or HTTP calls | `sequence` |
| 3+ named branches in a decision (`If A then B; if C then D; otherwise E`) | `flowchart` |
| 3+ system components / boxes in a layout (microservices, layers, gateways) | `architecture` |
| Parent-child taxonomy with 2+ levels (categories → subcategories → items) | `tree` |

Emit at most **two** recommendations — the two strongest matches. Skip emission entirely if no
signal matches (trivial records and refactors should not trigger the hook).

## Output format

For each emitted recommendation:

```
**Diagram suggestion:** This design doc describes a state machine for orders
(pending → paid → shipped → delivered → refunded). Consider a state diagram:
`/claude-tweaks:visualize state {spec-slug} --source specify`
```

`{spec-slug}` is the caller's own identifier for what's being visualized — the design doc's slug
for a decomposition-mode caller, the record's own ref/slug for a shaping-mode caller.

## Rendering — interactive vs. headless

Advisory only — never blocks, never writes record frontmatter, never invokes a tool itself. The
calling mode decides placement:

- **Interactive** (a human present at this turn): render the recommendation(s) inline, in
  whatever block the calling mode's own render step specifies. The user decides whether to act
  in the next turn.
- **Auto / headless** (bare drain, `--chained`, or any other non-interactive posture): never
  print the recommendation inline — log one line per emitted recommendation to the decision log
  instead:

  `STAGED {time} — {step-id}: diagram-suggestion ({type}) for {ref-or-slug}. Reversibility: high.`

  `{step-id}` is the calling mode's own step/section name (`Step 2.5d` for decomposition mode,
  `Diagram suggestion` for shaping mode) — each caller supplies its own; this file does not fix
  one.
```

- [ ] **Step 4: Replace decomposition-mode.md's Step 2.5d body with a citation**

In `plugin/skills/specify/decomposition-mode.md`, replace the full Step 2.5d section (from
`## Step 2.5d: Diagram Suggestion (all surfaces)` up to, but not including, the next `---`
horizontal rule before "## Delegate-or-continue decision") with:

```markdown
## Step 2.5d: Diagram Suggestion (all surfaces)

**Unlike Step 2.5, this runs for every surface** — architecture, ER, sequence, and state diagrams help backend and infra specs equally.

Read the `diagram-suggestions` flag from CLAUDE.md per `diagram-suggestion.md`'s Gate section (this skill's directory) — the same gate shaping mode's own Diagram suggestion step (`shaping-mode-readback.md`) reads, so it is checked once per file, never restated. When the flag is `disabled` or missing, skip this step silently.

When `enabled`, run `diagram-suggestion.md`'s Detection against the design doc text plus the decomposed record titles, and render per its Output format — at most two recommendations, the two strongest matches, nothing when no signal matches.

Place the rendered recommendation(s) in the Step 9 summary under a `### Diagram suggestions` block. Advisory only — see `diagram-suggestion.md`'s Rendering section for the full interactive/headless split; this mode's own `{step-id}` for the headless log line is `Step 2.5d`.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/specify-diagram-suggestion-shared.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Run the specify sub-file size ceiling test**

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS — `decomposition-mode.md` shrank (table removed), `diagram-suggestion.md` is a new, well-under-ceiling file.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/specify/diagram-suggestion.md plugin/skills/specify/decomposition-mode.md tests/specify-diagram-suggestion-shared.test.js
git commit -m "Extract diagram-suggestion detection table to a shared /specify sub-file — #2949"
```

### Task 2: Shaping mode's own Diagram suggestion step

**Files:**
- Modify: `plugin/skills/specify/shaping-mode-readback.md`
- Test: `tests/specify-diagram-suggestion-shaping.test.js`

**Interfaces:**
- Consumes: `diagram-suggestion.md`'s `## Gate`/`## Detection`/`## Output format`/`## Rendering` sections (Task 1).
- Produces: a new `### Diagram suggestion` section in `shaping-mode-readback.md`, run per record against that record's composed body (from `shaping-mode-stamping.md`'s Compose-then-write-once section, already in memory — no re-fetch), plus a new optional `### Diagram suggestions` render block placed after `### Actions Performed`.

- [ ] **Step 1: Write the failing test**

Create `tests/specify-diagram-suggestion-shaping.test.js`:

```js
'use strict';
// #2949: shaping mode (the primary #N/comma-list /specify path) must run the same
// diagram-suggestion detection decomposition mode's Step 2.5d already runs, per
// record, citing the shared table rather than restating it — and must honor the
// interactive/headless rendering split (STAGED log line, never an inline block,
// under bare drain / `next` / `--chained`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const READBACK = 'plugin/skills/specify/shaping-mode-readback.md';

test('shaping-mode-readback.md has a Diagram suggestion section citing the shared file', () => {
  const src = read(READBACK);
  assert.match(src, /^### Diagram suggestion\b/m, 'missing ### Diagram suggestion section heading');
  const at = src.indexOf('### Diagram suggestion');
  const section = src.slice(at, src.indexOf('### Read-back verification'));
  assert.ok(section.length > 0, 'Diagram suggestion section must precede Read-back verification');
  assert.match(section, /diagram-suggestion\.md/, 'must cite the shared detection file');
  assert.ok(!section.includes('named status enums'), 'must not restate the detection table inline');
  assert.ok(!section.includes('foreign key'), 'must not restate the detection table inline');
});

test('shaping-mode-readback.md runs the diagram-suggestion step per record, against the composed body', () => {
  const src = read(READBACK);
  const section = src.slice(src.indexOf('### Diagram suggestion'), src.indexOf('### Read-back verification'));
  assert.match(section, /composed body/, 'must run against the already-composed body, not a re-fetch');
  assert.match(section, /per record|each record/i, 'must state it runs once per record on a batch');
  assert.match(section, /at most two|capped at two/i, 'must restate the per-record two-suggestion cap for the batch case');
});

test('shaping-mode-readback.md splits interactive render from headless STAGED logging', () => {
  const src = read(READBACK);
  const section = src.slice(src.indexOf('### Diagram suggestion'), src.indexOf('### Read-back verification'));
  assert.match(section, /--chained/, 'must name --chained as a headless posture');
  assert.match(section, /next.*headless posture|headless posture/i, 'must name the next-form headless posture');
  assert.match(section, /STAGED/, 'must describe the headless STAGED log line');
});

test('shaping-mode-readback.md renders an optional Diagram suggestions block after Actions Performed', () => {
  const src = read(READBACK);
  const actionsAt = src.indexOf('### Actions Performed');
  const blockAt = src.indexOf('### Diagram suggestions', actionsAt);
  assert.ok(actionsAt >= 0, 'Actions Performed section missing');
  assert.ok(blockAt > actionsAt, 'Diagram suggestions render block must come after Actions Performed');
  const block = src.slice(blockAt, blockAt + 400);
  assert.match(block, /optional/i, 'the render block must be marked optional (omit when nothing emitted)');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/specify-diagram-suggestion-shaping.test.js`
Expected: FAIL — `shaping-mode-readback.md` has no `### Diagram suggestion` heading yet.

- [ ] **Step 3: Insert the new section at the top of `shaping-mode-readback.md`**

In `plugin/skills/specify/shaping-mode-readback.md`, insert immediately after the file's opening
`---` divider (before `### Read-back verification`):

```markdown
### Diagram suggestion

Once this record's write call (`shaping-mode-stamping.md`'s Compose-then-write-once) has run —
landed, been refused, or failed — but before Read-back verification below, run
`diagram-suggestion.md`'s Gate (this skill's directory) against this record. When the
`diagram-suggestions` flag is disabled or missing, skip the rest of this section for this record
entirely — no scan, no block, no log line, and shaping mode's visible output is unchanged from
before this step existed.

When enabled, run `diagram-suggestion.md`'s Detection against this record's already-composed
body (the one assembled in `shaping-mode-stamping.md`'s Compose-then-write-once section — no
re-fetch needed), and hold the result per `diagram-suggestion.md`'s Output format — at most two
recommendations for this record, the two strongest matches, nothing when no signal matches. On a
comma-list batch, run this independently for each record in the batch — the two-per-record cap
is per record, never two for the whole batch.

**Interactive entry** (case 1 or case 5 of `SKILL.md`'s Resolve-the-input, not `--chained`): hold
every record's recommendation(s) and render them together in the `### Diagram suggestions` block
below, after Actions Performed.

**Headless entry** (bare drain / the deprecated `next` alias's headless posture, or `--chained` —
the same two postures `shaping-mode.md`'s own opening section names): never render the block —
log one line per emitted recommendation instead, per `diagram-suggestion.md`'s Rendering section,
with this mode's own `{step-id}` set to `Diagram suggestion`:

`STAGED {time} — Diagram suggestion: diagram-suggestion ({type}) for {ref}. Reversibility: high.`

---
```

- [ ] **Step 4: Add the optional render block after Actions Performed**

In the same file, immediately after the `### Actions Performed` table's closing paragraph (the
paragraph ending "...never touches `auto:*` or `bot:*` — those stay `/backlog refine`'s (human-
granted authorization) and `/dispatch`'s (bot-state mirror) territory."), add:

```markdown

### Diagram suggestions (optional — render only on interactive entry, and only when the Diagram suggestion section above emitted any)

- {one or two `**Diagram suggestion:** …` blocks held by the Diagram suggestion section above, one per record that emitted any}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/specify-diagram-suggestion-shaping.test.js`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Run the specify sub-file size ceiling test**

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS — `shaping-mode-readback.md` grows from 7628 B by roughly 1.8 KB, still far under the 28672 B ceiling.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/specify/shaping-mode-readback.md tests/specify-diagram-suggestion-shaping.test.js
git commit -m "Add shaping mode's own diagram-suggestion step, citing the shared detection table — #2949"
```

### Task 3: Documentation cross-reference and full-suite verification

**Files:**
- Modify: `docs/getting-started.md` (line ~84)
- Test: full suite (no new test file)

**Interfaces:**
- Consumes: Tasks 1-2 (no new interface — documentation-only).
- Produces: nothing a later task consumes.

- [ ] **Step 1: Update the cross-reference**

In `docs/getting-started.md`, in the `/claude-tweaks:visualize` entry, replace:

```
Soft-hook nudges in `/journeys` Step 3.6, `/specify` Step 2.5d, and `/review` Lens 3i-diagram suggest invoking it — gated by `diagram-suggestions: enabled` in CLAUDE.md, written by `/init` Step 12.
```

with:

```
Soft-hook nudges in `/journeys` Step 3.6, `/specify` Step 2.5d (decomposition mode) and its shaping-mode Diagram suggestion step, and `/review` Lens 3i-diagram suggest invoking it — gated by `diagram-suggestions: enabled` in CLAUDE.md, written by `/init` Step 12.
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS — every suite, including the two new test files from Tasks 1-2 and the pre-existing `tests/specify-net-empty-teardown.test.js` (confirms `decomposition-mode-closeout.md`'s own `### Diagram suggestions` block was never touched).

- [ ] **Step 3: Commit**

```bash
git add docs/getting-started.md
git commit -m "Cross-reference shaping mode's diagram-suggestion step from getting-started.md — #2949"
```
