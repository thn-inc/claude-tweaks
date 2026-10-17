---
files:
  - tests/skill-size-single-source.test.js
  - plugin/bin/lib/skill-audit/budgets.js
  - docs/skill-authoring.md
---

# Act on a Red Skill-Size Single-Source Guard

**Persona:** A claude-tweaks plugin maintainer. They write a test that pins a skill file's size (`assert.ok(bytes < 20480)`, or a `const FOO_BYTE_BUDGET = …`), and `npm test` goes red on `tests/skill-size-single-source.test.js`.
**Goal:** See which line the guard flagged and why a per-file size number is not allowed, then keep the test's content assertions without the size check.
**Entry point:** `npm test` (or `node --test tests/skill-size-single-source.test.js`) reports `not ok … AC3.1: no file under tests/ or plugin/bin/ other than budgets.js defines or compares a skill-size number, and none is unclassified`.
**Success state:** The flagged size check is deleted, or the number moved into `plugin/bin/lib/skill-audit/budgets.js` when it really is a new platform limit. The guard passes, and the test's other assertions still run.

## Steps

### 1. Read the flagged line
- **URL:** the failing test's assertion message.
- **Action:** Read each listed line. Violations read `{file}:{line} (rule a|b): {source line}`, and unclassified lines read `{file}:{line} [{operand}]: {source line}`.
- **Should feel:** Pinpointed. Every entry names a file, a line and the exact source text, so there is nothing to search for.
- **Should understand:** There are two rules and one fallback.
  - **Rule (a)** flags a declared size-limit constant: a `CEILING`/`BUDGET` name carrying `BYTES`/`CHARS`, in either order, assigned a number.
  - **Rule (b)** flags a size taken from a skill file and compared to a literal of 1024 or more (or `N * 1024`). That size can come from a `plugin/skills` path, from a variable or loop binding derived from one, or from a skill-audit measurement call such as `composedBytesReport(...)`.
  - **Unclassified** is a size comparison against a named value the scanner cannot resolve: an UPPER_CASE constant, or a name containing ceiling/budget/cap. It is never treated as a pass.
- **Red flags:**
  - A violation with no line text.
  - The guard flagging a comparison inside a string message, or a fixture path with no skills reference. Its `what the scanner must not flag` self-test pins both.

### 2. Decide whether the number is a limit at all
- **URL:** `docs/skill-authoring.md` (the per-file pin paragraph) and `plugin/bin/lib/skill-audit/budgets.js`'s header.
- **Action:** Ask whether the number is a real platform limit or a budget someone picked.
- **Should feel:** Like a settled rule, not a negotiation. Decision 0024 says no size number below the Read-limit rail may tip `main` red.
- **Should understand:**
  - The only size limits are `RAIL_BYTES` (52,500 measured bytes), `RAIL_LINES` (2,000) and `DESCRIPTION_MAX_CHARS` (1,536), all in `budgets.js`, enforced by the `rail:` suite in `tests/bin-lib/skill-audit/context-cost.test.js`.
  - A test may compare against those names. They are never flagged.
  - Growth below the rail is shown at review (`/review`'s load delta) and in `/harness-health`, never gated.
- **Red flags:**
  - Renaming the constant (`MAX_SKILL_BYTES`, a lowercase `limit`) to slip past rule (a). That is the same pin under another name.
  - Adding the file to the guard's `ALLOWLIST` to keep a skill-file pin. The two allowlisted files each carry a reason for a different artifact (CLAUDE.md's own budget, and a fixture that proves discrimination).

### 3. Remove the size check and keep the content
- **URL:** the flagged test file.
- **Action:** Delete the size assertion and anything only it used: the `const bytes = …` line, the constant, and any import that only the size check read. Leave every content assertion in place. If the size check was the test's only assertion, delete the test. Then re-run `node --test tests/skill-size-single-source.test.js` and the edited file.
- **Should feel:** Small and safe. The test still proves what the skill says; it just no longer argues about how big the file is.
- **Should understand:** When a file is genuinely near the rail, the remedy is the rail's own: cut bytes, or move a genuinely lazy section into its own file (`act-on-a-red-read-limit-rail-3306.md` Step 3). A pin never was a remedy.
- **Red flags:**
  - Content assertions deleted along with the size line.
  - A leftover unused import or `bytes` variable.
  - The guard passing because the check was rewritten across several lines. The scanner is line-based, so that hides the pin rather than removing it.

## Origin
- Created during build of #3311 (decommissioned the per-file byte ceiling, the composed ceiling, the description ceilings, the merge-time size probe and every per-file byte pin in `tests/`; added the single-source guard), the contract step of parent #3305's strangler-fig rollout.
- Related: `act-on-a-red-read-limit-rail-3306.md` (the one size limit left), `read-a-skill-load-delta-at-review-3307.md` (how growth below the rail is shown instead of gated).
