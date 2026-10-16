# Design-wrapper pre-build: Impeccable 4.5 reference list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `pre-build.md`'s stale always-load Impeccable reference set (five files 4.5 no longer ships) with Impeccable 4.5's own load order, and pin every referenced file in the upstream-drift manifest so a future rename turns the drift check red instead of failing silently.

**Architecture:** Two independent, sequentially reviewable edits — a prose selection-rule update in `pre-build.md` (Task 1), and a manifest pin update in upstream-drift's `manifest.yml` (Task 2) — tied together only by the five file names both reference. Task 2 does not read Task 1's output programmatically; the two stay in sync by naming convention, which is why Review Focus below calls out the risk of the two drifting.

**Tech Stack:** Markdown prose (`plugin/skills/design-wrapper/modes/pre-build.md`), YAML (`tools/upstream-drift/manifest.yml`), Node test runner (`node --test`).

**Spec:** `.claude-tweaks/pipelines/2026-10-16T163120-record-3019/work/3019-spec.md` (GitHub issue #3019)

## Global Constraints

- Supported Impeccable floor is already 4.5.0 (`plugin/skills/design-wrapper/impeccable-plugin.md:3`'s `<!-- upstream-pin: impeccable-plugin@4.5.0 -->`) — the 4.5 reference set this plan adopts is within the supported range; no separate version-floor change needed.
- Never grow the keyword rules into a job-type classifier (`pre-build.md`'s own documented constraint) — `new-work.md` stays in the always-load set for that reason, unchanged by this plan.
- `npm test` must pass in full (spec Acceptance Criteria).

## Review Focus

- **Older Impeccable installs (3.x, 4.0-4.4) now report `missed` for the new names** — by design per the spec's Gotchas (acceptable, since the version floor governs the supported range). Not a regression to guard against; noted so a reviewer doesn't mistake it for one.
- **`operate.md` loaded for every surface instead of only Operate/Read surfaces** — would leak Operate conventions onto Persuade (landing) surfaces, which Impeccable's own mode split explicitly separates. Task 1 keeps it a conditional rule, never always-load.
- **A reference file name typo'd in `pre-build.md` but not pinned in `manifest.yml` (or vice versa)** — would silently reopen the exact drift-detection gap this record exists to close. Task 2's assertions must name every file Task 1's rules reference, not a subset; Task 1's test and Task 2's test both enumerate the same four new names independently as a cross-check.
- **`manifest.yml` schema violation** (a missing required assertion field, wrong indentation) — would break `loadManifest`'s real-manifest conformance test. Task 2 matches the existing entry shape exactly (same four keys per assertion: `file`, `claims`, `upstream-path`, `must-match`).
- **The terminal track (`pre-build.md:27-30`) accidentally touched** by the adjacent edit to the frontend rules — Task 1's test scopes its retired-name assertions to the Step 3 frontend section only, and the edit itself never touches lines 27-30.

---

### Task 1: Update pre-build.md's Impeccable 4.5 reference selection rules

**Files:**
- Modify: `plugin/skills/design-wrapper/modes/pre-build.md` (Step 3 reference-selection rules, currently lines 32-38)
- Test: `tests/design-wrapper-prebuild-reference-selection.test.js`

**Interfaces:**
- Consumes: nothing from another task — first and only prose task.
- Produces: the five Impeccable reference file names (`new-work.md`, `craft-floor.md`, `operate.md`, `adapt.md`, `clarify.md`) that Task 2's manifest pins must also name. No shared constant — the two tasks stay in sync by convention, which is why Review Focus calls this out.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
// Pins #3019's fix: pre-build.md's reference-selection rules must name
// Impeccable 4.5's actual reference files, not the five retired topic files
// 4.5 no longer ships. Content-anchored greps against the prose section,
// not a parser.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const PREBUILD = path.join(ROOT, 'plugin', 'skills', 'design-wrapper', 'modes', 'pre-build.md');

test('pre-build.md frontend reference-selection rules name Impeccable 4.5 files, not the retired topic files', () => {
  const md = readText(PREBUILD);
  const start = md.indexOf('### Step 3: Decide which Impeccable references to load');
  const end = md.indexOf('### Step 4: Load project design context');
  assert.ok(start !== -1 && end !== -1 && end > start, 'could not locate the Step 3 reference-selection section');
  const section = md.slice(start, end);

  const retired = [
    'typography.md',
    'color-and-contrast.md',
    'spatial-design.md',
    'motion-design.md',
    'interaction-design.md',
    'responsive-design.md',
    'ux-writing.md',
  ];
  for (const name of retired) {
    assert.ok(!section.includes(name), `reference-selection section still names retired Impeccable file ${name}`);
  }

  assert.match(section, /`new-work\.md`/, 'always-load set must still name new-work.md');
  assert.match(section, /`craft-floor\.md`/, 'always-load set must name craft-floor.md');
  assert.match(section, /`operate\.md`/, 'a conditional rule must name operate.md for Operate/Read surfaces');
  assert.match(section, /`adapt\.md`/, 'a conditional rule must name adapt.md (4.5 equivalent of responsive-design.md)');
  assert.match(section, /`clarify\.md`/, 'a conditional rule must name clarify.md (4.5 equivalent of ux-writing.md)');
});

test('pre-build.md terminal track always-load set is untouched by this change', () => {
  const md = readText(PREBUILD);
  assert.match(md, /`_shared\/terminal-ux\.md` plus `_shared\/design-craft\.md` only/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/design-wrapper-prebuild-reference-selection.test.js`
Expected: FAIL — `pre-build.md` still names the five retired always-load files and the two retired conditional files; the `operate.md`/`adapt.md`/`clarify.md` assertions fail because those strings are absent.

- [ ] **Step 3: Replace the reference-selection rules**

In `plugin/skills/design-wrapper/modes/pre-build.md`, replace this block (the `Reference selection rules` line through the three bullets):

```markdown
Reference selection rules (inspect the spec body):

- **Always load** when frontend: `typography.md`, `color-and-contrast.md`, `spatial-design.md`, `motion-design.md`, `interaction-design.md`, `new-work.md`
- **Add `responsive-design.md`** when the spec mentions breakpoints, mobile, tablet, responsive, or viewport
- **Add `ux-writing.md`** when the spec mentions copy, microcopy, error messages, empty states, or labels
```

with:

```markdown
Reference selection rules (inspect the spec body) — Impeccable 4.5's own load order (its `SKILL.md` steps 2-3: load the request's playbook, then read `craft-floor.md` immediately before any UI edit):

- **Always load** when frontend: `new-work.md`, `craft-floor.md`
- **Add `operate.md`** when the surface is Operate or Read (dashboard, settings, admin, docs, tools, authenticated/task surfaces) — Impeccable's own mode split (its `SKILL.md`: "See new-work.md for new surfaces and operate.md for deeper Operate/Read guidance")
- **Add `adapt.md`** when the spec mentions breakpoints, mobile, tablet, responsive, or viewport — the 4.5 equivalent of the retired `responsive-design.md`
- **Add `clarify.md`** when the spec mentions copy, microcopy, error messages, empty states, or labels — the 4.5 equivalent of the retired `ux-writing.md`
```

Leave the paragraph immediately after (starting "The keyword rules above select *which reference files to load*...") unchanged — it is generic commentary that names no specific reference file and stays accurate after this edit.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/design-wrapper-prebuild-reference-selection.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/design-wrapper/modes/pre-build.md tests/design-wrapper-prebuild-reference-selection.test.js
git commit -m "fix: Replace pre-build's stale Impeccable reference list with 4.5's load order

refs #3019"
```

---

### Task 2: Pin the four reference files in upstream-drift's manifest

**Files:**
- Modify: `tools/upstream-drift/manifest.yml` (the `impeccable-plugin` entry's `contract-paths` list, currently ending at line 100, and its `assertions` list, currently starting at line 101)

**Interfaces:**
- Consumes: the four reference-file names Task 1 introduced (`craft-floor.md`, `operate.md`, `adapt.md`, `clarify.md`) — by convention (both tasks cite the same literal filenames), not a shared constant.
- Produces: nothing a later task reads — this is the last task in the plan.

- [ ] **Step 1: Confirm the four files are not yet pinned**

Run: `grep -c "craft-floor.md\|reference/operate.md\|reference/adapt.md\|reference/clarify.md" tools/upstream-drift/manifest.yml`
Expected: FAIL in the sense that the count is `0` — none of the four are pinned yet. (There is no committed unit test for live manifest *content* to run red/green here — the committed suite validates manifest *schema* only, per Step 3's note — so this grep is the failing-check substitute for this task.)

- [ ] **Step 2: Add contract-paths and assertions**

In `tools/upstream-drift/manifest.yml`'s `impeccable-plugin` entry, append four lines to the existing `contract-paths:` list (immediately after the existing `"skills/impeccable/reference/document.md"` entry):

```yaml
      - "skills/impeccable/reference/craft-floor.md"
      - "skills/impeccable/reference/operate.md"
      - "skills/impeccable/reference/adapt.md"
      - "skills/impeccable/reference/clarify.md"
```

Append four assertions to the same entry's `assertions:` list (after the existing last assertion), matching the existing entry shape exactly — `file`, `claims`, `upstream-path`, `must-match`:

```yaml
      - file: "plugin/skills/design-wrapper/modes/pre-build.md"
        claims: "craft-floor.md carries the quality floor, read immediately before any UI edit"
        upstream-path: "skills/impeccable/reference/craft-floor.md"
        must-match: "# Craft floor"
      - file: "plugin/skills/design-wrapper/modes/pre-build.md"
        claims: "operate.md carries deeper Operate/Read guidance for dashboard, settings, admin, and tools surfaces"
        upstream-path: "skills/impeccable/reference/operate.md"
        must-match: "# Operate mode depth"
      - file: "plugin/skills/design-wrapper/modes/pre-build.md"
        claims: "adapt.md is the 4.5 equivalent of the retired responsive-design.md — adapting a design to a different screen size, device, platform, or use case"
        upstream-path: "skills/impeccable/reference/adapt.md"
        must-match: "Adapt an existing design to a different context"
      - file: "plugin/skills/design-wrapper/modes/pre-build.md"
        claims: "clarify.md is the 4.5 equivalent of the retired ux-writing.md — rewriting unclear interface text"
        upstream-path: "skills/impeccable/reference/clarify.md"
        must-match: "Rewrite unclear interface text so users understand what happened"
```

- [ ] **Step 3: Run the committed schema-conformance suite**

Run: `node --test tools/upstream-drift/tests/manifest.test.js`
Expected: PASS, including `conformance: loadManifest succeeds on the real tools/upstream-drift/manifest.yml`. (This suite validates manifest *schema* against the real file — it does not probe a live Impeccable install, which CI does not have; that live probe is Step 4 below, a one-time build-time proof, never a `npm test` gate.)

- [ ] **Step 4: Verify the new assertions hold against the installed artifact (manual — not part of `npm test`)**

```bash
node -e "
const { checkAssertions } = require('./tools/upstream-drift/checks');
const { loadManifest } = require('./tools/upstream-drift/manifest');
const m = loadManifest('tools/upstream-drift/manifest.yml');
const entry = m.dependencies.find((d) => d.name === 'impeccable-plugin');
const result = checkAssertions(entry);
const mine = result.results.filter((r) => ['craft-floor.md', 'operate.md', 'adapt.md', 'clarify.md'].some((f) => r.upstreamPath.endsWith(f)));
console.log(JSON.stringify(mine.map((r) => ({ upstreamPath: r.upstreamPath, status: r.status })), null, 2));
"
```

Expected: PASS — every one of the four new assertions reports `"status": "ok"`.

- [ ] **Step 5: Commit**

```bash
git add tools/upstream-drift/manifest.yml
git commit -m "fix: Pin Impeccable's craft-floor/operate/adapt/clarify reference files in the upstream-drift manifest

refs #3019"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (always-load set) and Deliverable 2 (conditional rules) → Task 1. Deliverable 3 (manifest pins) → Task 2. Deliverable 4 (`missed` reporting unchanged) → untouched by either task (the "Output to caller" section of `pre-build.md` is never modified). AC1 (every named file exists in the installed 4.5.x directory) → Task 2's assertions plus Step 4's live verification. AC2 (`manifest.yml` lists each path, its suite passes) → Task 2 Steps 2-3. AC3 (terminal-track unchanged, its test passes) → Task 1's second test, plus leaving lines 27-30 untouched. AC4 (`npm test` passes in full) → both tasks' own test runs, plus the final full-suite run noted below.
- **Placeholders:** none.
- **Type consistency:** n/a — prose and YAML changes, no shared function signatures across tasks.
- **Review Focus:** each of the five risks above has its own test or explicit scope note in the task that could introduce it.

---

**Final full-suite run** (after both tasks' commits land, outside either task's own steps): `npm test`.
