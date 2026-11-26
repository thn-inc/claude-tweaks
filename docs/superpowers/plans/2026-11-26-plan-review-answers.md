# Plan-review answers, waiting state and restart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plan-review needs-human stop gets a reply-based answer path (`/answer` comment folded into the body), a `needs:answer` waiting label instead of the headless `bot:blocked` block, and an automatic restart from a bare `/claude-tweaks:dispatch` drain.

**Architecture:** One pure module (`plan-review-answers.js`) owns question/reply detection and the body section writer; a thin `gh` CLI (`plan-review-answer.js`) ingests. `dispatch-resume.js --queue` turns off the typed-command stand-in for a queue-picked resume. Skill prose wires the label into plan review, a bare-drain Step 2.5 sweep (`dispatch/answered-resumes.md`), resume, attention and help.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T162921-record-5053/work/5053-spec.md` (record #5053) — read it with this plan; its Decisions D1-D10 are binding.

The `plan-review-question` sweep was done by grep at authoring time (Task 5, Task 6, Task 9 Files blocks); the frozen fixture `tests/fixtures/plan-review-ask-all-6051.txt`, the 3666/6054 journeys (filename references only) and the 2026-11-17 design doc need no change.

## Global Constraints

- Label `needs:answer`, colour `7057FF`, description exactly `a plan-review question awaits a human answer — reply /answer on the question comment` (fits the 100-char cap; prove with `ensureLabelPayload`).
- Answer section heading exactly `## Plan-review answers ({YYYY-MM-DD of question createdAt})`, then a blank line, `Question: {question url}`, a blank line, `**Decision** (answer by @{login}, {reply url}):`, a blank line, then `{fence}text` / reply text with the leading `/answer` token removed / `{fence}` (D6). `{fence}` = `fenceFor(replyText)` from `plugin/bin/lib/markdown-blocks.js` (never hand-rolled; Gotcha 1).
- A reply = trusted (`isTrustedComment`, `plugin/bin/lib/issues/comment-trust.js`) comment created strictly after the newest trusted `<!-- plan-review-question -->` comment, whose first non-blank line matches `/^\/answer(\s|$)/i` (D1).
- GitHub body cap: 65,536 characters — an append that would exceed it writes nothing, exits 4, keeps `needs:answer` (Gotcha 2).
- CLI exit codes for `plan-review-answer.js`: 0 answered (ingested now or already), 3 unanswered or no question, 2 usage error or `gh` absent, 4 a read, the write or the read-back failed (D2 of Deliverables).
- No skill or CLI ever posts an `/answer` comment (D9).
- No migration of already-`bot:blocked` records (D10); expand-contract: older builds still read `bot:blocked`, so `bot:blocked` stays defined (retry ceiling) — only the plan-review cause moves to `needs:answer`.
- Skill-file rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). Measured headroom at base `eaa89bea31`: `dispatch/SKILL.md` 52,295 (205 B), `_shared/github-pr-scan.md` 52,195 (305 B), `dispatch/settle-and-merge.md` 51,167 (1,333 B), `_shared/work-record.md` 45,744, `backlog/refine-mode.md` 46,753, `dispatch/task-prompt.md` 46,291. `dispatch/SKILL.md` and `github-pr-scan.md` may not grow net: every byte added is cut elsewhere in the same file (cut restatement only, after grepping `tests/` and `plugin/` for each phrase you cut).
- Every new `plugin/bin` spawn passes `windowsHide: true` as a literal key in the call's own options (`tests/windows-hide-spawn-conformance.test.js`); a `gh` argv takes `--end-of-options`-safe values only via argv arrays, never a shell string; existence checks route through `plugin/bin/lib/path-guard` (`tests/path-guard-conformance.test.js`).
- Governing project skills — the implementer of each task loads them with the Skill tool before writing code and follows them: Task 2 and Task 3: `gh-api-module-pattern` (its rule, quoted: "The module takes `runner(args)`, invoked as if `gh ${args.join(' ')}`, returning stdout; a throw is a failed call. Export `defaultRunner` = `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', windowsHide: true }))` — always an argv array, never a shell string"; its CLI wrapper contract is `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`). Tasks 5-8: `skill-prose-conformance-tests` (pins go red when reverted; mutate live text in memory for new prose). `dispatch-queue-exclusion-addition` does not apply (no queue exclusion is added, D4). `record-body-line-addition` does not apply (a body section, not a preamble `Key: value` line).
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #5053` (never closes/fixes), plus the `Claude-Session:` trailer.
- Auth proof (Task 2 carries the Proof line): only a comment whose `authorAssociation` is OWNER, MEMBER or COLLABORATOR (via `isTrustedComment`) can count as a question or an answer; Task 1's tests pin CONTRIBUTOR/NONE/missing-association replies and an untrusted question as `unanswered`/`no-question`, and Task 2's tests pin that such a record is never edited.
- Public-contract proof (Task 5 carries the Proof line): the new `needs:answer` label (bootstrap entry + `LABEL_BOOTSTRAP_VERSION` bump 11→12), the new CLI's exit-code contract, and `dispatch-resume.js` behaviour without `--queue` byte-unchanged — Task 3 keeps every existing `dispatch-resume-cli.test.js` case green and adds the no-flag typed case beside the `--queue` one.

## Review Focus

1. **Answer ingested, then resume refused** — removing `needs:answer` before knowing resume will accept strands the record (open-pr exclusion, no waiting label). Task 7's sweep therefore runs `plan-review-answer.js --check`, then `dispatch-resume.js --queue`, and ingests (the write) only on an eligible verdict; a refused resume leaves body and label untouched. (Departure from Deliverable 5's literal order, logged at build time; AC4's "calls plan-review-answer.js before dispatch-resume.js --queue" still holds.) Pinned in Task 7's conformance test by order.
2. **Two sessions ingest the same reply** — read-back counts each pending reply URL's occurrences and requires exactly one (Gotcha 3). Task 2 test: a read-back body citing the URL twice exits 4.
3. **A `/answer` comment with nothing after the token** (or only whitespace) — not an answer: it reads `unanswered`, never an empty Decision block. Task 1 test.
4. **CRLF record body** (a web-UI edit) — `## Original request\r` must still be found: `appendAnswers` normalizes `\r\n` to `\n` in the body it returns when it inserts, and returns the input unchanged when nothing is pending. Task 1 test.
5. **`/answer:` / `/ANSWER` / leading blank lines** — `/ANSWER foo` and a first non-blank line after blank lines count; `/answer:` and `/answers` do not. Task 1 test.

---

### Task 1: `plan-review-answers.js` — detection and section writer

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/plan-review-answers.js`
- Test: `tests/bin-lib/issues/plan-review-answers.test.js`
- Waived `bin/lib/markdown-blocks.js`: read only — `fenceFor` is consumed, not changed (Gotcha 1).

**Interfaces:**
- Consumes: `isTrustedComment` (`plugin/bin/lib/issues/comment-trust.js`); `fenceFor` (`plugin/bin/lib/markdown-blocks.js`); `originalRequestOffset`, `shapeGate` (`plugin/bin/lib/issues/materialize-format.js`).
- Produces:
  - `QUESTION_MARKER = '<!-- plan-review-question -->'`
  - `findQuestion(comments: Comment[]) -> Comment | null` — newest (by `createdAt`) trusted comment whose body starts with the marker.
  - `findAnswerReplies(comments, question) -> Comment[]` — trusted, `createdAt` strictly after `question.createdAt`, first non-blank line matches `/^\/answer(\s|$)/i`, remaining text (token removed, trimmed) non-empty; oldest first.
  - `answerText(comment) -> string` — the reply body with the leading `/answer` token (and one following space) removed from its first non-blank line, trimmed.
  - `answeredState({ comments, body }) -> { state: 'answered'|'unanswered'|'no-question', question, replies, pending }` — `pending` = replies whose `url` does not occur in `body`.
  - `appendAnswers(body, question, replies) -> string` — D6 section; inserts before `## Original request` (via `originalRequestOffset`) else appends at end; a reply URL already in the body is skipped; a later reply to the same question appends one more `**Decision**` block inside that question's existing section (found by its `Question: {url}` line); no pending → returns `body` unchanged.
  - `questionExcerpt(question) -> string` — the first line starting `**Question 1.` with `**` stripped, else the first non-blank line after the marker; for Task 8's attention row.
  - `Comment` = gh shape `{ body, createdAt, url, author: { login }, authorAssociation }`.

- [ ] **Step 1: Write the failing tests** — fixtures built with a `comment({ body, createdAt, association, login, url })` helper; the question body is the real #6118 shape (marker line, `**Plan review needs a decision…**`, blank, `**Question 1. What happens…?**`).
  - `AC1.1: a trusted question plus a trusted /answer comment after it reads answered` — `state === 'answered'`, `replies.length === 1`, `pending.length === 1`.
  - `AC1.2: no trusted question reads no-question` (no marker comment at all, and a marker comment by `CONTRIBUTOR` → `AC1.6`).
  - `AC1.3: an /answer created before the newest question (after an older one) reads unanswered` — two questions, the reply sits between them.
  - `AC1.4: untrusted authors read unanswered` — `CONTRIBUTOR`, `NONE`, and no association field.
  - `AC1.5: a first non-blank line that does not start with /answer reads unanswered` — `/answers x`, `see /answer x`, `/answer:` ; and positive controls `/ANSWER Reading A` and `\n\n/answer Reading B` read answered (Review Focus 5); `/answer` alone and `/answer   ` read unanswered (Review Focus 3).
  - `AC1.6: an untrusted question comment reads no-question`.
  - `AC2.1: the section goes immediately before ## Original request` — `body.indexOf('## Plan-review answers (2026-11-26)') < originalRequestOffset(result)` and nothing between section end and the heading but one blank line; `AC2.2: with no Original request it is appended at the end`.
  - `AC2.3: a reply holding a backtick run, a ## Original request line and TODO is fenced` — reply text `` ```js\nx\n```\n## Original request\nTODO later ``: `originalRequestOffset(result)` equals `originalRequestOffset(body)` + the inserted section's length (the heading the boundary finds is the real one), and `shapeGate(result).missing` does not include `'unresolved-placeholder'` when `shapeGate(body)` did not; fence length is 4.
  - `AC2.4: a second call with the same replies is byte-identical` — `appendAnswers(once, q, replies) === once`.
  - `a later reply to the same question adds a second Decision block to the same section` — one `## Plan-review answers` heading, two `**Decision**` lines.
  - `a CRLF body keeps the section before ## Original request` (Review Focus 4).
  - `questionExcerpt reads Question 1 from the real comment shape`.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/issues/plan-review-answers.test.js`
  Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/issues/plan-review-answers'`

- [ ] **Step 3: Implement the module** — pure, no I/O, `'use strict'`, header comment naming #5053 and D1/D6. Date for the heading: `question.createdAt.slice(0, 10)`.

- [ ] **Step 4: Run to verify it passes** — same command, Expected: PASS.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/issues/plan-review-answers.js tests/bin-lib/issues/plan-review-answers.test.js`, `git commit -m "Add plan-review answer detection and section writer — refs #5053"`.

### Task 2: `plan-review-answer.js` ingest CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/plan-review-answer.js`
- Test: `tests/plan-review-answer.test.js`

**Interfaces:**
- Consumes: Task 1's `answeredState`, `appendAnswers`; `ghAvailable`, `ghOptions`, repo slug resolution as `plugin/bin/dispatch-resume.js`'s `realDeps` does (mirror its `gh` seam, `issueView` shape).
- Produces: `run(argv: string[], deps) -> exitCode`, `realDeps`, exported; usage `plan-review-answer.js --issue <n> [--check] [--help]`. Stdout: one JSON line `{issue, state, question, replies, ingested}` where `question` is the question URL or null, `replies` the reply URLs, `ingested` the URLs written by this call (`[]` with `--check` or when already ingested).
- Reads: `gh issue view {n} --repo {slug} --json body,labels,comments` (probed read-only 2026-11-26 on #4523: comments carry `author.login`, `authorAssociation`, `createdAt`, `url`; `lastEditedAt` is not a `gh issue view` field — not needed here).
- Write (only when `pending` non-empty and not `--check`): one call `gh issue edit {n} --repo {slug} --body-file {tmp} [--remove-label needs:answer]` — `--remove-label` only when the read labels include `needs:answer`. Body file via `sessionTmpPath` (`plugin/bin/lib/session-tmp.js`), written with `fs.writeFileSync`, removed after.
- Read-back: re-run the issue view; every pending URL must occur exactly once in the new body, else exit 4.

- [ ] **Step 1: Write the failing tests** (fake runner recording argv; fixtures reuse Task 1's comment shape):
  - `AC3.1: answered with one pending reply issues exactly one gh issue edit carrying --body-file and --remove-label needs:answer, exit 0` — assert one `edit` call, both flags present, `ingested.length === 1`.
  - `answered without the label present edits without --remove-label` (Proof public-contract: a removal of an absent label is never sent).
  - `AC3.2: an already-ingested reply issues no edit and exits 0` — body already cites the URL; `ingested: []`.
  - `AC3.3: unanswered exits 3 with no edit`; `no-question exits 3 with no edit`; `an untrusted /answer reply is never ingested` (Proof auth).
  - `AC3.4: a failed edit exits 4`; `a read-back missing the reply URL exits 4`; `a read-back citing the URL twice exits 4` (Review Focus 2); `a failed first read exits 4`.
  - `AC3.5: --check never edits` — answered + pending, exit 0, zero `edit` calls.
  - `an append over 65,536 characters writes nothing and exits 4` (Gotcha 2).
  - `usage errors exit 2` (missing/zero/non-integer `--issue`, unknown flag) and `gh absent exits 2`.

Proof(auth): `isTrustedComment` gates both the question and the reply — CONTRIBUTOR, NONE and association-less `/answer` replies and an untrusted question are pinned as never ingested (Task 1 AC1.4/AC1.6, this task's untrusted-reply test).

- [ ] **Step 2: Run to verify it fails** — Run: `node --test tests/plan-review-answer.test.js` — Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** — `#!/usr/bin/env node`, header documenting argv, stdout and exit codes; `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`.

- [ ] **Step 4: Run to verify it passes**, then the scans: `node --test tests/plan-review-answer.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js` — Expected: PASS.

- [ ] **Step 5: Real-input probe (right after this task, not at the end)** — `node plugin/bin/plan-review-answer.js --issue 6118 --check` and `--issue 5053 --check`, output to `$PIPELINE_RUN_DIR/evidence/plan-review-answer-probe.txt` (absolute run-dir path, `mkdir -p` first, plain Bash redirect). Expected: #6118 prints `state` `unanswered` with its question URL (one trusted MEMBER question at 2026-11-26T06:56:52Z, no `/answer` reply), exit 3; #5053 prints `no-question`, exit 3. Independent count: `gh issue view 6118 --json comments --jq '[.comments[]|select(.body|startswith("<!-- plan-review-question -->"))]|length'` prints `1`. Log one `AC evidence` decision via `log-decision.js --text-file`.

- [ ] **Step 6: Commit** — `Add plan-review-answer ingest CLI — refs #5053`.

### Task 3: `dispatch-resume.js --queue`

**Role:** integration

**Files:**
- Modify: `plugin/bin/dispatch-resume.js` (`parseArgs`, `USAGE`, the `resolveBuildAuthority` call's `named`)
- Test: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
- Waived `docs/driver.md`: read only — its Build authority section is the precedent D8 cites; no change.
- Waived `plugin/bin/lib/dispatch/resume-eligibility.js`: no change — the CLI passes `named: false` under `--queue`, so `resolveBuildAuthority` answers `none` (`not-named`) for an ungranted record and the pure verdict refuses `not-granted` unchanged; this task's tests read the eligibility output end to end.

**Interfaces:**
- Produces: `--queue` boolean flag (no value). With it, `resolveBuildAuthority({ …, named: false })`; without it, `named: true` exactly as today.

- [ ] **Step 1: Write the failing tests** beside `#5584 AC10`:
  - `AC5.1: --queue refuses a record without auto:build even when the typed command would answer typed` — same fixture as `#5584 AC10: an ungranted ready record resumes on an accepted typed command`, plus `--queue`: exit 3, `reason: 'not-granted'`, and `readTypedCommand` never called.
  - `AC5.2: without --queue the typed behaviour is unchanged` — the existing AC10 case, unchanged, still exit 0 (keep it; add an assertion that no `--queue` is in argv).
  - `--queue with a granted record is eligible`; `--queue with a value (--queue x) exits 2`.
- [ ] **Step 2: Run to verify it fails** — `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js` — Expected: FAIL (`unknown argument: --queue`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify it passes** — same command, all pre-existing cases green.
- [ ] **Step 5: Commit** — `Add dispatch-resume --queue for queue-picked resumes — refs #5053`.

### Task 4: allow a headless first call on a sweep-originated resume

D7/Deliverable 7 require a sweep-originated resume in a headless firing to carry `DISPATCH_HEADLESS=1`; today both renderers refuse it (`plugin/bin/dispatch-prompt.js:159` "`--resume-verdict excludes --headless (a resume is human-typed)`", `plugin/bin/lib/dispatch/task-prompt.js:204` "`resume is human-typed: no DISPATCH_HEADLESS`"). The spec's Key Files miss both; this task is the mechanism behind Deliverable 7's sentence (behavioral-claim check).

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/dispatch/task-prompt.js` (step 3 first-call flags), `plugin/bin/dispatch-prompt.js` (drop the refusal; update the header comment line 21)
- Test: `tests/bin-lib/dispatch/task-prompt.test.js`, `tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`

**Interfaces:**
- Produces: with `headless` and `resume` both set, each first-call invocation line reads `" DISPATCH_HEADLESS=1 RESUME_PR=\"{prUrl}\" /claude-tweaks:flow"` (headless marker first), and the resume context is still appended.

- [ ] **Step 1: Tests** — in `task-prompt.test.js` replace `assert.throws(() => render({ headless: true, resume: VERDICT }), /resume/)` with a test `headless resume carries both prefixes on both first-call lines` asserting the exact substring count 2 and the resume-context line present; in `dispatch-prompt-cli.test.js` move `['first', base(runDir, ['--headless']), verdict]` out of `bad` into a positive case (exit 0, prompt contains `DISPATCH_HEADLESS=1 RESUME_PR="https://github.com/o/r/pull/9" /claude-tweaks:flow #4589`).
- [ ] **Step 2: Run to verify it fails** — `node --test tests/bin-lib/dispatch/task-prompt.test.js tests/bin-lib/dispatch/dispatch-prompt-cli.test.js` — Expected: FAIL (throws `resume is human-typed`).
- [ ] **Step 3: Implement** — `--headless` still refused on the second call and with several issues.
- [ ] **Step 4: Run to verify it passes**, plus `node --test tests/hooks-dispatch-prompt-gate.test.js tests/dispatch-prompt-cli-prose.test.js`.
- [ ] **Step 5: Commit** — `Let a sweep-originated resume render headless — refs #5053`.

### Task 5: `needs:answer` vocabulary and the `bot:blocked` explanation sweep

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/label-bootstrap.md` (new `needs:answer` row after `needs:decision`; `bot:blocked` description back to the retry ceiling only, e.g. `Bot state: retry ceiling hit — needs re-authorization`; `LABEL_BOOTSTRAP_VERSION` current value `11` → `12`)
- Modify: `plugin/skills/_shared/work-record.md` (label table `Definition (2)` → `Definition (3)` with `needs:answer`: stamped by `/build` plan review, removed by `plan-review-answer.js` or `dispatch resume`; the `| **Bot state** |` row drops the plan-review cause; the grant-revocation bullet near line 220 names `needs:answer` and `/claude-tweaks:dispatch resume #N` and no longer says plan review revokes grants; the Worklist rule names `needs:answer` and that the bare-drain sweep (`dispatch/answered-resumes.md`) resolves it only from a trusted human reply)
- Modify: `plugin/skills/_shared/work-record-permission-matrix.md` (`/build` / Executors row: adds `needs:answer` at plan review; `/dispatch` row: removes it (`plan-review-answer.js`, `dispatch resume`); a human may remove it; the Executors row drops `build/plan-review.md` as a `bot:blocked` writer)
- Each `bot:blocked` explainer below: drop the plan-review cause, add one clause pointing a plan-review question at `needs:answer`.
- Modify: `plugin/skills/tidy/step-1-records.md` (the `isBotBlocked(record)` paragraph and the `[blocked]` collect line)
- Modify: `plugin/skills/backlog/SKILL.md` (line 30 "A record hit its retry ceiling…")
- Modify: `plugin/skills/backlog/refine-mode.md` (lines ~241-242)
- Modify: `plugin/skills/backlog/refine-lanes.md` (lines ~67-68)
- Modify: `plugin/skills/_shared/github-pr-scan.md` (the `bot:blocked` bullet, line 147 — net zero bytes)
- Modify: `plugin/skills/_shared/github-pr-scan-triage.md` (the render line's Blocked clause)
- Modify: `plugin/skills/help/status-scan.md` (the Triage Queue `- Blocked:` line drops "or a plan-review question awaiting an answer")
- Modify: `plugin/skills/backlog/attention-mode.md` (the `| #{n} | bot:blocked |` row drops the plan-review clause)
- Modify: `docs/skill-graph.md` (line 122 `/backlog` row under `## build`: plan review now adds `needs:answer`, rendered by `/claude-tweaks:backlog attention`; line 719 `/dispatch` row: drop "plan-review question" as a `bot:blocked` cause)
- Test: `tests/plan-review-dispatch-relay-conformance.test.js` (rewrite `BLOCKED_CONSUMERS` and its test into `every bot:blocked explanation sends a plan-review question to needs:answer` — same files and heads, cause `needs:answer`; the label-description cap test keeps reading the `bot:blocked` row; the `/backlog` edge test now requires `/claude-tweaks:backlog attention` instead of `refine`), `tests/work-record-needs-decision-conformance.test.js` (version `>= 7` assertion still holds; add a `needs:answer` row/description/cap test there or in a new `tests/needs-answer-label-conformance.test.js` — description exact string, `ensureLabelPayload` passes, `Definition (3)` row contains `needs:answer`, permission matrix names `needs:answer` in the `/build` and `/dispatch` rows), `tests/bot-parked-label-conformance.test.js` (keep green)

Renumbering-completeness greps (all three forms) for the Definition family: `git grep -n -e 'Definition (2)' -e 'Definition (3)' -- plugin tests docs`, `git grep -n -e 'needs:definition`, `needs:decision`' -- plugin tests`, `git grep -n -i -e 'two needs' -e 'both needs:' -- plugin tests docs`. Moved-prose pin check: before editing each explainer, `git grep -n -F '{distinctive phrase}' -- tests plugin` for two phrases from it and re-point every hit.

Proof(public-contract): `needs:answer` lands in `LABELS_JSON` with `LABEL_BOOTSTRAP_VERSION` 11→12 so existing repos re-bootstrap, and `bot:blocked` keeps its retry-ceiling meaning for older builds (expand-contract, D10); pinned by the label and matrix tests below.

- [ ] **Step 1: Update the tests first** (new pins + rewritten `BLOCKED_CONSUMERS`; test `AC8.1: needs:answer is in label-bootstrap, the work-record label table and the permission matrix`); each pin is proven by mutating the live text in memory (remove `needs:answer` from the passage → assertion throws with its own message).
- [ ] **Step 2: Run to verify they fail** — `node --test tests/plan-review-dispatch-relay-conformance.test.js tests/work-record-needs-decision-conformance.test.js` (+ the new file) — Expected: FAIL on the missing `needs:answer` causes/rows.
- [ ] **Step 3: Edit the prose** listed above.
- [ ] **Step 4: Run** the Step 2 command plus `node --test tests/bot-parked-label-conformance.test.js tests/backlog-attention-rows.test.js tests/bin-lib/issues/labels.test.js` and every test file the pin greps found — Expected: PASS; `wc -c plugin/skills/_shared/github-pr-scan.md` ≤ 52,195.
- [ ] **Step 5: Commit** — `Add the needs:answer label and move plan-review stops off bot:blocked — refs #5053`.

### Task 6: plan review posts the label and the two answer options; Settle and relay follow

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/plan-review.md` — `### Spec gap — needs-human`: dispatched branch (line ~164) adds `needs:answer` (bootstrap per `_shared/label-bootstrap.md`, `gh issue edit {n} --add-label needs:answer`; MCP: `mergeLabelNames` read-merge-write per `_shared/github-write-transport.md`'s Full-replace hazard), headless or typed; question comment's closing instruction offers exactly two ways: reply with a comment whose first line starts `/answer` (the next bare `/claude-tweaks:dispatch` folds it into the body and resumes the build), or add a `**Decision**` paragraph to the body and run `/claude-tweaks:dispatch resume #{n}`; the `BLOCKED` reply carries the same two options. Headless paragraph (line ~166): no `bot:blocked`, no `auto:*` removal, keeps the `PushNotification`. Parallel-wave branch (line ~167): also adds `needs:answer` ("No label change" goes). Exit state (line ~168): Resume names the `/answer` reply + bare-drain sweep, or a body `**Decision**` + `/claude-tweaks:dispatch resume #{n}`; no re-grant; drop "the next dispatch re-materializes".
- Modify: `plugin/skills/dispatch/settle-and-merge.md` — `**Plan-review needs-human special case (#3377).**`: the build's exit posted the question and added `needs:answer` (any posture), kept `auto:*`, and under `DISPATCH_HEADLESS=1` sent the notification. All other anchors stay.
- Modify: `plugin/skills/dispatch/reporting.md` — the relay paragraph (line 27) closes with the two options (reply `/answer …` on the question comment, the next bare drain resumes it; or add a `**Decision**` paragraph and run `/claude-tweaks:dispatch resume #{n}`); drop "re-run `/claude-tweaks:dispatch #{n}`", the re-grant clause and the "re-pick … `bot:blocked`" sentence (a re-pick cannot happen: the kept draft PR holds it in the open-pr exclusion). The render-failure paragraph (line 33): "then re-run `/claude-tweaks:dispatch #{n}`" → "then run `/claude-tweaks:dispatch #{n}` again" (AC9's grep matches it today).
- Modify: `plugin/skills/_shared/auto-mode-contract.md` line 212's plan-review resume clause (re-grant → the two answer options).
- Test: `tests/plan-review-convergence-conformance.test.js` (`ANSWER_INSTRUCTION`, line 167 — the new instruction wording)
- Test: `tests/build-plan-review-conformance.test.js` (`GATE_ANCHORS` `bot:blocked` → `needs:answer`; the guarded-grant-removal anchor (line 136) becomes a go-red absence pin on the headless paragraph; new pins: dispatched and parallel-wave branches name `needs:answer`, the headless paragraph has no `bot:blocked` and no `remove whichever of`, the instruction names `/answer` and `/claude-tweaks:dispatch resume #{n}`), `tests/plan-review-hard-gate-conformance.test.js` (lines 31-40), `tests/plan-review-convergence-conformance.test.js` (`ANSWER_INSTRUCTION`, line 167), `tests/plan-review-dispatch-relay-conformance.test.js` (`SETTLE_ANCHORS`, `RELAY_ANCHORS`: `/claude-tweaks:dispatch #{n}` → `/claude-tweaks:dispatch resume #{n}`, add `/answer`, drop the three `bot:blocked`/re-pick anchors), `tests/dispatch-prompt-cli-prose.test.js:491` (render-failure remedy wording).

Each new AC6 pin goes red when reverted: assert with a frozen excerpt of the base text (`git show eaa89bea31:plugin/skills/build/plan-review.md`) that the pin fails on it.

- [ ] **Step 1: Write the failing tests** — tests `AC6.1: the dispatched and parallel-wave branches add needs:answer`, `AC6.2: the headless branch adds no bot:blocked and removes no auto:* label`, `AC6.3: the question instruction names the /answer reply and /claude-tweaks:dispatch resume #{n}`, `AC6.4: each AC6 pin goes red on the frozen base excerpt`.
- [ ] **Step 2: Run to verify they fail** — `node --test tests/build-plan-review-conformance.test.js tests/plan-review-hard-gate-conformance.test.js tests/plan-review-convergence-conformance.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/dispatch-prompt-cli-prose.test.js` — Expected: FAIL on the new pins.
- [ ] **Step 3: Edit the four prose files.**
- [ ] **Step 4: Run to verify they pass** — same command; `wc -c plugin/skills/dispatch/settle-and-merge.md` ≤ 52,500.
- [ ] **Step 5: Commit** — `Label plan-review stops needs:answer and name both answer paths — refs #5053`.

### Task 7: the bare-drain restart — Step 2.5, answered resumes, resume ingest

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/skills/dispatch/answered-resumes.md` — the Step 2.5 procedure: (1) `gh issue list --label needs:answer --state open --json number --limit {backlog-fetch-limit}` (probed 2026-11-26 with the label absent: prints `[]`, exit 0 — an empty list, not an error); (2) for each, `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-review-answer.js" --issue {n} --check` — exit 3 leave untouched, exit 2/4 print the stderr line and leave it, exit 0 keep with its `question` createdAt; (3) order the kept records by question createdAt, oldest first (D5); (4) while budget remains: `node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-resume.js" --issue {n} --queue`; refused → print its `line` (or `remedy` under `resume.md` Step 2's rule), spend nothing, write nothing; eligible → `plan-review-answer.js --issue {n}` (the ingest); its exit 0 → run `resume.md` Steps 3-8 for the record with Step 2's verdict, rendering the first call with `--headless` exactly when this firing is headless (`task-prompt.md`'s "Before rendering this template" decision), counting one `--budget` unit; a non-zero ingest exit prints its stderr and spends nothing. The remaining budget goes to Step 3. Why the check-verdict-ingest order: Review Focus 1. Never posts an `/answer` comment (D9).
- Modify: `plugin/skills/dispatch/SKILL.md` — add `### Step 2.5: Answered resumes (bare form only)` between Step 2 and Step 3: one short paragraph — bare drain only (never `#N`, `#N,#M,...`, `close-out`, `resume`), read `answered-resumes.md`, each eligible resume spends one `--budget` unit, the rest goes to Step 3. Net growth ≤ 0 within ~200 B headroom: cut an equal number of bytes of restatement in the same file (grep each cut phrase in `tests/` and `plugin/` first). The bare drain loop (line ~175) counts Step 2.5's resumes toward `{budget}`.
- Modify: `plugin/skills/dispatch/resume.md` — line 3: typed by a human, or run by the bare-drain sweep (`answered-resumes.md`) for an answered record; Step 2: before the verdict, `plan-review-answer.js --issue {N}`; its exit never blocks; exit 2 or 4 prints the stderr line as a concern; Step 7: before dispatching, remove `needs:answer` when still present (`gh issue view {N} --json labels`, then `gh issue edit {N} --remove-label needs:answer`) (D7); the "never pass `--headless`" clause gains the sweep exception.
- Modify: `plugin/skills/dispatch/task-prompt.md` — Resume paragraph (line 151): the one exception to "no call of a resume carries `DISPATCH_HEADLESS=1`" is a sweep-originated resume in a headless firing (`answered-resumes.md`).
- Modify: `plugin/skills/dispatch/open-pr-exclusion-report.md` — a named record carrying `needs:answer` renders `#{N} awaits a plan-review answer on its draft PR #{pr} — reply /answer on its question comment, or add a **Decision** paragraph to the body and run /claude-tweaks:dispatch resume #{N}` in place of the generic line (labels from the `#N` form's own fetch).
- Modify: `plugin/skills/dispatch/design-notes.md` — new `## Why the plan-review stop keeps the draft PR` section: resume reuses the PR number, its body markers and session links, and the pushed plan commits; the open-pr exclusion holds an unanswered record out of the queue without a second exclusion; the next build re-reviews from scratch by design (#4958's converged round).
- Test: create `tests/dispatch-answered-resumes-conformance.test.js`.

- [ ] **Step 1: Write the conformance test** (live prose, in-memory mutation controls, each control tripping its own assertion message):
  - `AC4.1: SKILL.md Step 2.5 runs only on the bare form` — the Step 2.5 section names the bare form and names each of `#N`, `close-out`, `resume` as not running it; sits between `### Step 2` and `### Step 3`.
  - `AC4.2: answered-resumes.md calls plan-review-answer.js before dispatch-resume.js --queue` — index of the first `plan-review-answer.js` < index of `dispatch-resume.js" --issue {n} --queue` < index of the ingest call without `--check` (Review Focus 1).
  - `AC4.3: only eligible resumes count against --budget` — the refused branch names "spend nothing"/"spends nothing"; the eligible branch names one `--budget` unit.
  - `AC10: no skill text instructs an agent to post an /answer comment` — no line in `plugin/skills/**` pairs `/answer` with `gh issue comment`/`add_issue_comment`/`post`.
  - `resume.md Step 2 ingests before the verdict and Step 7 removes needs:answer`; `task-prompt.md names the sweep exception`.
- [ ] **Step 2: Run to verify it fails** — `node --test tests/dispatch-answered-resumes-conformance.test.js` — Expected: FAIL (no `answered-resumes.md`).
- [ ] **Step 3: Write/edit the prose files above.**
- [ ] **Step 4: Run** — the Step 2 command plus `node --test tests/dispatch-resume-prose.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/no-dispatch-host-preflight-conformance.test.js tests/dispatch-prompt-cli-prose.test.js` and `node --test tests/bin-lib/skill-audit/` — Expected: PASS; `wc -c plugin/skills/dispatch/SKILL.md` ≤ 52,295.
- [ ] **Step 5: Commit** — `Resume answered plan-review records from a bare drain — refs #5053`.

### Task 8: attention row and help count

**Role:** integration

**Files:**
- Modify: `plugin/skills/backlog/attention-mode.md` — Step 2 merge fence: for a record whose `types` include `needs:answer`, read its comments (same `getComments`), `findQuestion` + `questionExcerpt` from `plan-review-answers.js` into `r.questionExcerpt` and the question URL into `r.questionUrl`; the stuck-rows loop skips a record whose existing entry carries `needs:answer` (no `stuck:open-pr` type, D8). Step 4 table: row `| #{n} | needs:answer | {createdAt, relative} | reply /answer … on {question url}, or add a **Decision** paragraph to the body and run /claude-tweaks:dispatch resume #{n} — question: {excerpt, wrapped per _shared/untrusted-record-content.md} |`; Batch launchers: `needs:answer` rows are never batched (paste block, one line per record); the `needs:*` catch-all bullet excludes it.
- Modify: `plugin/skills/_shared/github-pr-scan-triage.md` — item 4 **Awaiting a plan-review answer**: `gh issue list --label needs:answer --state open --json number --limit {resolved-limit} -q 'length'`; "items 1 and 2 are issue-backed" → "items 1, 2 and 4"; the render line gains `Awaiting answer: **{N}** records awaiting a plan-review answer`. Renumbering greps: `git grep -n -e 'three lines' -e 'Three cheap counts' -e 'three counts' -e 'items 1 and 2' -- plugin tests`.
- Modify: `plugin/skills/help/status-scan.md` — Triage Queue: add `- Awaiting answer: **{N} records awaiting a plan-review answer** — run /claude-tweaks:backlog attention (omit this line when N is 0)`; "all three counts are 0" → four.
- Waived `bin/stuck-open-prs.js`: no change — the dedupe lives in attention-mode's merge fence, which owns row merging (Gotcha 5's either/or).
- Test: `tests/backlog-attention-rows.test.js`; the help/triage pin in the same file or `tests/plan-review-dispatch-relay-conformance.test.js`.

- [ ] **Step 1: Tests** — extend `runMergeAndRank` fixtures with a record labelled `needs:answer` + `auto:build` carrying a trusted question comment (real #6118 shape) and also present in the stuck rows: `AC7.1: a needs:answer row carries the question excerpt and url` (`questionExcerpt === 'What happens when both worker-stop rules fire on the same pair of records?'`); `AC7.2: the same record has no stuck:open-pr type` (`types` deep-equals `['needs:answer']`); the existing `[7, 9, 10, 8]` order assertion updated for the new record; a control removing the skip turns AC7.2 red. Prose pins: the Step 4 row text and remedy; `AC7.3: help/status-scan.md carries the awaiting-answer line` and the triage item 4.
- [ ] **Step 2: Run to verify it fails** — `node --test tests/backlog-attention-rows.test.js` — Expected: FAIL.
- [ ] **Step 3: Edit the three prose files.**
- [ ] **Step 4: Run** — same plus `node --test tests/node-e-snippet-syntax.test.js tests/record-queue-fetch-conformance.test.js tests/plan-review-dispatch-relay-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Surface needs:answer records in attention and help — refs #5053`.

### Task 9: docs, journeys and the absence checks

**Role:** transcription

**Files:**
- Modify: `docs/plugin-structure.md` — the dispatch row of the per-skill sub-file table lists `answered-resumes.md` (one clause: the Step 2.5 bare-drain sweep); the `plugin/bin/lib/issues/` module list names `plan-review-answers.js`; the CLI list gains `node plugin/bin/plan-review-answer.js --issue <n> [--check]   # Plan-review answer ingest CLI (#5053) — …` beside `dispatch-resume.js` (whose line gains `[--queue]`).
- Modify: `docs/getting-started.md` (line 137's `/backlog` paragraph: a plan-review question is answered by a `/answer` reply or a body `**Decision**` + `dispatch resume`, never by re-authorizing)
- Modify: `docs/journeys/answer-a-plan-review-question-3377.md` (the headless `bot:blocked` bullet at line ~55 → `needs:answer` and the `/answer` reply; add an "Updated by #5053" line)
- Modify: `docs/journeys/review-backlog-attention-queue.md` (line ~54's `bot:blocked` cause → the `needs:answer` row)
- Modify: `docs/journeys/resume-a-stalled-dispatched-build-4588.md` (the sweep-originated resume)

- [ ] **Step 1: Edit.**
- [ ] **Step 2: AC9/AC10 absence checks, with their controls** — controls (must match on base): `git grep -n "re-run \`/claude-tweaks:dispatch #" eaa89bea31 -- plugin/skills` prints `dispatch/reporting.md:27` and `:33`; `git grep -n -i -e "re-grant" eaa89bea31 -- plugin/skills/build/plan-review.md` prints line 168. Then on HEAD: `git grep -n "re-run \`/claude-tweaks:dispatch #" -- plugin/skills` prints nothing (AC9.1); `git grep -n -i -e "re-grant" -e "re-grants" -- plugin/skills | grep -i "plan-review\|plan review"` prints nothing (AC9.2); `git grep -n -i "/answer" -- plugin/skills | grep -i -e "gh issue comment" -e "add_issue_comment"` prints nothing (AC10.1). Save the output to `$PIPELINE_RUN_DIR/evidence/ac9-ac10-absence.txt` and log one `AC evidence` entry via `log-decision.js --text-file`.
- [ ] **Step 3: Run** `node --test tests/plugin-structure*.test.js tests/journey*.test.js` (whichever exist) — Expected: PASS.
- [ ] **Step 4: Commit** — `Document plan-review answers in plugin-structure and journeys — refs #5053`.

Waived AC11.1: `npm test -- --full` is `/build` Common Step 5's and `/claude-tweaks:test`'s full-suite run, not a plan task.
