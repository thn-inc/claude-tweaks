# Comment-Trust Filter for Marker Readers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every plugin reader that selects a GitHub comment by a plugin marker or heading counts it only when GitHub reports its author association as `OWNER`, `MEMBER`, or `COLLABORATOR`, and says in one line when it skips one.

**Architecture:** One new module, `plugin/bin/lib/issues/comment-trust.js`, owns the trusted set, the predicate, the skip-note text and the jq fragments derived from the set. Code readers call it; skill-prose readers use its jq fragments, stated once in a new "Trusted authors" section of `_shared/pr-run-comments.md` that every other prose reader cites. A twin-pin conformance test keeps the prose list and jq equal to the module.

**Tech Stack:** Node 18+ CommonJS, `node:test`, `gh` CLI JSON (`authorAssociation`), GitHub REST/MCP JSON (`author_association`).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T101500-spec-3358/work/3358-spec.md` (record #3358)

## Global Constraints

- Trusted set, exactly: `OWNER`, `MEMBER`, `COLLABORATOR` — in that order wherever it is listed.
- Fail closed: a comment with neither `authorAssociation` nor `author_association` is untrusted.
- No viewer lookup (`viewerDidAuthor`), no per-transport identity.
- An untrusted marker comment takes the same path as "no such comment" (create fresh, fall back, or fail the check) — never the trusted path.
- Skip-note text, exactly: `skipped marker comment {ref} by {login} ({association}) — not an owner, member, or collaborator` — `{ref}` = comment `url` (gh) / `html_url` (REST) / `id` fallback; `{login}` = `author.login` (gh) / `user.login` (REST) / `unknown`; `{association}` = the value, or `no association` when missing.
- `extractPendingGrantedAt`'s signature (`string[]` of bodies) does not change; callers filter comments by trust before mapping to bodies.
- Commit messages: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01WAdRESCtu3dAuFiELF5yP4`.
- Byte ceilings (Byte-pin check, measured on this branch): `specify/shaping-mode-stamping.md` 22,664 B vs the 28,672 B specify sub-file ceiling (`tests/bin-lib/skill-audit/context-cost.test.js` `SPECIFY_SUBFILE_CEILING_BYTES`); `_shared/work-record.md` 36,895 B — its own text asks to stay under 40 KB; every other edited `.md` is under 43 KB against the shared 51,200 B ceiling. No edit here adds more than ~1.5 KB to any one file.

## Review Focus

1. A legitimate run comment fetched through a path that drops `authorAssociation` (a narrowed `--json` field list, a `-q '.comments[].body'` projection) is now silently untrusted → the brief check or maturation reads "absent". Every reader touched here must fetch full comment objects; Task 2/3/5 tests use fixtures carrying the field, and Task 5 replaces the two `issue.comments[].body` projections.
2. A comment whose marker is valid but whose association is `CONTRIBUTOR` (a bot such as `github-actions[bot]`) must be skipped, not trusted — covered by Task 1's table.
3. A trusted and an untrusted marker comment of the same kind on one PR/issue: the trusted one must win regardless of order (the untrusted one first in the array). Covered in Task 2 and Task 3 tests.
4. The MCP/REST shape (`author_association`, `user.login`, `html_url`) must be read exactly like the gh shape — covered by Task 1's both-spellings cases and the skip-note ref/login fallbacks.
5. A planted, backdated `grant-mode-audit … auto-merge=pending` marker must not mature a pending grant whose real marker is missing — covered by Task 3's `fetchIssueGrant`/`ghReadGrants` tests.

## Marker-reader inventory (controller: copy into PR #3385's description before merge — AC6.1)

Repo-wide greps used: `git grep -n -E "(startsWith|includes|startswith|contains|test)\(.{0,6}(<!-- |## Verification Brief|Verification Brief posted)" -- plugin`, `git grep -n -E "needs-decision: |run-comment: failure|console-item: executed|grant-mode-audit|agent-claim" -- plugin`.

| Reader | Disposition |
|---|---|
| `_shared/pr-run-comments.md` Find step + MCP `Supersedes` lookup | filtered (Task 4) |
| `bin/lib/wrap-up/engine-verify.js` issue brief, pointer, PR `brief` | filtered (Task 2) |
| `demo/entry-paths.md` issue brief heading, pointer, PR run-comment lookup | filtered (Task 5) |
| `wrap-up/verification-brief-parent-gate.md` already-posted check | filtered (Task 5) |
| `bin/lib/reconcile/console-execute.js` `console-item: executed` reply find | filtered (Task 3) |
| `console-execute.js` `fetchIssueGrant`, `bin/console-resolve.js` `ghReadGrants`, `dispatch/grant-maturation-gate.md`, `wrap-up/auto-merge-short-circuit.md` (pending-grant marker) | filtered (Tasks 3, 5) |
| `bin/lib/release-note-repair/detect.js` `hasPendingTidyDecision` | filtered (Task 3) |
| `_shared/work-record.md` Resolution rule; `backlog/grant-lane-decision.md`, `specify/shaping-mode-stamping.md`, `backlog/attention-mode.md`, `backlog/refine-record.md`, `tidy/step-1-records.md`, `tidy/decision-markers.md` (needs-decision) | filtered (Task 6) |
| `tidy/scan-procedures.md` failure-tombstone check | filtered (Task 4) |
| `bin/lib/flow/pr-body.js` PR-body markers | exempt — the PR body is editable only by its author and write-access users |
| `console-execute.js` console comments themselves | exempt — selected by the ids recorded in `console.json`, never by marker |
| `bin/lib/issues/retry.js` attempt count / negative evidence | exempt — a planted marker only lowers autonomy; dropping a legitimate one would undercount failures, the unsafe direction |
| `bin/lib/issues/fleet-counters.js`, `grant-sampling.js`, `backlog/refine-headless.md` daily-cap count | exempt — reporting/sampling/cap counts; a planted marker only tightens the cap or flags a sample |
| `bin/lib/issues/claims.js` `agent-claim` comments | exempt — write-only; claims are read from the `claims-registry` blob |
| `bin/lib/issue-branch-tracking.js` workflow-template idempotency grep | exempt — a planted marker only suppresses one branch-link comment |

---

### Task 1: The shared trust module

**Files:**
- Create: `plugin/bin/lib/issues/comment-trust.js`
- Modify: `plugin/bin/materialize.js:103` (delete the local `TRUSTED_AUTHOR_ASSOCIATIONS`, import it)
- Modify: `plugin/skills/flow/materialize.md` (Author-association gate paragraph: cite `bin/lib/issues/comment-trust.js` as the set's home)
- Test: `tests/bin-lib/issues/comment-trust.test.js`

**Interfaces:**
- Produces:
  - `TRUSTED_AUTHOR_ASSOCIATIONS: Set<string>` — `new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])`
  - `commentAssociation(comment: object|null) -> string|null` — `authorAssociation` else `author_association` else `null`
  - `isTrustedComment(comment: object|null) -> boolean`
  - `untrustedSkipNote(comment: object) -> string` — exact Global Constraints text
  - `trustedJqSelect() -> string` — `select(.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR")`, built from the set in its order
  - `untrustedJqNote() -> string` — `select((.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR") | not) | "skipped marker comment \(.url) by \(.author.login) (\(.authorAssociation // "no association")) — not an owner, member, or collaborator"`

- [ ] **Step 1: Write the failing tests** — `tests/bin-lib/issues/comment-trust.test.js`:
  - `AC1.1: exports the trusted set and isTrustedComment` — `deepEqual([...TRUSTED_AUTHOR_ASSOCIATIONS], ['OWNER','MEMBER','COLLABORATOR'])`, `typeof isTrustedComment === 'function'`.
  - `AC1.2: trusted associations, both field spellings` — for each of `OWNER`/`MEMBER`/`COLLABORATOR`: `isTrustedComment({ authorAssociation: v }) === true` and `isTrustedComment({ author_association: v }) === true`.
  - `AC1.2: untrusted associations and missing field` — `CONTRIBUTOR`, `NONE`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `MANNEQUIN` → false (both spellings); `{}`, `null`, `{ authorAssociation: '' }`, `{ authorAssociation: 'member' }` → false.
  - `untrustedSkipNote formats gh and REST shapes` — `{ url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' }` → `'skipped marker comment https://x/c1 by eve (NONE) — not an owner, member, or collaborator'`; `{ html_url: 'https://x/c2', user: { login: 'bot[bot]' }, author_association: 'CONTRIBUTOR' }` → `'… https://x/c2 by bot[bot] (CONTRIBUTOR) …'`; `{ id: 'IC_1' }` → `'skipped marker comment IC_1 by unknown (no association) — not an owner, member, or collaborator'`.
  - `trustedJqSelect/untrustedJqNote are derived from the set` — exact strings from the Interfaces block.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/comment-trust.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/issues/comment-trust'`
- [ ] **Step 3: Implement** the module (header comment naming #3358 and the fail-closed rule, matching `grant-maturation.js`'s comment density); in `materialize.js` replace line 103 with `const { TRUSTED_AUTHOR_ASSOCIATIONS } = require('./lib/issues/comment-trust');` and leave the gate's lookup (issue `author_association` via REST) unchanged; in `flow/materialize.md`'s Author-association gate paragraph add "(the set lives in `bin/lib/issues/comment-trust.js`, shared with every marker-comment reader — `_shared/pr-run-comments.md`'s Trusted authors)".
- [ ] **Step 4: Run to verify it passes** — Run: `node --test tests/bin-lib/issues/comment-trust.test.js tests/materialize-premise-check.test.js` — Expected: PASS, 0 fail (`AC1.3`: materialize keeps its behavior; `git grep -n "new Set(\['OWNER'" -- plugin/bin` prints only `comment-trust.js`).
- [ ] **Step 5: Real-input probe** — Run (one command): `node -e "const t=require('./plugin/bin/lib/issues/comment-trust');const c=JSON.parse(require('child_process').execFileSync('gh',['pr','view','3359','--json','comments'],{encoding:'utf8'})).comments;console.log(c.length,c.filter(t.isTrustedComment).length)"` — Expected: `1 1` (recorded at authoring: PR #3359 carries one `<!-- run-comment: verdict -->` comment, `MEMBER`). Independent count: `gh pr view 3359 --json comments --jq '[.comments[] | select(.authorAssociation=="MEMBER")] | length'` → `1`. Paste both outputs into the task report.
- [ ] **Step 6: Commit** — `git add plugin/bin/lib/issues/comment-trust.js plugin/bin/materialize.js plugin/skills/flow/materialize.md tests/bin-lib/issues/comment-trust.test.js` then `git commit -m "Add comment-trust module — one trusted-association rule for marker readers" -m "Claude-Session: …"`.

### Task 2: engine-verify acceptance-labeling check

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:747-780`
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js` (new cases + add `authorAssociation: 'MEMBER'` to every existing brief/pointer fixture at lines 1294, 1384, 1402, 1424, 1444, 1449, 1470, 1899 — Dependency-caller check: these are the only fixtures in `tests/` reaching this check, per `git grep -n "### Confirmed\|Verification Brief posted" -- tests`)

**Interfaces:**
- Consumes: `isTrustedComment`, `untrustedSkipNote` (Task 1).
- Produces: the `acceptance-labeling` row's `detail` gains `; ignored: {note}[; {note}…]` for every untrusted brief/pointer/PR-brief comment the check passed over — on a fail row appended after the existing reason, on a pass row as the whole detail.

- [ ] **Step 1: Write the failing tests** (reuse the existing `writeSpecFile`/`fakeOriginGit`/`isGraphqlCall` helpers of the neighboring pointer tests):
  - `AC2.1: an issue brief authored NONE fails acceptance-labeling and names the ignored comment` — issue comments `[{ body: '## Verification Brief\n### Confirmed\n', url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' }]`, no `run-state.json` pr → `row.result === 'fail'`, `row.detail` matches `/ignored: skipped marker comment https:\/\/x\/c1 by eve \(NONE\)/`.
  - `AC2.1: an untrusted pointer is not followed` — pr-first run-state, issue comments = one NONE pointer → `fail`, detail names the pointer comment; the fake `gh pr view` is never called (assert via a call log).
  - `AC2.1: an untrusted PR brief does not satisfy a trusted pointer` — trusted (`MEMBER`) pointer, PR comments = one NONE `<!-- run-comment: brief -->…### Confirmed` → `fail`, detail names the PR comment.
  - `AC2.2: the same comments authored MEMBER pass` — each of the three cases above with `MEMBER` → `pass`.
  - `a trusted brief after an untrusted one passes and still names the skipped one` — issue comments `[NONE brief, MEMBER brief]` → `pass`, `detail` matches `/ignored: skipped marker comment/`.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL after Step 1 (new AC2.1 cases report `pass`)
- [ ] **Step 3: Implement** — at each of the three `comments.some(...)` sites, test the marker first, then partition matches by `isTrustedComment`; only trusted matches count; collect `untrustedSkipNote` for the rest into a per-target `ignored` array and append it to that target's failing line, or (target passes) to a `notes` list joined into the pass row's detail.
- [ ] **Step 4: Run to verify it passes** — Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js` — Expected: PASS, 0 fail.
- [ ] **Step 5: Commit** — `git add plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/engine-verify.test.js`; `git commit -m "Trust only owner/member/collaborator briefs in engine-verify — skip planted marker comments"`.

### Task 3: console-execute, console-resolve and release-note-repair readers

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js:166-175` (`fetchIssueGrant`) and `:477-487` (executed-reply find)
- Modify: `plugin/bin/console-resolve.js:73-83` (`ghReadGrants`)
- Modify: `plugin/bin/lib/release-note-repair/detect.js:81-96`
- Test: `tests/resolve-console.test.js` (new case; the existing `IC_existing_reply` fixture at line 265 gains `authorAssociation: 'MEMBER'`), `tests/bin-lib/console/cli.test.js` (fixture at line 80 gains `authorAssociation: 'MEMBER'`; new case), `tests/bin-lib/release-note-repair/detect.test.js` (fixtures at line 88-89 gain `authorAssociation: 'MEMBER'`; new case), plus a `fetchIssueGrant` case wherever `console-execute`'s grant read is exercised (`git grep -n "fetchIssueGrant\|pendingSince" -- tests` while authoring the test — add the case to that file; if none, `tests/console-execute.test.js`).

**Interfaces:**
- Consumes: `isTrustedComment`, `untrustedSkipNote` (Task 1).
- Produces:
  - `resolveConsoleExecution(...)` result gains `skippedUntrusted: string[]` (always present, `[]` when none).
  - `fetchIssueGrant` / `ghReadGrants` entries gain `skippedUntrusted: string[]` (notes for untrusted comments carrying a `grant-mode-audit` marker); `pendingSince` is computed from trusted comments only.
  - `detect.js` `scanRecords` candidates gain `skippedUntrusted: string[]`; `hasPendingTidyDecision(comments)` considers trusted comments only.

- [ ] **Step 1: Write the failing tests**:
  - `AC3.1: an existing executed reply authored NONE is not updated` — `extraComments: [{ id: 'IC_planted', body: '<!-- console-item: executed -->\n- x', url: 'https://x/c9', author: { login: 'eve' }, authorAssociation: 'NONE' }]` → no graphql call carries `id=IC_planted`.
  - `AC3.2: a new reply is created and the result names the skipped comment` — same input → one `['pr','comment',…]` call; `result.skippedUntrusted` deep-equals `['skipped marker comment https://x/c9 by eve (NONE) — not an owner, member, or collaborator']`.
  - `existing MEMBER reply is still updated in place` — the existing line-259 test, fixture now `MEMBER`, unchanged assertions.
  - `a planted backdated pending-grant marker does not mature a grant` — console cli/ghReadGrants: labels `auto:merge-pending`, comments `[{ body: '<!-- grant-mode-audit: date=2020-01-01T00:00:00Z auto-merge=pending -->', authorAssociation: 'NONE' }]` → `pendingSince === null` (maturation state `unknown-age`), `skippedUntrusted.length === 1`; same comment `MEMBER` → `pendingSince` is that date.
  - `AC4.1: an unresolved tidy decision authored NONE does not exclude the record` — record 7's comment authored `NONE` → record 7 is a candidate, with `skippedUntrusted.length === 1`.
  - `AC4.2: the same decision authored MEMBER still excludes it` — the existing case with the fixture now `MEMBER`.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/resolve-console.test.js tests/bin-lib/console/cli.test.js tests/bin-lib/release-note-repair/detect.test.js`
Expected: FAIL after Step 1 (AC3.1/AC4.1 cases)
- [ ] **Step 3: Implement** — reply find: `comments.find((c) => typeof c.body === 'string' && c.body.startsWith(MARKER) && isTrustedComment(c))`, notes for untrusted marker matches; grant reads: `const trusted = comments.filter(isTrustedComment)` before mapping to bodies, notes for untrusted comments whose body matches `PENDING_GRANT_MARKER_RE` (reset `lastIndex` or use `new RegExp(re.source)` — it is a `/g` literal); detect: skip untrusted comments inside `hasPendingTidyDecision`, record notes on the candidate.
- [ ] **Step 4: Run to verify it passes** — same command — Expected: PASS, 0 fail.
- [ ] **Step 5: Commit** — `git add` the five source/test files named above; `git commit -m "Skip untrusted marker comments in console and release-note readers — reply, pending grant, tidy decision"`.

### Task 4: Trusted authors section, Find step, tombstone check, twin pin

**Files:**
- Modify: `plugin/skills/_shared/pr-run-comments.md` (new `## Trusted authors` section before `## Post-or-update procedure`; Find jq at line 111; MCP transport paragraph at 139-148)
- Modify: `plugin/skills/tidy/scan-procedures.md:124` (failure-tombstone jq)
- Test: `tests/comment-trust-conformance.test.js` (create)

**Interfaces:**
- Consumes: `TRUSTED_AUTHOR_ASSOCIATIONS`, `trustedJqSelect()`, `untrustedJqNote()` (Task 1).
- Produces: the prose anchor every later task cites — the literal heading `## Trusted authors` in `_shared/pr-run-comments.md`, citable as "`_shared/pr-run-comments.md`'s Trusted authors".

The section's content (implementer writes the prose; these facts are fixed): a marker or heading comment counts only when its author association is `OWNER`, `MEMBER`, or `COLLABORATOR` (that list, in that order, in backticks); `gh` returns it as `authorAssociation`, REST/MCP as `author_association`; a missing field is untrusted; no viewer lookup — anyone with write access can already push to the PR branch, so a narrower rule adds no protection, while a viewer match rejects comments read by a different maintainer or account; bots (`CONTRIBUTOR`) are excluded on purpose; the jq select, verbatim `trustedJqSelect()`; the skip-notice jq, verbatim `untrustedJqNote()`, run alongside the select so each skipped comment is named in one line in the reader's output; code readers use `bin/lib/issues/comment-trust.js`.

- [ ] **Step 1: Write the failing test** — `tests/comment-trust-conformance.test.js`:
  - `AC5.1: the Find-step jq tests the association` — `pr-run-comments.md` contains `select(.body | startswith("<!-- run-comment: {kind} -->")) | ${trustedJqSelect()} | .id`.
  - `AC5.3: the Trusted authors section lists exactly the module's set, in order` — extract the section between `## Trusted authors` and the next `## `; collect backticked tokens matching `/^[A-Z_]+$/`; `deepEqual` to `[...TRUSTED_AUTHOR_ASSOCIATIONS]` after de-dup in first-seen order, and `CONTRIBUTOR` appears only in an "excluded" sentence (assert the section includes `untrustedJqNote()` and `trustedJqSelect()` verbatim).
  - `AC5.2: the MCP transport paragraph filters the Supersedes lookup` — the `**MCP transport` paragraph mentions `author_association` and cites `Trusted authors`.
  - `tidy's tombstone check filters by association` — `scan-procedures.md` line containing `run-comment: failure` contains `trustedJqSelect()` with `|` escaped as `\|` (it lives in a table cell).
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/comment-trust-conformance.test.js`
Expected: FAIL (no `## Trusted authors` heading)
- [ ] **Step 3: Implement** the section and the three edits. Keep `gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments` byte-identical (pinned by `tests/pr-run-comments.test.js:46,57`). Degrade-clause convention: the MCP sentence cites `_shared/github-write-transport.md`'s MCP path as the paragraph already does — no new transport clause.
- [ ] **Step 4: Run to verify it passes** — Run: `node --test tests/comment-trust-conformance.test.js tests/pr-run-comments.test.js` — Expected: PASS, 0 fail.
- [ ] **Step 5: Commit** — `git add plugin/skills/_shared/pr-run-comments.md plugin/skills/tidy/scan-procedures.md tests/comment-trust-conformance.test.js`; `git commit -m "State the trusted-authors rule once in pr-run-comments — Find step and tombstone check filter on it"`.

### Task 5: Demo, parent-gate and grant-maturation prose readers

**Files:**
- Modify: `plugin/skills/demo/entry-paths.md:56-64` (issue brief heading), `:66-72` (pointer), `:208-222` (PR run-comment lookup step 2)
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md:315-329` (already-posted check)
- Modify: `plugin/skills/dispatch/grant-maturation-gate.md:31-35`, `plugin/skills/wrap-up/auto-merge-short-circuit.md:25-29` (inline `node -e` snippets)
- Test: `tests/comment-trust-conformance.test.js` (append)

**Interfaces:**
- Consumes: the `## Trusted authors` anchor (Task 4); `isTrustedComment`, `untrustedSkipNote` (Task 1) for the two `node -e` snippets.

- [ ] **Step 1: Write the failing tests** (append):
  - `AC5.2: demo's three lookups cite Trusted authors and the skip notice` — in `entry-paths.md`, each of the three passages (located by the anchors `comment **containing** \`## Verification Brief\``, `posted to PR #{pr-number}: {pr-url}\`. When no issue comment`, `2. **Read its comments by marker**`) contains `Trusted authors` within the same paragraph/list item, and the file contains `skipped marker comment` or `skip notice` at least once per passage — assert per passage on the paragraph text.
  - `AC5.2: the parent-gate already-posted check counts only trusted briefs` — the paragraph starting `**Then check whether a brief is already posted` contains `Trusted authors`.
  - `grant maturation snippets filter comments by trust before extracting the grant date` — both snippets contain `require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/comment-trust.js')`, `.filter(isTrustedComment)`, and no longer contain `issue.comments[].body`.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/comment-trust-conformance.test.js`
Expected: FAIL (new cases)

- [ ] **Step 3: Implement** — prose: each lookup says it counts only comments from trusted authors (`_shared/pr-run-comments.md`'s Trusted authors) and names each skipped marker comment in one line above the verdict, the same line shape as step 3's "Fail open, visibly"; an untrusted brief/pointer/try-it falls through exactly as "no matching comment" does. Snippets: change the `comments:` comment to "this member's fetched comment objects (issue.comments)" and compute `extractPendingGrantedAt(comments.filter(isTrustedComment).map((c) => c.body))`, logging `untrustedSkipNote` for skipped comments to stderr.
- [ ] **Step 4: Run to verify it passes** — Run: `node --test tests/comment-trust-conformance.test.js tests/demo-full-verification-pointer.test.js tests/try-it-contract-conformance.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js` — Expected: PASS, 0 fail.
- [ ] **Step 5: Commit** — `git add` the four skill files and the test; `git commit -m "Filter demo, parent-gate and grant-maturation marker reads by trusted author — cite Trusted authors"`.

### Task 6: needs-decision readers

**Files:**
- Modify: `plugin/skills/_shared/work-record.md:157-163` (Resolution rule: one added sentence)
- Modify: `plugin/skills/backlog/grant-lane-decision.md:37`, `plugin/skills/specify/shaping-mode-stamping.md:105` (jq: insert `trustedJqSelect()` after the `contains(...)` select)
- Modify: `plugin/skills/backlog/attention-mode.md:173-176` (inline JS filter: `&& isTrustedComment(c)`, with the `require` added to that script)
- Modify: `plugin/skills/backlog/refine-record.md:50-52`, `plugin/skills/tidy/step-1-records.md:62-66`, `plugin/skills/tidy/decision-markers.md:74` (prose: "from a trusted author")
- Test: `tests/comment-trust-conformance.test.js` (append)

**Interfaces:**
- Consumes: the `## Trusted authors` anchor (Task 4); `trustedJqSelect()`, `isTrustedComment` (Task 1).

- [ ] **Step 1: Write the failing tests** (append):
  - `AC5.2: the needs-decision Resolution rule names trusted authors` — `work-record.md`'s `**Resolution rule.**` paragraph contains `Trusted authors`.
  - `AC5.2: both needs-decision jq lookups filter by association` — `grant-lane-decision.md` and `shaping-mode-stamping.md` each contain `| ${trustedJqSelect()} |` on the line carrying `needs-decision`.
  - `attention-mode's proposal read skips untrusted decision comments` — the script contains `isTrustedComment(c)` and requires `comment-trust.js`.
  - `refine-record, tidy step-1 and decision-markers count only trusted decision comments` — each named passage contains `trusted author`.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/comment-trust-conformance.test.js`
Expected: FAIL (new cases)

- [ ] **Step 3: Implement** — work-record.md sentence: "Only a comment from a trusted author (`_shared/pr-run-comments.md`'s Trusted authors) is a decision comment at all; every reader filters on it and names any marker comment it skips." The jq readers also run the Trusted authors skip-notice jq and print its lines.
- [ ] **Step 4: Run to verify it passes** — Run: `node --test tests/comment-trust-conformance.test.js tests/backlog-grant-lane-decision.test.js tests/shaping-mode-needs-removal.test.js tests/backlog-attention-rows.test.js tests/work-record-needs-decision-conformance.test.js tests/tidy-needs-worklist-rule.test.js tests/backlog-refine-resolve-lane.test.js` — Expected: PASS, 0 fail.
- [ ] **Step 5: Commit** — `git add` the seven skill files and the test; `git commit -m "Count only trusted-author needs-decision comments — Resolution rule and every reader"`.

### Final verification (controller)

- `node "<plugin-root>/bin/plan-audit.js" <this plan> --spec <spec>` — Check E clean (the two waivers below).
- `npm test` in full (AC7.1).

Waived AC6.1: PR description, not a test — the controller copies the Marker-reader inventory table into PR #3385's description before merge.
Waived AC7.1: covered by `/build` Common Step 5's full-suite run, not a task-level test.
