# Per-record shaped-body temp file Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two records shaped in one session never share a shaped-body temp file, and a body composed for one record is refused, before any write, when it is about to be written onto another.

**Architecture:** Provenance lives in the body (the spec's Decision, Reading B). The step that composes a body for record `{n}` writes `<!-- composed-for: #{n} -->` as the file's first line. `compose-record.js --check <file> --record {n}` reads that marker and refuses (exit 6, fail-closed) when it names another record, is missing, or is malformed; on a match it shape-checks the rest and, on a pass, rewrites the file in place without the marker, so the very next command (`gh issue edit --body-file`, `writeRecord`, `issue_write`) sends a marker-free body. Separately, every session-scoped `specify` temp file carrying one record's content on the shaping path is keyed by record id (`specify-shaped-body-{n}.md`, `specify-prior-body-{n}.md`, `specify-risk-answers-{n}.json`).

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T104155-record-4746/work/4746-spec.md`

Scope keywords: specify-shaped-body, specify-prior-body, specify-risk-answers, SPECIFY_SHAPED_BODY, composed-for

## Global Constraints

- Marker line, exact form: `<!-- composed-for: #{n} -->`, the file's first line, `{n}` the record id pasted literally (a GitHub number, or a local-files id). Parse regex: `/^<!-- composed-for: #([A-Za-z0-9._-]+) -->$/` on the first line with a trailing `\r` dropped.
- Missing marker (first line does not start with `<!-- composed-for:`) and malformed marker (starts with it but fails the regex) both refuse with exit 6 and name the target id. Mismatch refuses with exit 6 and names both ids. Nothing is written on any refusal (spec Decision: fail-closed; "refuses, before any write, with a message naming both ids").
- The marker is stripped before the body reaches the forge or `writeRecord`: it never lands in a record body (spec Decision).
- `compose-record.js` existing exit codes keep their meaning: 0 pass, 2 malformed invocation or unreadable file, 3 payload rejected, 4 shape gaps, 5 could not write. New: 6 = `--record` given and the marker is missing, malformed, or names another record. Under `--check --record`, exit 5 also covers a failed in-place rewrite.
- `--check` without `--record` is unchanged: read-only, and a leading marker line does not affect the shape verdict (probed: `validateShaped` returns `ok: true` on a marker-prefixed shaped body).
- Family rule (spec Decision): every session-scoped `specify` temp file carrying one record's content is keyed by record id at every resolve site; every gap in this family resolves fail-closed. Sites found: `shaping-mode-stamping.md:57` (BODY/PRIOR/ANSWERS, unkeyed today), `:206` (fence, two literals), `shaping-mode.md:79` (born-ready paragraph). `:66`'s batch files (`specify-risk-body-{n}.md`, `specify-prior-body-{n}.md`, `specify-risk-answers-{n}.json`) and `planning.md`'s `specify-plan-body-{n}.md`/`specify-plan-unplan-{n}.md` are already keyed. Settled: creation-flow files (`specify-sub-issue-body.md`, `specify-parent-body.md`, their payloads) have no record id at resolve time and are written by `gh issue create`, never onto an existing record, so the rule's "keyed by record id" cannot apply to them; they are out of this record's scope.
- Driver-skill rule (`.claude/skills/driver-skill-outcome-taxonomy/SKILL.md`), quoted: "End it with a bare `\|\| exit`, which re-raises the engine's own code — `\|\| exit 4` turned `compose-record.js --check`'s exit 2 into 4 and made the non-gap branch unreachable". The fence's `--check` line keeps a bare `|| exit`.
- `tests/skill-fence-guard-shapes.test.js` ratchets the exact line `SPECIFY_SHAPED_BODY=$(node -e "` in `shaping-mode-stamping.md`: keep it byte-identical.
- Phrases pinned by existing tests that must survive: `run the same \`compose-record.js --check\` first` (local-files paragraph; `tests/specify-shaping-template-required-sections.test.js`, `tests/risk-flags-prose-conformance.test.js`), `pre-write shape check failed:`, `Detail \`write failed: pre-write shape check ({reason})\``, and `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" --check "$SPECIFY_SHAPED_BODY"` in `shaping-mode.md`'s born-ready paragraph (`tests/specify-shaping-noop-check.test.js`'s `CHECK_CALL`; the probe keeps no `--record`, see Task 2).
- Rail headroom (`RAIL_BYTES` 52,500): `shaping-mode-stamping.md` 36,897 B, `shaping-mode.md` 24,925 B, `planning.md` 37,884 B. Each edit adds under 1 KB; all stay over 13 KB under the rail.
- `compose-record.js` keeps its existing direct-`fs` convention and `run(argv, deps)` shape; converting it to the full CLI wrapper contract (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`) is out of scope (surgical change). No other project skill under `.claude/skills/` governs these files.

## Review Focus

- A marked body passed through `risk-flags.js settle` keeps the marker as line 1 (probed: `addRiskFlags` inserts `Risk-flags:` after the marker). Pinned in Task 3 by running the real `settle` CLI on a marked file, then `--check --record`.
- A CRLF body file (`<!-- composed-for: #7 -->\r\n...`) is accepted for `--record 7`, and the stripped file keeps the rest byte-for-byte. Pinned in Task 1.
- A dashed local-files id (`2026-01-foo`) matches `--record 2026-01-foo`; `#45` must not match `--record 4` or `--record 456` (whole-id compare, not prefix). Pinned in Task 1.
- A shape failure under `--record` (exit 4) leaves the file unchanged, marker included, so a fixed retry can still check it. Pinned in Task 1.
- Planning's `{body}` carries the marker through `planning.md`'s per-record steps (`plan-lane`, `plan-audit.js --spec`, `plan-store.js write/check --spec-file`, the `Plan:` line insertion above the first `##` heading). Probed: `specHash` (`bin/lib/issues/plan-line.js`) is identical for a body with and without a leading marker, since it hashes from `## Overview` on; the marker is preamble, so the `Plan:` line still lands in the metadata block below it. Pinned in Task 3 (`specHash` equality).
- The born-ready probe (`--check` without `--record`) on a marked body exits 0 and leaves the file byte-identical, so the later `cmp -s` of shaped vs prior files still reports unchanged when both carry the marker. Pinned in Task 1 (no-`--record` case) and Task 2's prose (both files written with the marker).

---

### Task 1: `compose-record.js --check <file> --record <id>` verifies and strips the composed-for marker

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/compose-record.js`
- Modify: `docs/plugin-structure.md` (the `node plugin/bin/compose-record.js --check <body-file>` command-reference line, ~line 371)
- Modify: `docs/journeys/release-a-claim-and-log-a-pipeline-decision.md` (line ~109, the `--check` "writes nothing" sentence: add that `--record {n}` verifies the marker and strips it in place on a pass)
- Test: `tests/bin-lib/compose-record/cli.test.js`

**Interfaces:**
- Produces: CLI `compose-record.js --check <body-file> [--record <id>]`; exported `readComposedFor(body: string) -> { status: 'ok'|'missing'|'malformed', id: string|null, rest: string }` (`rest` = body with the first line and its line ending removed when `status === 'ok'`, else the whole body). Stderr lines (one each, trailing `\n`):
  - mismatch: `compose-record.js: body file {path} was composed for #{m}, not #{n} — refusing to write it`
  - missing: `compose-record.js: body file {path} carries no composed-for marker — refusing to write it to #{n}`
  - malformed: `compose-record.js: body file {path} has a malformed composed-for marker — refusing to write it to #{n}`
  - rewrite failure (exit 5): `compose-record.js: could not rewrite body file: {path} ({message})`

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/compose-record/cli.test.js`, following its `run(argv, deps(out))` + `tmpDir()` style; `SHAPED` = the file's existing shaped body text:
  - `AC3.1: --check --record refuses a body composed for another record, naming both ids`: file `{dir}/specify-shaped-body-4550.md` = `'<!-- composed-for: #4549 -->\n' + SHAPED`, `['--check', f, '--record', '4550']` → 6; stderr includes `#4549` and `#4550`; file content unchanged.
  - `--check --record on a matching marker strips it in place and exits 0`: marker `#4746` + SHAPED, `--record 4746` → 0, no stdout, file now equals SHAPED exactly.
  - `--check --record refuses a body with no marker`: SHAPED only, `--record 4550` → 6, stderr matches `/carries no composed-for marker/` and includes `#4550`; file unchanged.
  - `--check --record refuses a malformed marker`: first line `<!-- composed-for: 4550 -->` (no `#`) → 6, stderr matches `/malformed composed-for marker/`; file unchanged.
  - `--check --record compares whole ids`: marker `#45` with `--record 4` → 6 and with `--record 456` → 6.
  - `--check --record accepts a dashed local-files id and CRLF`: `'<!-- composed-for: #2026-01-foo -->\r\n' + SHAPED.replace(/\n/g, '\r\n')`, `--record 2026-01-foo` → 0; file equals `SHAPED.replace(/\n/g, '\r\n')`.
  - `--check --record: a shape failure exits 4 and leaves the marker in place`: marker `#7` + `'## Current State\n\nTODO\n'`, `--record 7` → 4; file unchanged.
  - `--check --record: the marker check runs before the shape check`: marker `#1` + unshaped body with `--record 2` → 6, not 4.
  - `--check without --record ignores a leading marker and writes nothing`: marker `#7` + SHAPED, `['--check', f]` → 0; file byte-identical.
  - `--record misuse is a usage error`: `[payloadFile, '--out', out, '--record', '1']` → 2 (stderr `--record is only valid with --check`); `['--check', f, '--record']` → 2 (stderr `--record <id> is required`); unreadable file with `--record 1` → 2.
  - `readComposedFor` unit cases: ok/missing/malformed statuses and `rest` for the ok case.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/compose-record/cli.test.js`
Expected: FAIL (`--record` is an unknown argument today, so the new cases exit 2; `readComposedFor` is not exported).

- [ ] **Step 3: Implement** in `plugin/bin/compose-record.js`: `parseArgs` gains `record: null` and `else if (a === '--record') o.record = next() ?? '';`. In `run`: `o.record !== null && o.check === null` → usage error `--record is only valid with --check`; under `--check`, `o.record === ''` → usage error `--record <id> is required`. With `o.record` set: read the file (exit 2 on failure as today), `readComposedFor`, refuse per Interfaces (exit 6) before `validateShaped`; on `ok` with matching id, `validateShaped(rest)` (exit 4 on gaps, file untouched), then `fs.writeFileSync(o.check, rest)` (exit 5 on failure), return 0. Update the header comment's usage and exit list (`6 = --check --record: the composed-for marker is missing, malformed, or names another record (#4746)`), `USAGE`, and add `readComposedFor` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/compose-record/cli.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/release-note-repair/detect.test.js`
Expected: PASS

- [ ] **Step 5: Update docs.** `docs/plugin-structure.md`'s command line becomes `--check <body-file> [--record <id>]`, adding: with `--record`, exit 6 refuses a body whose first-line `<!-- composed-for: #{id} -->` marker is missing, malformed, or names another record, and a pass strips the marker in place (#4746). Journey line ~109: one added sentence saying the same. Keep the rest of both lines unchanged.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/compose-record.js tests/bin-lib/compose-record/cli.test.js docs/plugin-structure.md docs/journeys/release-a-claim-and-log-a-pipeline-decision.md
git commit -m "Add compose-record --check --record marker guard — refuses another record's body (refs #4746)"
```

### Task 2: Key the shaping temp files by record id and write/check the marker at every write site

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/specify/shaping-mode-stamping.md` (`:57` Risk flags naming + `session-tmp-resolve.js` args; the github-issues Compose-then-write-once paragraph above the fence (~`:198`); the fence `:204-208`; the exit-handling paragraph `:221`; the local-files paragraph `:230`)
- Modify: `plugin/skills/specify/shaping-mode.md:79` (born-ready paragraph)
- Modify: `plugin/skills/specify/planning.md:185-187` (decomposition-mode Body and Write steps)
- Modify: `tests/specify-shaping-template-required-sections.test.js` (fence `--check` regex)
- Modify: `tests/specify-planning-conformance.test.js:879` (pinned `--check "{body}"` phrase)
- Test: `tests/skill-fence-guard-shapes.test.js` (verify unchanged: opener ratchet)
- Test: `tests/specify-shaping-noop-check.test.js` (verify unchanged: born-ready probe keeps no `--record`)
- Test: `tests/risk-flags-prose-conformance.test.js` (verify unchanged)
- Test: `plugin/skills/specify/record-creation-subissues.md` (verify unchanged: `:41`'s `specify-risk-answers-{k}.json` is a creation-flow file already keyed per sub-issue; see Global Constraints' family-rule line)

**Interfaces:**
- Consumes: Task 1's `--check <file> --record <id>`, exit 6, in-place strip.

- [ ] **Step 1: Update the two pinning tests first** (they go red against today's prose): the template-required-sections fence regex becomes `/--check "\$SPECIFY_SHAPED_BODY" --record \{n\} \|\| exit\s*$/`; the planning-conformance phrase becomes `compose-record.js" --check "{body}" --record {n}\` first, as \`shaping-mode-stamping.md\`'s Compose-then-write-once runs it`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/specify-shaping-template-required-sections.test.js tests/specify-planning-conformance.test.js`
Expected: FAIL after Step 1, on the two changed assertions.

- [ ] **Step 3: Edit the prose.**
  - `shaping-mode-stamping.md:57`: `{tmp-shaped-body}` is `specify-shaped-body-{n}.md`, `{tmp-prior-body}` `specify-prior-body-{n}.md`, `{tmp-answers}` `specify-risk-answers-{n}.json`, each keyed by record id so no two records shaped in one session share one; the resolve call becomes `session-tmp-resolve.js" BODY=specify-shaped-body-{n}.md PRIOR=specify-prior-body-{n}.md ANSWERS=specify-risk-answers-{n}.json`.
  - Github-issues Compose-then-write-once paragraph: the composed body is written with its first line the marker `<!-- composed-for: #{n} -->` (#4746), naming the record this body is composed for.
  - Fence: both `'specify-shaped-body.md'` literals become `'specify-shaped-body-{n}.md'`; the check line becomes `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" --check "$SPECIFY_SHAPED_BODY" --record {n} || exit`. Opener line byte-identical.
  - `:221`: after the `--check` (#2827) sentence, add: `--record {n}` (#4746) reads the body's first-line `composed-for` marker: exit 6 (marker missing, malformed, or naming another record) writes nothing and the row renders `failed`, quoting stderr verbatim; a pass strips the marker in place, so the write sends no marker. A failed write after that strip is re-run from a recomposed, re-marked body, never the stripped file.
  - `:230` local-files paragraph: the body is written with the same first-line marker, and `run the same \`compose-record.js --check\` first` gains `, with \`--record {n}\`,` right after `first` (keep the pinned phrase intact).
  - `shaping-mode.md:79`: the path becomes `specify-shaped-body-{n}.md`; the fetched body is written with the marker `<!-- composed-for: #{n} -->` as its first line, and its unmodified copy (`{tmp-prior-body}`) carries the same first line, so `cmp -s` still compares like with like. The probe call stays `--check "$SPECIFY_SHAPED_BODY"` with no `--record`: it is a read-only shape probe, not a write, and the marker check runs at Compose-then-write-once's pre-write `--check`. Say that in one clause.
  - `planning.md:185` step 1: the re-fetched body is written with its first line the marker `<!-- composed-for: #{n} -->`; same for the `specify-plan-unplan-{n}.md` body in step 3.
  - `planning.md:187` step 3: `--check "{body}"` becomes `--check "{body}" --record {n}`; a non-zero exit (6 included) writes nothing, as today. The `specify-plan-unplan-{n}.md` write runs the same `--check --record {n}` first, so its marker is stripped before the write; a non-zero exit there (4 or 6) writes nothing for that sub-issue, its stale `Plan:` line stays on the forge, and it is a failed body write with the same Detail `write failed: pre-write shape check ({reason})`. That body is the forge body re-fetched just before, which already passed the shape gate, so exit 4 there means the forge body itself regressed and blocking is correct (fail-closed).
  - `shaping-mode-stamping.md:66` (batch pre-pass): each record's `specify-risk-body-{n}.md` is written with that record's marker as its first line too, and the per-record loop composes the record's body into `specify-shaped-body-{n}.md`, marker first, before `settle` runs on it; the pre-write `--check --record {n}` always reads `specify-shaped-body-{n}.md` (or planning's `{body}` copy of it), never the pre-pass file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/specify-shaping-template-required-sections.test.js tests/specify-planning-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/specify-shaping-noop-check.test.js tests/risk-flags-prose-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/shaping-mode-stamping.md plugin/skills/specify/shaping-mode.md plugin/skills/specify/planning.md tests/specify-shaping-template-required-sections.test.js tests/specify-planning-conformance.test.js
git commit -m "Key specify shaping temp files by record id and check the composed-for marker before every write (refs #4746)"
```

### Task 3: Two-record regression test, per-site conformance pin, and retirement sweep

**Role:** integration

**Files:**
- Create: `tests/specify-shaped-body-per-record.test.js`

**Interfaces:**
- Consumes: Task 1's CLI and `readComposedFor`; Task 2's prose (fence literal, `:57` resolve args, `shaping-mode.md` path, `--record {n}` calls); `plugin/bin/session-tmp-resolve.js`'s exported `run`; `plugin/bin/risk-flags.js`'s exported `run`.

- [ ] **Step 1: Write the test** (reading skill files via `tests/helpers/read-skill`'s `readText`):
  - `AC1.1: every shaping resolve site names the record id`: the stamping fence (the fenced block containing `SPECIFY_SHAPED_BODY=$(node -e "`) contains `'specify-shaped-body-{n}.md'` twice; `:57`'s resolve call contains `BODY=specify-shaped-body-{n}.md PRIOR=specify-prior-body-{n}.md ANSWERS=specify-risk-answers-{n}.json`; `shaping-mode.md` contains `specify-shaped-body-{n}.md`.
  - `AC1.2: no site keeps a fixed session-wide filename`: neither `shaping-mode-stamping.md`, `shaping-mode.md` nor `planning.md` contains `specify-shaped-body.md`, `specify-prior-body.md` or `specify-risk-answers.json`. Go-red control inside the test: the same assertion function run against `git show`-free fixture text `"... 'specify-shaped-body.md' ..."` throws.
  - `every pre-write check passes --record {n}`: the fence's check line matches `/--check "\$SPECIFY_SHAPED_BODY" --record \{n\} \|\| exit\s*$/m`; `planning.md` contains `--check "{body}" --record {n}`.
  - `AC2.1: shaping two records back to back in one session writes each its own body` (regression): extract the filename literal from the fence's `sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, '([^']+)')`; for `4549` and `4550` substitute `{n}` and resolve through `session-tmp-resolve.js`'s `run(['--value', name], { env: { CLAUDE_CODE_SESSION_ID: 'same-session', TMPDIR: tmp }, stdout, stderr })` (one shared session id; match that CLI's actual deps keys). Write body A (marker `#4549`) to 4549's path, then body B (marker `#4550`) to 4550's path. Assert the paths differ, then run `compose-record.js` `run(['--check', p4549, '--record', '4549'])` → 0 and `p4550`/`4550` → 0, and assert each file now holds its own body text without a marker. On today's fixed filename both names resolve to one path and the assertions go red.
  - `AC3.1: a cross-wired body is refused before the write`: body A's file checked with `--record 4550` → 6, stderr names `#4549` and `#4550`, file unchanged.
  - `the marker does not change the plan spec hash`: `specHash(body) === specHash('<!-- composed-for: #9 -->\n' + body)` for a body with `## Overview`.
  - `the marker survives risk-flags settle`: write marker `#9` + a shaped body to a temp file and an unmarked copy as prior; run `risk-flags.js`'s `run(['settle', '--body-file', f, '--prior-body-file', p, '--headless'], deps)` (match its actual deps shape); assert line 1 is still the marker, then `--check f --record 9` → 0.

- [ ] **Step 2: Run the test**

Run: `node --test tests/specify-shaped-body-per-record.test.js`
Expected: PASS (Tasks 1-2 landed). Go-red proof: on the base commit's prose (`git show ab982eda62:plugin/skills/specify/shaping-mode-stamping.md`) the AC1.1/AC1.2/AC2.1 extractions fail; the implementer confirms by temporarily pointing the reader at that text in a scratch copy, never committing it.

- [ ] **Step 3: Retirement sweep.**

Run: `git grep -n -F -e 'specify-shaped-body.md' -e 'specify-prior-body.md' -e 'specify-risk-answers.json' -- plugin docs tests ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' ':!tests/specify-shaped-body-per-record.test.js'`
Expected: no output. Control (run at plan time against the base, exclusions per #4579): `git grep -n -F -e 'specify-shaped-body.md' -e 'specify-prior-body.md' -e 'specify-risk-answers.json' ab982eda62 -- plugin` matched `shaping-mode-stamping.md:57`, `:206` and `shaping-mode.md:79`. Any other hit is edited to the keyed form in this task.

- [ ] **Step 4: Commit**

```bash
git add tests/specify-shaped-body-per-record.test.js
git commit -m "Add per-record shaped-body regression and conformance test (refs #4746)"
```
