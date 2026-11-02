# Aggregate Reproduction Line Refusal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bin/log-decision.js` refuses (exit 2, nothing written) a STAGED reproduction entry that names more than one finding, so no aggregate line can reach the Review Console as unsettleable keep-staged residue.

**Architecture:** A pure detector module, `plugin/bin/lib/log-decision/aggregate-reproduction.js`, decides from `{ status, step, text }` whether an entry is an aggregate reproduction line; `log-decision.js` calls it from both validation paths (single-entry `run` and `entryProblem` for `--entries`), beside the existing `repeatsStep` refusal. The finding-path grammar the detector needs moves out of `console/resolve.js` into a one-constant module both import, so writer and reader agree on what a location is. Prose in `/review` and `_shared/auto-decision-log.md` states the rule.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T182321-spec-4581/work/4581-spec.md` (record #4581)

Scope keywords: FINDING_PATH

## Global Constraints

- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, verbatim:
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes."
  - *Sanctioned-writer* (log-decision.js is in this family): "0 written (the written path echoed to stdout), 2 malformed invocation, 3 the run dir is missing or not anchored under the main checkout, or the target file is unwritable — **no 1 at all**."
  - "**Changing an existing CLI's exit code is a contract change — sweep every statement of the old code before calling it done.** The code lives in more places than the branch you edit: the file's header comment, a sibling module's comment that justifies its own code by analogy, `docs/`, `_shared/` prose, and this sub-file's own summaries."
  - Composer callers: "The composed text is built so it cannot trip the delegate's own refusals." (Checked at authoring: `review-routing-line.js`, `lib/log-decision/review-routing.js`, `dream-scan.js`, `release-note-repair.js` contain no `reproduction` text — `grep -n -i reproduction` empty — so none can trip the new refusal.)
- The new refusal is exit **2**, nothing written; it applies to `status === 'STAGED'` only. AUTO/SKIP/etc. are never refused by it.
- Exit-2 statement sweep (the only three that enumerate `log-decision.js`'s exit-2 reasons, from `grep -rn -i "log-decision" plugin docs .claude/skills | grep -i -E "exit.?2|exits 2|malformed"`): `plugin/bin/log-decision.js` header comment, `plugin/skills/_shared/auto-decision-log.md`, `docs/plugin-structure.md:196`.
- `plugin/skills/review/step3-lens-dispatch.md` is 52,336 bytes against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`): its edit is the exact replacement given in Task 3, measured at +50 bytes (52,386, headroom 114 — the full-path and never-several wording is Deliverable 2's own text, already trimmed elsewhere in the same bullet). No other edit to that file.
- `console/resolve.js`'s export surface and behavior are unchanged (Task 1 is a pure move with re-export).
- Commit style `{Verb} {what} — {detail}`; every commit message ends with the line `Claude-Session: https://claude.ai/code/session_01JHXvgY3ABzbfGWHHYSMJwB`.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch.
- Targeted runs only inside tasks (`node --test <file>`); the full suite runs centrally.

## Departures from the spec (decided at authoring, from real data)

A probe over every `decisions.md` under the main checkout's `.claude-tweaks/pipelines/` (1,318 STAGED reproduction lines) showed the spec's "two or more `path.ext:line` locations" detector would refuse real single-finding lines whose commentary cites a second location (`finding …/declaration.js:18 not reproduced (… also at verify.js:840 …)`, 9 such lines), and that aggregates are far wider than the two the record named (123 lines: `lens "3f" findings A and B`, `Reproduction: 26 unconfirmed single-agent findings …`, unquoted `lens 3a/3f …`, two `lens … finding` clauses, shortened coincidence lines `…release-merged.js:46 / :46 share a location`). So:

1. The detector keys on grammar, not location count: a plural `findings` that is the line's own subject, or two `lens … finding` clauses.
2. The marker is case-insensitive `reproduction:` and the lens quotes are optional — the reader's `findingKey` (`lens\s+"?…"?`, case-insensitive) and `_shared/multi-agent-coordination.md`'s `/review reproduction: lens …` form both require it.
3. The coincidence exemption requires a full path on **both** sides (the documented `{path}:{lineA} / {path}:{lineB}`): `lineKeys` cannot key a shortened `/ :46`, so a shortened coincidence line is residue too and is refused.

Departures 1 and 2 were settled by the user at Common Step 1.6's plan review (grammar rule; widened marker) and are recorded in the spec's `## Plan Review Clarifications` section, which supersedes Deliverable 1, AC3 and AC5 where they differ.

## Review Focus

1. A legitimate single-finding line with commentary mentioning other findings (`(agent A: no findings)`, `Lenses 3a, 3c: no findings from either agent`) — must be accepted.
2. A finding path that itself contains the word `findings` (`docs/plans/…-tiebreak-findings-4171-ledger.md:6`) — must be accepted.
3. An aggregate split across `--step "Reproduction"` + `--text 'lens "3a" 10 findings …'` (tiebreak.js writes `Reproduction` as a step) — must be refused.
4. A lens name with spaces (`lens "3f Test quality"`) — both detection and the coincidence exemption must handle it.
5. A non-reproduction STAGED line naming several locations (a routing line) — must be accepted.

Each has a test in Task 2.

## Acceptance criteria coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 2 Step 1: refuse — run 4481 (`--step "Step 3"`), refuse — spec #1921 (`--spec 1921`), both again with the prefix inside the text, refuse — split step; each asserts exit 2 and no `decisions.md` |
| AC2.1 | Task 2 Step 1: refuse — `--entries`, both observed texts (stderr names `entries[1]`, then `entries[2]` alone; nothing written) |
| AC3.1 | Task 2 Step 1: refuse — location list, refuse — lowercase marker (two full locations, no count, plural `findings` — the grammar rule the spec's Plan Review Clarifications settled) |
| AC4.1 | Task 2 Step 1: accept — per-finding, accept — coincidence, accept — single-read coverage, accept — vacuity downgrade, accept — AUTO aggregate (AUTO lines, including `reproduced. Confirmed`, `severity contested` and absence-claim-refuted, are never refused: status gate) |
| AC5.1 | Task 2 Step 1: accept — non-reproduction STAGED with several locations (the marker is now case-insensitive `reproduction:`, departure 2 above; a non-reproduction line still never matches) |
| AC6.1 | Task 2 Step 1: the `refusesAggregate` helper asserts stderr includes `one line per finding` and the reason's own `(--entries writes several in one call)` on every refusal (a bare `--entries` match would pass on `USAGE` alone) |
| AC7.1 | Task 2 Step 5: go-red proof |
| AC8.1 | Task 3 Step 4: `grep -c "one line per finding"` on `step3-lens-dispatch.md`, plus the `--entries` mention in the Step 1 replacement |

---

### Task 1: Move the finding-path grammar into its own module

**Role:** transcription

**Files:**
- Create: `plugin/bin/lib/console/finding-path.js`
- Modify: `plugin/bin/lib/console/resolve.js:508-510` (the `FINDING_PATH` declaration and the two `#4582` comment lines above it; lines 505-507 describe the debate regex and stay)
- Test: `tests/bin-lib/console/backfill.test.js` (unchanged — run in Step 3: `plugin/bin/lib/console/backfill.js:16` imports `FINDING_PATH` from `./resolve`, whose re-export this task keeps, so it needs no edit)
- No change (Check B scope sweep, frozen records of shipped work): `docs/superpowers/plans/2026-10-30-finding-key-path-class-4582.md`, `docs/superpowers/plans/2026-10-31-console-backfill-finding-path-4631.md`, `docs/superpowers/plans/2026-10-31-record-4647-test-digest-findings.md`

**Interfaces:**
- Produces: `require('./finding-path')` → `{ FINDING_PATH }` (a regex *source string*, byte-identical to today's `resolve.js:510` value). `resolve.js` keeps exporting `FINDING_PATH` (now re-exported from the new module).

- [ ] **Step 1: Create `finding-path.js`** holding the comment block now above `FINDING_PATH` in `resolve.js` (the `#4582` comment lines) and the constant verbatim, plus `module.exports = { FINDING_PATH };`.
- [ ] **Step 2: In `resolve.js`** delete the moved declaration and comments; add `const { FINDING_PATH } = require('./finding-path');` among the top-of-file requires. Leave the `module.exports` line unchanged.
- [ ] **Step 3: Prove the pure move.**
  Run: `node -e "const a=require('./plugin/bin/lib/console/resolve.js').FINDING_PATH,b=require('./plugin/bin/lib/console/finding-path.js').FINDING_PATH;console.log(a===b, a.length)"`
  Expected: `true 99` (99 is the length today's constant prints, measured at authoring).
  Run: `node --test tests/bin-lib/console/`
  Expected: PASS, same count as before the change (includes `backfill.test.js`, the one `FINDING_PATH` consumer outside `resolve.js`).
- [ ] **Step 4: Commit** — `git add plugin/bin/lib/console/finding-path.js plugin/bin/lib/console/resolve.js`; message `Move FINDING_PATH into console/finding-path.js — shared by resolve.js and log-decision`.

### Task 2: Detector module and the log-decision.js refusal

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/log-decision/aggregate-reproduction.js`
- Modify: `plugin/bin/log-decision.js` (header comment's exit-2 line; `run`'s single-entry branch after the `repeatsStep` check; `entryProblem` after its `repeatsStep` check)
- Test: `tests/bin-lib/log-decision/cli.test.js` (append)

**Interfaces:**
- Consumes: `FINDING_PATH` from `plugin/bin/lib/console/finding-path.js` (Task 1).
- Produces: `aggregateReproductionProblem({ status, step, text }) → string | null` — `null` when allowed; otherwise a reason starting `names several findings in one reproduction line`.

**Algorithm** (the tests below do not fully determine it):
1. `status !== 'STAGED'` → `null`.
2. `entry = step ? \`${step}: ${String(text).trim()}\` : String(text).trim()`.
3. `at = entry.search(/\breproduction:\s/i)`; `at < 0` → `null`. `tail = entry.slice(at)`.
4. `LENS = String.raw\`lens(?:es)?\s+(?:"[^"]*"|\S+)\``; `WORD = String.raw\`[\w/()-]+\s+\``.
5. Coincidence exemption (full path both sides) → `null` when `tail` matches
   `new RegExp(String.raw\`\blens\s+(?:"[^"]*"|[A-Za-z0-9_-]+)\s+findings\s+${FINDING_PATH}:\d+\s+\/\s+${FINDING_PATH}:\d+\s+share a location\b\`)`.
6. `bare = tail.replace(new RegExp(String.raw\`${FINDING_PATH}(?::\d+)?\`, 'g'), 'PATH')` — neutralize paths so a path containing `findings` never counts.
7. Refuse when `bare` matches any of (all `i`): `\b\d+\s+(?:WORD){0,3}findings\b` (a count), `\bLENS\s+(?:WORD){0,3}findings\b` (lens noun phrase), `\breproduction:\s+(?:WORD){0,4}findings\b` (marker subject — unanchored, so it is tested after every `reproduction:` in the tail, including the text's own marker when the step also carries one, e.g. `--step "Step 3 reproduction"`) — or when `bare` holds two or more matches of `\bLENS\s+(?:[\w-]+\s+)?finding\b` (`gi`).
8. Reason: `names several findings in one reproduction line — log one line per finding, each with its lens and full {path}:{line} (--entries writes several in one call): "${entry}"`.

Wiring: single-entry → `return usageError(\`--text ${reason}\`)`; `entryProblem` → `return \`text ${reason}\`` (readEntries already prefixes `entries[{i}]: `). Header comment's exit-2 line gains: "or a STAGED reproduction entry naming several findings (one line per finding — lib/log-decision/aggregate-reproduction.js)".

- [ ] **Step 1: Write the failing tests** in `cli.test.js`, reusing `fixture()`, `deps()`, `streamOf()`, `entriesFile()`. One helper: `const refusesAggregate = (args) => { const { main, run: runDir } = fixture(); const out = []; assert.equal(run(['--run', runDir, '--status', 'STAGED', ...args], deps(main, out)), 2); assert.ok(streamOf(out, 'err').includes('one line per finding')); assert.ok(streamOf(out, 'err').includes('(--entries writes several in one call)')); assert.equal(fs.existsSync(path.join(runDir, 'decisions.md')), false); };` and its mirror `acceptsLine(args, status = 'STAGED')` asserting exit 0. Name every test `#4581: …`. Texts are real `decisions.md` lines (prefix and `. Reversibility: …` suffix removed):
  - refuse — run 4481: `['--step', 'Step 3', '--text', 'Reproduction: lens "3a" 10 findings not reproduced (A: journey:89 medium, test:1921 low, git-command.js:2253 low, :2433 info, journey:34 info; B: ledger:5 medium, policy-schema-coverage.md:30 medium, git-command.js:2066 low, :2475 low, :2008 low). Staged to Review Console as low-confidence; handed to the tiebreak']`
  - refuse — spec #1921: `['--spec', '1921', '--text', 'Reproduction: lens "3f Test quality" 4 findings not reproduced (A only; B: no findings): cli.test.js:338 critical claim; cli.test.js:15 tmpDir never cleaned up. Staged to Review Console as low-confidence']`
  - refuse — run 4481, prefix inside the text: `['--text', 'Step 3: Reproduction: lens "3a" 10 findings not reproduced (A: journey:89 medium, test:1921 low, git-command.js:2253 low, :2433 info, journey:34 info; B: ledger:5 medium, policy-schema-coverage.md:30 medium, git-command.js:2066 low, :2475 low, :2008 low). Staged to Review Console as low-confidence; handed to the tiebreak']`
  - refuse — spec #1921, prefix inside the text: `['--text', 'spec #1921 — Reproduction: lens "3f Test quality" 4 findings not reproduced (A only; B: no findings): cli.test.js:338 critical claim; cli.test.js:15 tmpDir never cleaned up. Staged to Review Console as low-confidence']`
  - refuse — split step: `['--step', 'Reproduction', '--text', 'lens "3a" 10 findings not reproduced']`
  - refuse — marker subject behind a step that also carries the marker: `['--step', 'Step 3 reproduction', '--text', 'Reproduction: unconfirmed findings a/b.js:1 and c/d.js:2']`
  - refuse — location list: `['--text', 'Reproduction: lens "3c" findings plugin/bin/lib/worktree/remote-branch-collision.js:179 and :134 not reproduced']`
  - refuse — marker subject: `['--text', 'Reproduction: 26 unconfirmed single-agent findings (3a x4, 3c x4) staged at staged/review-lowconf-8.md']`
  - refuse — unquoted lens noun phrase: `['--text', 'Reproduction: lens 3a/3f single-agent low findings (Removes-from-Source cell, incidental-wording pins) not reproduced. Stage path: staged/review-unconfirmed-1.md']`
  - refuse — two clauses: `['--text', 'Reproduction: lens 3a finding plugin/bin/lib/reconcile/index.js:412 and lens 3f finding plugin/bin/lib/reconcile/index.js:334 not reproduced']`
  - refuse — shortened coincidence: `['--text', 'Reproduction: lens "3a" findings plugin/bin/lib/reconcile/release-merged.js:46 / :46 share a location but not substance; both staged unconfirmed']`
  - refuse — lowercase marker: `['--text', '/review reproduction: lens "3a" findings a/b.js:1 and c/d.js:2 surfaced by one agent only']`
  - refuse — `--entries`, both observed texts (AC2): element 0 `{ status: 'AUTO', text: 'ok' }`, element 1 `{ status: 'STAGED', step: 'Step 3', text: <the full run-4481 text above, without its prefix> }`, element 2 `{ status: 'STAGED', spec: '1921', text: <the full spec #1921 text above, without its prefix> }` → exit 2, stderr includes `entries[1]: text names several findings`, stdout `''`, no `decisions.md`. A second `--entries` test with element 1 replaced by `{ status: 'AUTO', text: 'ok' }` → exit 2, stderr includes `entries[2]: text names several findings` (so the spec #1921 element is refused on its own, not only shadowed by element 1).
  - accept — per-finding (documented): `['--text', 'Reproduction: lens "3a" finding plugin/bin/x.js:10 not reproduced. Staged to Review Console as low-confidence']`
  - accept — coincidence (documented, lens with spaces): `['--text', 'Reproduction: lens "3f Test quality" findings tests/a.test.js:466 / tests/a.test.js:466 share a location but not substance; both staged unconfirmed']`
  - accept — single-read coverage: `['--text', 'Reproduction: lens "3f" session limit twice; single-read coverage']`
  - accept — vacuity downgrade: `['--text', 'Reproduction: lens "3f" vacuity finding tests/a.test.js:5 downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence']`
  - accept — coordination form: `['--text', '/review reproduction: lens "3a" finding plugin/x.js:3 surfaced by one agent only. Stage path: staged/review-unconfirmed-1.md']`
  - accept — commentary (Review Focus 1, real): `['--step', 'Step 3 reproduction', '--text', 'Reproduction: lens "3b" finding plugin/bin/lib/init/release-bootstrap.js:276 not reproduced. Staged to Review Console as low-confidence. Lenses 3a, 3c, 3f: both pair agents returned No findings (6 agents)']`
  - accept — path containing `findings` (Review Focus 2, real): `['--text', 'Reproduction: lens "3a" finding docs/plans/2026-10-25-short-circuit-tiebreak-findings-4171-ledger.md:6 not reproduced']`
  - accept — AUTO aggregate is out of scope: `acceptsLine(['--text', 'Reproduction: lens "3a" 2 findings reproduced. Confirmed'], 'AUTO')`
  - accept — non-reproduction STAGED with several locations (Review Focus 5): `['--step', 'Step 3 Routing', '--text', 'findings a/b.js:1 and c/d.js:2 staged to staged/review-1.patch']`
- [ ] **Step 2: Run the tests to verify the refusals fail**
  Run: `node --test --test-name-pattern="#4581" tests/bin-lib/log-decision/cli.test.js`
  Expected: FAIL — every `refuse` test fails (exit 0 instead of 2); every `accept` test passes.
- [ ] **Step 3: Implement `aggregateReproductionProblem({ status, step, text })`** in `plugin/bin/lib/log-decision/aggregate-reproduction.js` per the Algorithm above (`'use strict'`, a header comment naming #4581 and the reader it keeps in step with — `console/resolve.js`'s `findingKey`/`lineKeys`), then wire it into `log-decision.js` per Wiring and update the header comment.
- [ ] **Step 4: Run the tests to verify they pass**
  Run: `node --test tests/bin-lib/log-decision/`
  Expected: PASS, including every pre-existing test.
- [ ] **Step 5: Go-red proof** — replace the module's body with `return null;`, re-run Step 4's command, confirm every `refuse` test fails and no `accept` test does, then restore it (`git diff --stat` shows only the intended files).
- [ ] **Step 6: Real-input probe** (scratch, not committed) — run the finished detector over every real line:
  Run: `node -e "const fs=require('fs'),p=require('path');const {aggregateReproductionProblem:f}=require('./plugin/bin/lib/log-decision/aggregate-reproduction.js');const root=process.argv[1];let n=0,r=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,e.name);if(e.isDirectory())w(q);else if(e.name==='decisions.md')for(const l of fs.readFileSync(q,'utf8').split('\n')){const m=/^- STAGED \d{2}:\d{2}:\d{2} — (.*)$/.exec(l);if(m&&/\breproduction:\s/i.test(m[1])){n++;if(f({status:'STAGED',text:m[1]}))r++}}}})(root);console.log(n,r)" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines"`
  Expected: `1318 123` at authoring time (a later run may have added lines; if either number differs, print the differing lines and confirm each new refusal is an aggregate and each new acceptance names one finding). Record the printed numbers in the commit message body.
- [ ] **Step 7: Commit** — `git add plugin/bin/lib/log-decision/aggregate-reproduction.js plugin/bin/log-decision.js tests/bin-lib/log-decision/cli.test.js`; message `Refuse a STAGED reproduction line naming several findings — log-decision.js exit 2, one line per finding`.

### Task 3: State the rule in the prose

**Role:** transcription

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md:106`
- Modify: `plugin/skills/_shared/auto-decision-log.md` (the `**Text from git or a user: \`--text-file\`.**` paragraph, after its "a `--text-file` with an interior line break exits 2." sentence)
- Modify: `docs/plugin-structure.md` (lines 37, 39 and 196)

Waived plugin/skills/release/SKILL.md: read-only — Step 4 checks line 194's description of `Reproduction:` lines still reads true; no edit expected.

**Interfaces:**
- Consumes: the refusal's behavior from Task 2 (exit 2, `--entries` hint). No code.

- [ ] **Step 1: Replace line 106 of `step3-lens-dispatch.md`** with exactly:
  `> - Findings present in only one agent's output → emit as \`unconfirmed\`, one line per finding with its full repo-relative path, never one summarizing several (\`--entries\` batches): \`STAGED {HH:MM:SS} — Reproduction: lens "{lens}" finding {path}:{line} not reproduced. Staged to Review Console as low-confidence. Reversibility: high.\` They go to Step 3.7 (\`step3-tiebreak.md\`). At \`medium\`, defer this write until \`step3-cross-lens-corroboration.md\`'s pass runs (it may promote it).`
  (The backslashes above only escape this plan's inline code; the file gets plain backticks.)
- [ ] **Step 2: Append to `auto-decision-log.md`**, after the `--text-file` paragraph's "exits 2." sentence, one sentence: `A STAGED reproduction entry naming more than one finding — a count (\`10 findings\`), a lens noun phrase (\`lens "3f" findings a.js:1 and b.js:2\`), or two \`lens … finding\` clauses — also exits 2: each finding gets its own line with its lens and full \`{path}:{line}\`, the key a tiebreak verdict settles it by (\`review/step3-tiebreak.md\`); write several at once with \`--entries\`. The documented two-finding coincidence line (full path on both sides) is the one exception.`
- [ ] **Step 3: Update `docs/plugin-structure.md`** — append to line 196, after `…followed by \`:\` is refused, exit 2`: `; so is a STAGED reproduction entry naming several findings (one line per finding — \`lib/log-decision/aggregate-reproduction.js\`)`. Add the two new modules to the module lists in that file: `aggregate-reproduction.js` to the `plugin/bin/lib/log-decision/` line (37, beside `append.js`, `claim-log.js`, `review-routing.js`), and `finding-path.js` to the `plugin/bin/lib/console/` line (39, beside `resolve.js`), each with a one-clause purpose in that line's existing style.
- [ ] **Step 4: Verify**
  Run: `wc -c plugin/skills/review/step3-lens-dispatch.md`
  Expected: `52386` (52,336 + 50; under the 52,500 rail).
  Run: `grep -c "one line per finding" plugin/skills/review/step3-lens-dispatch.md docs/plugin-structure.md`
  Expected: `1` for each file.
  Run: `grep -c "each finding gets its own line" plugin/skills/_shared/auto-decision-log.md`
  Expected: `1`.
  Run: `node --test tests/skill-size-single-source.test.js tests/review-cross-lens-corroboration-conformance.test.js tests/review-vacuity-evidence-conformance.test.js tests/review-absence-claim-ground-truth-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js tests/auto-decision-log-test-gate-completeness.test.js tests/auto-decision-log-worktree-gate.test.js`
  Expected: PASS. (These read the edited bullet or `auto-decision-log.md`; the first three pin the bullet's `> - Findings present in only one agent's output` prefix, its `At \`medium\`` sentence and its `step3-cross-lens-corroboration.md` citation, all kept by the replacement.)
  Run: `sed -n '194p' plugin/skills/release/SKILL.md`
  Expected: its description of `Reproduction:` lines (one finding per line, no severity) is still true after this change; no edit unless it contradicts the new rule.
- [ ] **Step 5: Commit** — `git add plugin/skills/review/step3-lens-dispatch.md plugin/skills/_shared/auto-decision-log.md docs/plugin-structure.md`; message `State one reproduction line per finding — review prose, decision-log contract, plugin-structure`.
