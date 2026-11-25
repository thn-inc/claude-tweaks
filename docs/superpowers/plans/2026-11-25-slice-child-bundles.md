# Slice the child bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the `lens-child` and `sdd-child` composed bundles down to the sections their child prompts cite. A non-3e lens bundle ends under 12 KB, the depth criteria reach only lens 3e, and the sdd-child bundle ends under 15 KB.

**Architecture:** Deliverable 1's choice is **named-section sources**. A phase-registry bundle can name, per source, a list of section selectors. A selector is either a markdown heading line (`## Title`), which selects that section up to the next heading of the same or higher level, or a bold paragraph lead (`**Lead.**`), which selects that one paragraph. A new pure module, `plugin/bin/lib/compose-context/sections.js`, does the selection. Selection is fence-aware: it reuses `parseMarkers`' `fenced` flag. A selector that matches zero lines or more than one line throws a `SectionError`. The compose path (`index.js`) and the rail measurement (`skill-audit/context-cost.js`) both apply the selection, so the rail measures the bytes a child actually reads.

The other two options were rejected:
- `when:` fences: compose.js's six-key vocabulary describes run conditions, not phases, so this would need a seventh key that no run condition resolves.
- A file split: about 40 conformance tests pin these rules' text inside `subagent-output-contract.md` and `subagent-dispatch-core.md` (`dispatch-no-stash-conformance`, `dispatch-no-name-kill-conformance`, `subagent-contract-clauses`, `discrimination-check-scratch-recipe-conformance`, …).

The source files stay byte-identical, and a reworded lead fails compose loudly instead of silently dropping a rule.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T073550-record-5668/work/5668-spec.md`

Scope keywords: lens-child, sdd-child, review-lens-child, phaseBundles

## Global Constraints

- The composed `lens-child` bundle for a non-3e lens is under 12 KB, and no cited rule is missing from it.
- The composed `sdd-child` bundle is under 15 KB and carries the three rules the prompt names (no-stash, no-name-kill, Discrimination checks in a scratch checkout).
- `composedRailViolations("plugin")` prints `[]`; existing conformance suites pass with no added skips; the prose `--phase` lines stay in place.
- `plugin/skills/review/step3-lens-dispatch.md` is 50,808 B against `RAIL_BYTES` 52,500 B (1,692 B headroom). Task 3's edits to it must stay within +300 B. `plugin/skills/build/dispatch.md` is 49,720 B and is not grown.
- Governing skill `compose-context-fencing` (verbatim): "**Adding a phase or bundle is a registry edit plus one prose line.** `tests/bin-lib/compose-context/phases.test.js` pins the exact phase-key set, that each step passes `STEP_RE`, and that every source exists under `plugin/`. Update the key-set assertion and the unknown-phase message's `known:` list in the same change." (This plan adds a bundle, `lens-depth`, to an existing phase. It adds no phase, so the key set and the `known:` list stay unchanged.)
- Governing skill `compose-context-fencing` (verbatim): "**A phase writes all its bundles or none.** `composePhase` reads every source of every bundle and validates every marker before the first write, so one bad marker anywhere in the phase leaves no bundle at all and the caller takes the documented fallback." Section selection runs inside that same pre-write validation.
- Governing skill `compose-context-fencing` (verbatim): "**A child-facing bundle is composed by the parent and cited in the child's prompt (#4359).** … every citation in the child prompt names `{run}/context/{step}.md` with `{run}` filled in literally, carries the absent-bundle fallback naming the `_shared/` source, and has a standalone branch citing that `_shared/` file directly. `assertChildBundleCited` in `tests/dispatch-prompt-bundle-citations.test.js` pins all three per call site." Task 3 rewrites that bullet's last sentence ("The bundle composes its sources whole…") to describe the selectors.
- Governing skill `shared-contract-extraction` (verbatim): "**A citation to a clause with no heading of its own owes a pin at the source, not only at each citer.** … if no suite pins it in the contract's own file, add that pin in the same change, with a control that strips the clause and a failure message naming every citer." The bold-lead selectors are that pin. Task 2's test resolves every registered selector against the real source file, includes a strip-the-lead control, and its failure message names the bundle and the citing prompt file.
- Governing skill `parse-signal-discipline`: a selector that does not resolve is a hard error naming the file and the selector. Never fall back to the whole file or to an empty slice.

## Review Focus

- A heading-like line inside a fenced code block (the Discrimination checks section carries fences) must not end a heading section early or match a selector. Pinned in Task 1.
- A selector that matches twice (the same bold lead in two paragraphs) must throw, never pick the first. Pinned in Task 1.
- A selected slice that opens a `<!-- when: -->` block without its close must surface as a `MarkerError` from compose, not compose silently. Pinned in Task 1, via `compose()` on the slice.
- The rail scanner must measure the sliced bytes, not the whole file. Otherwise the rail number says 38 KB while the child reads 5 KB, or the reverse. Pinned in Task 2.
- A CRLF checkout (Windows) must select the same sections. `measureComposed` already normalizes `\r\n`, and `sections.js` must match `trimEnd()`-ed lines. Pinned in Task 1.

---

### Task 1: Section selector module

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/compose-context/sections.js`
- Test: `tests/bin-lib/compose-context/sections.test.js`

**Interfaces:**
- Produces: `selectSections(content: string, selectors: string[], label: string) -> string` and `class SectionError extends Error { file, selector }` (`name = 'SectionError'`). The message never names the file, because callers add the prefix (`compose-context.js: ${err.file}: ${err.message}` in the CLI, and `${err.file}: ${err.message}` in `measureComposed`). The exact messages are ``section selector "${selector}" not found``, ``section selector "${selector}" matches ${n} lines``, and ``unknown selector shape "${selector}" (expected a markdown heading or a **bold lead**)``. The returned slices are joined by one blank line (`'\n\n'`), in selector order, and end with a trailing `'\n'`. Each slice has its trailing blank lines trimmed.
- Selector kinds: a selector matching `/^#{1,6} /` is a heading selector. It matches a non-fenced line whose `trimEnd()` equals the selector exactly, and runs to the line before the next non-fenced heading whose level is ≤ its own, or to EOF. A selector starting with `**` is a lead selector. It matches a non-fenced line whose text starts with the selector, and runs to the line before the next blank line (`/^\s*$/`), or to EOF. Any other selector shape throws a `SectionError` ("unknown selector shape").
- Fence awareness: use `parseMarkers(content, label)` from `./compose`, whose tokens carry `fenced: true` on code-fence lines. Lines inside a fence never match a selector and never end a section.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/compose-context/sections.test.js`:
  - `heading selector takes the section up to the next same-or-higher heading`: content `# T\n## A\na1\n### A.1\na2\n## B\nb1\n`, `['## A']` → `'## A\na1\n### A.1\na2\n'`.
  - `lead selector takes one paragraph`: `'x\n\n**Rule.** one\ntwo\n\n**Other.** z\n'`, `['**Rule.**']` → `'**Rule.** one\ntwo\n'`.
  - `slices join in selector order with one blank line`: `['**Other.**', '**Rule.**']` on the content above → `'**Other.** z\n\n**Rule.** one\ntwo\n'`.
  - `a heading inside a code fence neither matches nor ends a section`: `'## A\n```\n## B\n```\nafter\n## C\n'`, `['## A']` → `'## A\n```\n## B\n```\nafter\n'`. Also, `['## B']` on the same content throws `SectionError` with `/not found/`.
  - `a selector matching twice throws`: `'**R.** a\n\n**R.** b\n'`, `['**R.**']` → throws `SectionError`, message `/matches 2 lines/`, `err.file === label`, `err.selector === '**R.**'`.
  - `a missing selector throws naming file and selector`: `err.message === 'section selector "**Gone.**" not found'`, `err.file === label`.
  - `an unknown selector shape throws`: `['Rule']` → `/unknown selector shape/`.
  - `CRLF content selects the same section`: the heading case with `\r\n` line endings, normalized by the caller, gives the same result once `content.replace(/\r\n/g, '\n')` is passed in. Also, a trailing `\r` on a heading line still matches, because of `trimEnd`.
  - `a slice that opens a when-block without its close is a MarkerError at compose`: `'**R.** a\n<!-- when: mode=auto -->\nb\n\n<!-- /when -->\n'`, select `['**R.**']`, then `compose([{path:'x', content: slice}], allUnresolved)` throws `MarkerError` (`/unclosed/`).

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/compose-context/sections.test.js`
  Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/compose-context/sections'`)

- [ ] **Step 3: Implement `selectSections` and `SectionError`** in `plugin/bin/lib/compose-context/sections.js` (pure: no fs, no shell; header comment in the style of `compose.js`).

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/compose-context/sections.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** `git add` both files, then commit as `Add named-section selector for composed bundles — refs #5668`.

### Task 2: Registry sections, compose wiring, rail measurement

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/compose-context/phases.js` (bundle gets optional `sections`; registry entries)
- Modify: `plugin/bin/lib/compose-context/index.js` (`composeContext` applies sections; `composePhase` passes them through)
- Modify: `plugin/bin/lib/skill-audit/context-cost.js` (`parsePhaseTokens`, `findComposeCallSites`, `measureComposed` carry and apply `sections`)
- Modify: `plugin/bin/compose-context.js` (a `SectionError` exits 2 with a `file:` prefix, like `MarkerError`)
- Test: `tests/bin-lib/compose-context/phases.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`, `tests/bin-lib/compose-context/cli.test.js`, `tests/child-bundle-sections.test.js` (create)

**Interfaces:**
- Consumes: `selectSections`, `SectionError` from Task 1.
- Produces: `bundle(step, sources, load, sections?)`, where `sections` is a frozen object keyed by a source label, valued by a frozen selector array, and absent for whole-file bundles. `phaseBundles(...)` source entries become `{ label, file, sections? }`, with `sections` present only for a sectioned source. `composeContext` sources accept the same optional `sections`. `findComposeCallSites` rows from `--phase` lines carry `sections: (string[]|null)[]` aligned with `sources`, present only when some source is sectioned. `measureComposed` applies `selectSections` to each sectioned source after reading it, and turns a `SectionError` into an error row (`error: \`${err.file}: ${err.message}\``), the same way it handles a `MarkerError`.
- Registry after this task (exact selectors):
  - `review-lens-child` phase:
    - `lens-child`: sources `['skills/_shared/subagent-output-contract.md']`, sections `{ 'skills/_shared/subagent-output-contract.md': ['**Scratch rule.**'] }`, `on-demand`.
    - `lens-depth` (new bundle): sources `['skills/_shared/criteria-architecture-depth.md']`, whole file, `on-demand`.
  - `sdd-child` phase, bundle `sdd-child`: sources `['skills/_shared/subagent-dispatch-core.md']`, sections ``{ 'skills/_shared/subagent-dispatch-core.md': ['**Never run `git stash` in any form.**', '**Never kill a process by image or name.**', '## Discrimination checks in a scratch checkout'] }``, `on-demand`.
- All-or-none: `composePhase`'s pre-write loop, which runs before any bundle is written, applies `selectSections` to every sectioned source of every bundle and runs `parseMarkers` on each slice. A `SectionError`, or an unbalanced `when:` block inside a slice, therefore aborts the phase before the first write. `composeContext` re-applies the selection when it composes; this is idempotent and costs only a few KB of text.
- Consumers of `phaseBundles` and `PHASES`, classified:
  - `context-cost.js` (list-all: measures every bundle, so it must apply sections).
  - `index.js` (list-all: composes every bundle).
  - `skill-audit/load.js` `composeSources` (list-all, but it only needs files for the load-closure upper bound, so it is unchanged).
  - `bin/compose-context.js` (reads only `PHASES` keys, unchanged).
  - `tests/dispatch-prompt-bundle-citations.test.js` (keys only).
  - `phases.test.js` (shape, updated below).

- [ ] **Step 1: Write the failing tests**
  - `phases.test.js`: `every sectioned source names selectors that resolve in the real file`. For each bundle with `sections`, each key is one of the bundle's `sources`, each value is a non-empty array, and `selectSections(readFileSync(PLUGIN/label), selectors, label)` does not throw. Add the control `a reworded lead is caught (discrimination proof)`: it replaces `**Scratch rule.**` in the real contract text with `**Scratch rules.**`, runs the same helper the positive test calls, and expects a `SectionError`. Its failure message names `lens-child` and `plugin/skills/review/step3-lens-dispatch.md`.
  - `phases.test.js`: update the frozen-shape test so `sections`, when present, is frozen along with each array inside it.
  - `tests/child-bundle-sections.test.js` (new). Every test composes real bundles with `composePhase` into an `fs.mkdtempSync` run dir, with a fake `execFileSync` so no `gh` runs:
    - `AC1.1: the non-3e lens-child bundle is under 12 KB`: `bytes < 12 * 1024`.
    - `AC1.2: lens-child carries every rule a lens prompt cites, and no depth criteria`. The text includes `**Scratch rule.**` and `SCRATCH:`, and excludes the first heading line of `criteria-architecture-depth.md`, read from the file.
    - `AC1.2: lens-depth carries the architecture-depth criteria for lens 3e`: the bundle equals the resolved header plus the whole file.
    - `AC2.1: sdd-child is under 15 KB`.
    - `AC2.1: sdd-child carries the three rules build/dispatch.md names`. The test asserts that `build/dispatch.md`'s sdd-child line names `the no-stash rule`, `the no-name-kill rule` and `Discrimination checks in a scratch checkout`, and that the bundle contains ``**Never run `git stash` in any form.**``, `**Never kill a process by image or name.**` and `## Discrimination checks in a scratch checkout`.
    - Factor the "cited rule present" assertions into one helper. A control test then runs that helper against the bundle text with `**Never kill a process by image or name.**`'s paragraph removed and expects it to throw.
  - `context-cost.test.js`: `AC3.1: a --phase sdd-child row measures the sliced bytes`. Run `findComposeCallSites` against `plugin/` to find the row whose `step` is `sdd-child`, then run `measureComposed`. The row's `max` equals `Buffer.byteLength` of the composed sliced bundle and is `< 15 * 1024`. Also assert `composedRailViolations('plugin')` deep-equals `[]` (AC3.1), if the file doesn't already assert that; grep first, and reuse the existing assertion if one exists.
  - `phases.test.js` (or a new `tests/bin-lib/compose-context/compose-phase-sections.test.js`): `a phase whose second bundle fails section selection writes no bundle`. Call `composePhase` against an `fs.mkdtempSync` plugin root with a fake two-bundle phase. Because `PHASES` is frozen, give `composePhase` a `deps.phaseBundles` override, the only new seam, defaulting to the real `phaseBundles`. The first bundle is whole-file, and the second has a selector that is `**Missing.**`. Expect a `SectionError` and no file under `{run}/context/`. Add a second case where the second slice opens a `when:` block without closing it, and expect a `MarkerError` and no file written.
  - `context-cost.test.js`: `a --phase row whose selector no longer resolves is an error row, not a whole-file measurement`. Call `measureComposed` with a hand-built row `{ step, file, line, sources: [tmpFile], sections: [['**Missing.**']] }` → `error` matches `/not found/`, `combinations: []`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/child-bundle-sections.test.js tests/bin-lib/compose-context/phases.test.js tests/bin-lib/skill-audit/context-cost.test.js`
  Expected: FAIL. The size assertions fail at roughly 34 KB for lens-child and roughly 38 KB for sdd-child, and `lens-depth` is not found.

- [ ] **Step 3: Implement** the registry entries, the `bundle` fourth parameter, the `phaseBundles` passthrough, `composeContext` selection (apply `selectSections` to the read content before `compose`, inside the existing all-read-before-write path), `composePhase` passthrough, and the `context-cost.js` carry/apply. Update the `phases.js` and `index.js` header comments to state the `{ step, sources, load, sections? }` shape. Leave `SourceReadError` handling unchanged. In `bin/compose-context.js`, a `SectionError` gets the same branch as `MarkerError`, printing `compose-context.js: ${err.file}: ${err.message}` and exiting 2: a selector that does not resolve is a content error, like a malformed marker. Add one CLI test to `tests/bin-lib/compose-context/cli.test.js` that pins that exit and that stderr, using a `composePhase` dep that throws a `SectionError`.

- [ ] **Step 4: Run to verify they pass**, same command. Expected: PASS. Then run `node --test tests/bin-lib/compose-context/ tests/dispatch-prompt-bundle-citations.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`. Expected: PASS.

- [ ] **Step 5: Real-input probe (run right after this task, before Task 3).** Run `node plugin/bin/compose-context.js --run "{this run's worktree-local run dir, absolute}" --phase review-lens-child` and the same with `--phase sdd-child`. Record the three printed `bytes` values in the commit message body. Expected: lens-child about 2.6 KB, lens-depth about 8.3 KB, sdd-child about 5.5 KB.

- [ ] **Step 6: Commit** the eight files (the four source modules, including `bin/compose-context.js`, and the four test files) as `Compose child bundles from the sections their prompts cite — refs #5668`.

### Task 3: Prose citations and docs

**Role:** integration

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (lines 31-33 say what the two child bundles hold; the 3e citation at line ~237 moves to `{run}/context/lens-depth.md`)
- Modify: `tests/dispatch-prompt-bundle-citations.test.js` (add a `lens-depth` citation test)
- Modify: `docs/plugin-structure.md` (the `compose-context/` row names `sections.js` and the optional `sections`; the review-lens-child bundle list)
- Modify: `docs/journeys/compose-a-per-run-context-bundle-1988.md` (the review-lens-child bullet: `lens-child` = Scratch rule, `lens-depth` = depth criteria; sdd-child = three named sections)
- Modify: `.claude/skills/compose-context-fencing/SKILL.md` (the #4359 bullet's last sentence)
- Modify: `docs/skill-graph.md:281` (the `review-lens-child` parenthetical: `lens-child` — the output contract's Scratch rule; `lens-depth` — `_shared/criteria-architecture-depth.md`, lens 3e; `sdd-child` — three named sections of the dispatch core)
- Modify: `docs/journeys/measure-composed-bytes-per-call-site-1990.md:26` (the review phase lines give `review-dispatch`, `lens-child` and `lens-depth`); append an "Updated during build of #5668" line beside line 62's
- Unchanged, by decision: `plugin/skills/build/dispatch.md`. Its sdd-child line already names exactly the three rules the sliced bundle now carries, and it keeps its whole-file fallback. The test helpers in `tests/bin-lib/timing/*` and `tests/review-replay/*` only use `lens-child.md` as a path string, and the CLI usage tests list phase names, which are unchanged.

**Interfaces:**
- Consumes: the registry from Task 2 (bundle steps `lens-child`, `lens-depth`, `sdd-child`).

- [ ] **Step 1: Write the failing test** in `tests/dispatch-prompt-bundle-citations.test.js`: `step3-lens-dispatch.md cites lens-depth.md with its fallback`, using `assertChildBundleCited(LENS_DISPATCH, 'review-lens-child', 'context/lens-depth.md', '_shared/criteria-architecture-depth.md')`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/dispatch-prompt-bundle-citations.test.js`
  Expected: FAIL ("has no line citing context/lens-depth.md").

- [ ] **Step 3: Edit the prose.**
  - Line 237's citation becomes: ``with the bundle composed, `{run}/context/lens-depth.md`, `{run}` filled in literally, read on demand, never piecewise (if that bundle is absent, read `_shared/criteria-architecture-depth.md` directly); standalone, `_shared/criteria-architecture-depth.md`, read directly``.
  - Lines 31-33 say the second line composes the lens agents' two on-demand bundles: `{run}/context/lens-child.md` (the output contract's Scratch rule, which every lens cites) and `{run}/context/lens-depth.md` (the architecture-depth criteria, which only lens 3e cites).
  - Keep the line-87 Scratch citation unchanged.
  - Check `wc -c` for the file stays ≤ 51,108 B.
  - Update the three docs and the project skill bullet to match the registry.
  - Run `git grep -n -E "lens-child\.md|output contract and the architecture-depth"` over `plugin docs .claude` and fix every stale claim that lens-child carries the depth criteria. Leave archived fixtures (`tests/fixtures/review-lens-workers/smoke-bundle.md`), which are verbatim copies of a past run.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/dispatch-prompt-bundle-citations.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-prose-plugin-root-invocations.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** the seven modified files as `Point lens 3e at its own depth bundle — refs #5668`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (decide the mechanism) | Architecture above; Task 1 |
| Deliverable 2, AC1.1, AC1.2 | Task 2 (registry, size and citation tests), Task 3 (3e citation) |
| Deliverable 3, AC2.1 | Task 2 |
| Deliverable 4, AC3.1 | Task 2 (rail measures slices; `composedRailViolations` `[]`), Task 3 (prose `--phase` lines untouched) |
| AC3.2 (existing conformance suites pass, no added skips) | Not a plan task: `/claude-tweaks:build`'s Common Step 5 runs the whole suite through `verify.js` after the last task, and `/claude-tweaks:test` repeats it. No task adds a `skip`/`todo`, and the reviewer checks this per task. |

Waived AC4.1: a `### Key Files` entry parsed as a criterion, not an AC; phases.js is modified in Task 2.
Waived AC5.1: a Key Files entry; compose.js is unchanged because selection lives in the new sibling `sections.js` (compose.js stays the marker grammar); the named-section choice is implemented in Task 1.
Waived AC6.1: a Key Files entry; step3-lens-dispatch.md is modified in Task 3.
Waived AC7.1: a Key Files entry; build/dispatch.md's sdd-child line already names the three rules the sliced bundle carries — left unchanged by decision (Task 3 Files).
Waived AC8.1: a Key Files entry; the named-section choice needs no fences or split, so both `_shared` contracts stay byte-identical (Architecture).
