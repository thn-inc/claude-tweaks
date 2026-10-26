# Reflect Findings Console Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reflect `observation`/`convention` staged files carry a destination line, classify into the Review Console's Skill updates section (stance `approve`) instead of Pending review, and are carried to that destination by a new applier CLI; legacy files with no destination line get one stated rule (materiality digest) that both the live applier and #3950's backfill use.

**Architecture:** A pure parser module (`plugin/bin/lib/console/reflect-destination.js`) owns the destination grammar and is the single source both `resolve.js`'s `classifyStagedItem` and the applier read. The applier (`plugin/bin/lib/console/reflect-apply.js` + `plugin/bin/reflect-apply.js`) performs the record write (gh transport, or `emit` for MCP/local-files) and the decline write (`recordDecline`) through injectable deps, and reports edit/digest/emitted-record work back to the console session, which performs it and calls the CLI again to log it. Prose sites (`reflect/SKILL.md`, the wrap-up console files, the PR and multi-spec console files) cite the CLI.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T210508-record-4168/work/4168-spec.md` (record #4168)

## Global Constraints

- Plugin payload is `plugin/` only; tests under `tests/`.
- CLI wrapper contract (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`): `run(argv, overrides)` seam, `require.main === module` guard assigns `process.exitCode` (never `process.exit`), `execFileSync('gh', args, { windowsHide: true, … })`, run dir anchoring via `resolveTarget` (`plugin/bin/lib/stage-item/write.js`) with exit 3 on a missing/unanchored run dir, exit 2 on a malformed invocation.
- Defer-reason vocabulary is `DEFER_REASONS` from `plugin/bin/lib/issues/record.js` — never restated.
- `recordDecline` source literal is `'reflect'` and the fingerprint is `createFingerprint('reflect', ['description']).fingerprint({ description })` — identical to `plugin/bin/declined-learning.js`'s `computeFingerprint`, so reflect's own `lookup --source reflect` sees the decline.
- A record filing never adds an `auto:*`/`bot:*` label (strip them from `Labels:`).
- Commit messages: `{Verb} {what} — {detail}`, body `refs #4168` (never `closes`/`fixes`), trailer `Claude-Session: https://claude.ai/code/session_014kynwBUBcb1BYy54Pdqu6S`.
- `plugin/skills/**/*.md` stays under `RAIL_BYTES` = 52,500 B. `plugin/skills/flow/multispec-review-console.md` is 50,910 B at base: Task 8 may add at most ~800 B net.
- Implementers run only their own targeted suites (`node --test <file>`); the full suite runs centrally.

Waived AC4.1: `npm test` passing is verified centrally by `/claude-tweaks:build` Common Step 5 (`verify.js`), not by a task's test step.

## Review Focus

1. A reflect file with two `**Destination:**` lines, an unknown verb, or a `decline` with no reason — never applied; classifies Pending review with a named `reflect-destination-invalid:{why}` reason (Task 1, Task 2 tests).
2. An `edit` target that escapes the repo (`../x.md`, `/etc/x.md`, `C:\x.md`, a non-`.md` file) — invalid, never edited (Task 1 test).
3. Re-running the console (or the applier) on the same run dir — no second record, no second decline, no second log line (Task 3 idempotency test).
4. A `record` destination whose `Defer-reason:` is absent or outside the vocabulary — classifies `Refused — no defer reason`, the applier logs the `REFUSED` line once and files nothing (Task 2, Task 3 tests).
5. `--transport gh` when CLAUDE.md declares `work-types: native` or nothing — a loud per-item failure naming `--transport emit`, never a record filed with its Type silently dropped (Task 3 test).

---

### Task 1: Destination parser module

**Files:**
- Create: `plugin/bin/lib/console/reflect-destination.js`
- Test: `tests/bin-lib/console/reflect-destination.test.js`

**Interfaces:**
- Produces (all exported):
  - `DESTINATION_VERBS = Object.freeze(['edit', 'record', 'decline'])`
  - `RECORD_PROPOSAL_HEADING = '## Record proposal'`
  - `APPLICABLE_CATEGORIES = Object.freeze(['observation', 'convention'])`
  - `REFLECT_NO_DESTINATION = 'reflect-no-destination'` (the legacy rule's digest Defer-reason token)
  - `parseCategory(text) -> string|null` — moved verbatim from `resolve.js` (same regex `/^\*\*Category:\*\*\s*(\S+)/m`, null for falsy text).
  - `isApplicableReflect(name, text) -> boolean` — `name` starts with `reflect-` AND `parseCategory(text)` lowercased is in `APPLICABLE_CATEGORIES`.
  - `parseReflectDestination(text) -> { kind: 'none' } | { kind: 'edit', target } | { kind: 'decline', reason } | { kind: 'record', proposal: { title, type, labels, deferReason, body } } | { kind: 'invalid', why }`
  - `deferReasonProblem(proposal) -> null | string` — null when `proposal.deferReason` is in `DEFER_REASONS`, else the offending value or `'absent'`.
  - `findingDescription(text) -> string` — the `## Finding` section's text (to the next `## ` heading) with whitespace squashed to single spaces; falls back to `digestTextOf(text)` (`./staged-digest-text`) when the section is absent or empty.

Grammar (decide nothing else):
- Destination lines match `/^\*\*Destination:\*\*[ \t]*(.*?)[ \t]*$/gm`. Zero → `none`. More than one → `invalid`, why `multiple-destination-lines`.
- `edit {target}`: value matches `/^edit[ \t]+(\S+)$/`. Target valid only when: no leading `/`, no `^[A-Za-z]:`, no `\`, no `..` path segment, ends `.md`, and (basename is `CLAUDE.md` OR a path segment equals `skills` OR a segment equals `rules`). Otherwise why `edit-target`.
- `record`: value exactly `record`. Requires a line exactly `## Record proposal`; after it (skipping blank lines) a header block up to the first blank line, read by key: `Title:` (non-empty), `Type:` (one of `bug|feature|task`), `Labels:` (absent or `none` → `[]`, else comma-split, trimmed, empties dropped), `Defer-reason:` (value string, or null when absent). `body` = everything after that header block's terminating blank line, must be non-empty after trim. Any failure → why `record-proposal`. A bad Defer-reason is NOT invalid — it parses, and `deferReasonProblem` reports it.
- `decline {reason}`: value matches `/^decline[ \t]+(.+)$/` → reason trimmed. Bare `decline` → why `decline-reason`.
- Any other value → why `unknown-destination`.
- Must not require `./resolve` (resolve.js will require this module).

- [ ] **Step 1: Write the failing tests** — one `test()` per case, names cited by spec clause where they cover one:
  - `none` for a legacy file — use the real fixture `tests/bin-lib/console/fixtures/staged/reflect-ledger-3876.md` (read with `fs`): `assert.deepStrictEqual(parseReflectDestination(text), { kind: 'none' })` and `isApplicableReflect('reflect-1.md', text) === true` (its Category is `convention`).
  - `edit`: `'**Destination:** edit plugin/skills/review/SKILL.md'` → `{ kind: 'edit', target: 'plugin/skills/review/SKILL.md' }`; `CLAUDE.md` and `.claude/rules/x.md` valid; `../CLAUDE.md`, `/abs/skills/a.md`, `C:/skills/a.md`, `skills\\a.md`, `plugin/skills/a.js`, `docs/a.md` each → `{ kind: 'invalid', why: 'edit-target' }`.
  - `record`: a full file whose `## Record proposal` block is `Title: Fix the X\nType: task\nLabels: risk:low, auto:build\nDefer-reason: genuinely-larger\n\n## Current State\n\nx\n` → `proposal` deep-equals `{ title: 'Fix the X', type: 'task', labels: ['risk:low', 'auto:build'], deferReason: 'genuinely-larger', body: '## Current State\n\nx\n' }` (labels are parsed raw; stripping is the applier's job); missing heading, empty Title, `Type: chore`, empty body each → `invalid`/`record-proposal`; `Defer-reason: bogus` parses and `deferReasonProblem` returns `'bogus'`; absent → `'absent'`; `genuinely-larger` → `null`.
  - `decline`: `'**Destination:** decline already documented in CLAUDE.md'` → reason `'already documented in CLAUDE.md'`; bare `decline` → `decline-reason`.
  - two Destination lines → `multiple-destination-lines`; `**Destination:** later` → `unknown-destination`.
  - `isApplicableReflect`: `tangential` → false; `Observation` (case) → true; `leftover-1.md` with `**Category:** observation` → false.
  - `findingDescription`: the reflect-ledger fixture returns a string starting with `` `_shared/subagent-dispatch-core.md` line 39 states that `` with no newline in it.

- [ ] **Step 2: Run** `node --test tests/bin-lib/console/reflect-destination.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** `plugin/bin/lib/console/reflect-destination.js` per the Interfaces block (`'use strict'`, header comment naming #4168 and the grammar).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** both files: `Add reflect destination parser — one grammar for the console classifier and the applier` (+ `refs #4168`, trailer).

---

### Task 2: Classify reflect observation/convention into Skill updates

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`parseCategory` removed and imported from `./reflect-destination`; `classifyStagedItem`'s QUEUE un-reasoned branch; the comment block above `classifyStagedItem`)
- Test: `tests/bin-lib/console/resolve.test.js` (update the #2473 test at "a Category: observation/convention reflect finding never resolves to Queue writes/apply…"; add new tests)

**Interfaces:**
- Consumes: Task 1's `parseCategory`, `isApplicableReflect`, `parseReflectDestination`, `deferReasonProblem`.
- Produces: `classifyStagedItem(filename, text)` returns, for a `reflect-` file whose Category is observation/convention: `{ section: 'Skill updates' }` (destination `none`/`edit`/`decline`/`record` with a valid Defer-reason); `{ section: 'Refused — no defer reason' }` (record with `deferReasonProblem` non-null); `{ section: 'Pending review', reason: 'reflect-destination-invalid:{why}' }` (invalid). Every other non-tangential Category (any non-`reflect-` QUEUE file, or a reflect Category other than observation/convention/tangential) keeps `{ section: 'Pending review', reason: 'non-tangential-category:{category}' }`.

- [ ] **Step 1: Write the failing tests** in `resolve.test.js`:
  - `AC1.1/AC1.2: reflect observation and convention classify to Skill updates and resolve approve (#4168)` — replace the old #2473 test body: observation file with `**Destination:** decline not actionable`, convention file with `**Destination:** edit plugin/skills/review/SKILL.md`, tangential file unchanged. `classifyStagedItem` → `{ section: 'Skill updates' }` for both; `resolveAll` (existing `fixture`/`deps` helpers, `headers: [7]`) → both `section: 'Skill updates'`, `resolution: 'approve'`, and no item `resolution === 'pending'`.
  - `AC1.3: tangential still Queue writes` — keep the existing assertions (`reflect-3.md` → Queue writes / apply).
  - `AC1.4: no Category line classifies exactly as before` — the existing `AC3.2/AC3.3 orthogonal` test stays green untouched; add `classifyStagedItem('reflect-5.md', '# Reflect\n\n**Destination:** decline x\n')` → `{ section: 'Queue writes' }` (a Destination line without a Category changes nothing).
  - `AC3 (classification): a legacy reflect file with no destination line classifies to Skill updates` — real fixture `fixtures/staged/reflect-ledger-3876.md` → `{ section: 'Skill updates' }`.
  - `reflect record with an invalid Defer-reason classifies Refused and resolves refused` — `resolveAll` item `section: 'Refused — no defer reason'`, `resolution: 'refused'`.
  - `an invalid reflect destination stays pending with a named reason` — two Destination lines → `reason: 'reflect-destination-invalid:multiple-destination-lines'`, `resolution: 'pending'`.
  - Existing `wrap-up-cleanup-ordering.md` + `**Category:** observation` case (≈line 1352) must still return `non-tangential-category:observation` — leave it unchanged.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/resolve.test.js` — Expected: FAIL on the new/updated tests only.
- [ ] **Step 3: Implement** the branch in `classifyStagedItem` (inside `if (section === SECTIONS.QUEUE && !reason)`, after the non-tangential check, before returning the reroute); update the comment to say observation/convention route to Skill updates and are applied by `bin/reflect-apply.js` (#4168), other categories keep #2473's reroute.
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/staged-id-producers.test.js tests/bin-lib/console/cli.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Route reflect observations and conventions to Skill updates — their destination line decides what applies them`.

---

### Task 3: Applier CLI

**Files:**
- Create: `plugin/bin/lib/console/reflect-apply.js`
- Create: `plugin/bin/reflect-apply.js`
- Modify: `plugin/bin/lib/work-backend.js` (add `WORK_TYPES_RE = /^work-types:[ \t]*(\S+)[ \t]*$/m`, `parseWorkTypes(text)`, `readWorkTypes(root, { readFile })` — same null-on-anything-wrong contract as `readWorkBackend`; update the header comment to say it reads both keys)
- Modify: `docs/plugin-structure.md` (command reference row for `reflect-apply.js`, next to `console-filings.js`'s)
- Test: `tests/bin-lib/console/reflect-apply.test.js`

**Interfaces:**
- Consumes: Task 1 exports; Task 2's classification (the AC2 fixture runs `resolveAll` first); `resolveTarget` (`plugin/bin/lib/stage-item/write.js`); `formatEntry`/`appendEntry` (`plugin/bin/lib/log-decision/append.js`); `materialityEntryLine`/`materialityFingerprint` (`plugin/bin/lib/health-core/materiality-digest.js`); `digestTextOf` (`./staged-digest-text`); `runIdOf` (`./resolve`); `createFingerprint` (`plugin/bin/lib/health-core/fingerprint.js`); `recordDecline` (`plugin/bin/lib/declined-learning/store.js`); `defaultRunner`/`errorText` (`plugin/bin/lib/feedback/file-feedback.js`).
- Produces:
  - lib: `applyReflectItems({ runDir, only, transport, outDir, repo, dryRun, deps }) -> { applied, session, refused, pending, alreadyApplied, failed, planned? }`; `markApplied({ runDir, item, kind, ref, deps })`; `declineItem({ runDir, item, reason, deps })`; `APPLIED_LINE_RE(name)`.
  - CLI usage (exact):
    ```
    reflect-apply.js --run <run-dir> [--only <name,...>] [--transport gh|emit] [--out-dir <dir>] [--repo owner/name] [--dry-run]
    reflect-apply.js --run <run-dir> --item <name> --decline <reason>
    reflect-apply.js --run <run-dir> --item <name> --applied edited|filed|digested [--ref <ref>]
    ```
    Default transport `gh`; `--out-dir` required with `--transport emit`; `--ref` required for `filed` (`^#?\d+$`) and `digested` (non-empty). `--item`/`--only` naming a file that is absent or not `isApplicableReflect` → exit 2 listing the applicable names.
  - stdout: one JSON object `{ applied: [{ item, outcome: 'filed'|'declined', ref }], session: [{ item, outcome: 'edit', target } | { item, outcome: 'record', proposal } | { item, outcome: 'digest', line, fingerprint }], refused: [{ item, value }], pending: [{ item, reason }], alreadyApplied: [{ item, line }], failed: [{ item, error }] }` (all keys always present; `--dry-run` adds `planned: [{ item, outcome }]` and performs no gh call, no `recordDecline`, no file write, no log line).
  - Exit: 0 ok (session work included); 1 any `failed` entry; 2 malformed invocation; 3 run dir missing/unanchored.

Behaviour per item (selection = every `staged/reflect-*.md` where `isApplicableReflect`, narrowed by `--only`):
- `decisions.md` already holds a line matching `APPLIED_LINE_RE(name)` = `^- AUTO \d{2}:\d{2}:\d{2} — Reflect apply: staged/{escaped name} (filed|declined|edited|digested)\b` (multiline) → `alreadyApplied`, nothing else.
- `invalid` → `pending: [{ item, reason: 'reflect-destination-invalid:{why}' }]`.
- `record` with `deferReasonProblem` → `refused`; append (once — skip when decisions.md already names `staged/{name}` on a `- REFUSED` line) `formatEntry({ status: 'REFUSED', step: 'Queue write staged/{name}', text: 'no valid Defer-reason on staged/{name}; kept staged' })` under section `/wrap-up` — the line `refused-proposals.md` defines, so `resolve.js`'s `refusedStagedNames` reads it.
- `record`, transport `gh`: `deps.workTypes()` must be `'labels'` else `failed` with error `work-types {value|unset}: the gh transport expresses Type as a type:* label — rerun with --transport emit`. Labels = proposal labels minus `/^(auto|bot):/i`, plus `type:{type}`. Write `body` to `deps.tmpFile('reflect-apply-{stem}.md')`, call `deps.gh(['issue', 'create', ...(repo ? ['--repo', repo] : []), '--title', title, '--body-file', file, ...labels.flatMap((l) => ['--label', l])])`; parse `/\/issues\/(\d+)/` from stdout (no match → `failed`). Then log `AUTO` text `staged/{name} filed as #{n} (Defer-reason: {v})`, reversibility `high (gh issue close)`; `applied` `{ outcome: 'filed', ref: '#{n}' }`. A gh throw → `failed` with `errorText(err)`.
- `record`, transport `emit`: write `{outDir}/reflect-apply-{stem}.md` = `Title: …\nType: …\nLabels: {stripped labels comma-joined, or none}\nDefer-reason: …\n\n{body}` → `session` `{ outcome: 'record', proposal: path }`. No log line yet.
- `decline`: `description = findingDescription(text)`; `fp` per Global Constraints; `deps.recordDecline(fp, { reason, source: 'reflect', subject: description })`; log `staged/{name} declined ({reason}); decline {fp} recorded`, reversibility `high (clearDecline)`; `applied` `{ outcome: 'declined', ref: fp }`. A throw → `failed`.
- `edit`: `deps.exists(path.join(deps.cwd(), target))` false → `failed` `edit target not found: {target}`; else `session` `{ outcome: 'edit', target }`.
- `none` (the legacy rule): entry `{ area: 'reflect', finding: ('{name} (no destination): ' + digestTextOf(text)).slice(0, 200), fileRefs: {the **Files:** value squashed, else 'general'}, deferReason: REFLECT_NO_DESTINATION, provenance: runIdOf(runDir) }` → `session` `{ outcome: 'digest', line: materialityEntryLine(entry), fingerprint: materialityFingerprint(entry) }`.
- `--decline <reason>` mode: same as the `decline` branch with the given reason, whatever the file's own destination.
- `--applied` mode: `edited` logs `staged/{name} edited {target}` (error exit 2 when the file's destination is not `edit`), reversibility `high (in the wrap-up commit)`; `filed` logs `staged/{name} filed as #{n} (Defer-reason: {v})`; `digested` logs `staged/{name} digested ({ref})`, reversibility `high (entry remains promotable from the digest)`. Already applied → print `alreadyApplied`, no second line.
- Real deps: `cwd: process.cwd`, `gh: defaultRunner`, `recordDecline`, `workTypes: () => readWorkTypes(process.cwd())`, `tmpFile` under `os.tmpdir()`, `appendDecision: appendEntry`, `now: Date.now`, fs readers/writers.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/console/reflect-apply.test.js` (temp run dir under the test's own `mainRoot`, the way `tests/bin-lib/console/console-filings-cli.test.js` anchors one; fake `gh`/`recordDecline` recording their calls):
  - `AC2.1: a console-auto fixture with one reflect observation and one reflect convention ends with zero pending items` — staged `reflect-1.md` (observation, destination record, Title `Track the X`, Type `task`, Labels `risk:low, auto:build`, Defer-reason `genuinely-larger`) and `reflect-2.md` (convention, `decline already covered by CLAUDE.md`); `resolveAll({ policy: 'console-auto' })` → no `pending` item, both `approve`.
  - `AC2.2: the record destination is written through the injected gh dep` — after `run(['--run', dir], deps)` exit 0: exactly one gh call whose args deep-equal `['issue', 'create', '--title', 'Track the X', '--body-file', <file>, '--label', 'risk:low', '--label', 'type:task']` and whose body file holds the proposal body; `applied` has `{ item: 'reflect-1.md', outcome: 'filed', ref: '#901' }` (fake returns `https://github.com/o/r/issues/901\n`).
  - `AC2.3: the decline destination is written through the injected recordDecline dep` — one call; fingerprint equals `createFingerprint('reflect', ['description']).fingerprint({ description })` for the file's Finding text; `{ reason: 'already covered by CLAUDE.md', source: 'reflect', subject: description }`.
  - `AC2.4: decisions.md gains one applied line per item, and a second run applies nothing` — both `Reflect apply: staged/reflect-1.md filed as #901` and `…reflect-2.md declined (` present; second `run` → gh and recordDecline call counts unchanged, `alreadyApplied` lists both.
  - `AC3.1: a legacy reflect file with no destination line reaches the digest outcome` — copy real fixture `fixtures/staged/reflect-ledger-3876.md` as `reflect-3.md`; `session` entry `outcome: 'digest'`, `line` contains `— Defer-reason: reflect-no-destination —` and `reflect-3.md (no destination):`; then `run(['--run', dir, '--item', 'reflect-3.md', '--applied', 'digested', '--ref', 'https://github.com/o/r/issues/5#issuecomment-1'])` logs `staged/reflect-3.md digested (`; a further plain run lists it under `alreadyApplied`.
  - `edit destination is reported to the session, then logged by --applied edited`; missing target → exit 1, `failed`.
  - `emit transport writes a Queue-write-shaped proposal and calls no gh` — file starts `Title: Track the X\nType: task\nLabels: risk:low\nDefer-reason: genuinely-larger\n\n`.
  - `a record with an invalid Defer-reason is refused, logged once, never filed` — one `- REFUSED` line naming `staged/reflect-4.md` after two runs; zero gh calls.
  - `gh transport under work-types native fails loudly per item` — exit 1, error contains `--transport emit`, zero gh calls.
  - `--dry-run calls and writes nothing` — zero gh/recordDecline calls, decisions.md byte-identical, `planned` lists every item.
  - `--decline overrides the file destination` (a record-destination file declined via `--item … --decline 'declined at Review Console, no reason given'`).
  - `exit 2` on `--transport emit` without `--out-dir`, on `--only reflect-9.md` (absent), on `--applied filed` without `--ref`; `exit 3` on a run dir outside `mainRoot`.
  - `parseWorkTypes`: `'work-types: labels\n'` → `'labels'`; blank `work-types:` followed by `native` on the next line → null.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/reflect-apply.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** lib + CLI + `work-backend.js` additions per Interfaces; header comments state the exit codes and the two-call session protocol; add the `docs/plugin-structure.md` row (one line: what it does, the three invocation shapes, exit codes).
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/reflect-apply.test.js tests/bin-lib/exit-code-conformance.test.js tests/git-path-read-conformance.test.js` plus any `tests/**/work-backend*.test.js` (`git ls-files tests | grep work-backend`) — Expected: PASS.
- [ ] **Step 5: Commit** — `Add reflect-apply.js — carries a reflect observation or convention to its destination`.

---

### Task 4: Legacy rule in the backlog backfill

**Files:**
- Modify: `plugin/bin/lib/console/backfill-dispose.js` (`DIGEST_REASONS` gains `REFLECT_NO_DESTINATION: REFLECT_NO_DESTINATION` imported from `./reflect-destination`; `disposeStaged`'s digest fallback uses it when `isApplicableReflect(s.name, text) && parseReflectDestination(text).kind === 'none'`, else `UNMAPPED_KIND`; label and finding text unchanged)
- Modify: `tests/bin-lib/console/backfill-dispose.test.js`
- Modify: `tests/bin-lib/console/backfill.test.js` (the `staged-kind items carry classifyStagedItem's result` test: `items[0].staged` now `{ name: 'reflect-1.md', section: 'Skill updates' }`, no `reason`)
- Modify: `plugin/skills/tidy/console-backfill.md` (where it lists the staged-kind digest outcome: one sentence — a reflect observation/convention with no `**Destination:**` line digests with Defer-reason `reflect-no-destination`, the same rule the live console's `reflect-apply.js` applies)

**Interfaces:**
- Consumes: Task 1 `isApplicableReflect`, `parseReflectDestination`, `REFLECT_NO_DESTINATION`.
- Produces: `DIGEST_REASONS.REFLECT_NO_DESTINATION === 'reflect-no-destination'`.

- [ ] **Step 1: Write the failing tests** in `backfill-dispose.test.js`:
  - `AC3.2: a legacy reflect observation/convention with no destination digests under reflect-no-destination (#4168)` — `stagedDigest('reflect-1.md', { section: 'Skill updates' }, 'reflect-ledger-3876.md').deferReason === 'reflect-no-destination'`, same for `reflect-table-3877.md`; the materiality fingerprint equals the one the same input produced with `UNMAPPED_KIND` (it omits `deferReason`, so an already-digested item still dedups).
  - Orthogonal: the existing tangential-reflect case (≈line 236) still asserts `UNMAPPED_KIND`; a reflect observation carrying `**Destination:** decline x` that reached the backfill still digests `UNMAPPED_KIND`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/backfill-dispose.test.js tests/bin-lib/console/backfill.test.js` — Expected: FAIL (new test, and the backfill.test.js case already red since Task 2).
- [ ] **Step 3: Implement** the reason switch and the backfill.test.js expectation update; add the console-backfill.md sentence.
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/backfill-dispose.test.js tests/bin-lib/console/backfill.test.js tests/bin-lib/console/backfill-apply.test.js tests/bin-lib/console/backfill-cli.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Digest legacy reflect findings under reflect-no-destination — the backfill's rule for files staged before destination lines`.

---

### Task 5: Destination line in reflect's stage-file format

**Files:**
- Modify: `plugin/skills/reflect/SKILL.md` (Step 3's routing table rows for "Convention drift…" and "Pattern observation…"; the **Stage-file format** block; one new paragraph after it)
- Test: `tests/reflect-destination-format-conformance.test.js`

**Interfaces:**
- Consumes: Task 1 `DESTINATION_VERBS`, `RECORD_PROPOSAL_HEADING`, `REFLECT_NO_DESTINATION`.

Prose content (decided here):
- In the stage-file format block, after `**Category:**`, add `**Destination:** {edit {repo-relative path} | record | decline {reason}}`, and state `Category` is `{convention | tangential | observation}` unchanged.
- New paragraph "**Destination (observation/convention only).**": exactly one `**Destination:**` line, chosen by reflect: `edit {path}` when the fix is a small, clear change to a named skill file (a path with a `skills/` segment), a `rules/` file, or a `CLAUDE.md` — the console session makes the edit; `record` when it is real work beyond an edit — append a final `## Record proposal` section holding `Title:`/`Type:`/`Labels:`/`Defer-reason:` lines, a blank line, then the body composed via `specShapedBody` exactly as the tangential variant composes it (`filedBy: 'reflect'`, `provenance.deferReason` from `_shared/deferral-gate.md`'s vocabulary, `openQuestion` → `needs:definition`); `decline {reason}` when no action is warranted. The section sits in the body, not as a top header, so the file is never read as a Queue write. The console classifies these files into Skill updates and `bin/reflect-apply.js` applies them; a file with no Destination line (staged before this line existed) is digested with Defer-reason `reflect-no-destination`; a malformed line stays in Pending review; a `record` whose `Defer-reason:` is invalid is refused (`wrap-up/refused-proposals.md`).
- Table rows: "Convention drift…" and "Pattern observation…" Default routing becomes "STAGED — write to `staged/reflect-{n}.md` with a `**Destination:**` line (below). Resolves in the Review Console's Skill updates section." (drop "Most go to skill updates handled by `/claude-tweaks:wrap-up`'s Skills curation row").
- Leave the tangential variant, its header, and "omitted for `convention`/`observation` findings (those are never Queue writes)" as they are.

- [ ] **Step 1: Write the failing test** `tests/reflect-destination-format-conformance.test.js`: a helper `missingDestinationForms(text)` returning every `DESTINATION_VERBS` verb for which `text` lacks `` `**Destination:** {verb}`` `` as written in the format block (match `**Destination:** edit`, `record`, `decline` inside the stage-file fence), plus `RECORD_PROPOSAL_HEADING` and `REFLECT_NO_DESTINATION` when absent. Tests: `reflect/SKILL.md names every destination verb the parser accepts` (`[]` for the live file); go-red control `a copy with the decline form removed is reported` (mutate the live text with `.replace('decline {reason}', '')`, expect `['decline']`); `the old Skills-curation-row routing claim is gone` (`assert.doesNotMatch(text, /Most go to skill updates handled by/)`).
- [ ] **Step 2: Run** `node --test tests/reflect-destination-format-conformance.test.js` — Expected: FAIL.
- [ ] **Step 3: Edit** `plugin/skills/reflect/SKILL.md` per the prose content above (stay well under the rail: ~25 KB now).
- [ ] **Step 4: Run** the test plus `git grep -l -F 'reflect/SKILL.md' -- tests` suites — Expected: PASS.
- [ ] **Step 5: Commit** — `Give reflect's stage-file format a destination line — observation and convention findings name where they go`.

---

### Task 6: Single-spec console prose

**Files:**
- Modify: `plugin/skills/wrap-up/review-console.md` ("On approval" step 2 — extend, do not renumber)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (Resolution-to-step mapping `approve` bullet)
- Modify: `plugin/skills/wrap-up/console-template.md` (`#### Skill updates` section)
- Modify: `plugin/skills/wrap-up/review-console-interactive.md` (Numbering rules / Override handling)
- Test: `tests/reflect-apply-console-conformance.test.js` (create)

Prose content (decided here):
- Step 2 appended clause: "A `staged/reflect-{n}.md` row (a reflect observation/convention — `resolve.js` classifies it here) is carried to its own `**Destination:**`: run `node "${CLAUDE_PLUGIN_ROOT}/bin/reflect-apply.js" --run "{item-run-dir}"` (`--transport emit --out-dir {session-tmp dir}` when `gh` is absent, `work-backend: local-files`, or `work-types` is not `labels`; `--only '{name},…'` for Override's approved rows). It files `record` destinations and records `decline` ones itself; for each `session` entry: `edit` — make the edit now (folds into step 12's commit), then `--item '{name}' --applied edited`; `record` — file the emitted proposal as step 7 files a `Q#` (the Defer-reason check already ran), then `--applied filed --ref '#{n}'`; `digest` — append its `line` to the materiality digest per `_shared/materiality-floor.md` (its Dedup check first), then `--applied digested --ref '{comment url}'`. A `failed` entry logs one Degrade-trace `SKIP` and the file stays staged. Override's `skip {#}` on such a row runs `--item '{name}' --decline '{reason, or "declined at Review Console, no reason given"}'`."
- Appendix `approve` bullet: add "A Skill updates row for `staged/reflect-{n}.md` runs at step 2's reflect clause (`bin/reflect-apply.js`), not the Skills curation patch path."
- console-template.md Skill updates: a paragraph — reflect rows are not engine findings; on an engine run render them as a `| # | Target | Change | Disposition |` table directly after the engine's output (numbers continue the global sequence), one row per `staged/reflect-{n}.md` in Skill updates: Target = the file, Change = `{destination verb}: {finding one-line}`, Disposition = `staged (staged/reflect-{n}.md)`; Approve all applies each to its destination.
- review-console-interactive.md: reflect rows join the global `#N` sequence; Override `skip {#}` on one records a decline (step 2's reflect clause).

- [ ] **Step 1: Write the failing test** `tests/reflect-apply-console-conformance.test.js`: read the four files; `review-console.md`'s step-2 line (the `^2\. ` line under `## On approval (option 1)`) contains `bin/reflect-apply.js`, `--applied`, and `--decline`; the appendix `approve` bullet contains `staged/reflect-` and `step 2`; console-template's `#### Skill updates` section (to the next `#### `) contains `staged/reflect-`; review-console-interactive.md contains `reflect` within a sentence naming `--decline` or "decline". Go-red control: the same predicate over review-console.md with `bin/reflect-apply.js` removed returns false.
- [ ] **Step 2: Run** `node --test tests/reflect-apply-console-conformance.test.js` — Expected: FAIL.
- [ ] **Step 3: Edit** the four files per the prose content.
- [ ] **Step 4: Run** the test plus `node --test tests/reflect-wrap-up-insights-staging-conformance.test.js tests/console-shadow-dup-outcomes-conformance.test.js` and every suite `git grep -l -F 'review-console.md' -- tests` lists — Expected: PASS.
- [ ] **Step 5: Commit** — `Apply reflect Skill-updates rows at the Review Console — step 2 runs reflect-apply.js`.

---

### Task 7: PR-console and execution prose

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (`**Skill updates**` bullet)
- Modify: `plugin/skills/_shared/console-on-pr.md` (Item ID scheme paragraph)
- Modify: `plugin/skills/_shared/console-execution.md` (Execution routing)
- Test: `tests/reflect-apply-console-conformance.test.js` (created by Task 6; extend it)

Prose content:
- execution-and-verification Skill updates bullet: "— a `staged/reflect-{n}.md` row is applied by `review-console.md` step 2's reflect clause, not as a patch".
- console-on-pr.md: a reflect Skill-updates row is a `staged` row like any batch row (its `#` from the global sequence).
- console-execution.md: one clause after the routing paragraph — "An unticked `staged/reflect-{n}.md` Skill-updates row declines through `bin/reflect-apply.js --run {item-run-dir} --item '{name}' --decline 'declined, no reason given'`, so the decline is recorded, not only logged."

- [ ] **Step 1: Add failing assertions** to the conformance test: execution-and-verification's Skill updates bullet contains `staged/reflect-`; console-execution.md contains `reflect-apply.js` and `--decline`; console-on-pr.md's `## Item ID scheme` section contains `reflect`.
- [ ] **Step 2: Run** the test — Expected: FAIL on the new assertions.
- [ ] **Step 3: Edit** the three files.
- [ ] **Step 4: Run** the test plus suites from `git grep -l -F 'console-execution.md' -- tests` and `git grep -l -F 'console-on-pr.md' -- tests` — Expected: PASS.
- [ ] **Step 5: Commit** — `Route reflect rows through the PR console and execution step — a tick applies, an untick declines`.

---

### Task 8: Multi-spec console prose

**Files:**
- Modify: `plugin/skills/flow/multispec-console-template.md` (`#### Skill updates` section)
- Modify: `plugin/skills/flow/multispec-review-console.md` (step 2's read list; "On approval" step 5; "On override" step 2 skip)
- Test: `tests/reflect-apply-console-conformance.test.js` (created by Task 6; extend it)

Prose content (keep `multispec-review-console.md` net growth ≤ 800 B; measure `wc -c` before and after):
- Step 2 read list: add `Skill updates (each spec's `staged/reflect-{n}.md` observation/convention rows)` to the prose-aggregated sections.
- On approval step 5: append "; each spec's `staged/reflect-{n}.md` row per `wrap-up/review-console.md` step 2's reflect clause, `{item-run-dir}` its `spec-{N}` dir".
- On override step 2: a reflect row's `skip` declines per that clause.
- multispec-console-template.md Skill updates: reflect rows render after the engine output with the contributing spec in the Spec column, same rule as `wrap-up/console-template.md`.

- [ ] **Step 1: Add failing assertions**: multispec-review-console.md step-2 line contains `staged/reflect-`; its On-approval step 5 line contains `review-console.md` step 2 and `reflect`; multispec-console-template.md's Skill updates section contains `staged/reflect-`; `fs.statSync(multispec-review-console.md).size < 52500`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Edit** the two files.
- [ ] **Step 4: Run** the test plus suites from `git grep -l -F 'multispec-review-console.md' -- tests` — Expected: PASS.
- [ ] **Step 5: Commit** — `Carry reflect rows into the multi-spec console — per-spec run dir, same applier`.
