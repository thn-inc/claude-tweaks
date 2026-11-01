# Tolerate a Failed Identity Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failed or empty identity read no longer stops the below-floor parent close: the close-marker dedupe falls back to trusted authors only, and the output names the degrade.

**Architecture:** Since #4603 the probe lives in the shared parent-gate core (`plugin/bin/lib/issues/parent-gate.js`'s `gatherIdempotenceFacts`, plus the MCP facts reader `withIdempotenceReads` in `mcp-parent-gate-shape.js`). Both the `bin/parent-gate.js` CLI the prose calls and the reconciler's `below-floor-parent-close.js` run it, so the rule changes once in the core, `evaluateIdempotence` adds the degrade note to `skipped`, and the prose (`wrap-up/verification-brief-parent-gate.md`, tidy's verify line) states the same rule.

**Tech Stack:** Node 18+, CommonJS, `node --test`, injected fake `gh` runners. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T182348-spec-4770/work/4770-spec.md`

**Scope keywords:** `api user`, `get_me`, `has no login`, `current \`gh\` identity`

Waived AC7.1: a full-suite run, not a test to write — Task 5 and /build Common Step 5's verification run it.
Waived plugin/skills/_shared/github-pr-scan-acceptance.md: tidy's `parent-gate` scan is owned by #4801; this build never edits it.
Waived plugin/bin/lib/reconcile/post-merge.js: read only — its `composeSummaryText` already renders a closed entry's `notes`; Task 3 runs its suite.

## Global Constraints

- Degrade note text, exactly: `identity probe failed — close marker matched against trusted authors only`
- Do not modify `plugin/skills/_shared/github-pr-scan-acceptance.md` (tidy's `parent-gate` scan, owned by #4801) or `tests/closed-parent-acceptance-backstop.test.js`.
- A working probe behaves exactly as today: the current identity's untrusted-association close comment still counts.
- Commit messages: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer.

## Premise correction (logged in `decisions.md`, Spec Step 3)

The spec's Key Files predate #4603. The probe is `gatherIdempotenceFacts` (parent-gate.js, header line 8 and ~line 237), not code in `below-floor-parent-close.js`, and the prose no longer runs `gh api user` itself — the CLI does. The MCP twin is `withIdempotenceReads`' `me` guard. So the fix lands in the core and `below-floor-parent-close.js` changes only to read the login once per run (AC5).

**Builder's call — MCP `me` states.** `me: null` (the agent's record of a failed `get_me`) and `me: { login: '' }` read as no identity (login `''`). A `me` that is any other non-login shape (an error object such as `{ message: 'Bad credentials' }`, an array, a string) stays `FactsError('me', 'has no login')`, and a missing `me` key stays exit 1 — `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md` rule 3: an agent-recorded error object is never data. The agent states the failure explicitly by writing `null`.

## Review Focus

1. A probe that **succeeds with an empty login** (`gh api user` prints a blank line) must degrade exactly like a throwing one — not count as a login of `''` matching an author with no login (Task 1, `AC4.1`).
2. A **trusted** close comment plus a failed probe must give `close-only` with **no** degrade note — the note marks only the case where the fallback could have missed the bot's own comment (Task 1, `AC2.1`).
3. A failed probe must never mask a **REOPENED** or **CLOSED** parent: those return before the comment scan, with no note (Task 1, `evaluateIdempotence` cases).
4. The reconciler must not re-probe a failing token once per parent: the login read is memoized per `closeBelowFloorParents` call, failure included (Task 3, `AC5.1`).
5. The MCP facts path must not silently accept an agent-recorded error object as "no identity" (Task 2).

---

### Task 1: Core — failed or empty probe reads as no identity, with a degrade note

**Files:**
- Modify: `plugin/bin/lib/issues/parent-gate.js` (header line 8; `gatherIdempotenceFacts` ~line 222-239; `evaluateIdempotence` ~line 319-339; `module.exports`)
- Test: `tests/bin-lib/issues/parent-gate.test.js`

**Interfaces:**
- Produces: exported `IDENTITY_PROBE_FAILED_NOTE` (the Global Constraints string).
- Produces: `gatherIdempotenceFacts({ parent, owner, repo, host, caller, readLogin })` — new optional `readLogin: () => string`; default reads `caller.call(onHost(['api','user','--jq','.login'], host))`. A `GhFailure` thrown by the login read (default or injected) is caught and yields `login: ''`; the trimmed result is the login, so a blank line is `''` too. Every other read keeps throwing as today. Still reads the login only when `needsIdempotenceReads` (login `null` otherwise).
- Produces: `evaluateIdempotence(facts)` — after the comment scan, when `!counted` and `facts.login === ''`, push `IDENTITY_PROBE_FAILED_NOTE` onto `skipped` (after any untrusted-comment notes). `login: null` (reads not needed) or a non-empty login adds nothing.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/parent-gate.test.js`. First change the fake's login line (76) to `if (key === 'api user --jq .login') return \`${'login' in world ? world.login : 'bot'}\n\`;` so `login: ''` is expressible.
  - `AC1.1: gatherIdempotenceFacts reads login '' when the probe throws` — `throwWhen: (k) => k.startsWith('api user')`, open parent → returns `{ state: 'OPEN', stateReason: '', comments: [], login: '' }`, no throw.
  - `AC4.1: an empty probe line reads as login ''` — `world.login = ''` → `login: ''`.
  - `gatherIdempotenceFacts still throws when the comments read fails` — `throwWhen: (k) => k.includes('state,stateReason,comments')` → `GhFailure`.
  - `gatherIdempotenceFacts uses an injected readLogin` — `readLogin: () => 'x'` → `login: 'x'`, and the call log has no `api user` call.
  - `AC1.2: evaluateIdempotence adds the degrade note when login is empty and nothing counted` — `{ state: 'OPEN', stateReason: '', comments: [], login: '' }` → `{ idempotence: 'comment-and-close', skipped: [IDENTITY_PROBE_FAILED_NOTE] }`.
  - `AC2.1: a trusted marker with login '' is close-only and carries no note` — one `MEMBER` comment with the heading → `{ idempotence: 'close-only', skipped: [] }`.
  - `AC3.1: an untrusted own-bot marker with login '' reads as no comment` — `NONE` comment by `bot` with the heading → `comment-and-close`, `skipped` = `[untrustedSkipNote(c), IDENTITY_PROBE_FAILED_NOTE]`.
  - `the degrade note never applies to a CLOSED or REOPENED parent` — `login: ''` with `state: 'CLOSED'` → `already-closed`, `[]`; `stateReason: 'REOPENED'` → `reopened`, `[]`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js`
Expected: FAIL — `IDENTITY_PROBE_FAILED_NOTE` is undefined and the throwing-probe case throws `GhFailure`.

- [ ] **Step 3: Implement** the three Interfaces items in `parent-gate.js`; update header line 8 to `the login: api user --jq .login, only when needsIdempotenceReads(...); a failed or blank read is login '' (trusted authors only, evaluateIdempotence notes it).` Keep `isCloseMarkerComment` unchanged — it already returns false for a login match when login is empty.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js`
Expected: PASS, every pre-existing test included (`own-login heading comment counts` still green: AC6.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/parent-gate.js tests/bin-lib/issues/parent-gate.test.js
git commit -m "Read a failed identity probe as no login — trusted-only dedupe with a degrade note (#4770)"
```

### Task 2: MCP facts and CLI — `me: null` reads as no identity

**Files:**
- Modify: `plugin/bin/lib/issues/mcp-parent-gate-shape.js` (header comment line ~50; `withIdempotenceReads` ~line 214-216)
- Test: `tests/bin-lib/issues/mcp-parent-gate-shape.test.js` (lines ~218-235), `tests/parent-gate-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `evaluateIdempotence` note.
- Produces: `withIdempotenceReads(raw, idempotence)` — `me === null` or `me` a plain object whose `login === ''` → returns `{ ...idempotence, comments, login: '' }`. A non-empty string `login` → as today. Anything else (`{ message: … }`, array, string, number, `login` not a string) → `FactsError('me', 'has no login')` exit 3; missing key → exit 1, unchanged.

- [ ] **Step 1: Write the failing tests**
  - In `mcp-parent-gate-shape.test.js`: remove the `['me', { parentComments: [], me: { login: '' } }]` row from the invalid-entry table (line ~229), keep the `{ message: 'Bad credentials' }` row, and add `withIdempotenceReads reads me: null and an empty login as login ''` — both return `login: ''` with `comments: []`.
  - In `parent-gate-cli.test.js`: `AC1.3: --idempotence with a failing gh login read exits 0 with the degrade note` — the native happy world plus `throwWhen: (k) => k.startsWith('api user')`, below-floor due parent → exit 0, printed verdict `idempotence: 'comment-and-close'`, `skipped` includes `IDENTITY_PROBE_FAILED_NOTE`; and the same through `--facts-json` with `me: null` (reuse the facts builder at line ~491).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/parent-gate-cli.test.js`
Expected: FAIL after Step 1 — `me: null` raises `FactsError` (CLI exit 3) and the throwing gh probe exits 3.

- [ ] **Step 3: Implement** the Interfaces item; header comment for `me` becomes `` `get_me`, or null when get_me failed (read as no identity) ``.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/parent-gate-cli.test.js tests/bin-lib/issues/parent-gate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/mcp-parent-gate-shape.js tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/parent-gate-cli.test.js
git commit -m "Accept a null get_me in parent-gate facts — no identity, trusted-only dedupe (#4770)"
```

### Task 3: Reconciler — close despite a failed probe, read the login once per run

**Files:**
- Modify: `plugin/bin/lib/issues/below-floor-parent-close.js` (header comment; the `gatherIdempotenceFacts` call ~line 111)
- Test: `tests/bin-lib/issues/below-floor-parent-close.test.js`

**Interfaces:**
- Consumes: Task 1's `gatherIdempotenceFacts({ …, readLogin })` and the note in `skipped` (already copied into a closed entry's `notes`, line ~127).
- Produces: inside `closeBelowFloorParents`, one memoized `readLogin` per call — the first invocation runs `caller.call(['api','user','--jq','.login'] + host flag)` exactly as the core's default does; its result **or its `GhFailure`** is cached and replayed on later parents.

- [ ] **Step 1: Write the failing tests** (change the fake's login line 124 to the `'login' in world` form, as in Task 1):
  - `AC1.4: a throwing identity probe still closes the due parent with the degrade note` — `throwWhen: (k) => k.startsWith('api user')`, parent with no comments → one `issue comment` and one `issue close` call; `closed` = `[{ parent: 10, maxTier, notes: [IDENTITY_PROBE_FAILED_NOTE] }]`; no `skipped` entry with reason `gh-failed`.
  - `AC2.2: failed probe plus a trusted marker closes with no second comment and no note` — one `MEMBER` heading comment → no `issue comment` call, one close, entry has no `notes`.
  - `AC3.2: failed probe plus the bot's own NONE marker posts a second comment (accepted duplicate)` — `NONE` heading comment by `plugin-bot` → one `issue comment` call, one close, `notes` = `[untrustedSkipNote(c), IDENTITY_PROBE_FAILED_NOTE]`.
  - `AC4.2: an empty probe line behaves like a throwing one` — `login: ''` → same calls and note as AC1.4.
  - `AC5.1: the login is read at most once for a run closing two parents` — two closing records with two distinct due parents → both closed, and the call log holds exactly one `api user` call; repeat with the probe throwing → still one call, both closed.
  - `a working probe still counts the bot's own marker` — the existing own-login test stays green (AC6.2).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/below-floor-parent-close.test.js`
Expected: FAIL after Step 1 — before Task 1 the parent lands in `skipped` as `gh-failed`; after Task 1 alone, AC5.1 sees two `api user` calls.

- [ ] **Step 3: Implement** the memoized `readLogin` and pass it to `gatherIdempotenceFacts`. Update the header comment to say a failed or blank identity read closes with trusted-only matching, notes the degrade, and is read once per call.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/below-floor-parent-close.js tests/bin-lib/issues/below-floor-parent-close.test.js
git commit -m "Close a below-floor parent when the identity read fails — once-per-run login read (#4770)"
```

### Task 4: Prose — the rule in the parent gate, its MCP facts list, and tidy's verify line

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md` (MCP facts list ~line 278-283; **Close the parent below the floor** step 1 ~line 379-395)
- Modify: `plugin/skills/tidy/SKILL.md:205`
- Modify: `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md:19` (the `bin/parent-gate.js` row)
- Test: `tests/below-floor-parent-close-conformance.test.js`

**Interfaces:**
- Consumes: Tasks 1-3's behavior and the exact note string.

- [ ] **Step 1: Write the failing conformance tests** in `tests/below-floor-parent-close-conformance.test.js`, reading live prose with the suite's existing `read`/`collapse`/`closeSection` helpers:
  - `#4770: a failed identity read counts trusted authors only and is noted` — the close section contains the literal note string `` `identity probe failed — close marker matched against trusted authors only` `` and the phrase `never skips the parent`; the existing verbatim pin at line ~139 (`counting only a comment from a trusted author … (the CLI reads its login)`) stays as-is and passes (add the new sentence beside it, never reword it).
  - `#4770: the MCP facts list writes me as null when get_me fails` — the facts list contains ``- `me` — `get_me`, or `null` when `get_me` fails`` and the "If any MCP read fails, write no file" sentence names `get_me` as the exception.
  - `#4770: tidy's below-floor verify line accepts a trusted comment alone when the identity read fails` — `plugin/skills/tidy/SKILL.md` line containing `Closed parent below the floor` includes `when the identity read fails`.
  - `#4770: the prose note matches the code constant` — the string in the close section equals `require('…/parent-gate.js').IDENTITY_PROBE_FAILED_NOTE` (prose-code twin).
  - Go-red control: re-run each new assertion against the text with the new sentence removed and assert it fails.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL — the four new assertions.

- [ ] **Step 3: Edit the prose**
  - Step 1 (after the `close-only` bullet, before `comment-and-close`): one sentence — when the identity read fails or prints no login (`gh api user`, or `me: null` from a failed `get_me`), the CLI never skips the parent: only a trusted author's heading comment counts, so a `close-only` needs one, and on `comment-and-close` the verdict's `skipped` adds `` `identity probe failed — close marker matched against trusted authors only` ``, named in the output like the other skips. The accepted risk is one duplicate close comment when an earlier attempt posted under an untrusted association and its close then failed.
  - MCP facts list: `` - `me` — `get_me`, or `null` when `get_me` fails. `` and amend the following sentence to `If any MCP read other than \`get_me\` fails, write no file`.
  - `tidy/SKILL.md:205`: after `(\`gh api user --jq .login\`)` add `— or a trusted author's comment alone when the identity read fails`.
  - `mcp-agent-fetch-node-compute/SKILL.md:19`: append to the reader cell `; \`me\` may be \`null\` (a failed \`get_me\`), read as no identity`.
  - Check `wc -c` on both `plugin/skills` files stays under 52,500 B (now 41,916 and 43,256).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/bin-lib/issues/parent-gate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/verification-brief-parent-gate.md plugin/skills/tidy/SKILL.md .claude/skills/mcp-agent-fetch-node-compute/SKILL.md tests/below-floor-parent-close-conformance.test.js
git commit -m "State the failed-identity-read rule in the parent gate and tidy's verify line (#4770)"
```

### Task 5: Full suite

- [ ] **Step 1:** Run `npm test > {scratch}/npm-test-4770.txt 2>&1; echo exit=$?` and read the tail. Expected: `exit=0` — AC7.1: `npm test` passes on the full suite. A failure in `tests/closed-parent-acceptance-backstop.test.js` or anything citing `github-pr-scan-acceptance.md` is out of scope (#4801) and must be reported, not fixed here.
