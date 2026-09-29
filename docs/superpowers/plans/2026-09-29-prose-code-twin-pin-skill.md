# prose-code-twin-pin Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new maintainer-side project skill, `.claude/skills/prose-code-twin-pin/SKILL.md`, that names the "prose table pinned to a code twin with no conformance test" pattern and gives a reviewer or skill-author a concrete way to check for it, so `/claude-tweaks:harness-health`'s new-skill-gap scan and `/claude-tweaks:review`'s skill-gap detection can surface future candidate instances.

**Architecture:** A single new file following this repo's existing `.claude/skills/*/SKILL.md` dogfooding convention (YAML frontmatter with `name` + a keyword-rich `description`, then a markdown body: pattern statement, worked examples, a concrete check, anti-patterns table). No code changes — this is a documentation-only unit, matching the shape of its siblings (`.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`, `.claude/skills/shared-contract-extraction/SKILL.md`).

**Tech Stack:** Markdown only.

**Spec:** `.claude-tweaks/pipelines/2026-09-29T162825-record-2792/work/2792-spec.md` (materialized from GitHub issue #2792)

## Global Constraints

- File lives under `.claude/skills/prose-code-twin-pin/SKILL.md` — the maintainer-side project-skill convention (not `plugin/skills/`, which is the shipped payload; CLAUDE.md's Structure section: "nothing else in this repo ships").
- Frontmatter must match sibling convention exactly: `name: prose-code-twin-pin` and a `description:` field ending in a `Keywords - ...` clause (verified against `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` and `.claude/skills/shared-contract-extraction/SKILL.md`).
- Must name at least the two known instances from the #2251-2258 build as worked examples (spec Acceptance Criterion 2) — verified against real repo history, not invented.
- No test suite in this repo enumerates or lints `.claude/skills/*/SKILL.md` files generically (checked: `grep -rln "\.claude/skills" tests/*.js` returns only isolated same-file citations, no directory-walk sweep over that tree) — so no new automated test is required for this task, per CLAUDE.md's Working Approach ("Commit tests only where the task asks for them or the repo already keeps tests for this kind of change").

## Review Focus

1. **Worked examples that don't actually exist / are misattributed.** The record's Current State names one instance (`record.js`'s `TYPE_LABELS` vs `subject.js`'s `TYPE_PREFIX`) but the spec doesn't name a second. A plausible-sounding but unverified second example would make the skill's own worked-example section exactly the kind of unverified claim this project's review process exists to catch. Mitigation: Task 1 Step 1 re-derives and greps both examples against live repo state before writing.
2. **A "detect this pattern" instruction with no concrete, runnable check.** A skill that only describes the pattern in the abstract gives a reviewer nothing to actually do. Mitigation: Task 1's body includes a literal grep-based check a reviewer can run.
3. **Skill invisible to the generic new-skill-gap scan because its `description` lacks the keyword density its siblings carry.** `harness-health`'s gap scan and `/review`'s skill-gap detection work off the `description` field's keywords. Mitigation: Task 1 Step 2 models the frontmatter on two existing siblings and includes the pattern's own vocabulary (prose twin, code twin, conformance test, drift) as keywords.
4. **Confusing this skill's scope with `shared-contract-extraction`'s (adjacent but distinct).** `shared-contract-extraction` is about extracting a *new* shared contract and migrating consumers; `prose-code-twin-pin` is about *detecting* an existing drift risk between prose and code that was never extracted into a shared contract at all — a narrower, review-time check, not an extraction procedure. Mitigation: Task 1's body states this boundary explicitly in an "Existing coverage, checked" section, mirroring `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`'s own such section.
5. **File placed under the wrong directory (`plugin/skills/` instead of `.claude/skills/`), silently making it a shipped-payload change instead of a maintainer-only one.** Mitigation: Task 1 Step 1 explicitly re-confirms the target directory against CLAUDE.md's Structure section and an existing sibling before writing.

---

### Task 1: Author the `prose-code-twin-pin` skill

**Files:**
- Create: `.claude/skills/prose-code-twin-pin/SKILL.md`

**Interfaces:**
- Consumes: nothing (first and only task; no prior task output).
- Produces: the finished skill file. Nothing downstream in this plan reads it.

- [ ] **Step 1: Re-verify the two worked examples against live repo state**

Run (read-only, no file changes yet):

```bash
grep -n "Type vocabulary has one source of truth" tests/bin-lib/compose-subject.test.js
```

Expected: one match — `test('Type vocabulary has one source of truth: TYPE_PREFIX and record.TYPES name the same set', () => {` — confirming this test exists and pins `subject.js`'s `TYPE_PREFIX` against `record.js`'s `TYPES` (the fixed instance named in the record's own Current State).

```bash
grep -n "review finding on #2256" .claude/skills/driver-skill-outcome-taxonomy/SKILL.md
grep -rln "HELD\|PARTIAL" tests/*.js
```

Expected: the first command matches the skill's own opening paragraph ("Every review finding on #2256 that survived refutation was a taxonomy or a provenance confusion"), confirming this skill's four-outcome-word table (`HELD` / `failed` / `PARTIAL` / `released` in `.claude/skills/driver-skill-outcome-taxonomy/SKILL.md`) was itself born from a review finding during the #2251-2258 build. The second command's only hit, `tests/release-routine-template.test.js`, asserts that certain literal strings (`'HELD'`, `'PARTIAL'`) are *present* in specific files — a citation sweep, not a vocabulary-equality assertion like `compose-subject.test.js`'s `assert.deepEqual(Object.keys(TYPE_PREFIX).sort(), TYPES.slice().sort())` — confirming this second instance has no conformance test pinning its four words against the actual outcome vocabulary the release skill's code produces.

Both examples now re-verified against live repo state (not carried from memory or invented).

- [ ] **Step 2: Confirm target directory and frontmatter convention**

Run:

```bash
ls .claude/skills/pre-tool-use-gate-exemptions/SKILL.md .claude/skills/shared-contract-extraction/SKILL.md
head -3 .claude/skills/pre-tool-use-gate-exemptions/SKILL.md
```

Expected: both files exist; the frontmatter shape is:

```yaml
---
name: pre-tool-use-gate-exemptions
description: Use when ... Keywords - ..., ..., ....
---
```

Confirms the convention to follow: `.claude/skills/{kebab-case-name}/SKILL.md`, frontmatter with `name` + `description` ending in a `Keywords - ` clause. This is a maintainer-only project skill (CLAUDE.md's Structure section: "The plugin payload is the `plugin/` subtree — nothing else in this repo ships"), so it does **not** go under `plugin/skills/`.

- [ ] **Step 3: Write the skill file**

Create `.claude/skills/prose-code-twin-pin/SKILL.md`:

```markdown
---
name: prose-code-twin-pin
description: Use when reviewing a project skill, or authoring one, that restates a table which also exists as executable code (an enum, a switch, a lookup table) — checks whether a conformance test pins the two equal, the same way this repo already pins `record.js`'s TYPE_LABELS against `subject.js`'s TYPE_PREFIX. Keywords - prose table, code twin, conformance test, drift, pinning test, one source of truth, vocabulary equality, review checklist.
---

# Prose-code-twin-pin

A project skill's markdown prose sometimes restates a table that also exists as executable code:
an enum, a `switch`, a lookup object, a closed vocabulary. The two copies can drift apart —
someone adds a fourth case to the code and forgets the prose row, or renames a prose column with
no code changed to match — and nothing catches it, because the prose is never executed and the
code is never read as documentation. Two review lenses independently flagged an instance of this
during the #2251-2258 multi-spec build (`docs/skill-graph.md`'s release-skill units), which is
the evidence this pattern is real and recurring, not hypothetical.

## The check

For any project skill (`.claude/skills/**/SKILL.md`) or shipped skill (`plugin/skills/**/*.md`)
whose prose contains a table or enumerated list that names a **closed vocabulary** — a fixed set
of type names, outcome words, status labels, facet values — ask two questions:

1. **Does an executable code twin exist?** Grep the vocabulary's own terms (each row/word) against
   `plugin/bin/lib/**/*.js` for a matching object key, `switch` case, or array literal. A vocabulary
   that exists only in prose, with nothing in code reading or producing it, is not this pattern —
   there's no twin to drift from.
2. **If a twin exists, does a conformance test pin the two equal?** Grep `tests/**/*.js` for a test
   that imports both sides and asserts their key/value sets match (`assert.deepEqual(Object.keys(A).sort(), B.slice().sort())` or equivalent) — not merely a test asserting individual literal strings are *present* somewhere (a citation sweep proves nothing about the fourth case someone adds later).

No such test → flag it: either the vocabulary needs a pinning test (model it on the fixed worked
example below), or the "table" isn't actually a closed vocabulary and the prose should say so
plainly instead of reading like one.

## Worked examples

**Fixed instance (what pinning looks like):** `plugin/bin/lib/issues/record.js`'s `TYPE_LABELS`
must stay in sync with `plugin/bin/lib/release/subject.js`'s `TYPE_PREFIX` — both key off the same
closed vocabulary of record types. `tests/bin-lib/compose-subject.test.js`'s `'Type vocabulary has
one source of truth: TYPE_PREFIX and record.TYPES name the same set'` test pins them:
`assert.deepEqual(Object.keys(TYPE_PREFIX).sort(), TYPES.slice().sort())` — a fourth type must gain
a `TYPE_PREFIX` entry in the same change that adds it to `TYPES`, or this test fails loudly instead
of `typeOf` silently returning `null` for the new type.

**Candidate instance (what this check catches today):** `.claude/skills/driver-skill-outcome-taxonomy/SKILL.md`'s
four-outcome-word table (`HELD` / `failed` / `PARTIAL` / `released`) — itself born from a review
finding on #2256 ("Every review finding on #2256 that survived refutation was a taxonomy or a
provenance confusion") — has no conformance test asserting that the release skill's actual code
(`plugin/bin/lib/release/*.js`, `plugin/skills/release/execute.md`) only ever produces one of
these four words. `tests/release-routine-template.test.js` asserts that the literal strings
`'HELD'` and `'PARTIAL'` are *present* in specific files — a citation sweep, not a vocabulary-equality
assertion — so a fifth outcome word introduced later in the release skill's code would not make
this test fail. This is a real, currently-open gap this check surfaces; fixing it is out of scope
for this skill (which only detects and names the pattern) and is tracked separately if pursued.

## Existing coverage, checked

`shared-contract-extraction` governs *extracting* a recurring cross-skill rule into a new
`plugin/skills/_shared/*.md` contract and migrating consumers to cite it — a different problem
from this skill's: a prose table restating a code enum was never meant to be a shared *contract*
between skills, it's a single skill's own documentation drifting from its own dependency's code.
Nothing else in `.claude/skills/` covers vocabulary-equality pinning as its own topic.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Flagging every markdown table as a candidate | Most tables are prose (comparisons, option matrices) with no code twin at all — check for an actual code-side enum/switch/lookup first |
| Accepting a citation-sweep test (`includes('HELD')`) as equivalent to a vocabulary-equality pin | A citation sweep never fails when a new case is added to one side and not the other — only `assert.deepEqual` on the full key/value sets catches that |
| Treating this skill's scope as "extract a shared contract" | That's `shared-contract-extraction`'s job; this skill only detects and names an existing prose/code drift risk, it doesn't prescribe extracting anything |
| Writing a pinning test that only checks one direction (code has every prose row, but not the reverse) | A pinning test must assert set equality both ways — a prose row with no code twin is exactly as much a drift as a code case with no prose row |
```

- [ ] **Step 4: Verify the required content landed**

Run:

```bash
test -f .claude/skills/prose-code-twin-pin/SKILL.md && echo "file exists"
grep -c "^name: prose-code-twin-pin$" .claude/skills/prose-code-twin-pin/SKILL.md
grep -c "Keywords - " .claude/skills/prose-code-twin-pin/SKILL.md
grep -c "#2251-2258" .claude/skills/prose-code-twin-pin/SKILL.md
grep -c "TYPE_PREFIX" .claude/skills/prose-code-twin-pin/SKILL.md
grep -c "driver-skill-outcome-taxonomy" .claude/skills/prose-code-twin-pin/SKILL.md
```

Expected: `file exists`, then `1`, `1` (at least), `1` (at least), `1` (at least), `1` (at least) —
confirming the frontmatter name, the keyword clause, the #2251-2258 attribution, and both worked
examples (the fixed `TYPE_PREFIX` instance and the candidate `driver-skill-outcome-taxonomy`
instance) are all present in the written file.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/prose-code-twin-pin/SKILL.md
git commit -m "Add prose-code-twin-pin project skill — detect prose tables pinned to a code twin with no conformance test

refs #2792"
```
