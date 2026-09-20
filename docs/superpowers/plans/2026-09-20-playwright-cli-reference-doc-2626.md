# Playwright CLI reference doc + init detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright CLI reference doc mirroring `agent-browser-reference.md`, and update init's browser-detection step to detect `playwright-cli` instead of `agent-browser`.

**Architecture:** Pure markdown convention-pin, matching today's `agent-browser` integration pattern (no Node.js code layer). One new reference file plus a targeted edit to the init bootstrap step's detection command and tool name — the shared `_shared/browser-detection.md` (still `agent-browser`-scoped, used by `/browse`/`/visual-review`) stays untouched; this record's scope is init-detection only.

**Tech Stack:** Markdown (skill reference docs).

**Spec:** `.claude-tweaks/pipelines/2026-09-20T061253-record-2626/work/2626-spec.md`

## Global Constraints

- No `npm test` coverage applies — both changes are markdown/prose, matching `agent-browser-reference.md`'s own precedent of having no test suite (spec Gotchas).
- Do not rewrite any of the ~28 files that currently cite `agent-browser-reference.md` — that migration is sub-project 3, out of scope here.
- Do not modify `agent-browser-reference.md` or `_shared/browser-detection.md`.

---

### Task 1: Playwright CLI reference doc

**Files:**
- Create: `plugin/skills/browse/playwright-cli-reference.md`
- Read (template): `plugin/skills/browse/agent-browser-reference.md`

**Interfaces:**
- Consumes: nothing (new standalone reference doc).
- Produces: nothing consumed by another task in this plan — Task 2 does not read this file's content, only cross-references its path.

- [x] **Step 1: Write the reference doc**

Mirror `agent-browser-reference.md`'s section shape: Authority (pins `@playwright/cli` 0.1.0,
defers to the tool's own bundled self-docs at
`node_modules/playwright-core/lib/tools/skills/playwright-cli/SKILL.md` plus `references/`
sub-docs), Daemon/session model (`-s=<name>`, `list`/`close-all`/`kill-all`), the operation
vocabulary translation table from the spec's Technical Approach section verbatim, and the three
cautions (refs are session-scoped and regenerate; `find` here is read-only — opposite of
`agent-browser`'s action-defaulting bare `find`; always pass absolute output paths).

- [x] **Step 2: Verify content matches acceptance criteria**

Check: the translation table is present in full (11 rows matching the spec), both behavioral
differences ((1) `find` read-only, (2) absolute output paths) are stated explicitly and
prominently.

Run: `grep -c "|" plugin/skills/browse/playwright-cli-reference.md`
Expected: table rows present (non-zero, matching the 11-row + header translation table).

- [x] **Step 3: Commit**

```bash
git add plugin/skills/browse/playwright-cli-reference.md
git commit -m "Add Playwright CLI reference doc (agent-browser migration, part 2)"
```

---

### Task 2: Init detection — playwright-cli

**Files:**
- Modify: `plugin/skills/init/bootstrap/step-07-browser-integration.md`

**Interfaces:**
- Consumes: `plugin/skills/browse/playwright-cli-reference.md`'s path (Task 1) — referenced by
  name only, not content.
- Produces: nothing consumed by a later task.

- [x] **Step 1: Update the file**

Replace the `agent-browser`-specific title, backend name, and detection description with the
Playwright CLI equivalents: title becomes "Step 7 — Browser / Playwright CLI (detailed
procedure)"; backend line names `playwright-cli` (`@playwright/cli`); detection command becomes
`npx --no-install playwright-cli --version`, inlined directly (not deferred to
`_shared/browser-detection.md`, which stays `agent-browser`-scoped for `/browse`/`/visual-review`
until sub-project 3); install hint becomes `npm install -g @playwright/cli`. Keep the exact
"missing → hint and continue, never block init" structure and the "do not prompt for backend
choice" line unchanged.

- [x] **Step 2: Verify no other file changed**

Run: `git status --short`
Expected: only `plugin/skills/browse/playwright-cli-reference.md` (new) and
`plugin/skills/init/bootstrap/step-07-browser-integration.md` (modified) — no other file touched.

- [x] **Step 3: Commit**

```bash
git add plugin/skills/init/bootstrap/step-07-browser-integration.md
git commit -m "Detect playwright-cli in init's browser-integration step"
```
