# Upstream Filing Ownership Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under control mode, the Review Console files a `U#` upstream-feedback item automatically when its target repo is owned, and holds every other item as an acceptance-packet decision fact.

**Architecture:** A pure ownership module (`plugin/bin/lib/issues/upstream-ownership.js`) decides owned/external from strings only. `bookkeepingPermissions` gains one control-mode capability, `ownedUpstreamFiling`. The unattended resolver (`resolveAll`) applies the route in-process; a new read/write shape `console-resolve.js --upstream-route` serves every other tier and records filing failures, scrub hits and successful filings. Prose follows the code.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T100700-record-4621/work/4621-spec.md`

Scope keywords: owned-owners, ownedUpstreamFiling, wrap-up-upstream-, upstream-target:

## Global Constraints

- Owner grammar, every owner input (target owner, `currentRepoOwner`, each `owned-owners` entry): `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`, no trimming. Repo-name half: `^[A-Za-z0-9._-]{1,100}$`, never `.` or `..`.
- Ownership is a literal, case-insensitive string comparison and nothing else: no API call, no membership check, no redirect or rename following. The authenticated `gh` account is never an input (no `gh auth`, no `gh api user`).
- `currentRepoOwner` comes from the `origin` remote through `originSpecOf`/`parseRepo` in `plugin/bin/lib/repo-resolve.js` (reuse, never re-parse). A target is a bare `owner/name`, so its host is `github.com`; an origin whose normalized host is not `github.com` makes every target external. No origin, or an unparseable one: `owner-unresolved`.
- Owned filing requires control mode on, at every ceiling. Outside control mode every path behaves byte-for-byte as before.
- Packet fact: conform to `_shared/acceptance-packet.md`'s Decision facts table (`id`, `kind: 'decision'`, `origin: 'upstream'`, `summary`, `evidenceRef`, `suggestedResolution`, plus `text`); no schema field is added. `summary` names the target repo, draft title and hold reason; `text` is that summary plus the full draft body (whitespace collapsed); `evidenceRef` is the staged file (spec's Plan Review Clarifications).
- Staged upstream file layout (written by `wrap-up/upstream-feedback.md` Step 2): line 1 `<!-- upstream-target: {owner/name} -->`, line 2 `Title: {title}`, a blank line, then the scrubbed body. The two header lines are never part of a filed issue's body.
- Only `staged/wrap-up-upstream-*` items are routed by ownership; `staged/upstream-draft-*` hand-off drafts keep their existing never-filed `pending` → carried path. Hold reasons: `external`, `filing-failed`, `scrub-hit`, `owner-unresolved`.
- From `gh-api-module-pattern/cli-wrapper-contract.md`: "Every child process is started with a `cwd` derived from `deps.cwd()` … A relative path is resolved against `deps.cwd()`". console-resolve.js keeps its `execFile`/`cwd` seam: every new git call goes through `execFile(cmd, args, { cwd })`.
- From `policy-key-addition`: "State the value the resolver returns for unset, set and malformed input, from the code, not from intent." `owned-owners` resolves to `[]` unset, the raw comma string (`'Thn-Inc,acme'`) set, `{ value: [], source: 'default', invalid: true }` malformed; consumers split on `,` and trim around commas, as `readRiskPolicy` does.
- From `windows-checkout-test-parity`: a staged file may carry CRLF line endings; split lines on `/\r?\n/` (line splitting, not value trimming).
- A run on the previous plugin release must keep working: a staged `wrap-up-upstream-*.md` with no `<!-- upstream-target: … -->` line is external under control mode (held, never filed) and unchanged outside it.

Waived AC11.1: the whole suite runs at Common Step 5's verification and again in `/claude-tweaks:test`; no task-level test can cite it.

## Review Focus

1. A staged upstream file written by the previous release (no `<!-- upstream-target: … -->` line) under control mode — expect a hold with reason `external`, never a filing. Test in Task 3.
2. A cloud-sandbox proxy origin (`http://local_proxy@127.0.0.1:43123/git/thn-inc/claude-tweaks`) — expect `owner-unresolved`, never owned. Test in Task 2.
3. Base-branch policy unreadable (no `origin/{branch}` ref, `git show` fails) — expect `owned-owners` to read `[]`, the repo owner still owned. Test in Task 3.
4. A CRLF staged file (`<!-- upstream-target: thn-inc/claude-tweaks -->\r\n`) — expect the target to parse as `thn-inc/claude-tweaks`. Test in Task 2.
5. Two `<!-- upstream-target: … -->` lines naming different repos — expect `targetRepo: null` (ambiguous → external). Test in Task 2.

---

### Task 1: `ownedUpstreamFiling` capability in `bookkeepingPermissions`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/autonomy.js:217-240` (`bookkeepingPermissions` and its comment)
- Test: `tests/bin-lib/issues/autonomy.test.js` (the three exact-shape `deepEqual`s at lines 247-279 gain `ownedUpstreamFiling: false`)
- Test: `tests/bin-lib/issues/autonomy-control-mode.test.js:63-80` (composition assertions)

**Interfaces:**
- Produces: `bookkeepingPermissions(ceiling, { controlMode } = {})` returns the six existing keys plus `ownedUpstreamFiling: controlMode === true` — true at every ceiling (a typo'd ceiling included) exactly when control mode is on, false otherwise. No other key changes.

- [ ] **Step 1: Write the failing tests** in `autonomy-control-mode.test.js`:

```js
test('AC8.2: ownedUpstreamFiling is control mode alone, at every ceiling', () => {
  for (const c of [null, undefined, 'supervised', 'trusted', 'unattended', 'bogus']) {
    assert.strictEqual(bookkeepingPermissions(c, { controlMode: true }).ownedUpstreamFiling, true, String(c));
    assert.strictEqual(bookkeepingPermissions(c).ownedUpstreamFiling, false, String(c));
    assert.strictEqual(bookkeepingPermissions(c, { controlMode: false }).ownedUpstreamFiling, false, String(c));
  }
});
test('control mode widens nothing but ownedUpstreamFiling', () => {
  const strip = ({ ownedUpstreamFiling, ...rest }) => rest;
  assert.deepStrictEqual(strip(bookkeepingPermissions(null, { controlMode: true })), strip(bookkeepingPermissions('unattended')));
  assert.deepStrictEqual(strip(bookkeepingPermissions('supervised', { controlMode: true })), strip(bookkeepingPermissions('supervised')));
});
```

Rewrite the existing lines 64, 65, 79 and 80 to compare through `strip` (they pinned "control mode adds no capability of its own", which this record deliberately changes); add `ownedUpstreamFiling: false` to the three exact shapes in `autonomy.test.js`.

- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/autonomy-control-mode.test.js tests/bin-lib/issues/autonomy.test.js` — Expected: FAIL (`ownedUpstreamFiling` undefined).
- [ ] **Step 3: Implement** the key in `bookkeepingPermissions`; extend the comment above it with one sentence: control mode grants `ownedUpstreamFiling` at any ceiling, and it authorizes filing into an owned repo only (#4621).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add plugin/bin/lib/issues/autonomy.js tests/bin-lib/issues/autonomy.test.js tests/bin-lib/issues/autonomy-control-mode.test.js` then `git commit -m "Add the ownedUpstreamFiling control-mode capability — refs #4621"`.

### Task 2: The pure ownership module

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/upstream-ownership.js`
- Test: `tests/bin-lib/issues/upstream-ownership.test.js`

**Interfaces:**
- Consumes: `originSpecOf(remote)` from `../repo-resolve` (`{ host, owner, repo }` normalized, or null); `decisionFactFor(item, { runDir, staged })` from `../console/decision-facts`; Task 1's `bookkeepingPermissions(...).ownedUpstreamFiling`.
- Produces (all exported):
  - `TARGET_HOST = 'github.com'`, `HOLD_REASONS = ['external', 'filing-failed', 'scrub-hit', 'owner-unresolved']`
  - `isValidOwner(value) -> boolean`
  - `parseTargetRepo(value) -> { owner, name } | null` — a string with exactly one `/`, owner passing the owner grammar, name the name grammar.
  - `ownedOwnersList(value) -> { owners: string[], ignored: string[] }` — an array is taken as is; a string splits on `,` with whitespace around commas trimmed and empties dropped; anything else is `{ owners: [], ignored: ['(owned-owners is not a list)'] }`. Each element failing `isValidOwner` (or not a string) moves to `ignored` (as `String(el)`).
  - `isOwnedRepo({ targetRepo, currentRepoOwner, ownedOwners }) -> boolean` — true iff the target parses and its owner, lower-cased, equals a valid `currentRepoOwner` lower-cased or a valid `ownedOwnersList(ownedOwners).owners` entry lower-cased.
  - `ownerContextFromOrigin(remoteUrl) -> { owner, host } | null` — `originSpecOf`; null when it returns null or its owner fails `isValidOwner`.
  - `upstreamFilingRoute({ permissions, targetRepo, ownerContext, ownedOwners }) -> { route: 'file' | 'hold' | 'unchanged', reason: string | null, targetRepo: string | null }` — order: `permissions.ownedUpstreamFiling !== true` → `unchanged`/null; target fails `parseTargetRepo` → `hold`/`external`; `ownerContext` null → `hold`/`owner-unresolved`; `ownerContext.host !== TARGET_HOST` → `hold`/`external`; `isOwnedRepo` → `file`/null; else `hold`/`external`. `targetRepo` echoes the input when it is a string, else null.
  - `parseStagedUpstream(text) -> { targetRepo: string | null, title: string | null, body: string }` — lines split on `/\r?\n/`; the target is the exact inner text of a line matching `^<!-- upstream-target: (.*) -->$`; the title is the exact remainder of a line starting `Title: `; header lines are read only from the leading header block (leading blank lines, then consecutive header lines; the block ends at the first line after a header that is not a header — the blank separator included) — a body line that looks like a header is body text, never read or removed; within the block a header appearing twice with different values yields null for that field, and a target marker anywhere after the block whose value differs from the block's also yields `targetRepo: null` (Review Focus 5); `body` is the text after the header block and one blank line directly after it.
  - `upstreamDecisionFact({ id, targetRepo, title, body, reason, detail, runDir, staged }) -> fact` — `decisionFactFor({ id, section: 'Upstream feedback', resolution: 'filed', reason: '' }, { runDir, staged })` for `id`/`kind`/`origin`/`evidenceRef`, then `summary` = one line: `Upstream feedback ${id} held, not filed (${reason}): target ${targetRepo ?? 'unresolved'}` + (title ? `; draft "${title}"` : '') + (detail ? ` — ${detail}` : ''), whitespace collapsed; `text` = `summary` + (body ? ` — draft: ${body}` : '') with whitespace collapsed; `suggestedResolution` = `file the draft at ${evidenceRef} into ${targetRepo ?? 'its upstream repo'} yourself, or decline` (for `filing-failed`/`scrub-hit` prefix `fix the cause, then `).

- [ ] **Step 1: Write the failing tests** (one `test` per id; values exact):
  - `AC1.1` / `AC1.2`: `isOwnedRepo({ targetRepo: 'thn-inc/claude-tweaks', currentRepoOwner: 'thn-inc', ownedOwners: [] })` true; `'obra/superpowers'` false.
  - `AC2.1` / `AC2.2`: `ownedOwners: ['obra']` makes `'obra/superpowers'` true; `'obra-fork/x'` false.
  - `AC3.1`: `'THN-INC/claude-tweaks'` with owner `'thn-inc'` true; `'thn-inc-evil/x'` and `'THN-INC.evil/x'` false.
  - `AC3.2`: each of `'thn-inc'`, `'thn-inc/'`, `'/claude-tweaks'`, `'thn-inc/../x'`, `'thn-inc/..'`, `'thn-inc/.'`, `'thn-inc%2Fx/y'`, `'HTTPS://github.com/thn-inc/x'`, `' thn-inc/claude-tweaks'`, `'thn-inc/claude-tweaks '`, `'thn-inc/claude-tweaks\n'` is false and `parseTargetRepo` null.
  - `AC7.1`: `currentRepoOwner` of `''`, `null`, `'thn_inc'` makes `thn-inc/x` false; `upstreamFilingRoute` with `ownerContext: null` → `{ route: 'hold', reason: 'owner-unresolved' }`; with `{ owner: 'thn-inc', host: 'acme.ghe.com' }` → `hold`/`external`; `ownerContextFromOrigin` of `'https://gitlab.com/thn-inc/x.git'` yields host `gitlab.com` and routes `external`; Review Focus 2's proxy origin → null.
  - `AC7.2`: `ownedOwners` of `[42]`, `['']`, `['obra_x']`, `'obra'`-as-object `{ a: 1 }` leaves `'obra/superpowers'` false and `ignored` non-empty; `[]` with owner `thn-inc` keeps `thn-inc/x` true; the string `'obra, acme'` lists both.
  - `AC10.1`: for each input slot (target owner, `currentRepoOwner`, `ownedOwners` entry) each of `'thn-іnc'` (Cyrillic i), `'thn-inc\n'`, `'thn-inc\u0000'`, `'thn-inc.'`, `'a'.repeat(40)`, `'thn_inc'`, `'thn-inc/x'` never makes a match; `'a'.repeat(39)` is valid.
  - `origin parsing`: ssh `git@github.com:thn-inc/claude-tweaks.git`, https `https://github.com/thn-inc/claude-tweaks`, `.git` suffix, `https://ghe.acme.com/thn-inc/x` (host `ghe.acme.com`, routes `external`) — the AC3 Deliverable's origin shapes; a fork origin `git@github.com:someone/claude-tweaks.git` makes `thn-inc/claude-tweaks` external.
  - `route`: `permissions: { ownedUpstreamFiling: false }` → `unchanged` for an owned target (AC6.1 at the unit level); owned → `file`.
  - `parseStagedUpstream`: Review Focus 4 (CRLF) and 5 (two differing lines → null); no line → null; `body` excludes both header lines.
  - `AC4.2` (fact shape): `upstreamDecisionFact`'s `id` is `decision:upstream:wrap-up-upstream-1.md`, `origin` `upstream`, `evidenceRef` ends `/staged/wrap-up-upstream-1.md`, `summary` contains the target, title and reason, `text` contains every word of the draft body; its keys are a subset of `[...DECISION_FACT_FIELDS, 'text']` (import from `decision-facts.js`).
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/upstream-ownership.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** the module per the Interfaces block. Regexes are module constants with no `m` flag and no `i` flag (lower-case both sides for comparison).
- [ ] **Step 4: Run** the same command — Expected: PASS. Mutation-check each guard in `upstreamFilingRoute` (delete it, see a named test go red, restore).
- [ ] **Step 5: Commit** `git add plugin/bin/lib/issues/upstream-ownership.js tests/bin-lib/issues/upstream-ownership.test.js` then `git commit -m "Add the upstream ownership predicate and filing route — refs #4621"`.

### Task 3: Route `U#` items in the unattended resolver

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js:983-1018` (`resolveAll`)
- Modify: `plugin/bin/console-resolve.js` (new `readUpstreamOwnership`, wired into `resolverDeps` at lines 786-797)
- Test: `tests/bin-lib/console/resolve-control-mode.test.js`
- Test: `tests/bin-lib/console/control-mode-cli.test.js`
- Waived `plugin/bin/lib/repo-resolve.js`: read only — Task 2 imports `originSpecOf` (which calls `parseRepo`); no edit.

**Interfaces:**
- Consumes: Task 2's `parseStagedUpstream`, `upstreamFilingRoute`, `upstreamDecisionFact`, `ownerContextFromOrigin`, `ownedOwnersList`; Task 1's `bookkeepingPermissions`.
- Produces:
  - `resolveAll` under `controlMode === true`: every item with `section === SECTIONS.UPSTREAM` and `resolution === 'filed'` is routed with `permissions = bookkeepingPermissions('unattended', { controlMode: true })`, the staged text from `snapshot.staged` (by `name === id`), and `deps.upstreamOwnership()` (called at most once per call, only when such an item exists; absent → `{ ownerContext: null, ownedOwners: [] }`). `file` → resolution stays `filed`, reason `control mode: owned target ${repo} — filed with no prompt`. `hold` → `resolution: 'carried'`, `carriedFrom: 'filed'`, reason `carried to the acceptance packet as ${fact.id} — held: ${reason}`, fact pushed onto `decisionFacts`. Outside control mode nothing changes.
  - `readUpstreamOwnership({ execFile, cwd, runDir }) -> { ownerContext, ownedOwners, notes: string[] }` in console-resolve.js (exported): origin via `execFile('git', ['remote', 'get-url', 'origin'], { cwd })` (throw → null context); `owned-owners` from the base branch: branch = `git rev-parse --abbrev-ref origin/HEAD` minus `origin/`, else `main` — never the checkout's own `integration-branch` policy value or run config, which a PR controls (task-review ruling); raw = `execFile('git', ['show', `origin/${branch}:.claude-tweaks/policy.yml`], { cwd })` (throw → `[]` plus a note); the line value `parseFlatLines(raw)['owned-owners']` (from `../lib/policy-schema`; absent → `[]`) goes through Task 2's `ownedOwnersList`, so a bad entry is ignored on its own (never the whole list, as the schema's `element: 'login'` check would) and each `ignored` entry adds a note. Never calls `gh`.
  - Notes are logged: `console-resolve.js` appends one `SKIP` line per note under `/wrap-up` (step `Upstream ownership`, text `condition: {note} → fallback: {the entry ignored | owned-owners read as [] | targets held}`), in the same block as the resolve's decisions entries; nothing is logged when `upstreamOwnership` was never called.

- [ ] **Step 1: Write the failing tests.**
  - `resolve-control-mode.test.js` (fixture staged files: `wrap-up-upstream-1.md` = `<!-- upstream-target: thn-inc/claude-tweaks -->\nTitle: dispatch: x\n\nbody\n`, `wrap-up-upstream-2.md` = same with `obra/superpowers`, `wrap-up-upstream-3.md` = body only; deps `upstreamOwnership: () => ({ ownerContext: { owner: 'thn-inc', host: 'github.com' }, ownedOwners: [] })`):
    - `AC4.1`: item 1 `filed`, reason names `thn-inc/claude-tweaks`.
    - `AC4.2` / `AC8.1`: item 2 `carried` from `filed`; its fact's `summary` names `obra/superpowers` and `external`; `evidenceRef` ends `staged/wrap-up-upstream-2.md`.
    - Review Focus 1: item 3 `carried` with reason `external`.
    - `AC6.1` (and `AC8.3`): the same fixture with no `controlMode` leaves all three `filed` with the `SECTION_STANCES` reason and `decisionFacts` empty, and `upstreamOwnership` is never called (pass a function that throws).
    - `upstream-draft-1.md` under control mode stays carried from `pending` (the existing hand-off route), with no call to `upstreamOwnership`.
  - `control-mode-cli.test.js` (extend `fakeExec` with an optional `answers` map for `remote get-url`, `rev-parse --abbrev-ref origin/HEAD` and `show`):
    - `AC5.1`: two runs whose fake also answers `gh api user` / `gh auth status` with logins `alice` and `mallory` print byte-identical stdout and identical `packet-facts/decisions.json`, and `calls` holds no `gh` call with `auth` or `api`.
    - Base-branch `owned-owners: obra` (from the `show` answer) files an `obra/superpowers` item; the same line only in the worktree's own `.claude-tweaks/policy.yml` does not.
    - Review Focus 3: `show` throws → the `thn-inc` item still files, the `obra` one is held, and decisions.md carries one `SKIP` line naming the unread base-branch policy.
    - `AC7.3` (per-entry): base-branch `owned-owners: obra, thn-inc.` files the `obra` item and logs one `SKIP` line naming `thn-inc.`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/resolve-control-mode.test.js tests/bin-lib/console/control-mode-cli.test.js` — Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement** the `resolveAll` routing (before the existing carry map, so a held item is not re-carried) and `readUpstreamOwnership`, passed as `upstreamOwnership` in `resolverDeps` behind a one-shot memo.
- [ ] **Step 4: Run** the same command plus `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js` — Expected: PASS, the last two untouched.
- [ ] **Step 5: Commit** the four files with `git commit -m "Route upstream feedback by repo ownership in the control-mode console — refs #4621"`.

### Task 4: `console-resolve.js --upstream-route`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/console-resolve.js` (header comment's seventh shape, `USAGE`, `parseArgs`, new `upstreamRoute` function, `run` dispatch)
- Test: `tests/bin-lib/console/upstream-route-cli.test.js` (new; reuse `control-mode-cli.test.js`'s fixture shape by copying its helpers)

**Interfaces:**
- Consumes: Tasks 1-3 (`readUpstreamOwnership`, `writeDecisionFacts`, `rewriteItemResolution`, `appendEntry`/`formatEntry`).
- Produces: `--run <dir> --upstream-route <staged-id> [--hold filing-failed|scrub-hit --reason <text> | --filed <url>]`, taking no other flag. Reads policy via `readPolicy`; `bookkeepingPermissions(ceiling, { controlMode }).ownedUpstreamFiling !== true` → stdout `console-resolve.js: upstream-route {id} unchanged (control mode off)`, exit 0, nothing written. The id must match `/^wrap-up-upstream-[^/\\]+$/` and name a file in `staged/` (`lstatType`), else exit 5. Then:
  - no modifier: route via `upstreamFilingRoute`; stdout `console-resolve.js: upstream-route {id} {file|hold} target {repo|none} reason {reason|none}`; on `hold`, also do the hold writes below.
  - `--hold R --reason T`: hold with reason R and detail T.
  - `--filed URL`: runs at every ceiling, `unattended` included (the console calls it after every owned filing under control mode). It needs no staged file, because `/claude-tweaks:feedback --pre-confirmed`'s Step 8 cleanup deletes it on success before this call; the id still passes the regex. The target is the repo the URL names (`https://github.com/{owner}/{name}/issues/{n}`, parsed strictly; anything else is an unresolved target), routed via `upstreamFilingRoute`. On `file` it appends `AUTO … Upstream filing: {id} filed into {repo} as {url} (control mode: owned target, no prompt)` under `/wrap-up`. Otherwise it appends `AUTO … Upstream filing: {id} filed as {url} against a hold verdict ({reason})` and exits 5, so an issue that exists is never left unlogged.
  - Hold writes: `writeDecisionFacts(runDir, [upstreamDecisionFact(...)])` (throw → exit 6); when `console.json` is the auto-resolve shape holding the id as `filed`, `rewriteItemResolution(... 'carried' ...)`; append `AUTO … Upstream filing: {id} held for the acceptance packet as {factId} — {reason}{: detail}`; stdout ends `fact {factId}`. Exit 0; 2 malformed; 3 unanchored or a log write failed.

- [ ] **Step 1: Write the failing tests:** `AC8.2` (`autonomy: trusted` + `control-mode: on`, owned item → `file`, nothing written); external item at `trusted` → `hold`, fact written; `AC9.1` (`--hold filing-failed --reason 'gh: permission denied'` → fact summary names the reason, `console.json` item `filed` → `carried`, one decisions.md line); `AC9.2` (`--hold scrub-hit --reason 'internal path'` same shape); `AC4.3` (`--filed https://github.com/thn-inc/claude-tweaks/issues/9` logs the line naming repo and URL, once at `trusted` and once at `unattended` with an auto-resolve `console.json` holding the item `filed`); ownership notes are logged as `SKIP` lines here too; control mode off → `unchanged`, no files touched; a repeated `--hold` writes one fact (merge-by-id); `--hold` without `--reason` exits 2; an id `../x` exits 5.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/upstream-route-cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block; `parseArgs` keeps each other shape's exclusivity checks rejecting `--upstream-route`.
- [ ] **Step 4: Run** it plus `node --test tests/bin-lib/console/cli.test.js tests/bin-lib/console/control-mode-cli.test.js tests/console-resolve-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "Add console-resolve.js --upstream-route for owned/held upstream filing — refs #4621"`.

### Task 5: Prose, policy marker and pins

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/upstream-feedback.md` (Step 2: the stage file layout from Global Constraints — `<!-- upstream-target: thn-inc/claude-tweaks -->`, /feedback's fixed filing target, then `Title: {title}`, a blank line, the scrubbed body — and the approval paragraph gains the control-mode split). 3,346 B; rail 52,500 B.
- Modify: `plugin/skills/_shared/autonomy-ceiling.md` (a capability row `ownedUpstreamFiling` | control mode only, any ceiling | …; "the other six rows" → "the other seven rows"; the Control mode Composition sentence now says control mode adds exactly this one capability; a Hold-over-unattended paragraph: under control mode an external item is held at every ceiling, overriding `consoleAutoResolve`'s file-unconditionally `U#` stance). 40,444 B; headroom ~12 KB.
- Modify: `plugin/skills/_shared/upstream-feedback-batch.md` (one sentence: under control mode the Override drill and Approve all never file a held item; `console-resolve.js" --upstream-route {id} --run` decides). 8,573 B.
- Modify: `plugin/skills/wrap-up/review-console.md` (the `U#` bullet and step 9: under control mode, below unattended run `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --upstream-route {id} --run "$PIPELINE_RUN_DIR"` per `U#` (at unattended the resolve already routed it); `file` files via `/claude-tweaks:feedback --pre-confirmed` with no per-item prompt, causal tag or not; after every owned filing, at every tier `unattended` included, run `--upstream-route {id} --filed {url}`; a failed filing or a scrub stop → `--hold filing-failed|scrub-hit --reason '{why}'`). Flag-first form only: `tests/console-resolve-conformance.test.js` pins exactly one `console-resolve.js" --run`. 40,986 B; headroom ~11.5 KB.
- Modify: `plugin/skills/_shared/acceptance-packet.md` (Decision facts: an `upstream` fact is written by `upstream-ownership.js`'s `upstreamDecisionFact`, `evidenceRef` the staged draft). 32,115 B.
- Modify: `plugin/skills/feedback/pre-confirmed.md` (Step 7: the `<!-- upstream-target: … -->` and `Title:` lines are the draft's header — the title becomes the drafts-file `title` and neither line goes into `body`; Step 7's scrub stop under control mode also runs the `--hold scrub-hit` call).
- Modify: `plugin/skills/feedback/SKILL.md` (Step 8 item 4: under control mode a `filing-failure` row also runs the `--hold filing-failed` call).
- Modify: `plugin/skills/flow/multispec-console-template.md:168` (the "every row resolves to filed instead" clause gains: except under control mode, where an item not owned is held — `console-resolve.js` routes it per spec dir, `_shared/autonomy-ceiling.md`).
- Modify: `plugin/skills/wrap-up/review-console-interactive.md:89` (the Upstream feedback paragraph: under control mode `--upstream-route` decides each `U#` instead of the causal-tag default).
- No change (Check B hits, read and classified): `plugin/skills/_shared/policy-schema.md` and `policy-schema-coverage.md` (name the key only), `plugin/skills/feedback/upstream-draft.md` (hand-off drafts stay never-filed), `plugin/skills/flow/multispec-review-console.md`, `plugin/skills/wrap-up/console-template.md`, `plugin/skills/tidy/issue-claims-backstops.md` (glob and section mentions, behavior unchanged), `tests/bin-lib/console/cli.test.js`, `tests/bin-lib/console/resolve.test.js`, `tests/bin-lib/console/staged-id-producers.test.js`, `tests/feedback-upstream-draft-conformance.test.js` (existing pins, must stay green untouched).
- Modify: `plugin/bin/lib/policy-schema.js:202` (drop `Not yet used; ` from `owned-owners`'s summary, keep the rest; the comment at line 190 names `owned-owners -> #4621` already).
- Modify: `tests/resolve-policy-control-mode.test.js:300` (drop `'owned-owners'` from `NOT_YET_USED`).
- Modify: `plugin/skills/_shared/policy-schema-read-path.md:51` (owner cell: `/claude-tweaks:wrap-up` (the Review Console's upstream filing, #4621)).
- Modify: `docs/journeys/resolve-a-policy-key.md:51` (drop `owned-owners` from the "Not yet used" list).
- Modify: `docs/journeys/review-project-policy.md:39` (drop `owned-owners` from the "Not yet used" list).
- Test: `tests/control-mode-console-prose.test.js` (add pins: review-console.md names `--upstream-route`; autonomy-ceiling.md names `ownedUpstreamFiling`; each proved red on a mutated copy).

- [ ] **Step 1: Write the failing prose pins** in `tests/control-mode-console-prose.test.js`.
- [ ] **Step 2: Run** `node --test tests/control-mode-console-prose.test.js tests/resolve-policy-control-mode.test.js` — Expected: FAIL (pins missing; marker test once `NOT_YET_USED` shrinks).
- [ ] **Step 3: Edit** the prose and schema line. Sweep: `git grep -n -e 'adds no capability of its own' -e 'other six rows' -e 'none yet (#4608)' -- plugin docs` and `git grep -n -e 'owned-owners' -- plugin docs` — every hit updated or confirmed accurate.
- [ ] **Step 4: Run** the Step 2 command plus `node --test tests/console-resolve-conformance.test.js tests/policy-schema-metadata.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "Document the owned/external upstream filing split — refs #4621"`.
