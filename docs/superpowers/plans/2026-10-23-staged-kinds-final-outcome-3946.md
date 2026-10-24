# Staged Kinds Reach a Final Outcome (#3946) Implementation Plan

**Goal:** Give every `.shadow-dup` staged copy a final, click-free, content-preserving Review Console outcome, harden the staged-id producer sweep, and switch `stage-item.js`'s unmapped-prefix warning to a refusal.

**Architecture:** `plugin/bin/lib/console/resolve.js`'s `classifyStagedItem` stops forcing `.shadow-dup` copies to `pending`. A byte-identical copy goes to a new `Dismissed duplicates` section (resolution `dismissed`). A divergent or collision copy goes to Queue writes (`apply`), where a new `bin/shadow-dup-proposal.js` composes the `Title:`/`Type:`/`Labels:`/`Defer-reason:` header that copy lacks and quotes the copy verbatim, so the existing queue-write path files it. `stage-item.js` then refuses an id that is neither mapped nor exempt, and stages nothing.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-10-23T213805-spec-3946-3949-3816-3950/spec-3946/work/3946-spec.md`

**Execution order:** Task 1 (sweep) → Tasks 2–6 (shadow-dup outcomes) → Task 7 (warn → refuse, last code change) → Task 8 (prose and docs sweep). This is the spec's Technical Approach order.

Scope keywords: unmapped-prefix, warnUnmappedPrefix, unmappedPrefixRefusal, stagingExemption, STAGING_EXEMPTIONS, CANONICAL_PREFIXES, SECTION_MAP, SECTION_STANCES, classifyStagedItem, SHADOW_DUP_RE, SHADOW_DUP_OUTCOMES, shadow-dup, shadow-dup-duplicate, shadow-dup-divergent, shadow-dup-collision, Dismissed duplicates, dismissed, non-tangential-category, DYNAMIC_ID_PREFIXES, collectMdProducers, shadow-dup-proposal, composeShadowDupProposal, nothingToRevert

Premise-refs: plugin/bin/lib/console/resolve.js
Premise-refs: plugin/bin/stage-item.js
Premise-refs: plugin/bin/console-resolve.js
Premise-refs: plugin/bin/lib/hooks/sweep-shadow.js
Premise-refs: tests/bin-lib/console/staged-id-producers.test.js
Premise-refs: plugin/skills/wrap-up/review-console.md
Premise-refs: plugin/skills/wrap-up/skill-curation.md
Premise-refs: plugin/skills/wrap-up/refused-proposals.md
Premise-refs: plugin/skills/reflect/SKILL.md
Premise-refs: .claude/skills/review-console-section-addition/SKILL.md
Premise-refs: .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md

## Premise reversals (read before Task 1)

1. **The producer sweep (AC2) already exists.** #3488 shipped `tests/bin-lib/console/staged-id-producers.test.js`. It scans same-line `stage-item.js … --id` producers and in-process `writeStagedItem({ id: … })` calls, and asserts each one is mapped or exempt. It has two gaps against the spec's extraction rule. (a) It is line-scoped, so it misses `plugin/skills/tidy/release-note-repair.md`'s `--id tidy-release-note-{id}`, whose `stage-item.js` mention sits on the line above. (b) `DYNAMIC_ID_PREFIXES` exempts `plugin/skills/tidy/step-6-auto.md`'s fully dynamic `--id "{id}"`, but the spec says a dynamic id is fixed at the producer, never exempted. Task 1 closes both gaps instead of writing a new sweep.
2. **The Gotcha about extracting the exemption list does not apply.** `resolve.js` already exports `STAGING_EXEMPTIONS` and `stagingExemption(id)`, and `stage-item.js` already imports `classifyStagedItem, nearestCanonicalPrefixes, stagingExemption`.
3. **The Skill-updates consumer cannot apply a `reflect-*` file.** `review-console.md` "On approval" step 2 reads "Apply skill updates and create new skills (items 11–12, from the Skills curation row)". `skill-curation.md` 7.6 step 3 stages that row's input as "`staged/wrap-up-skill-{N}.md` containing the Update Mode patch". A reflect `observation`/`convention` file carries `## Finding` and an optional `## Suggested resolution` (`reflect/SKILL.md` Step 3's stage-file format). It names no target skill and no recommended destination. No "On approval" step is mechanized either: `console-resolve.js` "Computes the merge half; never executes it", and step 10, the precedent, is prose too. The consumer AC5 asks for needs these pieces:
   - a destination line in reflect's staging format;
   - an applier CLI that does the record and decline writes through injectable deps, with gh and MCP transports;
   - a new or extended On-approval step;
   - the appendix mapping;
   - the console-template, interactive and multi-spec render sites;
   - a rule for the legacy files that have no destination.

   That is more than one task, so per the spec's Deliverable 3 split clause the reflect reroute (AC3.1, AC5) is **not in this plan**. It goes to its own record, and the reroute stays behind it.
4. **The Queue-writes path cannot take a header-less copy as it is.** Step 7 reads `Title:`/`Type:`/`Labels:` from the staged file. `refused-proposals.md` refuses any proposal without a valid `Defer-reason:` header, and a refused row has no default, so it is residue. Tasks 4–5 add a composer that writes that header and quotes the copy verbatim. The copy then goes through the existing queue-write path, as the spec asks.
5. **"Dismissed" has no section or resolution today.** Task 2 adds the section `Dismissed duplicates` with resolution `dismissed`. Task 3 walks the review-console-section-addition registration table for it.

Waived AC3.1: the reflect observation/convention reroute is split into its own record (premise reversal 3; Defer-reason: genuinely-larger).
Waived AC5.1: same split. Only the shadow-dup half of the fixture is in scope, and Task 4's `AC4 e2e` test covers it.
Waived AC5.2: same split. The applied-effect assertion for `reflect-*` belongs to the split record's consumer.
Waived plugin/skills/reflect/SKILL.md: changes only in the split record.
Waived plugin/skills/wrap-up/skill-curation.md: read only, to refute the spec's ASSUMPTION (premise reversal 3).
Waived plugin/bin/lib/hooks/sweep-shadow.js: read only. Its callers carry no outcome; the outcome is decided at the console by `classifyStagedItem`'s text comparison.

## Check B classification (scope-keyword hits no task lists)

Read at authoring; each needs no change:
- `tests/bin-lib/console/residue.test.js`, `residue-cli.test.js`, `tests/bin-lib/hooks/session-residue.test.js`, `tests/hooks-dispatcher.test.js` and `tests/hooks-session-start.test.js` are stored `console.json` fixtures carrying `pending`/`unmapped-prefix` items. That stored shape is unchanged.
- `tests/curation-judge-stagepath.test.js` and `tests/bin-lib/hooks/sweep-shadow-claim-concurrency.test.js` pin the sweep's file naming, which is unchanged.
- `plugin/skills/wrap-up/journey-curation.md` and `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` describe the console's defensive `unmapped-prefix` fallback, which stays for files staged outside `stage-item.js` (spec Non-Goals).
- `CHANGELOG.md`, `docs/incident-log.md` and `docs/superpowers/plans/*` are append-only history.
- The remaining hits match the generic keyword `dismissed` or the word `pending` and name neither the console section nor shadow-dup copies: `docs/skill-graph.md`, `declined-learning/store.js`, `transcript-judge/*`, `feedback/*`, `challenge/lenses.md`, `_shared/criteria-security-hardening.md`, `_shared/transcript-judge.md`, `_shared/upstream-feedback-batch.md`, `review/step3-routing.md`, `tidy/scan-procedures.md`, `wrap-up/cleanup-procedures-execution.md`, `wrap-up/standalone-fast-path.md`, `docs/journeys/evaluate-a-session-for-upstream-feedback.md`, `tests/bin-lib/staged-patch/stack-check.test.js`, `tests/feedback-watermark-prose.test.js` and `tests/reflect-transcript-judge-prose.test.js`.
- `plugin/bin/lib/hooks/sweep-shadow.js` and `plugin/skills/reflect/SKILL.md` are waived above.

## Global Constraints

- `plugin/` is the shipped payload. Cite functions, never line numbers: #3880, #3816, #3926 and #3488 shift lines in `resolve.js` and `stage-item.js`.
- Commit style: `{Verb} {what} — {detail}`, imperative, with a second `-m "refs #3946"` paragraph. Never write "closes" or "fixes".
- `stage-item.js` belongs to the *Sanctioned-writer* exit vocabulary. Quoted from `cli-wrapper-contract.md`: "0 written (the written path echoed to stdout), 2 malformed invocation, 3 the run dir is missing or not anchored under the main checkout, or the target file is unwritable — **no 1 at all**". The same contract says: "A new code is earned by a caller that *branches* on it … not by the outcome being conceptually distinct". No caller branches on an unmapped id, so the refusal is **exit 2**, reason token `unmapped-prefix`.
- `tests/path-guard-conformance.test.js` allows no bare `realpathSync`/`existsSync` under `plugin/bin/` outside its per-file allowlist. New bin code tests presence with a `readFile` try/catch and anchors `--run` with `lib/stage-item/write.js`'s `resolveTarget`.
- `tests/bin-lib/exit-code-conformance.test.js`: a new CLI's `require.main === module` guard sets `process.exitCode = run(...)` and never calls `process.exit(`.
- Governing skill `review-console-section-addition`, quoted: "A section is not shipped until every applicable row lands in the same change." and "Find the prose sites by grep rather than from this table alone: `git grep -l -F 'Reference repairs' -- plugin docs tests` lists every file that enumerates the sections." Its site 4 pin is "hand-typed, not read from `SECTIONS`, so add the name there too or a missing stance stays green."
- Governing skill `bin-source-scan-conformance`, quoted: "Set the floor to the count at the time the scan lands. Raise it when sites are added. Never lower it to make the suite green."
- Governing skill `skill-prose-conformance-tests` and the plan-authoring Go-red control check: every negative control runs the **same** assertion function as its positive test, against mutated input.
- Byte rail `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). Measured headroom: `flow/multispec-review-console.md` 48,832 B (3,668 left), `tidy/step-6-auto.md` 47,007 B (5,493 left), `wrap-up/SKILL.md` 39,763 B. Remedy if a task would cross the rail: cite `review-console.md` step 7's shadow-dup clause rather than restating it.
- Every new test is shown red against the pre-change code: revert the implementation (`git show HEAD:<path>` into a scratch worktree, never `git stash`) and see the test fail.

## Review Focus

1. A copy whose text holds triple-backtick fences, `## ` headings or CRLF line endings. The filed record must quote it byte for byte (Task 4, `verbatim round-trip`).
2. A copy that differs from its anchor only by whitespace or CRLF. It is divergent and is never dismissed (Task 2, `AC4.2`).
3. A `.patch.shadow-dup` copy. It is never sent to `git apply --check` and never resolves `stale`; it routes to Queue writes (Task 2, `patch copy`).
4. An unmapped id passed with `--ledger`. The refusal must leave the ledger and `decisions.md` byte-identical, not only skip the staged file (Task 7, `AC1.3`).
5. An id that is mapped only by its `.patch` extension (`review-2` + `.patch`), or one that is exempt (`release-held`). Both must still exit 0 once the refusal exists (Task 7, `AC1.2`, kept tests).

---

### Task 1: Close the producer sweep's two gaps

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/console/staged-id-producers.test.js` — `collectMdProducers`, `DYNAMIC_ID_PREFIXES`, `checkDynamicIds`, `headOf`, the matcher-floor test, and the dynamic-id controls
- Modify: `plugin/skills/tidy/step-6-auto.md` — the "Staging a Stage-tier item (#2612)" command line
- Modify: `plugin/skills/tidy/digest-sweep.md` — the `staged/digest-promotion-{n}.md` sentence
- Test: `tests/bin-lib/console/staged-id-producers.test.js`

**Interfaces:**
- Produces: `collectMdProducers(text, file) -> [{file, id}]`, now paragraph-scoped. A paragraph is a blank-line-separated block, with `\`+newline continuations joined first. Every `--id` token in a paragraph that mentions `stage-item.js` is collected. `<…>`-headed synopsis ids and `SYNOPSIS_FILES` stay skipped. `DYNAMIC_ID_PREFIXES` is deleted. `checkDynamicIds(producers)` throws for **any** id with an empty static head, naming the file, with the message `… is fully dynamic — give the producer a literal head (fix it at the producer, never exempt it)`.

- [ ] **Step 1: Write the failing tests** (add or replace in `staged-id-producers.test.js`)
  - `AC2.1: a producer whose --id sits on a later line of the stage-item.js paragraph is collected`: `collectMdProducers('Stage one item with \`stage-item.js\` (see X),\n\`--id tidy-release-note-{id}\`. The .md holds it.', 'a.md')` deep-equals `[{ file: 'a.md', id: 'tidy-release-note-{id}' }]`. Also, `collectMdProducers('winget install --id GitHub.cli', 'b.md')` deep-equals `[]`, because that paragraph never names stage-item.js.
  - `AC2.1 go-red: a deliberately unmapped fixture producer, read through the matcher, fails the disposition check`: `assert.throws(() => assertProducerDisposition(collectMdProducers('node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run r --id "zz-unmapped-{n}" --file f', 'plugin/skills/new/step.md')), /plugin\/skills\/new\/step\.md.*zz-unmapped-/)`.
  - Replace both dynamic-id controls with one: `control: any fully dynamic --id fails the dynamic-id check, in every file`. It asserts `checkDynamicIds` throws `/fully dynamic/` for that fixture keyed both as `plugin/skills/new/step.md` and as `plugin/skills/tidy/step-6-auto.md`.
  - Matcher floor: `producers.length >= 19` (15 skill + 4 bin sites, counted at authoring by a paragraph-scoped scratch scan), and the known heads list gains `'tidy-release-note-'` and `'digest-promotion-'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/console/staged-id-producers.test.js`
Expected: FAIL after Step 1. The paragraph test gets `[]` from the line matcher, and the live Deliverable-4 test throws `fully dynamic` on `plugin/skills/tidy/step-6-auto.md` once the map is gone.

- [ ] **Step 3: Implement**
  - In the test file, make `collectMdProducers` paragraph-scoped, delete `DYNAMIC_ID_PREFIXES`, and make `headOf(p)` return `staticHead(p.id)`.
  - In `step-6-auto.md`, change the command's `--id "{id}"` to `--id "tidy-{action}-{n}"`. Add one sentence after the fence: `{action}` is the Stage-tier row's kebab-case action (`absorb`, `claim-releases`, `release-note`, …), and a digest cluster proposal passes `--id "digest-promotion-{n}"` instead (`digest-sweep.md`).
  - In `digest-sweep.md`, extend the parenthesized `(`{run-dir}/staged/digest-promotion-{n}.md`)` to say the proposal is staged through `step-6-auto.md`'s `stage-item.js` call with `--id "digest-promotion-{n}"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/staged-id-producers.test.js tests/tidy-report-rules.test.js tests/materiality-floor-conformance.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS. The last three read the two edited tidy files.

- [ ] **Step 5: Revert-to-red check.** In a scratch `git worktree add`, put the test file at its new state and the two tidy files at their pre-change text (`git show HEAD:<path>`). Run the Step 2 command there and expect FAIL on `step-6-auto.md`.

- [ ] **Step 6: Commit** — `git add` the three files; `git commit -m "Harden the staged-id producer sweep — paragraph-scoped --id, no dynamic-id exemption" -m "refs #3946"`

---

### Task 2: Final outcomes for shadow-dup copies in the resolver

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` — `SECTIONS`, `SECTION_STANCES`, `classifyStagedItem`, `stagedItems`, `module.exports`, the `SHADOW_DUP_RE` comment block
- Modify: `plugin/bin/console-resolve.js` — `run()`'s `nothingToRevert` set
- Modify: `plugin/skills/wrap-up/console-template.md` — new `#### Dismissed duplicates (` heading right after the Pending review section. It is pinned by `tests/reflect-wrap-up-insights-staging-conformance.test.js`, which reads `SECTIONS`.
- Test: `tests/bin-lib/console/resolve.test.js`
- Test: `tests/bin-lib/console/cli.test.js`

**Interfaces:**
- Produces:
  - `SECTIONS.DISMISSED === 'Dismissed duplicates'`.
  - `SECTION_STANCES['Dismissed duplicates'] = { resolution: 'dismissed', reason: 'byte-identical to its anchor, which carries the same content — nothing to apply or file' }`.
  - Exported `SHADOW_DUP_RE`.
  - Exported frozen `SHADOW_DUP_OUTCOMES`: `{ 'shadow-dup-duplicate': { section: SECTIONS.DISMISSED, note }, 'shadow-dup-divergent': { section: SECTIONS.QUEUE, note }, 'shadow-dup-collision': { section: SECTIONS.QUEUE, note } }`. The QUEUE notes say the copy "is filed as a needs:definition backlog record quoting it verbatim (Queue writes, On approval step 7)".
  - `classifyStagedItem(filename, text, siblingText)`: for a `SHADOW_DUP_RE` name it returns `{ section, outcome }`, **never** `reason`, so it no longer forces `pending`. The comparison stays `text === siblingText`, and either side `null`/`undefined` still gives `shadow-dup-collision`.
  - `stagedItems`: an item with an `outcome` resolves to its section's stance, with `reason: \`${outcome} — ${note}\``. The `.patch` stack check still keys on `name.endsWith('.patch')`, so a `.patch.shadow-dup` copy is never checked.

- [ ] **Step 1: Write the failing tests** (`resolve.test.js`: rewrite the two shadow-dup assertions in "classifyStagedItem maps every known prefix…" and the #2773 test to the new shape)
  - `AC4.1: shadow-dup-duplicate classifies to Dismissed duplicates, whose stance is final`: `classifyStagedItem('build-deviation-1.md.shadow-dup', 'same', 'same')` deep-equals `{ section: 'Dismissed duplicates', outcome: 'shadow-dup-duplicate' }`, and `SECTION_STANCES['Dismissed duplicates'].resolution === 'dismissed'`.
  - `AC4.1: shadow-dup-divergent classifies to Queue writes (apply)`: `('build-deviation-2.md.shadow-dup', 'shadow', 'anchor')` → `{ section: 'Queue writes', outcome: 'shadow-dup-divergent' }`.
  - `AC4.1: shadow-dup-collision (no anchor, or unreadable copy) classifies to Queue writes (apply)`: `('wrap-up-memory-1.md.shadow-dup', 'x')` and `('build-deviation-3.md.shadow-dup', null, 'anchor')` both give `outcome: 'shadow-dup-collision'`, section `Queue writes`.
  - `AC4.2: a whitespace-only or CRLF difference is divergent, never dismissed`: `('x-1.md.shadow-dup', 'a\n', 'a\n\n')`, `('x-1.md.shadow-dup', 'a ', 'a')` and `('x-1.md.shadow-dup', 'a\r\n', 'a\n')` each give `outcome: 'shadow-dup-divergent'` with section `!== 'Dismissed duplicates'`.
  - `patch copy: a .patch.shadow-dup copy resolves apply in Queue writes, never stale`: `resolveAll` over `{ 'review-2.patch': 'p', 'review-2.patch.shadow-dup': 'q' }` gives the copy `resolution: 'apply'` and `section: 'Queue writes'`.
  - `AC4.1 e2e: resolveAll leaves no shadow-dup item pending`: one pair per reason (duplicate pair, divergent pair, `leftover-x.md.shadow-dup` with no anchor). `unresolvedItems({ items })` is `[]`. The resolutions are `dismissed`/`apply`/`apply`, each `reason` starts with its outcome token, and the anchors keep their own resolutions (`build-deviation-1.md` stays `apply`).
  - `AC3.2/AC3.3 orthogonal: tangential and Category-less reflect files are unchanged`: `classifyStagedItem('reflect-3.md', tangentialText)` deep-equals `{ section: 'Queue writes' }`, and `classifyStagedItem('reflect-4.md', '# Reflect\n\n## Finding\n\nx\n')` deep-equals `{ section: 'Queue writes' }`. The existing observation/convention `non-tangential-category:*` assertions stay unchanged (the reroute is out of scope).
  - Add `'Dismissed duplicates'` to the hand-typed list in "SECTION_STANCES names a stance for every section the console renders".
  - `cli.test.js`: `a dismissed shadow-dup duplicate logs reversibility n/a`. The run stages a byte-identical `wrap-up-memory-1.md` + `wrap-up-memory-1.md.shadow-dup` pair, and `decisions.md` holds a line matching `/Console item wrap-up-memory-1\.md\.shadow-dup \(Dismissed duplicates\): dismissed — shadow-dup-duplicate .*Reversibility: n\/a\.$/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js`
Expected: FAIL after Step 1. The new tests get `{ section: 'Pending review', reason: 'shadow-dup-…' }` and `resolution: 'pending'`.

- [ ] **Step 3: Implement** the Interfaces above in `resolve.js`. Add `'dismissed'` to `console-resolve.js`'s `nothingToRevert`. In `console-template.md`, add `#### Dismissed duplicates (byte-identical to their anchor — informational; Approve all and Override leave them as they are)`: a `| # | Copy | Anchor |` table with one example row numbered `{n}`, plus "Renders only when non-empty; rows take the next numbers of the global sequence". A `{n}` keeps every later example number unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js tests/bin-lib/console/residue.test.js tests/bin-lib/console/staged-id-producers.test.js`
Expected: PASS. AC6.1: the `CANONICAL_PREFIXES` parity tests in `resolve.test.js` still pass. No `SECTION_MAP` row changed, because shadow-dup is matched by suffix before the table.

- [ ] **Step 5: Revert-to-red check.** Restore the pre-change `classifyStagedItem` alone (scratch worktree) and confirm every `AC4.*` test fails. Delete `'dismissed'` from `nothingToRevert` and confirm the reversibility test fails.

- [ ] **Step 6: Commit** — `git commit -m "Route shadow-dup copies to final console outcomes — duplicate dismissed, divergent and collision to Queue writes" -m "refs #3946"`

---

### Task 3: Register the Dismissed duplicates section in the console prose

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` — Resolution-to-step mapping: new bullet `` - `dismissed` — execute **nothing**. `` stating that a **Dismissed duplicates** row is a `.shadow-dup` copy byte-identical to its anchor (`shadow-dup-duplicate`), that the anchor is its own item, and that the copy stays in `staged/`
- Modify: `plugin/skills/wrap-up/review-console-interactive.md` — the Numbering rules' named-batch-sections list: add `Dismissed duplicates` after `Pending review`, and add it to the "render only when non-empty" parenthetical
- Modify: `plugin/skills/flow/multispec-console-template.md` — `#### Dismissed duplicates (` heading after Pending review, same shape as Task 2's
- Modify: `plugin/skills/wrap-up/SKILL.md` — the Review Console paragraph's parenthesized section list (registration site 11)
- Create: `tests/console-shadow-dup-outcomes-conformance.test.js`

**Interfaces:**
- Consumes: `SECTIONS.DISMISSED` (Task 2). The test reads the name from code, never a hand-typed string.
- Produces: test helpers `assertDismissedRouted(appendixText)`, `assertInBatchList(interactiveText, name)`, `assertHeading(templateText, name)`, `assertInSkillList(skillText, name)`. Tasks 5 and 6 add assertions to this same file.

- [ ] **Step 1: Write the failing tests** — each positive test calls its helper on the live file, and each control calls the **same** helper on mutated text (Go-red control check):
  - `dismissed routes to execute-nothing in the appendix mapping`. The control deletes the `dismissed` bullet and expects a throw.
  - `the Numbering rules list Dismissed duplicates among the named batch sections`. The control deletes the name and expects a throw.
  - `multispec-console-template.md renders a #### Dismissed duplicates heading`. The control deletes the heading.
  - `wrap-up/SKILL.md's Review Console section list names Dismissed duplicates`. The control deletes it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js`
Expected: FAIL. The prose does not name the section yet.

- [ ] **Step 3: Implement** the four prose edits listed under Files. Before editing, run `git grep -l -F 'Reference repairs' -- plugin docs tests` and classify each hit in the commit body as edited here, edited in Task 6 or 8, or no-change. Known no-change hits: `engine-render.js` (an engine-only section list), `execution-and-verification.md`, `multispec-batch-curation.md`, and the console-template "Generate the next five sections" sentences.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js tests/bin-lib/console/resolve.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "Register the Dismissed duplicates console section — appendix, numbering, multi-spec template, wrap-up section list" -m "refs #3946"`

---

### Task 4: Compose a queue-write proposal for a shadow-dup copy

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/console/shadow-dup-proposal.js`
- Create: `plugin/bin/shadow-dup-proposal.js`
- Create: `tests/bin-lib/console/shadow-dup-proposal.test.js`
- Modify: `docs/plugin-structure.md` — add the lib to the `plugin/bin/lib/console/` line, and add a CLI line beside `console-resolve.js`'s

**Interfaces:**
- Consumes: `classifyStagedItem`, `SHADOW_DUP_RE` (Task 2). From `plugin/bin/lib/issues/record.js`: `specShapedBody`, `recordPayload`, `fencedBlock`, `fenceFor`, `DEFER_REASONS`. `resolveTarget` from `plugin/bin/lib/stage-item/write.js`.
- Produces:
  - `composeShadowDupProposal({ name, text, anchorText, runId }) -> { ok: true, outcome, anchor, title, proposal } | { ok: false, reason }`, where `reason ∈ {'not-a-shadow-dup', 'shadow-dup-duplicate', 'copy-unreadable'}`. `proposal` is exactly `Title: {title}\nType: task\nLabels: needs:definition\nDefer-reason: needs-human-decision\n\n{body}`, the same header shape `wrap-up/leftover-routing.md` step 3 writes. `{body}` = `recordPayload({ title, type: 'task', deferReason: 'needs-human-decision', body: specShapedBody({...}) }).body`, built from these `specShapedBody` fields:
    - `provenance: { origin: 'wrap-up Review Console, run {runId}: {outcome} copy staged/{name}', deferReason: 'needs-human-decision' }`
    - `currentState: [one sentence naming the copy, its anchor `staged/{anchor}` and the outcome, fencedBlock(text)]`
    - `deliverables`: one checkbox, "compare with the anchor; apply the copy through its own kind's consumer, or close this record when the anchor covers it"
    - `openQuestion`: divergent → whether the copy carries a proposal the anchor does not; collision → the anchor was missing or unreadable, so is the copy's proposal still wanted
    - `releaseNote: 'No user-visible change.'`
    - `filedBy: 'wrap-up Review Console'`
    - `footer: '_Filed by \`wrap-up Review Console\` via specShapedBody._'`

    `title` = `Reconcile staged copy {name}`.
  - CLI `node bin/shadow-dup-proposal.js --run <run-dir> --item <staged-name> --out <file>`, exported `run(argv, deps)`; `deps = { cwd, mainRoot, readFile, writeFile, stdout, stderr }`.
    - Exit 0: wrote `--out` and printed its path.
    - Exit 2: a malformed invocation. That covers a missing or unknown flag; an `--item` that is not a plain filename (`sanitizeId`); a name that is not a shadow-dup; an item absent from `staged/`; a byte-identical duplicate (stderr `refused (shadow-dup-duplicate): dismissed, nothing to file`); and an unreadable copy.
    - Exit 3: `--run` missing or not anchored (the reader bullet of `cli-wrapper-contract.md`), or `--out` unwritable.

    The anchor text is read from `staged/{anchor}` and is `null` when unreadable. The header comment states the 0/2/3 vocabulary.

- [ ] **Step 1: Write the failing tests** (`shadow-dup-proposal.test.js`)
  - `divergent: header carries Title/Type/Labels/Defer-reason and the reason is in DEFER_REASONS`: parse the header block (the lines before the first blank line). Assert `Labels: needs:definition`, and that `DEFER_REASONS.includes('needs-human-decision')`. This is the same check `refused-proposals.md` runs.
  - `verbatim round-trip: the copy is quoted byte for byte`. The copy text is ``'## Finding\r\n\nuses ```js fences``` and `ticks`  \n'``. Assert `proposal.includes(fencedBlock(text))` and that the fence is longer than three backticks.
  - `collision: no anchor composes with the collision question`. The `openQuestion` text names the missing anchor.
  - `duplicate is refused, not composed`: `{ ok: false, reason: 'shadow-dup-duplicate' }`.
  - `non-shadow-dup name is refused`: `'leftover-x.md'` → `not-a-shadow-dup`.
  - CLI:
    - exit 0 writes `--out` whose content equals `composeShadowDupProposal(...).proposal`;
    - exit 2 for a missing item and for a duplicate, with nothing written to `--out`;
    - exit 3 for a worktree-local shadow `--run`. Use the `stage-item/cli.test.js` fixture shape (a main checkout plus a `.claude/worktrees/…` shadow), and assert `--out` is absent afterwards.
  - `AC4 e2e (spec AC5, shadow-dup half): a console-auto run with one copy per reason ends with zero pending and each Queue-writes copy composes a fileable proposal`. Build a run dir with the three pairs and call `resolveAll`. Assert `unresolvedItems` is `[]`. For each `apply` shadow-dup item, CLI exit 0 and the `--out` file contains `fencedBlock(copyText)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/console/shadow-dup-proposal.test.js`
Expected: FAIL with `Cannot find module '…/plugin/bin/lib/console/shadow-dup-proposal'`.

- [ ] **Step 3: Implement** the lib and the CLI per Interfaces, plus the two `docs/plugin-structure.md` lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/shadow-dup-proposal.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/path-containment-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/console/staged-id-producers.test.js`
Expected: PASS

- [ ] **Step 5: Real-input probe.** No `.shadow-dup` file exists in any local run dir: `find "$RUN_ROOT/.claude-tweaks/pipelines" -name "*.shadow-dup*"` printed nothing at authoring. Use a real staged file as the copy instead:
  1. In a scratch main-checkout fixture, copy `$RUN_ROOT/.claude-tweaks/pipelines/archive/2026-10-03T120516-record-2773/staged/reflect-1.md` to `staged/reflect-1.md.shadow-dup`, with the anchor holding a one-line edit.
  2. Run the CLI.
  3. Record the exit code, the `Title:` line, and `cmp` of the extracted fenced block against the source file (expect identical) in the task report.
- [ ] **Step 6: Revert-to-red check.** Delete the lib export and confirm Step 2's failure. Replace `fencedBlock(text)` with `text.trim()` and confirm `verbatim round-trip` fails.

- [ ] **Step 7: Commit** — `git commit -m "Add shadow-dup-proposal.js — compose a fileable queue-write proposal that quotes a shadow-dup copy verbatim" -m "refs #3946"`

---

### Task 5: Wire the composer into the Queue-writes consumers

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/review-console.md` — "On approval" step 7. Budget about 450 B; the file is 26,720 B.
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` — the `` `apply` on a `Q#` item `` bullet
- Modify: `plugin/skills/flow/multispec-review-console.md` — the Numbering rules' Queue-writes aggregation sentence and step 2. Each is one short clause that cites `wrap-up/review-console.md` step 7 and does not restate it; keep the total under 400 B (headroom 3,668 B).
- Modify: `plugin/skills/wrap-up/console-template.md` — "Where the `Q#` rows come from"
- Test: `tests/console-shadow-dup-outcomes-conformance.test.js`

**Interfaces:**
- Consumes: the CLI from Task 4 and the test helpers from Task 3.
- Step 7's new sentence, to be written exactly in this form:

  > A `*.shadow-dup*` item (`shadow-dup-divergent`/`shadow-dup-collision`) carries no header of its own: resolve a scratch path with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SHADOW_DUP_PROPOSAL=shadow-dup-proposal-{Q#}.md` (no `eval` — it prints the path), run `node "${CLAUDE_PLUGIN_ROOT}/bin/shadow-dup-proposal.js" --run "$PIPELINE_RUN_DIR" --item {name} --out "{proposal-path}"`, then run the check and create the record from `{proposal-path}` as above — it quotes the copy verbatim under `Defer-reason: needs-human-decision` and `needs:definition`. A non-zero exit is a failed create, not a refusal: log it `FAILED` and keep the item staged.

- [ ] **Step 1: Write the failing tests** (append to the conformance file, each with a same-helper control):
  - `step 7 names shadow-dup-proposal.js with --run, --item and --out for a .shadow-dup Q# item`;
  - `the appendix apply-on-Q# bullet routes a shadow-dup copy through step 7's composer`;
  - `multispec-review-console.md step 2 cites review-console.md step 7's shadow-dup clause`;
  - `console-template.md's Q# source sentence names .shadow-dup copies`;
  - `prose-code twin: every flag step 7 passes appears in shadow-dup-proposal.js's USAGE`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js`
Expected: FAIL after Step 1, on the five new tests.

- [ ] **Step 3: Implement** the four prose edits.

- [ ] **Step 4: Verbatim-command run-once check.** This could not be run at authoring because the CLI does not exist until Task 4, so it is flagged unverified until this step. Run the step 7 command line exactly as written in a scratch fixture with `PIPELINE_RUN_DIR` set to a main-checkout run dir holding one divergent pair. Record exit 0 and the `--out` path in the task report.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/console-resolve-conformance.test.js tests/bin-lib/console/resolve.test.js`
Expected: PASS

- [ ] **Step 6: Commit** — `git commit -m "File divergent and collision shadow-dup copies through Queue writes — step 7 composes their header" -m "refs #3946"`

---

### Task 6: Shadow-dup prose sweep in shipped skills

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/curation-engine.md` — the shadow sweep paragraph's `STAGED … shadow copy kept as staged/{name}.shadow-dup for a human decision …` log line and its "so the console renders it as a pending item" clause. Rewrite them to say the console compares the copy with its anchor: a byte-identical copy is dismissed, and any other copy is filed through Queue writes (`resolve.js`'s `classifyStagedItem`). The log status stays `STAGED`; the artifact still exists.
- Modify: `plugin/skills/_shared/console-on-pr.md` — Item ID scheme: "**Auto-applied rows are never checkboxes**" gains Dismissed duplicates rows, which are informational with no id and no tick.
- Test: `tests/console-shadow-dup-outcomes-conformance.test.js`

**Interfaces:**
- Consumes: the Task 3 helpers.

- [ ] **Step 1: Write the failing tests** (each with a same-helper control):
  - `curation-engine.md no longer routes a shadow-dup copy to a human decision`: the shadow sweep paragraph does not contain `for a human decision`, and does contain `Dismissed duplicates` and `Queue writes`. Before writing this, run the absence grep `git grep -n -F 'for a human decision' -- plugin/skills/wrap-up/curation-engine.md` on the current tree and record that it matches one line. At authoring it matched exactly one line, the shadow sweep paragraph.
  - `console-on-pr.md keeps Dismissed duplicates rows out of the checkbox ids`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js`
Expected: FAIL after Step 1, on the two new tests.

- [ ] **Step 3: Implement** the two edits.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js tests/hooks-staged-inventory.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "Describe shadow-dup copies' final outcomes in the curation engine and the PR console" -m "refs #3946"`

---

### Task 7: Refuse an unmapped, non-exempt staged id

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/stage-item.js`:
  - delete `warnUnmappedPrefix` and its two calls (`runLedger` and the plain path in `run()`);
  - add `unmappedPrefixRefusal`;
  - update the header comment's exit-2 list, which currently says the warning "never changes the exit code".
- Modify: `plugin/bin/lib/console/resolve.js` — only the comments above `CANONICAL_PREFIXES` and `STAGING_EXEMPTIONS`, where "unmapped-prefix warning" becomes "unmapped-prefix refusal"
- Modify: `docs/plugin-structure.md` — the `plugin/bin/lib/console/` line's two "unmapped-prefix warning" phrases
- Modify: `.claude/skills/review-console-section-addition/SKILL.md` — site 3's "`stage-item.js`'s unmapped-prefix warning suggests from this list" becomes "refusal"
- Test: `tests/bin-lib/stage-item/cli.test.js`

**Interfaces:**
- Consumes: `classifyStagedItem`, `stagingExemption`, `nearestCanonicalPrefixes` (all already imported).
- Produces: `unmappedPrefixRefusal(id: string, sourceFile: string) -> string | null`. It classifies `id + path.extname(sourceFile)` by id alone, with no content: a `SECTION_MAP` prefix counts as mapped whatever the file holds, and a `.patch` source is mapped by its extension. It returns `null` when exempt or mapped. Otherwise it returns `stage-item.js: refused (unmapped-prefix): --id {id} matches no Review Console SECTION_MAP prefix and no STAGING_EXEMPTIONS entry — nothing written. Nearest canonical prefixes: {a, b, c}\n`. `run()` calls it once, after every usage check (the ledger-mode/stray block) and before `deps.readFile(o.file)`. On non-null it writes the message to stderr and returns 2. This single site covers both call paths, so nothing is read, staged, appended or logged.

- [ ] **Step 1: Write the failing tests** (`cli.test.js`)
  - Replace the #3370 warning test with `AC1.1: --id review-13-record (.md) is refused: exit 2, named reason, nearest prefixes, nothing written`. Assert `code === 2`, that `staged/review-13-record.md` is absent, that `out` is empty, and that stderr matches `/refused \(unmapped-prefix\): --id review-13-record/` and `/Nearest canonical prefixes: .*review-/`.
  - `AC1.2: a mapped id and an exempt id still exit 0`. Keep "a canonical id prints nothing to stderr" (`polish-suggestion-1` .md, and `review-2` .patch mapped by extension) and the #3488 exempt loop (`release-held`, `dispatch-target-missing-x`, `shipped-close-1`, `upstream-draft-1`), unchanged.
  - `AC1.3: the --ledger call site refuses an unmapped id before any carry-forward`. Set up a ledger `docs/plans/x-ledger.md` with one table row in the fixture checkout and an empty `decisions.md`. Call `run(['--run', runDir, '--id', 'zz-unmapped-1', '--file', md, '--allocate', '--ledger', ledger, '--item', 'i', '--label', 'l'])`. Assert exit 2, the stderr reason, `staged/` absent, and the ledger and `decisions.md` byte-identical.
  - `AC1.3: the --ledger call site still stages a mapped id` is already covered by `ledger.test.js`'s `sdd-ruling-1` cases. Cite them; add nothing.
  - `guard: classification is by id alone`: `--id reflect-7 --file obs.md`, where `obs.md` holds `**Category:** observation`, exits 0 and is written.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/stage-item/cli.test.js`
Expected: FAIL after Step 1. The current code exits 0 with a warning for `review-13-record`, and appends the ledger row for `zz-unmapped-1`.

- [ ] **Step 3: Implement** per Interfaces, plus the comment and doc wording edits.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/stage-item/cli.test.js tests/bin-lib/stage-item/ledger.test.js tests/bin-lib/stage-item/write.test.js tests/bin-lib/console/resolve.test.js tests/bin-lib/console/staged-id-producers.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-shipped-candidate-prose.test.js`
Expected: PASS. AC6.1: `resolve.test.js`'s `CANONICAL_PREFIXES` parity checks pass. The scratch scan at authoring found no test `--id` that the refusal flips except `review-13-record`.

- [ ] **Step 5: Revert-to-red check.** Make `unmappedPrefixRefusal` return `null` unconditionally and confirm `AC1.1` and `AC1.3` fail. Delete its `stagingExemption` guard and confirm the `release-held` case fails.

- [ ] **Step 6: Commit** — `git commit -m "Refuse an unmapped staged id in stage-item.js — exit 2 with reason unmapped-prefix, nothing written" -m "refs #3946"`

---

### Task 8: Docs sweep for both behavior changes

**Role:** transcription

**Files:**
- Modify: `docs/journeys/review-what-an-unattended-console-left-open-3370.md`:
  - the "Should understand" line describing `stage-item.js: warning: …` and "The file is still written and the exit code is unchanged" becomes the refusal (exit 2, nothing written, same nearest-prefix hint);
  - the `pending` list no longer names "a shadow-dup copy".
- Modify: `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md` — the "Should understand" sentence that puts `.shadow-dup` copies in Pending review becomes: dismissed when byte-identical; otherwise filed through Queue writes with the copy quoted verbatim. The "Red flags" sentence is kept and reworded so a divergent copy is never dismissed.
- Modify: `docs/journeys/multi-spec-review-console.md` — the named-batch-section reading order adds Dismissed duplicates after Pending review.
- Test: `tests/console-shadow-dup-outcomes-conformance.test.js`

**Interfaces:**
- Consumes: the Task 3 helpers.

- [ ] **Step 1: Write the failing tests** (each with a same-helper control). The 3370 journey contains no `the exit code is unchanged` and does contain `refused (unmapped-prefix)`. The 1932 journey no longer says `a \`.shadow-dup\` copy lands there too`. The multi-spec journey names `Dismissed duplicates`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js`
Expected: FAIL after Step 1, on the three new tests.

- [ ] **Step 3: Implement** the three doc edits. Then run the behavior-change prose sweep: `git grep -n -i -e 'unmapped-prefix warning' -e 'shadow-dup' -e 'for a human decision' -- plugin docs .claude/skills`. Classify every remaining hit in the commit body as fixed or no-change. Expected no-change hits: `docs/superpowers/plans/*` (history) and `.claude/skills/parse-signal-discipline/SKILL.md` (it describes the comparison's three outcomes, which are unchanged).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/console-shadow-dup-outcomes-conformance.test.js`
Expected: PASS. AC6.1: the full suite runs once at `/build`'s Common Step 5 (`verify.js`), not per task.

- [ ] **Step 5: Commit** — `git commit -m "Update journeys for the shadow-dup outcomes and the unmapped-prefix refusal" -m "refs #3946"`
