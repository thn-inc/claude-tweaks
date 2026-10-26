# Close-out Update Marker Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the parse, validate, serialise and accumulate rules for the `close-out-update` PR run comment out of `close-out-update.md`'s prose and into a unit-tested `plugin/bin/lib/` module, plus a thin CLI that the prose calls.

**Architecture:** `plugin/bin/lib/dispatch/close-out-marker.js` is pure: it parses a body string, serialises a pending body, appends an update to a pending marker, and resolves a `pending` resolution entry. It does no I/O. `plugin/bin/close-out-marker.js` is a `run(argv, deps)` CLI with three verbs: `read`, `write` and `resolve-pending`. Each verb takes the Find payload `gh pr view --json comments` already writes, locates the trusted marker comment through `find-run-comment.js`'s exported `findRunComments`, and calls the module. Then `close-out-update.md` replaces each prose rule with a call to the CLI, and the conformance pins that restated those rules shrink to pinning the call sites.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T195505-record-4331/work/4331-spec.md` (record #4331)

**Scope keywords:** close-out-update, pre-update-head, resolution-commit

## Global Constraints

- The plugin ships with zero runtime dependencies. The CLI goes in `plugin/bin/`, and every `require` resolves inside `plugin/`, which `tests/payload-boundary.test.js` enforces.
- The CLI follows `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`. Use the *Payload-1/Invocation-2* family, the same one `find-run-comment.js` uses: exit 0 answered, 1 payload failure (comments file unreadable or not a list, or for `write`/`resolve-pending` a marker that cannot be used), 2 malformed argv, 3 unwritable `--out` (the `qa-report.js` precedent). Set `process.exitCode`, never call `process.exit` (`tests/bin-lib/exit-code-conformance.test.js`). Look flags up with `Object.hasOwn`.
- Use the marker body format exactly as `close-out-update.md` states it. Line 1 is `<!-- run-comment: close-out-update -->`. Line 2 is `close-out-update: pending`, or `close-out-update: cleared ({reason})` once cleared. Then come `update-method:`, `conflicted-files:`, `pre-update-head:` and `resolution-commit:`, a blank line, and the explanatory paragraph. List fields join with `, `.
- Every changed prose pin keeps exactly one go-red mutation in `UPDATE_MUTATIONS`, whose `from` occurs exactly once in `close-out-update.md`. Every id in `PINS_4317` keeps its pin.

## Review Focus

1. **A web-UI edit turns line endings into CRLF on every line, not just line 2.** Every field must still parse, and a test sets a CRLF body on all lines (Task 1).
2. **A marker whose first line is not the run-comment marker.** `findRunComments` only returns comments whose first line is the marker, but `parseMarker` called directly must return `unreadable`, never `pending` (Task 1).
3. **An existing field already `unknown` when an update appends.** The accumulated field stays `unknown` rather than dropping the earlier entries silently: an earlier entry cannot be named, so the list cannot be stated whole (Task 1).
4. **An injected value in a comment body.** For example, `pre-update-head: $(rm -rf ~)` or a `resolution-commit` entry like `abc; echo`. Neither may come back as a usable value: `preUpdateHead` and the `resolutionCommits` field read `unknown` (Task 1).
5. **`write` against a payload whose trusted marker is unreadable.** It exits 1 and writes nothing, never a fresh marker that silently drops the earlier pending one (Task 2).

Real-input probe: no recorded `close-out-update` comment exists yet. The kind shipped in #4317 the same day. The fixtures are the prose template's own text with values substituted, and the probe is shape-only.

---

### Task 1: Marker module

**Files:**
- Create: `plugin/bin/lib/dispatch/close-out-marker.js`
- Test: `tests/bin-lib/dispatch/close-out-marker.test.js`

**Interfaces:**
- Produces:
  - `MARKER_LINE` (string): `'<!-- run-comment: close-out-update -->'`.
  - `UPDATE_METHODS` (frozen array): `['merge', 'gh pr update-branch']`.
  - `parseMarker(body: string) -> { status: 'pending'|'cleared'|'unreadable', updateMethod: string[]|'unknown', conflictedFiles: string[]|'unknown', preUpdateHead: string|'unknown', resolutionCommits: string[]|'unknown' }`.
    - Split on `/\r?\n/` and `trimEnd()` each line.
    - Line 1 must be `MARKER_LINE`.
    - Line 2 `close-out-update: pending` → `pending`; `/^close-out-update: cleared \(.*\)$/` → `cleared`. Anything else, or a non-string body, → `unreadable` with every field `'unknown'`.
    - A field is the first line, after line 2 and before the first blank line, that starts with `{key}: `. A missing field is `'unknown'`.
    - `update-method`: split on `,` and trim; every entry must be in `UPDATE_METHODS`, else `'unknown'`.
    - `conflicted-files`: `none` → `[]`, `unknown` → `'unknown'`. Otherwise split on `,` and trim; any empty entry → `'unknown'`.
    - `pre-update-head`: `/^[0-9a-f]{40}$/i`, lowercased, else `'unknown'`.
    - `resolution-commit`: every entry 40-hex (lowercased) or `pending`, else `'unknown'`.
  - `serializeMarker(fields) -> string`: the full pending body, ending in a newline, with the explanatory paragraph copied byte-for-byte from `close-out-update.md`'s template. `conflictedFiles: []` writes `none`, and `'unknown'` writes `unknown`.
  - `appendUpdate(pending, update) -> fields`. `update` is `{ updateMethod: string, conflictedFiles: string[]|'unknown', preUpdateHead: string, resolutionCommit: string }`.
    - `updateMethod` and `resolutionCommits` append the new entry (oldest first). An existing `'unknown'` stays `'unknown'`.
    - `conflictedFiles` is the union in first-seen order. Either side `'unknown'` → `'unknown'`.
    - `preUpdateHead` is replaced.
  - `resolvePendingCommit(fields, sha) -> fields | null`: replaces the last `'pending'` entry of `resolutionCommits` with `sha`. Returns `null` when `resolutionCommits` is `'unknown'` or holds no `pending` entry.

- [ ] **Step 1: Write the failing tests.** `TEMPLATE(line2, extra)` builds a body from the prose template with `pre-update-head` set to `H = 'a'.repeat(40)`.
  - `AC1.1: a second line ending in \r reads pending`: `parseMarker(body.replace('close-out-update: pending', 'close-out-update: pending\r')).status === 'pending'`. A second case puts CRLF on every line, and every field must parse to the same values as the LF body.
  - `AC1.2: an unrecognised second line reads unreadable`: `'close-out-update: pnding'` and `'close-out-update: cleared'` (no parenthesis) → `'unreadable'`. A body whose line 1 is not `MARKER_LINE` → `'unreadable'`. `parseMarker(null).status === 'unreadable'`.
  - `AC1.3: a non-40-hex pre-update-head reads unknown`: a 39-hex value, a 40-char value containing `g`, `$(rm -rf ~)` and a missing line all give `preUpdateHead === 'unknown'`. An uppercase 40-hex value comes back lowercased.
  - `cleared (reason) reads cleared`, and its fields still parse.
  - `fields validate`:
    - `update-method: merge, gh pr update-branch` → both entries; `update-method: rebase` → `'unknown'`.
    - `conflicted-files: none` → `[]`; `a.js, b/c.md` → `['a.js','b/c.md']`; `a.js,,b` → `'unknown'`.
    - `resolution-commit: {H}, pending` → `[H,'pending']`; `abc; echo` → `'unknown'`.
  - `AC2.1: appending to a pending marker keeps entries oldest first, unions conflicted files and replaces pre-update-head`:
    - Start from `{ updateMethod:['merge'], conflictedFiles:['a.js','b.js'], preUpdateHead:H, resolutionCommits:[H] }`.
    - Append `{ updateMethod:'gh pr update-branch', conflictedFiles:['b.js','c.js'], preUpdateHead:'b'.repeat(40), resolutionCommit:'pending' }`.
    - Expect `updateMethod ['merge','gh pr update-branch']`, `conflictedFiles ['a.js','b.js','c.js']`, `preUpdateHead 'b'.repeat(40)` and `resolutionCommits [H,'pending']`.
  - `appending keeps an unknown field unknown`: existing `updateMethod:'unknown'` and `conflictedFiles:'unknown'` stay `'unknown'`.
  - `serialize round-trips`: `parseMarker(serializeMarker(f))` deep-equals `{status:'pending', ...f}` for the AC2.1 result and for `conflictedFiles: []`. The serialised text contains `conflicted-files: none` and the explanatory sentence `While this reads \`pending\`, close-out has pushed an update`.
  - `resolvePendingCommit replaces the last pending entry`: `[H,'pending']` with `'c'.repeat(40)` → `[H,'c'.repeat(40)]`. `[H]` → `null`. `'unknown'` → `null`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/dispatch/close-out-marker.test.js`
  Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement the module.** Write `plugin/bin/lib/dispatch/close-out-marker.js` with the exports above. Its header comment names `close-out-update.md`'s Update marker as the contract it implements and #4331 as the record that moved it.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/dispatch/close-out-marker.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**: `git add` both files. Message: `Add close-out update marker module — parse, serialise and accumulate the close-out-update run comment` with `refs #4331`.

### Task 2: `close-out-marker.js` CLI

**Files:**
- Create: `plugin/bin/close-out-marker.js`
- Test: `tests/close-out-marker-cli.test.js`
- Modify: `docs/plugin-structure.md` (add a CLI line after the `find-run-comment.js` line, ~172)

**Interfaces:**
- Consumes: Task 1's exports, and `findRunComments(payload, kind)` from `plugin/bin/find-run-comment.js` (returns `{kind,id,ids,skipped}`, or `null` for a payload that is not a comments list).
- Produces, with usage `close-out-marker.js <read|write|resolve-pending> --comments-file <file> [...] [--help]`:
  - `read --comments-file <f>`
    - Prints one JSON line `{status, id, updateMethod, conflictedFiles, preUpdateHead, resolutionCommits, skipped}`.
    - `status` is `'none'` when no trusted marker exists, and the four fields are then `null`. Otherwise it is `parseMarker` of the body of the comment whose `id` `findRunComments` returned.
    - An unreadable marker is still exit 0 with `status: 'unreadable'`, because the status is data.
  - `write --comments-file <f> --update-method <m> --conflicted-files <list|none|unknown> --pre-update-head <40-hex> --resolution-commit <40-hex|pending> --out <f>`
    - Validates every flag. A bad `--update-method`, a non-40-hex `--pre-update-head`, a bad `--resolution-commit` or an empty list entry → exit 2.
    - Reads the trusted marker. `pending` → `appendUpdate`; `none` or `cleared` → a fresh marker from the flags; `unreadable` → exit 1 (`marker unreadable`), nothing written.
    - Writes `serializeMarker(...)` to `--out` (exit 3 on a write failure). Prints `{written, accumulated, marker}`.
  - `resolve-pending --comments-file <f> --sha <40-hex> --out <f>`: needs a `pending` marker that `resolvePendingCommit` accepts, else exit 1. Writes and prints like `write`.
  - Exports `run(argv, deps)` and `parseArgs`. `deps` = `{readFile, writeFile, stdout, stderr}`.

- [ ] **Step 1: Write the failing tests** in `tests/close-out-marker-cli.test.js`. Run in-process through `run` with fake deps, plus one real `spawnSync(process.execPath, [BIN, 'read', ...])` against a tmp file. `P(...comments)` builds `{comments:[...]}` with `authorAssociation:'MEMBER'`.
  - `read: no marker comment is status none`. Also, an untrusted (`NONE`) marker comment alone gives `status 'none'` and one `skipped` note.
  - `read: a CRLF pending marker reads pending with its id`. This is AC1.1 end-to-end through the CLI.
  - `read: an unrecognised second line is unreadable, exit 0`.
  - `write: no marker writes a fresh pending body`. The `--out` content parses to the flags' values, and `accumulated` is `false`.
  - `write: a pending marker accumulates`. This is AC2.1 end-to-end: the entries are appended, the files unioned and `pre-update-head` replaced, with `accumulated: true`.
  - `write: an unreadable marker exits 1 and writes nothing`.
  - `write: a cleared marker writes fresh`.
  - `write: invalid flags exit 2`: `--update-method rebase`, `--pre-update-head abc`, `--resolution-commit nope`, a missing `--out`, a trailing bare `--out`, an unknown flag and an unknown verb.
  - `write: an unwritable --out exits 3`, with `writeFile` throwing.
  - `resolve-pending: replaces the pending entry`. Also, a marker with no `pending` entry exits 1, and no marker exits 1.
  - `an unreadable or non-list comments file exits 1`.
  - `--help exits 0 and prints usage`.
  - `subprocess: read prints one JSON line and exits 0`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/close-out-marker-cli.test.js`
  Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement the CLI.** Write `plugin/bin/close-out-marker.js` after `find-run-comment.js`'s shape: header comment, `USAGE`, a `FLAGS` table per verb, `realDeps`, and a `require.main === module` guard that sets `process.exitCode`. The header states the exit vocabulary and cites `find-run-comment.js`'s family. Then add the `docs/plugin-structure.md` line, giving the verbs, the output and the exit codes 0/1/2/3, and naming `tests/close-out-marker-cli.test.js`.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/close-out-marker-cli.test.js tests/bin-lib/exit-code-conformance.test.js tests/payload-boundary.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**: `git add` the CLI, its test and `docs/plugin-structure.md`. Message: `Add close-out-marker.js CLI — read, write and resolve-pending over the Find payload` with `refs #4331`.

### Task 3: `close-out-update.md` calls the CLI; the pins shrink to the call sites

**Files:**
- Modify: `plugin/skills/dispatch/close-out-update.md` (Update marker section ~21-49, step 2 ~79-89, step 5 ~108-110)
- Modify: `tests/close-out-pr-state-contract-conformance.test.js` (`UPDATE_PINS` 90-101, 140-149; `UPDATE_MUTATIONS` 345-371)

**Interfaces:**
- Consumes: Task 2's CLI verbs and flags, exactly.

Moved-prose pin grep (run while authoring: `git grep -n -F -e 'trailing whitespace trimmed' -e '40-hex' -e 'close-out-update: pending' -e 'oldest first' -- tests plugin`): the only test hits are `tests/close-out-pr-state-contract-conformance.test.js`'s pins and mutations. `docs/journeys/update-a-conflicting-parked-pr-at-close-out-4273.md:50` describes the behaviour, which is unchanged, and needs no edit. Byte budget: the file is 18,661 B against `RAIL_BYTES` 52,500 B, and the net change is about +700 B.

- [ ] **Step 1: Update the pins first, so they go red.** In `UPDATE_PINS`:
  - `marker-read`: `s.includes('its \`status\` \`pending\` is a pending marker') && s.includes('still routes to the resume, with that value \`unknown\`')`.
  - `marker-read-unrecognised-stops`: `s.includes('\`unreadable\` stops the candidate (\`stopped: update failed — marker unreadable\`), never none')`. The CRLF clause goes, because the module's AC1.1 test now owns it.
  - `marker-accumulates`: `s.includes('\`write\` given a payload whose marker is pending appends this update to it')`.
  - `marker-read-by-id`: `s.includes('\`read\` prints its \`id\` (the comment to update in place)')`.
  - `resume-pre-update-head-hex`: `s.includes('a \`preUpdateHead\` of \`unknown\` (\`read\` accepts only a full 40-hex sha, since a comment body is never pasted into a command unchecked)')`.
  - `resume-pre-update-head-field`: `s.includes('\`{pre-update-head}\` being the Read\'s \`preUpdateHead\`')`.
  - `marker-post-update-sha`: `s.includes('Then rewrite the marker\'s \`pending\` \`resolution-commit\` entry to that sha with \`resolve-pending\`.')`.
  - New `marker-cli` (step 0): the step-0 span includes all three of `bin/close-out-marker.js" read --comments-file "{comments-path}"`, `bin/close-out-marker.js" write --comments-file "{comments-path}"` and `bin/close-out-marker.js" resolve-pending --comments-file "{comments-path}"`, plus `never by hand`. Add it to `PINS_4317['AC1.1']`.

  In `UPDATE_MUTATIONS`, replace the `from`/`to` of the eight pins above with clauses from the new text. Each `from` occurs exactly once:
  - `marker-read`: `'its \`status\` \`pending\` is a pending marker'` → `'its \`status\` is ignored'`.
  - `marker-read-unrecognised-stops`: `'\`unreadable\` stops the candidate (\`stopped: update failed — marker unreadable\`), never none.'` → `'\`unreadable\` is none.'`.
  - `marker-accumulates`: `'appends this update to it'` → `'overwrites it'`.
  - `marker-read-by-id`: `'\`read\` prints its \`id\` (the comment to update in place)'` → `'\`read\` prints its body'`.
  - `resume-pre-update-head-hex`: `' (\`read\` accepts only a full 40-hex sha, since a comment body is never pasted into a command unchecked)'` → `''`.
  - `resume-pre-update-head-field`: `', \`{pre-update-head}\` being the Read\'s \`preUpdateHead\`'` → `''`.
  - `marker-post-update-sha`: `'\n   Then rewrite the marker\'s \`pending\` \`resolution-commit\` entry to that sha with \`resolve-pending\`.'` → `''`.
  - `marker-cli`: `', never by hand'` → `''`.
  - Also update `marker-before-update-branch`'s `from` to the new step-2 text below.

- [ ] **Step 2: Run to verify red**
  Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
  Expected: FAIL. The pins `marker-read`, `marker-read-unrecognised-stops`, `marker-accumulates`, `marker-read-by-id`, `resume-pre-update-head-hex`, `resume-pre-update-head-field`, `marker-post-update-sha` and `marker-cli` fail, and the matching mutations report `occurs exactly once`.

- [ ] **Step 3: Rewrite the prose.**
  - **Update marker section.**
    - Line 23 ends `Its body, marker first, is composed only by \`bin/close-out-marker.js\` (rules in \`bin/lib/dispatch/close-out-marker.js\`), never by hand:`. The ```text template stays as it is.
    - After the template add one sentence: `Its three verbs read the Find step's payload \`{comments-path}\` and write the body to \`{body-path}\` (both from that procedure's Find); each is one plain command — exit 1: the payload or the marker cannot be used, 2: a malformed call, 3: \`--out\` unwritable:`.
    - Then three ```bash fences:
      - `node "${CLAUDE_PLUGIN_ROOT}/bin/close-out-marker.js" read --comments-file "{comments-path}"`
      - `node "${CLAUDE_PLUGIN_ROOT}/bin/close-out-marker.js" write --comments-file "{comments-path}" --update-method "{merge | gh pr update-branch}" --conflicted-files "{comma-joined paths | none | unknown}" --pre-update-head "{the values line's headRefOid}" --resolution-commit "{full sha | pending}" --out "{body-path}"`
      - `node "${CLAUDE_PLUGIN_ROOT}/bin/close-out-marker.js" resolve-pending --comments-file "{comments-path}" --sha "{post-update sha}" --out "{body-path}"`
    - Line 37 becomes: `A marker covers every update since its last clear: \`write\` given a payload whose marker is pending appends this update to it, so an earlier agent-made resolution stays named until a verified merge or a decline clears it.`
    - Lines 39-41 become: `**Read** it with that procedure's Find fetch, then \`read\`: its \`status\` \`pending\` is a pending marker, and \`cleared\` or \`none\` (no trusted comment) is none; \`unreadable\` stops the candidate (\`stopped: update failed — marker unreadable\`), never none. \`read\` prints its \`id\` (the comment to update in place) and Find's \`skipped\` notes. A pending marker missing a field still routes to the resume, with that value \`unknown\`.`
    - Every other sentence of the section stays as it is.
  - **Step 2 Resume values (line 80).** The `pending` clause becomes `… GitHub's update merge, \`{pre-update-head}\` being the Read's \`preUpdateHead\` — none printed, a \`preUpdateHead\` of \`unknown\` (\`read\` accepts only a full 40-hex sha, since a comment body is never pasted into a command unchecked), or a \`rev-list\` that exits non-zero: \`unknown\`, never a stop.`
  - **Step 2 Fresh (line 85).** `\`BEHIND\` then writes the pending marker (\`write\` with \`--update-method "gh pr update-branch" --conflicted-files none --resolution-commit pending\`)\n   and runs \`gh pr update-branch {number}\`` (keep the line break). Line 89 becomes `Then rewrite the marker's \`pending\` \`resolution-commit\` entry to that sha with \`resolve-pending\`.`
  - **Step 5 (line 109).** `First write the pending marker with \`write\`, passing this update's \`update-method\`, \`conflicted-files\` and resolution commit (in full) — \`write\` appends it to a pending one, per the Update marker above;`. The rest of the sentence stays.

- [ ] **Step 4: Run to verify green**
  Run: `node --test tests/close-out-pr-state-contract-conformance.test.js tests/payload-boundary.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**: `git add` both files. Message: `Route close-out-update.md's marker Read, write and accumulation through close-out-marker.js — prose pins reduced to the call sites` with `refs #4331`.

### Acceptance-criterion coverage

| Clause | Test |
|---|---|
| AC1.1 | Task 1 `AC1.1: a second line ending in \r reads pending`; Task 2 CRLF `read` |
| AC1.2 | Task 1 `AC1.2: an unrecognised second line reads unreadable` |
| AC1.3 | Task 1 `AC1.3: a non-40-hex pre-update-head reads unknown` |
| AC2.1 | Task 1 `AC2.1: appending to a pending marker …`; Task 2 `write: a pending marker accumulates` |
| AC3.1 | Common Step 5 full `npm test` via `verify.js`; Task 3's reduced pins |
