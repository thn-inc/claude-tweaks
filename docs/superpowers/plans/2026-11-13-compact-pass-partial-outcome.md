# Keep a partial Current-State outcome out of review's compact clean PASS (#5359) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A review whose diff does not reach the Current-State outcome its record named (Step 1 item 5 marked `partial`) can no longer render the compact clean PASS.

**Architecture:** Two prose edits in `plugin/skills/review/` — a new compact-form condition bullet in the summary template, and a reworded Step 7 parenthetical in `code-mode-steps.md` that defers to the template's full list and names spec compliance — pinned by one new prose-conformance suite that proves each pin goes red against the pre-change text.

**Tech Stack:** Markdown skill prose; `node --test` (built-in), `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T180809-spec-5359/work/5359-spec.md` (materialized from GitHub issue #5359)

## Global Constraints

- `plugin/skills/review/code-mode-steps.md` is 52,331 B at the merge base `79cd5710d` against the 52,500 B Read rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`) — 169 B of headroom. The Step 7 edit replaces one parenthetical in place; the file must stay ≤ 52,500 B by `wc -c` after the edit. Remedy if it would not fit: shorten the replacement parenthetical, never cut other prose.
- Do not reword the template's existing bullet `Every deliverable is \`done\` and every criterion \`met\` — a \`partial\`, \`missing\` or \`unverifiable\` item (Step 1 item 6) needs the full template's Spec Compliance tables`: `tests/review-pr-body-deliverables.test.js:145` pins it byte-for-byte. The new condition is a separate bullet.
- Governing skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/SKILL.md`), quoted verbatim: "Read live prose only when the prose is the declared contract" — here it is: the compact-form list and Step 7's pointer are the contract being pinned. And: "the mechanism this repo converged on three times is to freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."
- `tests/helpers/read-skill.js`, quoted verbatim: "Every prose-conformance suite that reads governed markdown for a literal assertion should route its read through this helper instead of a private fs.readFileSync call."
- Commit message style: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix).

## Review Focus

1. The new bullet lands outside the compact-form list (e.g. in the full template below `## Full template`) — the AC1.1 pin slices `## Compact form — clean PASS` … the first `` ```markdown `` fence, so a misplaced bullet reads red.
2. The existing byte-pinned bullet at `tests/review-pr-body-deliverables.test.js:145` gets reworded while adding the new one — Step 4 runs that suite too.
3. The Step 7 replacement grows `code-mode-steps.md` past the 52,500 B rail — Step 4 measures it with `wc -c` and states the number.
4. A go-red control that only re-asserts its own mutation (cannot fail) — both controls call the same assertion function the positive test calls and expect it to throw.
5. The new Step 7 wording restates a narrower list again — the replacement names the template's list as the source ("every condition that file lists") and adds no other enumerated condition beyond spec compliance and the Current-State outcome.

---

### Task 1: Exclude a partial Current-State outcome from the compact clean PASS

**Files:**
- Modify: `plugin/skills/review/review-summary-template.md:10` (insert one bullet directly after it)
- Modify: `plugin/skills/review/code-mode-steps.md:385` (replace one parenthetical in place)
- Test: `tests/review-compact-pass-outcome-conformance.test.js` (Create)

**Interfaces:**
- Consumes: none.
- Produces: none (prose + test only).

- [ ] **Step 1: Write the failing test** — create `tests/review-compact-pass-outcome-conformance.test.js`:

  - Read both files with `readText` (`./helpers/read-skill`) from `path.join(__dirname, '..', 'plugin', 'skills', 'review', …)`.
  - A `between(text, start, end)` helper identical in behavior to `tests/review-build-not-run-conformance.test.js`'s (both anchors must resolve; end searched after start).
  - Slices: `compact = between(template, '## Compact form — clean PASS', '```markdown')`; `step7 = between(steps, '## Step 7: Present Review Summary', '### Key Learnings for Wrap-Up')`.
  - Patterns:
    - `OUTCOME_BULLET_RE = /^- Step 1 item 5's Current-State outcome is not `partial` — /m`
    - `STEP7_RE = /\*\*compact clean-PASS form\*\* \([^)]*spec compliance[^)]*\)/`
  - Frozen pre-change excerpts (constants in the test, copied verbatim from `git show 79cd5710d:<path>`):
    - `PRE_CHANGE_COMPACT` — the compact-form bullet list, from `- Verdict is PASS` through the `- Step 3.7's tiebreak …` bullet (template lines 9-17 at the base).
    - `PRE_CHANGE_STEP7` — the base's line 385 sentence fragment `For the complete template, the context-signal rules, and the **compact clean-PASS form** (rendered instead of the full template when the verdict is PASS with zero findings, zero actions, and zero manual steps), read \`review-summary-template.md\` in this skill's directory.`
  - Assertion functions: `assertOutcomeBullet(text)` → `assert.match(text, OUTCOME_BULLET_RE, …)`; `assertStep7NamesSpecCompliance(text)` → `assert.match(text, STEP7_RE, …)`.
  - Tests:
    - `test('AC1.1: the compact-form list excludes a partial Current-State outcome (Step 1 item 5)', …)` → `assertOutcomeBullet(compact)`.
    - `test('AC1.1: the compact-form pin goes red when the clause is removed', …)` → `mutated = compact.split('\n').filter((l) => !OUTCOME_BULLET_RE.test(l)).join('\n')`; `assert.notStrictEqual(mutated, compact)`; `assert.throws(() => assertOutcomeBullet(mutated))`; `assert.throws(() => assertOutcomeBullet(PRE_CHANGE_COMPACT))`.
    - `test("AC2.1: Step 7's compact-condition sentence names spec compliance", …)` → `assertStep7NamesSpecCompliance(step7)`.
    - `test('AC2.1: the Step 7 pin goes red against the pre-change sentence', …)` → `assert.throws(() => assertStep7NamesSpecCompliance(PRE_CHANGE_STEP7))`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-compact-pass-outcome-conformance.test.js`
Expected: FAIL — the two positive tests (`AC1.1: the compact-form list excludes …`, `AC2.1: Step 7's compact-condition sentence …`) fail; the control tests pass.

- [ ] **Step 3: Edit the two prose files**

  - `review-summary-template.md`: insert directly after the `- Every deliverable is \`done\` and every criterion \`met\` …` bullet (line 10), as its own line, exactly:
    `- Step 1 item 5's Current-State outcome is not \`partial\` — a diff that does not reach the outcome its record named needs the full template, even when every deliverable is \`done\` and every criterion \`met\``
  - `code-mode-steps.md` line 385: replace exactly `(rendered instead of the full template when the verdict is PASS with zero findings, zero actions, and zero manual steps)` with `(rendered instead of the full template only when every condition that file lists holds, spec compliance and the Current-State outcome included)`. Change nothing else on the line.

- [ ] **Step 4: Run tests and the byte check**

Run: `node --test tests/review-compact-pass-outcome-conformance.test.js tests/review-pr-body-deliverables.test.js tests/review-build-not-run-conformance.test.js`
Expected: PASS, 0 fail.

Run: `wc -c plugin/skills/review/code-mode-steps.md`
Expected: `52354` (base 52,331 + the replacement's measured +23 B; 146 B under the rail).

- [ ] **Step 5: Commit**

```bash
git add tests/review-compact-pass-outcome-conformance.test.js plugin/skills/review/review-summary-template.md plugin/skills/review/code-mode-steps.md
git commit -m "Keep a partial Current-State outcome out of review's compact clean PASS — template bullet, Step 7 defers to it (#5359)"
```
