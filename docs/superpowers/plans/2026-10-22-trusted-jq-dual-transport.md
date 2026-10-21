# Trusted-Author jq on Both Transports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the jq filters `comment-trust.js` generates (and skill prose pastes verbatim) trust a comment whether its association arrives as `authorAssociation` (`gh --json comments`) or `author_association` (REST / MCP).

**Architecture:** `trustedJqPredicate()` reads the association through one jq alternative, `(.authorAssociation // .author_association)`, per set member; `untrustedJqNote()` reads ref/login/association with the same both-shape fallbacks `untrustedSkipNote()` already uses. The two builders stay the single generator. Every prose copy is re-pasted from the new output, and a repo-wide sweep test pins that no prose copy is anything but the generator's text.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `jq` (real binary, skip when absent), gh's built-in gojq for `--jq`/`-q`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T224031-record-3823/work/3823-spec.md`

Premise-refs: plugin/bin/lib/issues/comment-trust.js
Premise-refs: tests/comment-trust-conformance.test.js
Premise-refs: tests/materiality-floor-conformance.test.js

## Global Constraints

- `trustedJqSelect()` / `untrustedJqNote()` stay the single generator; prose copies are byte-equal to their output (spec Deliverables 1-2).
- Trusted set and order unchanged: `OWNER`, `MEMBER`, `COLLABORATOR` (`TRUSTED_AUTHOR_ASSOCIATIONS`, "Order is part of the contract").
- jq text must contain no `$` (prose commands run through the harness Bash guard) and no `|` inside `trustedJqSelect()` (tidy's markdown-table copy escapes pipes as `\|`).
- jq must run on jq 1.5+ and gojq (gh `--jq`): use only `//`, `==`, `or`, `not`, string interpolation — no `IN`, no `as $x`.
- The real-jq test skips where `jq` is absent, same precedent as the existing `untrustedJqNote` test.

## Verified premises (run at authoring time, 2026-10-22)

- REST shape: `gh api repos/thn-inc/claude-tweaks/issues/3823/comments --jq '.[] | {author_association, url, html_url, id, login: .user.login}'` printed `{"author_association":"MEMBER","html_url":"https://github.com/...#issuecomment-6328175953","id":6328175953,"login":"thomasholknielsen","url":"https://api.github.com/repos/thn-inc/claude-tweaks/issues/comments/6328175953"}`.
- gh shape: `gh issue view 3823 --json comments --jq '.comments[] | {authorAssociation, url, login: .author.login}'` printed `{"authorAssociation":"MEMBER","login":"thomasholknielsen","url":"https://github.com/...#issuecomment-6328175953"}`.
- The planned select, run through gh's gojq over both shapes, kept the MEMBER comment (printed its `.id` / `.url`); the planned note format over the REST shape printed `skipped marker comment https://api.github.com/repos/thn-inc/claude-tweaks/issues/comments/6328175953 by thomasholknielsen (MEMBER) — ...`.

## Review Focus

1. A comment carrying both fields with different values — camelCase must win in jq exactly as `commentAssociation()` does (`{authorAssociation: "NONE", author_association: "MEMBER"}` → untrusted). Pinned in Task 1.
2. `authorAssociation: ""` beside `author_association: "MEMBER"` — jq's `//` keeps `""` (only null/false fall through), so jq drops it while the JS trusts it. Not a GitHub output (no transport emits both); the divergence is fail-closed. State it in the builder's comment and pin jq's drop in Task 1 so a future change is deliberate.
3. Lowercase `member` on either spelling stays untrusted in jq. Pinned in Task 1.
4. A REST comment with a deleted author (`user: null`) and a REST comment with no association — the note prints `unknown` / `no association`, equal to `untrustedSkipNote()`. Pinned in Task 1.
5. A prose copy silently left on the old predicate (the record's actual failure mode). Pinned by Task 2's sweep with exact copy counts.

---

### Task 1: Generator reads both association spellings

**Files:**
- Modify: `plugin/bin/lib/issues/comment-trust.js`
- Test: `tests/bin-lib/issues/comment-trust.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged exports. New exact outputs (Task 2 pastes these):
  - `trustedJqSelect()` → `select((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR")`
  - `untrustedJqNote()` → `select(((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR") | not) | "skipped marker comment \(.url // .html_url // .id // "unknown") by \(.author.login // .user.login // "unknown") (\(.authorAssociation // .author_association // "no association")) — not an owner, member, or collaborator"`

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/comment-trust.test.js`; update the existing literal pins)

  - Replace both literals in `'trustedJqSelect/untrustedJqNote are derived from the set'` with the two exact strings in Interfaces above (JS-escaped: `\\(` in the note).
  - New test `'AC1.1: trustedJqSelect keeps a trusted comment on both transports (real jq)'`: skip when `jq --version` fails (same probe as the existing jq test). Input `{ comments: [...] }` run as `jq -c '.comments[] | <trustedJqSelect()> | .n'`; comments and expected kept `n`s:
    - `{n:1, authorAssociation:'MEMBER'}` kept (gh shape)
    - `{n:2, author_association:'MEMBER'}` kept (REST shape)
    - `{n:3, author_association:'OWNER'}`, `{n:4, author_association:'COLLABORATOR'}` kept
    - `{n:5, author_association:'CONTRIBUTOR'}`, `{n:6, author_association:'NONE'}`, `{n:7}`, `{n:8, author_association:'member'}`, `{n:9, authorAssociation:'member'}` dropped
    - `{n:10, authorAssociation:'NONE', author_association:'MEMBER'}` dropped (camelCase wins — Review Focus 1)
    - `{n:11, authorAssociation:'', author_association:'MEMBER'}` dropped (Review Focus 2 — fail-closed divergence from `isTrustedComment`, which returns true; assert both facts)
    - Assert stdout lines equal `['1','2','3','4']`, and for every comment except n:11 that jq's keep/drop equals `isTrustedComment(c)`.
  - Extend `'untrustedJqNote prints the same text as untrustedSkipNote...'`: add REST-shaped comments `{ url:'https://api/c4', html_url:'https://x/c4', user:{login:'eve'}, author_association:'NONE' }`, `{ html_url:'https://x/c5', user:null, author_association:'CONTRIBUTOR' }`, `{ id: 6, user:{login:'bot[bot]'} }`; the existing assertion (jq stdout === each `untrustedSkipNote(c)` joined by `\n`) covers them unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/comment-trust.test.js`
Expected: FAIL after Step 1 — the literal pins and the REST-shape rows (n:2-4, c4-c6) fail against the old `.authorAssociation`-only builders.

- [ ] **Step 3: Implement in `plugin/bin/lib/issues/comment-trust.js`**

  `trustedJqPredicate()` maps each set member to `(.authorAssociation // .author_association) == "${a}"`, joined by ` or ` (keep set order). `untrustedJqNote()` emits the exact string in Interfaces. Update the two builder comments: both shapes are read; jq's `//` passes `""` through, so a comment carrying an empty camelCase field beside a snake_case one is untrusted in jq but trusted by `isTrustedComment` — no transport emits both fields, and the divergence fails closed. Update the module header's "Skill prose ... pastes" paragraph to say the pasted filters read either spelling.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/comment-trust.test.js`
Expected: PASS (all tests; the jq tests run, not skipped, on this machine — jq-1.8.2 present).

Note: `tests/comment-trust-conformance.test.js` and `tests/materiality-floor-conformance.test.js` go red after this task (prose still holds the old text) and are restored by Task 2 — do not edit prose here.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/comment-trust.js tests/bin-lib/issues/comment-trust.test.js
git commit -m "Read both association spellings in the trusted-author jq builders — refs #3823"
```

### Task 2: Re-paste every prose copy and pin the sweep

**Files:**
- Modify: `plugin/skills/_shared/pr-run-comments.md` (lines 106-107 prose; 121-122 fence; 144 and 153 Find-step commands)
- Modify: `plugin/skills/tidy/digest-sweep.md` (lines 43, 50)
- Modify: `plugin/skills/tidy/scan-procedures.md` (line 124, inside a markdown table — the select has no `|`, so paste it as-is)
- Modify: `plugin/skills/backlog/grant-lane-decision.md` (lines 36, 37)
- Modify: `plugin/skills/specify/shaping-mode-stamping.md` (lines 105, 106)
- Test: `tests/comment-trust-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `trustedJqSelect()` / `untrustedJqNote()` exact outputs.
- Produces: nothing new.

Byte headroom (`RAIL_BYTES` 52,500 B; each select grows ~81 B, each note ~117 B): pr-run-comments.md 17,939 B; digest-sweep.md 6,991 B; scan-procedures.md 42,475 B (largest; +81 B leaves ~9.9 KB); grant-lane-decision.md 8,735 B; shaping-mode-stamping.md 23,383 B. All stay well under the rail.

- [ ] **Step 1: Write the failing test** (append to `tests/comment-trust-conformance.test.js`)

  New test `'AC2.1: every jq trust filter in plugin/skills is the generator output'`: walk every `*.md` under `plugin/skills` (recursive `fs.readdirSync`), and per file count occurrences of `trustedJqSelect()` and of `untrustedJqNote()`, then delete every occurrence of both (note first). Assert:
  - total select copies === 6 and note copies === 5 (exact: pr-run-comments 2+2, digest-sweep 1+1, scan-procedures 1+0, grant-lane-decision 1+1, shaping-mode-stamping 1+1);
  - no file's remainder contains `authorAssociation ==`, `author_association ==`, or `"no association"` (a hand-edited or stale copy);
  - `trustedJqSelect()` contains `.author_association` (anchors the sweep to the dual-transport form).
  Go-red control `'the AC2.1 sweep goes red on a stale copy'`: factor the per-text assertions into one function both tests call; run it over a frozen excerpt holding the pre-change select `select(.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR")` and assert it throws.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/comment-trust-conformance.test.js tests/materiality-floor-conformance.test.js`
Expected: FAIL after Step 1 — every existing prose pin fails against Task 1's new generator output, and the AC2.1 sweep finds 0 copies plus old-predicate remainders.

- [ ] **Step 3: Re-paste the prose copies**

  Print the generator output (`node -e "const m=require('./plugin/bin/lib/issues/comment-trust.js');console.log(m.trustedJqSelect());console.log(m.untrustedJqNote())"`) and replace each old select/note copy at the lines listed in Files with it byte-for-byte, leaving the surrounding command text unchanged. In `pr-run-comments.md`'s Trusted authors paragraph, after "the REST and MCP transports return it as `author_association`.", add: "The filters below read either spelling, so they work on every transport."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/comment-trust-conformance.test.js tests/materiality-floor-conformance.test.js tests/bin-lib/issues/comment-trust.test.js`
Expected: PASS.

Run: `grep -rlF '(.authorAssociation // .author_association) == "OWNER"' plugin/skills`
Expected: exactly the five Modify files above (AC2.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-run-comments.md plugin/skills/tidy/digest-sweep.md plugin/skills/tidy/scan-procedures.md plugin/skills/backlog/grant-lane-decision.md plugin/skills/specify/shaping-mode-stamping.md tests/comment-trust-conformance.test.js
git commit -m "Re-paste the dual-transport trusted-author jq into every skill copy — refs #3823"
```

## As-built deviations (Common Step 4.5)

- Beneficial — final whole-branch review fix wave (16b9517dd): `.claude/skills/prose-code-twin-pin/SKILL.md` copy-derivation grep re-pointed at the new-form needle `(.authorAssociation // .author_association) == "OWNER"` (the old needle returned zero files after Task 2); the AC2.1 sweep also rejects `== "OWNER"` / `== "MEMBER"` / `== "COLLABORATOR"` remainders, with a go-red control for a COLLABORATOR-dropped and a spelling-swapped new-form copy. Neither was in Task 2; both close the record's own stale-copy failure mode.
- Beneficial — `pr-run-comments.md` sentence reads "so they work on either comment shape" (plan said "on every transport"; the Find-step commands are gh-only, so the plan wording overclaimed).
