# Retarget help/policy.md's derived-default citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point the three `plugin/skills/help/policy.md` citations of the derived-default prose at `_shared/policy-schema-read-path.md`, where #5216 moved that prose.

**Architecture:** Three in-place path substitutions in one markdown skill file. No code, no new files.

**Tech Stack:** Markdown skill prose; `node --test` conformance suites via `verify.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T141706-spec-5249/work/5249-spec.md`

## Global Constraints

- Only `plugin/skills/help/policy.md` changes, and only the path token at lines 51, 57 and 81 (spec AC2: "No other text in `plugin/skills/help/policy.md` changes").
- The cited names stay exactly as written: "Derived-default keys list", "Shape B paragraph", "Shape B derived-default signal".
- New path text, verbatim: `_shared/policy-schema-read-path.md`.

## Review Focus

- Line 81's citation is a parenthetical `(` `_shared/policy-schema.md` `)`, not a `'s` possessive — the AC1 greps do not cover it, so check it by line number.
- Other `_shared/policy-schema.md` mentions in the same file that cite content still living in the parent (none at the time of writing — lines 20, 130 and 140 cite `bin/lib/policy-schema.js`, a different file) must not be swept up.

---

### Task 1: Retarget the three citations

**Files:**
- Modify: `plugin/skills/help/policy.md:51`, `:57`, `:81`

**Interfaces:**
- Consumes: `plugin/skills/_shared/policy-schema-read-path.md` — "**Derived-default keys**" paragraph (line 15) and the "*Shape B — in-loop derivation over a static base default*" paragraph (line 19).
- Produces: nothing other tasks use.

- [ ] **Step 1: Confirm the old citations are present**

Run: `git grep -n -F "_shared/policy-schema.md" -- plugin/skills/help/policy.md`
Expected: exactly three hits, at lines 51, 57 and 81.

- [ ] **Step 2: Edit the three sites**

At each of lines 51, 57 and 81, replace the path `_shared/policy-schema.md` with `_shared/policy-schema-read-path.md`. Nothing else on those lines or elsewhere in the file changes.

- [ ] **Step 3: Verify AC1**

Run each, expecting the stated result:
- `git grep -n -F "_shared/policy-schema.md\`'s Derived-default" -- plugin/skills/help` → no output (exit 1)
- `git grep -n -F "_shared/policy-schema.md\`'s Shape B" -- plugin/skills/help` → no output (exit 1)
- `git grep -n -F "_shared/policy-schema-read-path.md\`'s Derived-default" -- plugin/skills/help` → one hit, line 51
- `git grep -n -F "_shared/policy-schema-read-path.md\`'s Shape B" -- plugin/skills/help` → one hit, line 57
- `git grep -n -F "Shape B derived-default signal (\`_shared/policy-schema-read-path.md\`)" -- plugin/skills/help` → one hit, line 81
- `git grep -n -F "_shared/policy-schema.md" -- plugin/skills/help/policy.md` → no output

- [ ] **Step 4: Verify AC2's no-other-change half**

Run: `git diff --stat`
Expected: `plugin/skills/help/policy.md | 6 +++---` and nothing else.

- [ ] **Step 5: Run the affected tests**

Run (foreground, output to a file): `node plugin/bin/verify.js --scope .claude-tweaks/verify-scope.json --integration-branch main --no-stamp`
Expected: exit 0. If it prints `waiting for a test-suite slot` because another session holds the slot, stop only your own queued PID, run `node --test tests/skill-fence-guard-shapes.test.js tests/flow-pre-authorize-merge-token.test.js` instead (the two suites that read `help/policy.md`), report that you did so, and commit — Common Step 5 runs the branch's full verification.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/help/policy.md
git commit -m "Retarget help/policy.md's derived-default citations at _shared/policy-schema-read-path.md — #5216 moved that prose"
```
