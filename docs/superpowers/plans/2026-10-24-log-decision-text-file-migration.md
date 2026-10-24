# Migrate git-text log-decision.js call sites to --text-file — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `log-decision.js` call site in `plugin/skills/**` whose entry text interpolates git- or user-supplied text passes that text through `--text-file "{text-file}"`, never a quoted `--text`, with one pin plus a go-red control per migrated site.

**Architecture:** Prose-only migration of skill markdown, mirroring #3671's two migrated sites (`flow/steps-and-gates.md`'s abort entry, `wrap-up/execution-and-verification.md`'s leave-open re-check). One new table-driven conformance suite pins every migrated site (pin + go-red per row) and a repo-wide sweep guard enforces AC1. Two existing pin tests that read the old wording are re-pointed.

**Tech Stack:** Markdown skill files; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-24T065422-record-3792/work/3792-spec.md` (record #3792)

## Global Constraints

- Canonical rule (cite, never restate): `_shared/auto-decision-log.md`'s "**Text from git or a user: `--text-file`.**" paragraph. Every migrated site names it by the phrase `Text from git or a user`.
- Migrated form, inline prose: `--text-file "{text-file}"` holding `{the exact former --text content}` per `_shared/auto-decision-log.md`'s Text from git or a user paragraph. In a ```bash fence: the fence line ends `--text-file "{text-file}"` and the prose right after the fence says `` `{text-file}` holds one line, `{former content}`, `` written per `_shared/auto-decision-log.md`'s Text from git or a user paragraph (the `flow/worktree-merge.md:156-159` shape).
- The former `--text` content is preserved byte-for-byte as the text-file content (the logged entry is identical — the rule says so).
- No migrated site keeps an escape instruction ("escape any …", `'\''`, "single-quoted").
- Every edited skill file stays under `RAIL_BYTES` = 52500 (`plugin/bin/lib/skill-audit/budgets.js`). Measured at base: largest target is `flow/steps-and-gates.md` 39238 B; each edit adds < 300 B. Re-check `wc -c` after editing.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #3792` (never closes/fixes), ending `Claude-Session: https://claude.ai/code/session_01TrbU7UWJwpgyJHG2ogYvBN`.
- Edit in place; do not reflow or reword surrounding prose.

## Site inventory

Listed by the record (10) plus the sweep the record's Deliverable 3 requires (8 more found at plan time). `content` is the exact text-file line (= the former `--text` argument); it is also the test anchor.

| id | file | content (text-file line) |
|---|---|---|
| W1 | `plugin/skills/flow/multispec-parallel-waves.md` (~36, fence) | `condition: preflight-records.js --waves exited non-zero ({stderr reason}) → fallback: sequential run.` |
| W2 | same (~59, fence in list item) | `#{N} merged; git worktree remove refused ({reason}); {worktreePath} and {worktreeBranch} left for manual cleanup.` |
| W3 | same (~63, fence in list item) | `#{N} conflicted at merge-back ({paths}); re-run sequentially.` |
| W4 | same (~142, fence) | `condition: per-spec worktree unavailable ({reason}) → fallback: sequential` |
| G1 | `plugin/skills/flow/steps-and-gates.md` (~62, first #3014 call, inline) | `the filled note line` — new wording: replace "the note as `--text`" with `` `--text-file "{text-file}"` holding the filled note line per `_shared/auto-decision-log.md`'s Text from git or a user paragraph, since the note names the integration branch `` |
| D1 | `plugin/skills/dispatch/two-call-gate.md` (~9, inline) | `Artifact check failed: {message}` |
| T1 | `plugin/skills/tidy/release-note-repair.md` (~86, inline) | `{ref}: {stderr reason} → not written` |
| P1 | `plugin/skills/_shared/pr-check-gate.md` (~64, inline) — sweep: `{names}`, `{baseBranch}` | `PR #{pr} checks red at {headRefOid short}, but every failing check ({names}) is also failing on {baseBranch} at {baseSha short} — inherited, passed with caveat` |
| P2 | same (~70) — sweep: `{pending names}` | `PR #{pr} checks {state} at {headRefOid short} ({pending names, or 'HEAD not yet pushed'}) — passed with caveat` |
| P3 | same (~76) | `condition: pr-checks.js {state}{: reason} → fallback: local verification only` |
| K1 | `plugin/skills/_shared/git-discipline.md` (~162, inline in list item 5) | `caught PR #{pr}'s branch up with origin/{integration-branch} before the next phase ({before short} → {after short}); re-pushed` |
| L1 | `plugin/skills/_shared/local-merge-auto-finish.md` (~217, fence) — sweep: branch names | `Merged {feature-branch} into {base-branch} (commit {sha}), pushed. [outcome: merged]` |
| L2 | same (~246, fence; single-quoted + `'\''` escape paragraph at ~250) — sweep | `Local merge into {base-branch} failed ({conflict|failed verification}) — reverted, worktree and branch preserved. [outcome: pending-review]` |
| A1 | `plugin/skills/wrap-up/auto-merge-short-circuit.md` (~103, fence) — sweep: `{detail}` carries an error message | `#{n} merge-check verdict not confirmed in decisions.md (latest: {latest}{detail}) — treated as needs-human, Review Console renders normally` |
| F1 | `plugin/skills/feedback/upstream-draft.md` (~78, fence) — sweep: user-supplied raw value | `Unresolved target: {the raw value}. Kept placeholder; no AskUserQuestion in {mode}.` |
| R1 | `plugin/skills/build/plan-review.md` (~86, inline) — sweep: gh error `{reason}` | `condition: plan-review record comment failed ({reason}) → fallback: the committed clarification section is the trail` |
| R2 | `plugin/skills/build/plan-audit.md` (~35, inline) — sweep: spec-supplied `{paths}` | `amended plan for {N} unlisted spec path(s) — listed {paths}; waived {paths}` |

Deliberately not migrated (sweep guard allowlist, Task 6): `dispatch/two-call-gate.md` stamp-read `({reason})` (closed enum from `checkFirstCallStamp`: `worktree-unrecorded|stamp-read-failed|stamp-absent|stamp-not-head|report-missing`); `tidy/actions-github-issues.md:116` `({reason})` (closed enum; its paragraph already forbids non-bare-word `verify.json` strings); `build/micro-plan.md:93` `{plan-path}` (agent-composed `docs/superpowers/plans/…` path); `build/plan-review.md:146` (an enumeration of literal conditions, not a substituted value). `dispatch/queue-pull-script.md:493` uses shell `${VAR}` inside a script — expansion is not re-evaluated, so it is safe and the guard skips `$`-prefixed braces.

## Review Focus

- A fence site whose `{text-file}` clause sits too far from the fence (> 400 collapsed chars) — the pin fails; keep the holding clause directly after the fence.
- Two adjacent sites in one file (W2/W3) sharing a `--step`: each row must pass and each go-red must throw independently — pinned by per-row go-red tests.
- A content literal wrapped across lines in markdown — the suite collapses whitespace (`/\s+/g → ' '`) before matching, so wrapping is fine but the literal's internal spacing must be single spaces.
- An existing pin reading the old wording (`tests/auto-merge-short-circuit-verdict-backstop.test.js:69`, `tests/local-merge-close-run-ordering.test.js:78`) — re-pointed in Task 4, not deleted.
- The sweep guard over-matching a non-git placeholder — allowlist only with a stated reason; never allowlist a site carrying a file name, path list, stderr/error text, branch name, or user value.

---

### Task 1: Conformance suite + flow sites (W1–W4, G1)

**Files:**
- Create: `tests/log-decision-text-file-sites-conformance.test.js`
- Modify: `plugin/skills/flow/multispec-parallel-waves.md`
- Modify: `plugin/skills/flow/steps-and-gates.md`

**Interfaces:**
- Produces (inside the test file, reused by Tasks 2–6): `const SITES = [{ id, file, content }]`; `collapse(text) -> string` (`text.replace(/\s+/g, ' ')`); `checkSite(text, site) -> void` (throws `Error` whose message contains `--text-file`); `revertSite(text, site) -> string`; one `test()` per row for the pin and one per row for the go-red, generated by `for (const site of SITES)`.

- [ ] **Step 1: Write the failing test** — `checkSite(text, site)` on `flat = collapse(text)`:
  - `idx = flat.indexOf(site.content)`; throw `` `${site.id}: content must appear exactly once (as the --text-file line)` `` when `idx < 0` or `flat.lastIndexOf(site.content) !== idx`.
  - `before = flat.slice(Math.max(0, idx - 400), idx)`; throw `` `${site.id}: no --text-file "{text-file}" before its text` `` unless `before.includes('--text-file "{text-file}"')`.
  - throw `` `${site.id}: text passed as a quoted --text, not --text-file` `` when `flat.includes('--text "' + site.content)` or `flat.includes("--text '" + site.content)`.
  - `win = flat.slice(Math.max(0, idx - 400), idx + site.content.length + 400)`; throw (message naming `--text-file` and the canonical paragraph) unless `win.includes('Text from git or a user')`; throw if `/escape any|'\\''|single-quoted/i.test(win)`.
  - `revertSite`: in `flat`, replace the last `--text-file "{text-file}"` occurring within the 400 chars before `idx` with `--text "${site.content}"`; assert the result differs.
  - Tests: `AC1.2/AC2.1/AC2.2/AC3.1 pin: {id} {file} reads its text from --text-file` → `checkSite(read(file), site)` does not throw; `AC3.1 go-red: {id} reverted to --text throws` → `assert.throws(() => checkSite(revertSite(read(file), site), site), /--text-file/)` (same `checkSite` as the pin — the Go-red control check).
  - Rows: W1–W4, G1 with `content` exactly as in the Site inventory.
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js`
  Expected: FAIL — `W1: no --text-file "{text-file}" before its text` (and W2–W4, G1).
- [ ] **Step 3: Migrate W1–W4 and G1** per Global Constraints' migrated form (fence shape for W1–W4: fence line keeps every other flag, ends `--text-file "{text-file}"`; one `{text-file}`-holds sentence directly after each fence, inside the same list item for W2/W3). G1: only the first #3014 call (the note log); the abort call is already migrated.
- [ ] **Step 4: Run tests to verify they pass**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js tests/flow-preflight-conformance.test.js tests/multispec-preflight-failure-conformance.test.js tests/flow-claim-preflight.test.js tests/multispec-ephemeral-server-record-conformance.test.js`
  Expected: PASS (all).
- [ ] **Step 5: Commit** — `git add` the three files; message `Migrate flow's git-text log-decision calls to --text-file — parallel-waves x4, adoption note (#3014)`.

### Task 2: dispatch + tidy sites (D1, T1)

**Files:**
- Modify: `tests/log-decision-text-file-sites-conformance.test.js` (append rows D1, T1)
- Modify: `plugin/skills/dispatch/two-call-gate.md`
- Modify: `plugin/skills/tidy/release-note-repair.md`

**Interfaces:** Consumes Task 1's `SITES`/`checkSite`/`revertSite`.

- [ ] **Step 1: Append rows D1, T1** (content from Site inventory).
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js`
  Expected: FAIL — `D1: no --text-file "{text-file}" before its text`, same for T1.
- [ ] **Step 3: Migrate D1** (`log-decision.js --status REFUSED --text-file "{text-file}"`, holding `Artifact check failed: {message}` per … — the `{message}` names paths and refs) **and T1** (inline, inside the existing parenthesised command).
- [ ] **Step 4: Run tests to verify they pass**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js tests/tidy-release-note-repair-conformance.test.js tests/tidy-release-note-shape.test.js tests/dispatch-mechanical-enforcement.test.js tests/dispatch-sequential-execution-conformance.test.js tests/dispatch-settle-and-merge-lazy-read.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** — `Migrate dispatch and tidy git-text log-decision calls to --text-file — artifact-check message, release-note stderr`.

### Task 3: shared PR-check and merge-state sites (P1, P2, P3, K1)

**Files:**
- Modify: `tests/log-decision-text-file-sites-conformance.test.js` (append P1–P3, K1)
- Modify: `plugin/skills/_shared/pr-check-gate.md`
- Modify: `plugin/skills/_shared/git-discipline.md`

**Interfaces:** Consumes Task 1's helpers.

- [ ] **Step 1: Append rows P1, P2, P3, K1.**
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js`
  Expected: FAIL — `P1: no --text-file "{text-file}" before its text` (P2, P3, K1 likewise).
- [ ] **Step 3: Migrate P1–P3** (each inline backticked command ends `--text-file "{text-file}"`, followed by the holding clause; one shared citation sentence is not enough — each site's 400-char window must contain `Text from git or a user`) **and K1** (list item 5's command).
- [ ] **Step 4: Run tests to verify they pass**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js tests/pr-check-gate-conformance.test.js tests/git-discipline-merge-state-conformance.test.js tests/git-path-read-conformance.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** — `Migrate PR-check gate and merge-state catch-up log calls to --text-file — check names, branch names, reasons`.

### Task 4: wrap-up merge sites (L1, L2, A1) + re-point their existing pins

**Files:**
- Modify: `tests/log-decision-text-file-sites-conformance.test.js` (append L1, L2, A1)
- Modify: `plugin/skills/_shared/local-merge-auto-finish.md`
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md`
- Modify: `tests/local-merge-close-run-ordering.test.js:78`
- Modify: `tests/auto-merge-short-circuit-verdict-backstop.test.js:69`

**Interfaces:** Consumes Task 1's helpers.

- [ ] **Step 1: Append rows L1, L2, A1.**
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js`
  Expected: FAIL — `L1: no --text-file "{text-file}" before its text` (L2, A1 likewise).
- [ ] **Step 3: Migrate L1, L2, A1** (fence shape). L2: delete the "The substituted reason can carry a filename or stderr text, so `--text` is single-quoted … `'\''`." sentence — the holding clause plus citation replaces it. In the re-protect paragraph change "carry it into the `--text` of the log call below" to "carry it into the log call's `{text-file}` below". Step 7's "`{conflict|failed verification}` replaced by …" wording stays.
- [ ] **Step 4: Re-point the two existing pins** — `local-merge-close-run-ordering.test.js` row `local-merge-auto-finish.md`: `logNeedle: "carry it into the log call's \`{text-file}\`"`. `auto-merge-short-circuit-verdict-backstop.test.js`: read `--step` from the fence (`/--step "([^"]+)" --reversibility n\/a --text-file "\{text-file\}"/`) and the text from the holding clause (`` /`(#\{n\} merge-check verdict not confirmed[^`]*)`/ ``); the rest of the test is unchanged.
- [ ] **Step 5: Run tests to verify they pass**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js tests/local-merge-auto-finish.test.js tests/auto-merge-short-circuit-dispatch-call.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/bin-lib/dispatch/merge-verdict.test.js`
  Expected: PASS.
- [ ] **Step 6: Commit** — `Migrate local-merge and auto-merge log calls to --text-file — branch names, park reason, verdict error`.

### Task 5: feedback + build sites (F1, R1, R2)

**Files:**
- Modify: `tests/log-decision-text-file-sites-conformance.test.js` (append F1, R1, R2)
- Modify: `plugin/skills/feedback/upstream-draft.md`
- Modify: `plugin/skills/build/plan-review.md`
- Modify: `plugin/skills/build/plan-audit.md`

**Interfaces:** Consumes Task 1's helpers.

- [ ] **Step 1: Append rows F1, R1, R2.**
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js`
  Expected: FAIL — `F1: no --text-file "{text-file}" before its text` (R1, R2 likewise).
- [ ] **Step 3: Migrate F1** (fence), **R1** (inline `--text-file "{text-file}"` holding …), **R2** (inline command ends `--text-file "{text-file}"`, holding clause after it).
- [ ] **Step 4: Run tests to verify they pass**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js tests/feedback-upstream-draft-conformance.test.js tests/build-plan-review-conformance.test.js tests/plan-review-hard-gate-conformance.test.js tests/plan-audit-check-f-prose.test.js tests/plan-audit-check-e-prose.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit** — `Migrate feedback and build log calls to --text-file — raw target, comment error, spec paths`.

### Task 6: Repo-wide sweep guard (AC1) + headroom check

**Files:**
- Modify: `tests/log-decision-text-file-sites-conformance.test.js`

**Interfaces:**
- Produces: `scanQuotedGitText(text) -> Array<{arg, placeholder}>` — on `collapse(text)`, every `--text "…"`/`--text '…'` argument (`/--text (["'])([^"']*)\1/g`); inside each, every `{name}` not preceded by `$` whose `name` matches `GIT_TEXT = /reason|paths?\b|path|message|branch|names|file|error|detail|raw|stderr|output|note/i`. `ALLOW = [{ file, fragment, why }]` — the four entries named in the Site inventory's "Deliberately not migrated" paragraph, `fragment` a substring of the offending `arg`.

- [ ] **Step 1: Write the failing tests**
  - `AC1.1: no skill passes git- or user-supplied text in a quoted --text` — walk `plugin/skills/**/*.md`, collect `scanQuotedGitText` hits not matched by an `ALLOW` entry for that file; `assert.deepStrictEqual(hits, [])`.
  - `go-red: scanQuotedGitText flags a reverted site` — `scanQuotedGitText('--text "#{N} conflicted at merge-back ({paths}); re-run sequentially."')` has length 1; `scanQuotedGitText('--text "dispatch: #${NUM} excluded"')` is empty; `scanQuotedGitText('--text-file "{text-file}"')` is empty.
  - `every ALLOW entry still matches a live hit` — each entry's `fragment` occurs in a hit of its file (no stale allowlist).
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js`
  Expected: FAIL — `scanQuotedGitText is not defined`.
- [ ] **Step 3: Implement `scanQuotedGitText` and `ALLOW`.** Any further hit is classified: git/user text → migrate it in this task with its own `SITES` row; otherwise add an `ALLOW` entry with a one-line `why`.
- [ ] **Step 4: Run tests and the record's grep**
  Run: `node --test tests/log-decision-text-file-sites-conformance.test.js`
  Expected: PASS.
  Run: `grep -rn -- '--text "' plugin/skills`
  Expected: no listed/sweep site from the Site inventory remains.
  Run: `wc -c plugin/skills/flow/multispec-parallel-waves.md plugin/skills/flow/steps-and-gates.md plugin/skills/dispatch/two-call-gate.md plugin/skills/tidy/release-note-repair.md plugin/skills/_shared/pr-check-gate.md plugin/skills/_shared/git-discipline.md plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/feedback/upstream-draft.md plugin/skills/build/plan-review.md plugin/skills/build/plan-audit.md`
  Expected: every file < 52500.
- [ ] **Step 5: Commit** — `Guard skill log-decision calls against git text in a quoted --text — repo-wide sweep with allowlist`.

Final verification (Common Step 5, not a task): `npm test` via the verification runner.

Waived AC4.1: `npm test` passing is proven by `/build` Common Step 5's runner verification and `/test`'s gate, not by a plan test step.

Prose-pin grep run at plan time (`git grep -n -F -e "substituted reason can carry" -e "the note as" -e "carry it into the" -- tests plugin`): the only test hit is `tests/local-merge-close-run-ordering.test.js:78`, re-pointed in Task 4; the former `--text` contents are kept verbatim, and a `tests/` grep for each content literal found only `tests/bin-lib/dispatch/merge-verdict.test.js:63` (a decisions.md line fixture — unaffected, the logged entry is identical) and the `auto-merge-short-circuit-verdict-backstop.test.js:69` regex (Task 4).

## Build deviations (Common Step 4.5, classified Beneficial)

- **One table-driven suite instead of per-neighbour go-reds.** The spec's Deliverable 2 named "a go-red control for each migrated site in the neighbouring pin test"; the build pins every site (23 `SITES` rows across 16 skill files after the final-review fix wave and residual fix) in `tests/log-decision-text-file-sites-conformance.test.js`, each pin and go-red through one shared `checkSite`, and re-points the neighbouring pins that read the old wording (`local-merge-close-run-ordering`, `auto-merge-short-circuit-verdict-backstop`, `plan-authoring-ac-evidence-prose`). One assertion function for every site keeps the go-reds uniform and makes a new site a one-row addition.
- **Repo-wide sweep guard added.** AC1 is a repo-wide claim; `scanQuotedGitText` + `GIT_TEXT` + a placeholder-keyed `ALLOW` (each entry with a stated `why`, plus a staleness test) enforce it mechanically, so a future quoted `--text` carrying git/user text fails CI instead of relying on the Deliverable 3 grep.
- **Site count.** The plan's inventory listed 17 rows. The final review and residual fix added degraded-stderr SKIP sites (`dispatch/two-call-gate.md`, `dispatch/task-prompt.md`, `flow/claim-targets.md`), `_shared/pr-early-run-lifecycle.md`'s deferred-closure line, `build/plan-authoring-checks.md`'s AC-evidence check, and `backlog/refine-record.md`'s free-text override choices.
