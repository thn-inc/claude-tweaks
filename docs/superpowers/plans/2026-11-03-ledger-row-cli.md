# Ledger-row CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the open-items ledger a sanctioned `hooks.js ledger-row` verb that appends one row or settles one row by number, under the ledger lock with a re-read and an atomic write, and point the build/review/wrap-up prose at it.

**Architecture:** The locked read-modify-write and the status/resolution validation live in `plugin/bin/lib/stage-item/ledger.js` beside `carryForward` (same `{run-dir}/.ledger.lock`, same `writeFileAtomic`, same table parser). `pack.js` exports its existing deferral predicates, and `ledger-write.js` exposes the cell rewrite under `flipLedgerRow`. `plugin/bin/hooks.js` gains a thin verb that resolves the run and the ledger, validates, and prints one JSON line. Prose names the verb once in `_shared/ledger-format.md`'s new Writer section and cites it from the writing sites.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T203316-record-4439/work/4439-spec.md` (re-materialized 2026-11-03 with the record's `## Plan-review answers (2026-11-03)`, `## Plan-review answers, round 2 (2026-11-03)` and `## Plan-review answers, round 3 (2026-11-03)` sections; this plan was amended to apply all three)

**Scope keywords:** ledger-row, appendLedgerRow, ledgerLockPath

## Global Constraints

- Statuses: the closed enum is exactly `open`, `fixed`, `deferred`, `accepted`, `acknowledged`, `observation` (spec Deliverable 2); `resolved` and every other value is refused.
- `fixed` needs a commit or file ref (spec Deliverable 2).
- Q1 (spec, verbatim): "`ledger-row` accepts `--status deferred` only when its Resolution (a) names a `staged/…` path or a record reference, or (b) carries exactly one valid `Defer-reason:` from `_shared/deferral-gate.md`. The checks for (a) and (b) reuse `pack.js`'s predicates (`LEDGER_DEFERRED_STAGED_RE`/`namesRecordReference` for `deferredUnstaged`, `hasValidDeferReason`), exported rather than copied. A row accepted only under (b) is written, and the JSON output flags it `incompleteDeferral: true`; the resolve gate settles it later. A `deferred` Resolution meeting neither (a) nor (b) exits non-zero, names the rule, and writes nothing."
- Q2 (spec, verbatim): "`ledger-row --row N` reads row N's current Status first. If it is terminal (`fixed`, `deferred`, `accepted`, `acknowledged`, `observation`), the verb exits 1 with nothing written and names the row and its status. The one exception is an incomplete deferral: a `deferred` row whose Resolution names neither a `staged/…` path nor a record reference, per `pack.js`'s `deferredUnstaged` predicate. That row may be settled to any terminal status, since that is its first complete terminal write per `_shared/ledger-format.md`."
- Plan-review answer 1 (spec, 2026-11-03, Reading B — amends Q2: a terminal row has two exceptions, not one): "The verb accepts `--row N --status open` in exactly two cases: **Refused-proposal reopen.** Row N is currently `deferred`, its Resolution matches `pack.js`'s `LEDGER_DEFERRED_STAGED_RE` (a `staged/…` path, `spec-{N}/staged/…` included), and the new `--resolution` carries the literal note `proposal refused — no defer reason` from `refused-proposals.md`'s Ledger origin. If any of the three fails, exit 1, write nothing, and name the rule. **Open row.** Row N is currently `open`. This only rewrites the Resolution, which `review/step3-routing.md` uses for a failed stage or digest write. Every other move to `open` is refused, including an incomplete deferral and any `fixed`, `accepted`, `acknowledged` or `observation` row. Prose cites `ledger-format.md` for the exception and doesn't restate it. A non-zero exit from the verb is `refused-proposals.md`'s existing "write fails" case: the row and the staged file are both left unchanged." "Carries" = the new Resolution contains the note as a substring (an exact-match test would refuse refused-proposals.md's own wording if it prefixes context). The note literal lives in one exported constant, `REFUSED_PROPOSAL_NOTE`, in `stage-item/ledger.js`.
- Plan-review answer 2 (spec, 2026-11-03): "`wrap-up-engine.js finish-console`'s `flipLedgerRow` path is not changed here." Task 1's `rewriteLedgerRow` extraction is a pure refactor — `flipLedgerRow`'s validation, error messages and lock-free write path stay byte-for-byte the same in behavior (pinned by `flipLedgerRow still refuses open` and the existing `ledger-write.test.js` suite); no lock and no terminal-row guard is added to it. The follow-up record for that gap is filed at this run's wrap-up through the deferral gate, not by this build.
- Round-2 answer 3 (spec, verbatim): "**Every non-zero `ledger-row` exit, at every writing site: Reading A.** A refusal stops the write and is never worked around. The ledger Writer section states this one rule, and each writing site cites it without restating it. The sites are `build/SKILL.md` Common Step 4, `build/dispatch.md`'s carry-forward, `build/operational-checklist.md`, `build/docs-sync.md`, `review/step3-routing.md`, `review/code-mode-steps.md`, `wrap-up/nothing-left-behind.md`, `wrap-up/residue-sweep.md`, the resolve gate's Phase 3, and `wrap-up/refused-proposals.md`." — `LOCK_TIMEOUT`: retry once. `ambiguous` / `unattributable` / unresolvable ledger: re-run once with an explicit `--ledger` taken from `hooks.js resolve-ledger`'s candidates; if no single candidate belongs to this run, don't guess: the row stays unwritten. Rule refusal (status, Resolution, terminal row): correct the arguments the refusal names and re-run once; never change a refused status or Resolution into a different one the verb happens to accept. Anything still refused: the row stays unwritten; surface the verb's stderr and log a `SKIP` to `decisions.md` (`condition: ledger-row exited {code}: {stderr} → fallback: row not written`). `refused-proposals.md`'s existing "write fails" case is this same rule. Never fall back to hand-editing the ledger file; the only path without the verb is the existing standalone one (no run dir), unchanged.
- Round-2 answer 4 (spec): the five amendments from plan-review comment 6606565049 are applied below — (1) the foreign-run write guard on implicit `--run` (Task 2 step 1b); (2) `excludeRecords` passed to `settleRow` (Task 2 step 6); (3) the literal plugin root in the Writer section's command shape for worktree sessions (Task 3); (4) `Review risk: high` on Task 3; (5) the tightened `fixed` patterns — a sha needs at least one digit, an extension needs two or more letters — with negative fixtures for "e.g." and "facade" (Task 1).
- Round-3 answer 5 (spec, text transport, Reading B): add `--item-file <path>` and `--resolution-file <path>`, a path to a file holding the text, written with the Write tool — the same rule as `log-decision.js --text-file` and `stage-item.js --file`. Each file flag is exclusive with its argv twin; passing both is a usage error (exit 2). A file that is empty (blank after trimming trailing newlines) or unreadable is a usage error (exit 2). Trailing `\r`/`\n` are trimmed (an index loop from the end, not a `[\r\n]+$` regex — `regex-scan-linearity`); any other `\r` or `\n` inside the text is a usage error (exit 2), because a ledger row is one table line. The argv flags stay, for AC1 and for short literal text (argv text keeps Task 1's newline collapse). The Writer section tells every site to use the file form whenever the text comes from git, a user, a finding or any other source the site did not write itself (the same split as `_shared/auto-decision-log.md`'s Text from git or a user rule), and that a harness refusal of the Bash call counts as round-2 answer 3's "anything still refused" case: the row stays unwritten and a `SKIP` is logged. Tests per file flag: a pipe, a backtick and `$` round-trip intact; both forms together exit 2; an empty file exits 2.
- Round-3 answer 6 (spec, `fixed` with a PR reference, Reading B narrowed): `fixed` also accepts the explicit form `PR #N`, or a `/pull/N` URL on this repo (host, owner and repo equal, case-insensitively, to the `origin` remote's `parseRepo` result). A bare `#N` stays refused, and so does an `/issues/N` URL. URLs (`https?://` followed by non-space characters) are removed from the Resolution before the sha/path/extension patterns run, so a URL's `owner/repo` path or `github.com` host never passes as a "file reference". `ledger-format.md:66` becomes "the commit hash, file reference, or resolving PR (`PR #N` or its URL)"; line 133 stays as it is. Fixtures: `fixed — merged in PR #4712` passes, a `/pull/4712` URL on this repo passes, `fixed — merged in #4712` is refused, an `/issues/4712` URL is refused.
- Round-3 answer 7 (spec): the four plan amendments from plan-review comment 6614743358 are applied below — (1) ledger Create and `delete-ledger` keep their own paths: Task 3's "write through the Writer section" wording and the Writer section's "never hand-edit the ledger file" cover row appends and settles only; (2) `ledger-format.md:23`'s "An append … takes the fallback as written" applies only on the standalone, no-run-dir path (Task 3); (3) the Writer command passes `--run "{run-dir}"` whenever the caller has a run dir — the caller decides the standalone branch before calling, never from the verb's `no pipeline run dir found` refusal — and a `multiple candidate runs` refusal is a rule refusal, re-run once with the `--run` it names (Task 3); (4) the resolution reason is named `not-found` (next bullet).
- Stderr names the refusal kind so a caller can apply answer 3 mechanically: a held lock's message contains `LOCK_TIMEOUT`; a ledger-resolution refusal contains its `resolveLedgerPath` reason (`ambiguous`, `unattributable`, `not-found`, `rejected`) and the candidate paths; a rule refusal names the rule.
- AC1 command, verbatim: `node plugin/bin/hooks.js ledger-row --ledger <path> --phase build --item "a | b" --status open` — no `--run`, so the verb resolves the run implicitly from a linked worktree.
- Governing skill `hooks-js-verb-registration` (quoted): "A verb is not shipped until every row lands in the same change." Sites: "`VERBS` table in `plugin/bin/hooks.js` | One entry"; "`KNOWN_FLAGS` in `plugin/bin/hooks.js` | Every `VERBS` verb gets an entry"; "`tests/hooks-help-guard.test.js` | Add the verb to the `runAccepting` list"; "`docs/hooks.md` | The anchored-`--run` paragraph: bump the spelled-out count (the "{N} subcommands that accept it" phrase) and insert the verb in the list. If the verb exits 1 on refusal, name it in the exit-code exception sentence beside `close-run` and `resolve-console`."; "`docs/plugin-structure.md`'s `plugin/bin/hooks.js` line | Add the verb to the subcommand list"; "`docs/hooks.md`'s implicit-resolution sentence … Only for a verb that resolves an omitted `--run` through `resolveRunArg`'s `unambiguousOnly` path: name it there." Decisions: "If a skill parses it, stdout carries only the machine-readable result. Notices (the worktree-local-fallback disclosure, refusals) go to stderr through `reportWorktreeLocalFallback(runDir, flag, process.stderr)`."; "Flush before returning. `await new Promise((resolve) => process.stdout.write(line, resolve))`"; "exactly the `<value>` flags must be in this set" (`VALUE_FLAGS`).
- Governing skill `regex-scan-linearity`: any regex here runs over a Resolution of unbounded length, so use the single-character forms given in Task 1, never `[\w.-]+\/…` (quadratic across start positions).
- Governing skill `skill-prose-conformance-tests`: a go-red control runs the same assertion code as the positive test, against mutated input.
- Source-scan lint: no new `existsSync` / `realpathSync` token anywhere under `plugin/bin/` (`tests/path-guard-conformance.test.js`). Read files with `fs.readFileSync` inside try/catch.
- Pipe rule pins (`tests/ledger-pipe-escape-rule-conformance.test.js`): `ledger/SKILL.md`, `review/step3-routing.md` and `build/dispatch.md` each keep a line citing "`_shared/ledger-format.md`'s Format section" with a `` `|` `` on it and never name `escapeLedgerCell`; `review/step3-routing.md`'s sentence " A finding whose text quotes a `|` is escaped per `_shared/ledger-format.md`'s Format section before its row is appended." stays byte-identical; `ledger-format.md` states the bold pipe rule exactly once and its paragraph keeps naming `ledger-cells.js`, `escapeLedgerCell`, `splitLedgerRow`, `ledgerRowCells`, `flipLedgerRow`.
- Other pins: `tests/build-sdd-ledger-residue-carryforward.test.js` pins dispatch.md's "`/claude-tweaks:ledger`'s Add Item operation" clause (keep it); `tests/deferral-gate-conformance.test.js:292` pins `` `proposal refused — no defer reason` `` in refused-proposals.md (keep it).
- Rail (`RAIL_BYTES` 52,500): `plugin/skills/build/SKILL.md` 52,235 (265 B headroom), `review/code-mode-steps.md` 51,796 (704 B headroom) — each edit below adds under 60 B. `ledger-format.md` 37,412, `build/dispatch.md` 46,492, `review/step3-routing.md` 38,241: ample.

## Review Focus

1. A refused call (bad status, deferred rule, terminal row, unresolvable run, held lock) leaves the ledger byte-unchanged — Task 2 refusal tests compare bytes.
2. A `--item`/`--resolution` value with a raw newline stays one table row — Task 1 test `appendRow collapses a newline`.
3. A `#N` naming the run's own record is not a record reference, so a `deferred` Resolution naming only it is refused — Task 2 test `own record is not a record reference`.
4. A `--ledger` outside the run dir and worktree (or not named `*-ledger.md`/`ledger.md`) is refused, never written — Task 2 test `rejects a --ledger outside the run and worktree`.
5. A lock held by a live process makes the verb refuse (exit 1) rather than write unlocked — Task 2 test `a held ledger lock refuses`.
6. `--status open` succeeds only for an open row or the three-condition refused-proposal reopen (answer 1); a staged `deferred` row reopened without the note, an incomplete deferral, and every other terminal row are refused — Task 1 `settleRow to open:` tests, Task 2 `answer 1:` test.
7. `flipLedgerRow`'s behavior is unchanged (answer 2) — the existing `ledger-write.test.js` suite passes untouched.
8. An implicit `--run` reaching a run owned by another session is refused, an explicit one is not (amendment 1) — Task 2 `amendment 1:` test.
9. The refusal rule is stated once in the Writer section and only cited at the ten sites (round-2 answer 3) — Task 3 conformance helper's `LOCK_TIMEOUT`-absent assertion.
10. `fixed` refuses "e.g." and all-hex-letter words (amendment 5) — Task 1 negative fixtures.
11. `fixed` accepts `PR #N` and this repo's `/pull/N` URL, and refuses a bare `#N`, an `/issues/N` URL and another repo's `/pull/N` URL (round-3 answer 6) — Task 1 PR fixtures; a URL never passes through the path pattern.
12. `--item-file`/`--resolution-file` carry a pipe, a backtick and `$` intact; both forms together, an empty file, an unreadable file and an interior newline each exit 2 with the ledger byte-unchanged (round-3 answer 5) — Task 2 `answer 5:` tests.
13. The Writer section states the file-form rule, the `--run` rule and the `multiple candidate runs` retry once, and covers row appends and settles only (round-3 answers 5 and 7) — Task 3 conformance anchors.

---

### Task 1: Locked append/settle and validation in the ledger lib

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (export only, plus `ownRecordNumbers`)
- Modify: `plugin/bin/lib/wrap-up/ledger-write.js` (extract `rewriteLedgerRow`; correct the `flipLedgerRow` comment naming where the reopen is applied)
- Modify: `plugin/bin/lib/stage-item/ledger.js`
- Test: `tests/bin-lib/stage-item/ledger.test.js`

**Interfaces:**
- Produces, from `pack.js`: exports `LEDGER_DEFERRED_STAGED_RE`, `namesRecordReference`, `hasValidDeferReason`, and `ownRecordNumbers(runDir: string, worktree: string|null): number[]` = `resolveRecords(defaultDeps(worktree || process.cwd()), runDir, worktree).records` (empty on `unavailable`).
- Produces, from `ledger-write.js`: `rewriteLedgerRow(text, { item, status, resolution }): string` — `flipLedgerRow`'s body from `parseLedgerTable` onward, with no status validation (missing row and non-7-slot rows still throw, same messages). `flipLedgerRow` validates as today, then delegates; its behavior is unchanged.
- Produces, from `stage-item/ledger.js`:
  - `LEDGER_STATUSES: string[]` = `['open', ...TERMINAL_STATUSES]`.
  - `REFUSED_PROPOSAL_NOTE: string` = `'proposal refused — no defer reason'` (em dash, U+2014 — byte-identical to `refused-proposals.md`'s note).
  - `ledgerLockPath(runDir): string` = `path.join(runDir, '.ledger.lock')`; `carryForward` switches to it.
  - `isIncompleteDeferral(resolution: string, excludeRecords: number[]): boolean` = neither `LEDGER_DEFERRED_STAGED_RE` nor `namesRecordReference` matches.
  - `checkLedgerStatus(status, resolution, { excludeRecords = [], repo = null } = {}): { refusal: string|null, incompleteDeferral: boolean }` — `repo` is a `{ host, owner, repo }` (`repo-resolve.js`'s `parseRepo` shape) or `null`. Rules: not in `LEDGER_STATUSES` → refusal containing `invalid status '{status}'` and the enum joined by `, `. `fixed` → passes when (i) the resolution with every URL span removed (`/https?:\/\/\S+/g` replaced by a space) matches `/\b(?=[0-9a-f]{0,39}[0-9])[0-9a-f]{6,40}\b/` (a sha with at least one digit), `/[\w.-]\/[\w.-]/` or `/\w\.[A-Za-z]{2}[A-Za-z0-9]{0,4}\b/` (an extension of two or more letters) (round-2 amendment 5); or (ii) it matches `/\bPR #\d+\b/`; or (iii) some URL in it matches `/^https?:\/\/([A-Za-z0-9.-]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/` (run on each URL span from (i), never the whole resolution) with host, owner and repo equal case-insensitively to `repo`'s — `repo === null` makes (iii) false (round-3 answer 6). Else refusal naming "a commit sha, file reference, or resolving PR (`PR #N` or this repo's /pull/N URL)". `deferred` → complete under (a), or `incompleteDeferral: true` with no refusal under (b) only, else refusal naming `staged/`, a record reference and `Defer-reason:`. `accepted`/`acknowledged` → non-blank resolution. `open`/`observation` → any.
  - `appendLedgerRow(ledgerText, { phase, item, status, resolution })` — gains optional `resolution`; blank writes `—`, else through the existing `ledgerCell`. Existing callers unchanged.
  - `appendRow({ runDir, ledgerPath, phase, item, status, resolution }): { number }` — under `withLock(ledgerLockPath(runDir), fn, { failClosed: true })`: `fs.readFileSync`, `appendLedgerRow`, `writeFileAtomic`. Throws on unreadable ledger, no table, `LEDGER_UNSAFE`, `LOCK_TIMEOUT`.
  - `settleRow({ runDir, ledgerPath, row, status, resolution, excludeRecords = [] }): { number }` — same lock. Inside it, read the row first, and:
    - no such row, or not 7 slots → let `rewriteLedgerRow` throw;
    - `status === 'open'`: allowed when the current status is `open`, or when all three refused-proposal-reopen conditions hold — current status `deferred`, `LEDGER_DEFERRED_STAGED_RE` matching its current Resolution, and the new `resolution` including `REFUSED_PROPOSAL_NOTE`; else throw `row #{n} is {current}; only an open row, or a deferred row naming a staged/ path reopened with the note '${REFUSED_PROPOSAL_NOTE}' (the refused-proposal reopen, _shared/ledger-format.md's Resolution-text requirements), can be set to open`;
    - terminal target: current status terminal → allowed only when current is `deferred` and `isIncompleteDeferral`; else throw `row #{n} is already {current} (terminal) — a wrong resolution gets a new item`;
    - current status read lowercase (`ledgerRowCells(row)[3]`); an out-of-enum current status is not terminal, so it may be settled.
  - Neither function calls `checkLedgerStatus`: the CLI validates first.
  - Load `pack.js` lazily inside the functions that need it, so `bin/stage-item.js` does not pay for it.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/stage-item/ledger.test.js` (reuse `LEDGER_HEAD`, `PRIOR_ROW`; ledgers in a `fs.mkdtempSync` dir whose `run/` subdir is the `runDir`):
  - `checkLedgerStatus refuses an out-of-enum status, naming the enum` — `checkLedgerStatus('resolved', 'x').refusal` matches `/invalid status 'resolved'/` and `/open, fixed, deferred, accepted, acknowledged, observation/`.
  - `checkLedgerStatus fixed needs a commit sha or file ref` — no refusal for `'abc123'`, `'Fixed in plugin/bin/x.js'`, `'see ledger.js'`, `'see notes.md'`; refusal for `'done'`, `'done.'`, `''`, `'e.g. done'` and `'facade'` (round-2 amendment 5: each negative fixture turns red when its pattern is loosened back — `'facade'` under the digit-free sha form, `'e.g. done'` under the one-letter extension form).
  - `checkLedgerStatus fixed accepts a resolving PR, never a bare #N or an issue URL` (round-3 answer 6) — with `repo = { host: 'github.com', owner: 'thn-inc', repo: 'claude-tweaks' }`: no refusal for `'fixed — merged in PR #4712'` and `'merged in https://github.com/thn-inc/claude-tweaks/pull/4712'` (also with `/files` appended); refusal for `'fixed — merged in #4712'`, `'https://github.com/thn-inc/claude-tweaks/issues/4712'`, `'https://github.com/other/repo/pull/4712'`, and the `/pull/4712` URL with `repo: null`. Each refused URL fixture turns red if URL spans are left in the text the path pattern scans.
  - `checkLedgerStatus deferred: staged path or record reference is complete` — `'staged/ledger-record-a.md'`, `'#77'` and `'https://github.com/o/r/issues/7'` → `{ refusal: null, incompleteDeferral: false }`.
  - `checkLedgerStatus deferred: a Defer-reason alone is incomplete but accepted` — `'Defer-reason: tangential'` → `{ refusal: null, incompleteDeferral: true }`.
  - `checkLedgerStatus deferred: neither is refused, naming the rule` — `'later'`, and `'Defer-reason: tangential Defer-reason: tangential'` (two tokens), and `'Defer-reason: because'` (invalid value) → refusal matching `/staged\//` and `/Defer-reason:/`.
  - `checkLedgerStatus deferred: the run's own record is not a reference` — `checkLedgerStatus('deferred', 'see #5', { excludeRecords: [5] }).refusal` non-null; with `{ excludeRecords: [] }` null.
  - `checkLedgerStatus accepted/acknowledged need a reason; open/observation do not`.
  - `appendRow appends the next row with an escaped pipe and a resolution` — on `LEDGER_HEAD + PRIOR_ROW`, item `'a | b'`, status `open` → `{ number: 2 }`, row 2 is `| 2 | build | a \| b | open | — |`, row 1 unchanged, `{runDir}/.ledger.lock` gone afterwards.
  - `appendRow collapses a newline in item and resolution` — item `'x\ny'`, status `fixed`, resolution `'abc1234\nmore'` → one line `| 2 | build | x y | fixed | abc1234 more |`.
  - `appendRow refuses a held lock (failClosed)` — create `{runDir}/.ledger.lock/.owner` holding `${process.pid}-held`, `CLAUDE_TWEAKS_LOCK_WAIT_MS='30'` (restored in `finally`): throws `code === 'LOCK_TIMEOUT'`, bytes unchanged.
  - `AC2.1: settleRow rewrites only the named row's Status and Resolution` — three open rows; `{ row: 3, status: 'fixed', resolution: 'abc123' }` → row 3 is `| 3 | {phase} | {item} | fixed | abc123 |`, everything else byte-identical.
  - `settleRow refuses a terminal row, naming the row and status` — for each of the five terminal statuses (a complete Resolution, `staged/a.md` for `deferred`): throws matching `/row #1/` and the status, bytes unchanged.
  - `settleRow settles an incomplete deferral to any terminal status` — row `deferred` with `Defer-reason: tangential`, to `fixed` with `abc123` → rewritten.
  - `settleRow treats the run's own record as incomplete` — row `deferred` with `see #5`, `excludeRecords: [5]`, to `accepted` → rewritten; `excludeRecords: []` → throws.
  - `settleRow to open: open row keeps open with a new Resolution` — rewritten.
  - `settleRow to open: the refused-proposal reopen` — `deferred` row with `staged/ledger-record-a.md`, new resolution `` `staged/ledger-record-a.md` refused at the console — proposal refused — no defer reason `` → rewritten `open`; also a `spec-2/staged/review-followup-1.md` Resolution → rewritten.
  - `settleRow to open: the reopen without the note is refused` — same staged `deferred` row, new resolution `'reopened'` → throws matching `/proposal refused — no defer reason/`, bytes unchanged.
  - `settleRow to open: refused from fixed, from a deferred row with no staged path (an incomplete deferral, even with the note), and from accepted/acknowledged/observation` — throws, bytes unchanged. Each guard above has its own fixture: deleting it turns exactly that test red.
  - `REFUSED_PROPOSAL_NOTE matches refused-proposals.md` — reads `plugin/skills/wrap-up/refused-proposals.md` and asserts it includes `` `${REFUSED_PROPOSAL_NOTE}` ``; go-red: the same assertion against a copy with the note's em dash replaced by `-` throws.
  - `settleRow settles an out-of-enum current status` — row status `resolved`, to `accepted` → rewritten.
  - `settleRow throws for a missing row and for a raw-pipe row, writing nothing` — `row: 9` throws `/no ledger row for item #9/`; a row with a raw `|` in its Item throws `/5-column/`; bytes unchanged.
  - `flipLedgerRow still refuses open` — pins the delegation left validation in place.
  - `ledgerLockPath is the carryForward lock` — `assert.equal(ledgerLockPath('/r'), path.join('/r', '.ledger.lock'))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/stage-item/ledger.test.js`
Expected: FAIL — `checkLedgerStatus is not a function` (and the other new names undefined).

- [ ] **Step 3: Implement** the Produces lists above. Update `stage-item/ledger.js`'s header comment to say the module also exports the plain-row writer behind `hooks.js ledger-row`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/stage-item/ledger.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/wrap-up/pack.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js plugin/bin/lib/wrap-up/ledger-write.js plugin/bin/lib/stage-item/ledger.js tests/bin-lib/stage-item/ledger.test.js
git commit -m "Add locked appendRow/settleRow to the ledger lib — refs #4439"
```

### Task 2: `hooks.js ledger-row` verb and its registration set

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js` (`VERBS`, `KNOWN_FLAGS`, `VALUE_FLAGS`, new `runLedgerRow`)
- Modify: `plugin/bin/lib/repo-resolve.js` (export `originUrl` only — round-3 answer 6's repo match)
- Modify: `tests/hooks-help-guard.test.js:80` (`runAccepting` gains `'ledger-row'`)
- Modify: `docs/hooks.md:28` (count "fourteen" → "fifteen", list gains `ledger-row`; exit-code exception sentence gains `ledger-row`, which exits 1 on any refusal so its caller reads a refusal as a stop, and 2 on a text-file usage error), `docs/hooks.md:57` (implicit-resolution sentence names `ledger-row`), `docs/hooks.md:59` (the write-time foreign-run guard sentence names `ledger-row` beside `record-pr` and `spec-status`, round-2 amendment 1)
- Modify: `docs/plugin-structure.md:17` (subcommand list + one clause describing the verb; the run-accepting roster's counts move with it: "the fourteen that accept --run (…)" → "the fifteen …" with `ledger-row` in the list, `sweep-shadow` "a fifteenth" → "a sixteenth", "the other fourteen's --run" → "the other fifteen's --run", `adopt-run-dir` "a sixteenth" → "a seventeenth")
- Create: `tests/hooks-ledger-row.test.js`

**Interfaces:**
- Consumes: Task 1's `checkLedgerStatus`, `appendRow`, `settleRow`; `ownRecordNumbers` from `./lib/wrap-up/pack`; `resolveLedgerPath` from `./lib/wrap-up/ledger-write`; hooks.js's `resolveRunArg`, `renderCandidateRefusal`, `reportWorktreeLocalFallback`, `flagVal`, `ctxLib.readRunState`. Lazy-require the libs inside the handler, as `runDeleteLedger` does.
- Produces: `VERBS['ledger-row'] = { usage: 'ledger-row [--run <dir>] [--ledger <path>] [--phase <phase>] [--item <text> | --item-file <path>] [--row <n>] --status <status> [--resolution <text> | --resolution-file <path>]', run: runLedgerRow }`; `KNOWN_FLAGS['ledger-row'] = ['--run', '--ledger', '--phase', '--item', '--item-file', '--status', '--resolution', '--resolution-file', '--row']`; `VALUE_FLAGS` gains `'--item'`, `'--item-file'`, `'--resolution'`, `'--resolution-file'`, `'--row'`.
- CLI contract: on success stdout is exactly one JSON line, `{"action":"appended"|"settled","row":N,"status":"…","ledger":"…"}` plus `"incompleteDeferral":true` only when true; exit 0. Every refusal writes `claude-tweaks: ledger-row: … — nothing written` to **stderr** (or the run-resolution refusals below), nothing to stdout, exit **1**, ledger untouched — except a text-file usage error (round-3 answer 5: a file flag with its argv twin, an empty or unreadable file, an interior newline), which writes the same stderr shape and exits **2**.

`runLedgerRow(argv)` order:
1. `resolveRunArg(argv.slice(3), process.cwd(), process.env, { unambiguousOnly: true, callerIdentity })`; `reportWorktreeLocalFallback(runDir, worktreeLocalFallback, process.stderr)`. `invalidRunArg` → `claude-tweaks: --run path rejected: {x} — nothing written`; `candidates` → `renderCandidateRefusal('ledger-row', candidates)`; no `runDir` → `claude-tweaks: no pipeline run dir found — nothing written`.
1b. Foreign-run write guard (round-2 amendment 1), the same shape as `runRecordPr`'s: `implicitForeign = !explicit && runDir && ctxLib.classifyOwnership(callerIdentity, ctxLib.readRunState(runDir)) === 'foreign'` → `claude-tweaks: ledger-row: run {id} was recorded by another session/worktree — refusing to write a ledger row against it without an explicit --run — nothing written`, exit 1. Explicit `--run` bypasses it.
1c. Text flags (round-3 answer 5): for each pair (`--item`/`--item-file`, `--resolution`/`--resolution-file`), both present → exit 2 naming both flags; the file flag present → `fs.readFileSync(path, 'utf8')` in try/catch (unreadable → exit 2 naming the path), trailing `\r`/`\n` trimmed by an index loop, blank after the trim → exit 2 naming the flag as empty, a remaining `\r` or `\n` → exit 2 naming "one table line". The file's text then stands in for its argv twin in every later step (so `--row` with `--item-file` is refused like `--row` with `--item`, and a `--resolution-file` satisfies settle's resolution requirement).
2. Mode: `--row` present → settle (requires `^\d+$`, `--status`, and a non-blank resolution unless status is `observation`; refuses `--phase`/`--item`/`--item-file` alongside it); else append (requires non-blank `--phase`, item text, `--status`).
3. `worktree = ctxLib.readRunState(runDir)?.worktree || process.cwd()`; `excludeRecords = ownRecordNumbers(runDir, worktree)`; `repo` = `parseRepo(originUrl(worktree))` from `./lib/repo-resolve` (which gains `originUrl` in its exports — export only, no behavior change) in try/catch, `null` on any failure (round-3 answer 6).
4. `checkLedgerStatus(status, resolution, { excludeRecords, repo })`; a refusal is the message.
5. `resolveLedgerPath({ runDir, worktree, explicit: ledgerArg ? path.resolve(process.cwd(), ledgerArg) : null })`; `!ok` → refusal naming `reason`, `detail` and candidates.
6. `appendRow` / `settleRow({ …, excludeRecords })` in try — `settleRow` receives the same `excludeRecords` as the status check (round-2 amendment 2); a thrown error → refusal with its message (a `LOCK_TIMEOUT` refusal names `LOCK_TIMEOUT` and adds `— retry once`).
7. Flush stdout per the skill's rule; return 0.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-ledger-row.test.js` — spawn `node plugin/bin/hooks.js` with `spawnSync` (`env: { ...process.env, PIPELINE_RUN_DIR: '', CLAUDE_CODE_SESSION_ID: 'ledger-row-test' }` — the session id pinned for every spawn, `record-worktree` included, so ownership classification is deterministic), assert `status`, `stdout`, `stderr` separately. Fixture: a temp git repo (`git init -q --initial-branch=main`, one seed commit, like `tests/delete-ledger-verb.test.js`'s `gitRoot`), a linked worktree `git worktree add -q {tmp}/wt -b feat`, a run dir `{root}/.claude-tweaks/pipelines/2026-11-03T000000-record-1/` whose `run-state.json` is written by the real writer (`node plugin/bin/hooks.js record-worktree --run {runDir} {wt}`, after seeding `{"status":"active"}`), a materialized header `{runDir}/work/1-spec.md` (`---\nrecord: 1\n---\n`), and a ledger at `{wt}/docs/plans/2026-11-03-x-ledger.md` holding the table head.
  - `AC1.1: from a linked worktree, ledger-row appends one row keeping the escaped pipe` — cwd `{wt}`, args `['ledger-row', '--ledger', ledger, '--phase', 'build', '--item', 'a | b', '--status', 'open']` (no `--run`); exit 0; stdout parses to `{ action: 'appended', row: 1, status: 'open' }` with no `incompleteDeferral` key; the ledger's only row is `| 1 | build | a \| b | open | — |`.
  - `AC1.1 lock: a held ledger lock refuses and writes nothing` — pre-create `{runDir}/.ledger.lock/.owner` = `${process.pid}-held`, env `CLAUDE_TWEAKS_LOCK_WAIT_MS=30`; exit 1, stderr matches `/lock/`, stdout empty, bytes unchanged.
  - `AC2.1: --row 3 --status fixed --resolution abc123 rewrites only row 3's Status and Resolution` — three open rows; row 3 = `| 3 | build | three | fixed | abc123 |`; every other line byte-identical; stdout `{ action: 'settled', row: 3 }`.
  - `AC2.2: --status resolved exits non-zero naming the enum` — exit 1; stderr matches `/open, fixed, deferred, accepted, acknowledged, observation/`; bytes unchanged.
  - `AC3.1: two concurrent appends from two child processes take distinct row numbers` — two `spawn` children started together (each `--run runDir --ledger ledger --phase build --item item-{i} --status open`), await both `close`; both exit 0; the ledger holds exactly rows `1` and `2`, one per item.
  - `Q1: a Defer-reason alone writes the row and flags incompleteDeferral` — `--status deferred --resolution 'Defer-reason: tangential'`; exit 0, stdout `incompleteDeferral === true`; running the real `parseLedger` from `pack.js` over the file reports that row in `deferredUnstagedItems`.
  - `Q1: a staged path writes the row with no flag` — stdout has no `incompleteDeferral` key.
  - `Q1: neither is refused, naming the rule` — `--resolution 'later'`; exit 1; stderr matches `/staged\//` and `/Defer-reason:/`; bytes unchanged.
  - `own record is not a record reference` — `--status deferred --resolution 'see #1'` (the fixture's own record) → exit 1; `'see #2'` → exit 0.
  - `amendment 2: a deferred row naming only the run's own record settles through the CLI` — a ledger row `| 1 | build | x | deferred | see #1 |` (written into the fixture file directly), `--row 1 --status accepted --resolution 'superseded by the build'` → exit 0, row 1 rewritten `accepted`; go-red: the same call against a fixture with no `work/1-spec.md` header (so `excludeRecords` is empty and `#1` reads as a record reference) exits 1 naming `row #1`.
  - `amendment 1: an implicit run owned by another session is refused` — a second run dir `{root}/.claude-tweaks/pipelines/2026-11-03T000001-record-9/` stamped by `record-worktree` with `CLAUDE_CODE_SESSION_ID: 'someone-else'`, its own ledger at `{runDir2}/ledger.md`; spawn from cwd `{wt}` with `PIPELINE_RUN_DIR: runDir2` and no `--run` → exit 1, stderr matches `/recorded by another session\/worktree/`, both ledgers byte-unchanged; the same call with an explicit `--run runDir2` → exit 0 (the bypass).
  - `Q2: settling a terminal row exits 1 naming the row and status` — a `fixed` row; exit 1; stderr matches `/row #1/` and `/fixed/`; bytes unchanged.
  - `answer 1: the refused-proposal reopen through the CLI` — a `deferred` row whose Resolution is `staged/ledger-record-a.md`: `--row 1 --status open --resolution 'reopened'` → exit 1, stderr names `proposal refused — no defer reason`, bytes unchanged; `--resolution 'staged/ledger-record-a.md refused — proposal refused — no defer reason'` → exit 0, stdout `{ action: 'settled', row: 1, status: 'open' }`.
  - `answer 5: --item-file carries a pipe, a backtick and $ intact` — a file (written with `fs.writeFileSync` into a `mkdtemp` dir outside the worktree) holding ``a | `b` $c`` plus a trailing `\n`; append with `--item-file`; exit 0; the row's Item cell is ``a \| `b` $c`` (escaped pipe, backtick and `$` verbatim, trailing newline gone).
  - `answer 5: --resolution-file carries a pipe, a backtick and $ intact` — same text through `--row 1 --status accepted --resolution-file` on an open row; exit 0; the Resolution cell is ``a \| `b` $c``.
  - `answer 5: a file flag with its argv twin exits 2` — `--item x --item-file f`, and `--resolution x --resolution-file f`: each exit 2, stderr names both flags, bytes unchanged.
  - `answer 5: an empty file exits 2` — for each file flag, a file holding `''` and one holding `'\n\n'`: exit 2, bytes unchanged.
  - `answer 5: an unreadable file and an interior newline exit 2` — a missing path → exit 2 naming the path; a file holding `'a\nb'` → exit 2, stderr matches `/one table line/`; bytes unchanged.
  - `answer 6: fixed with this repo's /pull/N URL through the CLI` — the fixture repo gains `git remote add origin https://github.com/o/r.git`; `--status fixed --resolution https://github.com/o/r/pull/7` → exit 0; `https://github.com/o/r/issues/7` → exit 1, bytes unchanged.
  - `rejects a --ledger outside the run and worktree` — a `*-ledger.md` in another `mkdtemp` dir; exit 1; that file unchanged.
  - `refuses --row together with --item`, `refuses --row with no --resolution`, `refuses an append with no --phase` — each exit 1, bytes unchanged.
  - `refuses an undeclared flag in both orders` — `--bogus` before and after the verb's flags: exit 1, empty stdout, bytes unchanged.
  - `--help prints the usage line` — `['ledger-row', '--help']`, exit 0, stdout contains `ledger-row [--run <dir>]`.
  Add `'ledger-row'` to `runAccepting` in `tests/hooks-help-guard.test.js:80`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-ledger-row.test.js`
Expected: FAIL — the AC1.1 test sees a usage error instead of an appended row.

- [ ] **Step 3: Implement** `runLedgerRow` and the registration rows above; edit `docs/hooks.md` and `docs/plugin-structure.md` as listed in Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-ledger-row.test.js tests/hooks-help-guard.test.js tests/hooks-js-flag-strict.test.js tests/delete-ledger-verb.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/hooks.js plugin/bin/lib/repo-resolve.js tests/hooks-ledger-row.test.js tests/hooks-help-guard.test.js docs/hooks.md docs/plugin-structure.md
git commit -m "Add hooks.js ledger-row verb for plain ledger appends and settles — refs #4439"
```

### Task 3: Name the writer and point the writing prose at it

**Role:** integration
**Review risk:** high (round-2 amendment 4 — it routes `refused-proposals.md`'s lock-dependent status write through the verb)

**Files:**
- Modify: `plugin/skills/_shared/ledger-format.md` — (1) opening paragraph: "read/write the ledger file … directly using file operations" becomes read directly, append and settle rows through the Writer section (ledger Create and `delete-ledger` keep their own paths — round-3 answer 7 amendment 1); (2) Format paragraph: the writers list adds `hooks.js ledger-row` beside `finish-console`, both taking text raw; (3) new `### Writer` subsection between "### De-duplication on Append" and "## Status Lifecycle"; (4) one sentence appended to "### Phase 3 — Apply user decisions"'s opening paragraph: every status update in this phase is written with `ledger-row --row {N}`; (5) line 66's "`fixed` includes the commit hash or file reference" becomes "`fixed` includes the commit hash, file reference, or resolving PR (`PR #N` or its URL)" — line 133 unchanged (round-3 answer 6); (6) line 23's closing "An append (a new row, or Create's already-exists check) takes the fallback as written." becomes: a row append takes the fallback only on the standalone, no-run-dir path — with a run dir it goes through the Writer section, which never guesses — and Create's already-exists check takes the fallback as written (round-3 answer 7 amendment 2).
- Modify: `plugin/skills/ledger/SKILL.md` — Add Item: one line naming the verb; the Pipes bullet keeps its citation line and says the verb escapes, so pass raw text; Update Item: one sentence naming `ledger-row --row {N}`; Invocation Model's "write directly, using file operations" corrected to match.
- Modify: `plugin/skills/build/SKILL.md:264` — "(see `/claude-tweaks:ledger`)" → "(`hooks.js ledger-row`, `_shared/ledger-format.md`'s Writer section)".
- Modify: `plugin/skills/build/operational-checklist.md:22`, `plugin/skills/build/docs-sync.md:19` — the append instruction names `hooks.js ledger-row` (Writer section).
- Modify: `plugin/skills/build/dispatch.md:14` — replace the sentence starting "Escape every `|` in a carried one-liner": pass every carried one-liner raw, because `hooks.js ledger-row` and the carry-forward call below each escape a `|` themselves (`_shared/ledger-format.md`'s Format section); a `Ruling:` line routinely quotes a regex alternation or a table fragment. Pre-escaping now double-escapes, so leaving the old sentence is a defect.
- Modify: `plugin/skills/review/step3-routing.md` — "Ledger first, then the patch" paragraph (the verb's JSON `row` is the number the patch's `Ledger:` field needs); "**Write all findings to the open items ledger**" paragraph (writes and the `fixed` update go through `ledger-row`). The pinned pipe sentence stays untouched.
- Modify: `plugin/skills/review/code-mode-steps.md:179` — "Append only what survives triage" names `hooks.js ledger-row`.
- Modify: `plugin/skills/wrap-up/nothing-left-behind.md:51` — "update status to `acknowledged`" names `ledger-row --row {N}`.
- Modify: `plugin/skills/wrap-up/residue-sweep.md:59` — "add a row" names `hooks.js ledger-row`.
- Modify: `plugin/skills/wrap-up/refused-proposals.md:47` — the status write names `ledger-row --row {N} --status open`, its `--resolution` carrying the note; a non-zero exit is the "write fails" case the next sentence already covers. Keep the pinned note literal and every `assertLedgerOrigin` anchor (`tests/deferral-gate-conformance.test.js:282-298`) intact; cite `ledger-format.md` for the exception, never restate the three conditions.
- Create: `tests/ledger-row-writer-conformance.test.js`

Waived `plugin/skills/_shared/staged-patch.md`: its Write-back section's console outcomes go through `finish-console`'s flips, which keep their own path; the Writer section states the general rule.

Every site edit above (and the Phase 3 sentence in `ledger-format.md` itself) cites the Writer section for what to do on a non-zero exit — "(`_shared/ledger-format.md`'s Writer section)" or, inside `ledger-format.md`, "(the Writer section)" — and never restates the retry ladder (round-2 answer 3). `refused-proposals.md`'s "write fails" sentence keeps its wording and adds that this is the Writer section's refusal rule.

Writer section content (the implementer words it; it must carry each of these and stay two paragraphs plus the two command lines — the second paragraph is the refusal rule):
- the two command shapes, with `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" ledger-row --run "{run-dir}"` and every flag of `VERBS['ledger-row'].usage`, plus one clause that a worktree session substitutes the literal plugin root for `${CLAUDE_PLUGIN_ROOT}`, since the worktree guard refuses a runtime variable as `node`'s script operand (`_shared/scratch-worktree.md` §7; round-2 amendment 3); the caller passes `--run` whenever it has a run dir and decides the standalone branch before calling, never from the verb's `no pipeline run dir found` refusal (round-3 answer 7 amendment 3);
- that it runs under `{run-dir}/.ledger.lock`, re-reads the ledger and writes it atomically; stdout is one JSON line whose `row` is the item number; Item/Resolution text is passed raw;
- the text-transport rule (round-3 answer 5): text the site did not write itself — from git, a user, a finding, any other source — goes through `--item-file`/`--resolution-file`, a file written with the Write tool, per `_shared/auto-decision-log.md`'s Text from git or a user rule; argv is for short literal text the site wrote; a file is one line (trailing newlines trimmed), and a file flag with its argv twin, an empty or unreadable file, or an interior newline exits 2;
- that it covers row appends and settles only: ledger Create and `hooks.js delete-ledger` keep their own paths (round-3 answer 7 amendment 1);
- that it refuses (exit 1, nothing written) a status outside the closed enum, a Resolution missing its requirement, a rewrite of a terminal row except an incomplete deferral, and a `--status open` other than an open row or this file's refused-proposal reopen (whose new Resolution must carry `refused-proposals.md`'s note); it does not restate those requirements, citing the Status Lifecycle section; a `deferred` row accepted on its `Defer-reason:` alone comes back `incompleteDeferral: true`;
- that it does not de-duplicate (the De-duplication on Append check stays the writer's); a value starting `--` is refused, so lead the text with a word;
- that an omitted `--ledger` resolves per this file's resolution rule; a row paired with a staged proposal goes through `bin/stage-item.js --ledger`; with no run dir at all (standalone) the verb refuses, and the writer uses file operations as before;
- the refusal rule (round-2 answer 3), as the second paragraph, stated once: a refusal stops the write and is never worked around; a `LOCK_TIMEOUT` is retried once; an `ambiguous`/`unattributable`/unresolvable ledger is re-run once with an explicit `--ledger` from `hooks.js resolve-ledger`'s candidates, and stays unwritten when no single candidate belongs to this run; a rule refusal is re-run once with the arguments it names corrected, never with a refused status or Resolution swapped for a different one the verb accepts — a `multiple candidate runs` refusal is a rule refusal, re-run once with the `--run` it names (round-3 answer 7 amendment 3); anything still refused — a harness refusal of the Bash call included (round-3 answer 5) — stays unwritten: surface the stderr and log `SKIP` with `condition: ledger-row exited {code}: {stderr} → fallback: row not written`; never hand-edit a ledger row — the standalone no-run-dir path above is the only one without the verb.
It must not restate the bold pipe rule.

**Interfaces:**
- Consumes: Task 2's `VERBS['ledger-row'].usage` (the test reads it via `require('../plugin/bin/hooks.js').VERBS`).

- [ ] **Step 1: Write the failing conformance test** `tests/ledger-row-writer-conformance.test.js` with one shared helper `assertWriterSites({ format, sites })` that asserts: `format` has a `### Writer` heading whose section contains `hooks.js" ledger-row`, every `--flag` token parsed from the usage string, `.ledger.lock`, the literal-plugin-root clause (`scratch-worktree.md`), `--run "{run-dir}"`, the text-transport rule's anchor `Text from git or a user`, the Create/Delete carve-out's anchor `delete-ledger`, and the refusal rule's anchors `LOCK_TIMEOUT`, `resolve-ledger`, `multiple candidate runs`, `row not written` and `SKIP`; `format` contains "file reference, or resolving PR (`PR #N` or its URL)"; `format`'s Phase 3 opening paragraph contains `ledger-row --row` and `Writer section`; each entry in `sites` (`ledger/SKILL.md`, `build/SKILL.md`, `build/operational-checklist.md`, `build/docs-sync.md`, `build/dispatch.md`, `review/step3-routing.md`, `review/code-mode-steps.md`, `wrap-up/nothing-left-behind.md`, `wrap-up/residue-sweep.md`, `wrap-up/refused-proposals.md`) contains `ledger-row` and `Writer section`, and none of them contains `LOCK_TIMEOUT` (the ladder is stated once, never restated at a site). Tests: `writer section names the verb with its full flag set and the citing sites point at it` (real files); `go-red: helper throws when --resolution is removed from a copy of the Writer section` (same helper, mutated `format`, `assert.throws` with `/--resolution/`); `go-red: helper throws when the refusal rule's LOCK_TIMEOUT clause is removed from a copy of the Writer section`; `go-red: helper throws when the text-transport rule is removed from a copy of the Writer section`; `go-red: helper throws when a site loses the verb` (same helper, mutated site); `go-red: helper throws when a site restates LOCK_TIMEOUT` (same helper, mutated site); `dispatch.md no longer tells a writer to pre-escape a carried one-liner` (asserts the text does not include "Escape every `|` in a carried one-liner", and go-red by running the same assertion against a copy holding that sentence).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/ledger-row-writer-conformance.test.js`
Expected: FAIL — no `### Writer` section in `ledger-format.md`.

- [ ] **Step 3: Edit the prose** as listed in Files. Before editing each sentence, `git grep -n -F '{phrase}' -- tests plugin` two distinctive phrases from it; a hit in `tests/` is a pin to keep satisfied, and a hit in `plugin/` read by a test is one too.

- [ ] **Step 4: Run the affected suites**

Run: `node --test tests/ledger-row-writer-conformance.test.js tests/ledger-pipe-escape-rule-conformance.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/deferral-gate-conformance.test.js tests/ledger-reader-ownership-conformance.test.js tests/flow-ledger-creation-timing-conformance.test.js tests/staged-patch-contract.test.js tests/skill-size-single-source.test.js`
Expected: PASS. Then `wc -c plugin/skills/build/SKILL.md plugin/skills/review/code-mode-steps.md` prints values below 52500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md plugin/skills/build/SKILL.md plugin/skills/build/operational-checklist.md plugin/skills/build/docs-sync.md plugin/skills/build/dispatch.md plugin/skills/review/step3-routing.md plugin/skills/review/code-mode-steps.md plugin/skills/wrap-up/nothing-left-behind.md plugin/skills/wrap-up/residue-sweep.md plugin/skills/wrap-up/refused-proposals.md tests/ledger-row-writer-conformance.test.js
git commit -m "Point ledger-writing prose at hooks.js ledger-row — refs #4439"
```

Waived AC4.1: `npm test` passes — covered by `/build` Common Step 5's full-suite verification and the `/test` gate, not by a task test.
