# Status-Line Migration WU2 (design-wrapper + dispatch + specify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every remaining inline dispatch-prompt status-line instruction in the design-wrapper, dispatch, and specify skill families to the canonical trailing `STATUS: {WORD}` convention already landed in `plugin/skills/_shared/subagent-output-contract.md` (#2265).

**Architecture:** Pure mechanical text edits — no logic change, no test-code change. Each touched file's own dispatch-prompt template (a fenced/blockquoted block a subagent actually receives) must read a labeled trailing `STATUS: {WORD}` line as its last non-empty line; any surrounding prose describing that template must describe the same thing (trailing, labeled), not the retired first-line convention.

**Tech Stack:** Markdown skill files (no code). Verified via `npm test` (skill-prose conformance suites) after edits.

**Spec:** `/home/user/claude-tweaks/.claude/worktrees/dispatch-next/.claude-tweaks/pipelines/2026-09-16T062436-record-2266/work/2266-spec.md` (GitHub issue #2266)

## Global Constraints

- Canonical replacement wording comes from `plugin/skills/_shared/subagent-output-contract.md` (already landed): the reply's **last non-empty line** must read exactly `STATUS: {WORD}` where `{WORD}` is `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
- Match each file's own established phrasing style for the surrounding sentence — `plugin/skills/dispatch/task-prompt.md`'s two already-canonical instances (lines ~135-137, ~235-237) are the reference style: "Status line (required): on its own trailing line, after everything above — the reply's last non-empty line — write exactly `STATUS: {WORD}`, where {WORD} is one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED."
- Preserve each file's own formatting context exactly — blockquote `>` prefixes (red-team.md), list/code-fence placement, surrounding punctuation style (some files use em-dashes, `red-team.md`/`task-prompt.md` use `--`/`—` per their own existing convention — never introduce a new punctuation style, keep whatever the line already used before the words being replaced).
- Do not touch `plugin/skills/_shared/subagent-output-contract.md` itself, `plugin/bin/lib/hooks/subagent-stop.js`, or any file outside the 5 named below (Non-Goals).
- `plugin/skills/dispatch/task-prompt.md` and `plugin/skills/specify/mechanical-handoff.md`'s Status-line sentence(s) that already read the canonical `STATUS: {WORD}` labeled form need no wording change to that clause — investigate live content per-task before editing; do not blind-apply a diff.

---

## Investigation findings (live-repo state as of this plan — supersedes the spec's own "Current State" section, which has drifted)

The spec's Current State section quotes an old first-line instruction verbatim for all 6 named instances. Live inspection shows the repo has already partially migrated independently of this record:

| File | Actual current state |
|---|---|
| `design-wrapper/modes/explore.md` line 92 (prose) | Still asserts **first-line** position ("a status line as the first line of the reply") — not in the spec's list at all, but the same file, same protocol description, and contradicts the file's own template below it |
| `design-wrapper/modes/explore.md` lines 109-110 (template) | Already **trailing**, but **unlabeled** bare word list |
| `design-wrapper/modes/review.md` line 222 (prose) | Still asserts **first-line** position ("...as its first line, then the table") |
| `design-wrapper/modes/review.md` lines 268-269 (template, inside fenced OUTPUT FORMAT block) | Already **trailing**, but **unlabeled** bare word list |
| `design-wrapper/modes/review.md` line 282 (parse/encode table) | Describes detection as "First line `BLOCKED` or `NEEDS_CONTEXT`" — stale once the template moves to trailing; update for internal consistency |
| `dispatch/task-prompt.md` lines ~135-137 and ~235-237 (both instances) | Already **fully canonical** (`STATUS: {WORD}`, trailing, labeled) — no edit needed |
| `specify/mechanical-handoff.md` lines 67-68 (template) | Already **trailing**, but **unlabeled** bare word list — NOT already canonical (spec's own text was right about this one being unmigrated, wrong about the exact old wording) |
| `specify/red-team.md` line 20 (Contract prose, inside `>` blockquote) | Still asserts **first-line** position ("...as its first reply line") |
| `specify/red-team.md` line 44 (template, inside `>` blockquote) | Already **trailing**, but **unlabeled** bare word list |

Net: `task-prompt.md` needs no edit. The other 4 files each need 1-3 small edits. Total edit sites: 8 (not the spec's originally-quoted 6), because the live text differs from the spec's stale snapshot and `explore.md`/`review.md` each carry an extra out-of-sync prose sentence the spec didn't name.

---

### Task 1: design-wrapper/modes/explore.md

**Files:**
- Modify: `plugin/skills/design-wrapper/modes/explore.md:92` (prose) and `:109-110` (template)
- Test: none (prose-only skill file; verified via `npm test`'s existing skill-prose conformance suites, no new test needed)

**Interfaces:**
- Consumes: nothing from other tasks — file is edited independently.
- Produces: nothing later tasks depend on — each file's edit is independent.

- [ ] **Step 1: Read the two sites and confirm current line numbers**

```bash
grep -n "first line\|Status line (required)" plugin/skills/design-wrapper/modes/explore.md
```

Expected: two matches, one near line 92 ("...a status line as the first line of the reply..."), one near line 109-110 ("Status line (required): after everything above, on its own trailing line — the last non-empty\nline of your reply — write exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.").

- [ ] **Step 2: Edit line 92 (prose)**

Change:
```
One Task agent per presented direction, per `skills/_shared/subagent-output-contract.md`: **Standard** profile (fan-out — never Frontier), a status line as the first line of the reply, and clean-room input limited to the synthesized direction card plus the shared markup path (read-only). Builders never restructure markup to compensate for a direction that doesn't fit — see the previous step.
```
To:
```
One Task agent per presented direction, per `skills/_shared/subagent-output-contract.md`: **Standard** profile (fan-out — never Frontier), a trailing `STATUS: {WORD}` line as the last non-empty line of the reply, and clean-room input limited to the synthesized direction card plus the shared markup path (read-only). Builders never restructure markup to compensate for a direction that doesn't fit — see the previous step.
```

- [ ] **Step 3: Edit lines 109-110 (template)**

Change:
```
Status line (required): after everything above, on its own trailing line — the last non-empty
line of your reply — write exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
```
To:
```
Status line (required): after everything above, on its own trailing line — the last non-empty
line of your reply — must read exactly `STATUS: DONE` (or DONE_WITH_CONCERNS / NEEDS_CONTEXT /
BLOCKED).
```

- [ ] **Step 4: Verify no old-convention text remains in this file**

Run: `grep -n "first line" plugin/skills/design-wrapper/modes/explore.md`
Expected: no matches.

Run: `grep -c "STATUS:" plugin/skills/design-wrapper/modes/explore.md`
Expected: at least 1.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/design-wrapper/modes/explore.md
git commit -m "Migrate explore.md status-line instruction to canonical trailing STATUS: line

refs #2266"
```

---

### Task 2: design-wrapper/modes/review.md

**Files:**
- Modify: `plugin/skills/design-wrapper/modes/review.md:222` (prose), `:268-269` (template), `:282` (parse/encode table)
- Test: none

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Read the three sites and confirm current line numbers**

```bash
grep -n "first line\|Status line\|DONE / DONE_WITH_CONCERNS" plugin/skills/design-wrapper/modes/review.md
```

- [ ] **Step 2: Edit line 222 (prose, Contract summary)**

Change the clause `one of {DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED} as its first line, then the table` to `a trailing `STATUS: {WORD}` line as the last non-empty line of the reply, after the table` — keep the rest of the sentence (Standard profile, dispatch-shape citation, "Inline the template literally...") unchanged.

- [ ] **Step 3: Edit lines 268-269 (template, inside the fenced OUTPUT FORMAT block)**

Change:
```
After the table, on its own trailing line — the last non-empty line of your reply — write exactly
one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
```
To:
```
After the table, on its own trailing line — the last non-empty line of your reply — must read
exactly `STATUS: DONE` (or DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED).
```

- [ ] **Step 4: Edit line 282 (parse/encode table, "Refused" row)**

Change:
```
| **Refused** | First line `BLOCKED` or `NEEDS_CONTEXT` | `{provider, ran: true, parsed: false, reason: "<status>: <agent's own text>"}` | `SCANNED` naming provider + reason |
```
To:
```
| **Refused** | Trailing `STATUS: BLOCKED` or `STATUS: NEEDS_CONTEXT` line | `{provider, ran: true, parsed: false, reason: "<status>: <agent's own text>"}` | `SCANNED` naming provider + reason |
```

- [ ] **Step 5: Verify**

Run: `grep -n "first line" plugin/skills/design-wrapper/modes/review.md`
Expected: no matches.

Run: `grep -c "STATUS:" plugin/skills/design-wrapper/modes/review.md`
Expected: at least 2.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/design-wrapper/modes/review.md
git commit -m "Migrate review.md status-line instruction to canonical trailing STATUS: line

refs #2266"
```

---

### Task 3: specify/mechanical-handoff.md

**Files:**
- Modify: `plugin/skills/specify/mechanical-handoff.md:67-68`
- Test: none

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Read the site and confirm current line numbers**

```bash
grep -n "Status line (required)" plugin/skills/specify/mechanical-handoff.md
```

- [ ] **Step 2: Edit lines 67-68**

Change:
```
Status line (required): after the summary above, on its own trailing line — the last non-empty
line of your reply — write exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
```
To:
```
Status line (required): after the summary above, on its own trailing line — the last non-empty
line of your reply — must read exactly `STATUS: DONE` (or DONE_WITH_CONCERNS / NEEDS_CONTEXT /
BLOCKED).
```

- [ ] **Step 3: Verify**

Run: `grep -n "first line" plugin/skills/specify/mechanical-handoff.md`
Expected: no matches (there were none before either — this file never had the first-line phrasing, only the unlabeled-trailing one).

Run: `grep -c "STATUS:" plugin/skills/specify/mechanical-handoff.md`
Expected: at least 1.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/specify/mechanical-handoff.md
git commit -m "Migrate mechanical-handoff.md status-line instruction to canonical trailing STATUS: line

refs #2266"
```

---

### Task 4: specify/red-team.md

**Files:**
- Modify: `plugin/skills/specify/red-team.md:20` (Contract prose), `:44` (template) — both inside the file's `>` Form B blockquote
- Test: none

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Read the two sites and confirm current line numbers**

```bash
grep -n "first reply line\|After the table, on its own trailing line" plugin/skills/specify/red-team.md
```

- [ ] **Step 2: Edit line 20 (Contract prose, inside blockquote)**

Change:
```
> **Contract:** Each agent follows the Subagent Contract — minimal input (a record reference + persona lens question + Template A), one of `DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED` as its first reply line. `[Use: Standard]` (resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`, contract § Model Selection). Read-only — personas never modify the record themselves.
```
To:
```
> **Contract:** Each agent follows the Subagent Contract — minimal input (a record reference + persona lens question + Template A), a trailing `STATUS: {WORD}` line (one of DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED) as the last non-empty line of its reply. `[Use: Standard]` (resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`, contract § Model Selection). Read-only — personas never modify the record themselves.
```

Preserve the leading `> ` prefix exactly as it already appears on this line.

- [ ] **Step 3: Edit line 44 (template, inside blockquote)**

Change:
```
> After the table, on its own trailing line — the last non-empty line of your reply — write exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
```
To:
```
> After the table, on its own trailing line — the last non-empty line of your reply — must read exactly `STATUS: DONE` (or DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED).
```

Preserve the leading `> ` prefix exactly as it already appears on this line.

- [ ] **Step 4: Verify**

Run: `grep -n "first reply line\|first line" plugin/skills/specify/red-team.md`
Expected: no matches.

Run: `grep -c "STATUS:" plugin/skills/specify/red-team.md`
Expected: at least 1.

Run: `grep -n "^> " plugin/skills/specify/red-team.md | sed -n '1,5p'` — spot-check the blockquote prefix survived on both edited lines (visual check, not a hard assertion).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/red-team.md
git commit -m "Migrate red-team.md status-line instructions to canonical trailing STATUS: line

refs #2266"
```

---

### Task 5: dispatch/task-prompt.md — verify-only, no edit expected

**Files:**
- Read-only check: `plugin/skills/dispatch/task-prompt.md:135-137` and `:235-237`

**Interfaces:**
- Consumes: nothing.
- Produces: confirmation that this file needs no edit (or, if investigation was wrong, the same edit pattern as Tasks 1-4).

- [ ] **Step 1: Confirm both instances are already canonical**

```bash
grep -n "Status line (required)" plugin/skills/dispatch/task-prompt.md
```

Expected: two matches, each reading `write exactly \`STATUS: {WORD}\`, where {WORD} is one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.` (trailing, labeled — already canonical).

- [ ] **Step 2: If confirmed canonical, no edit — log a no-op note in the build handoff.**

If either instance turns out NOT to already be canonical (investigation was stale), apply the same edit pattern as Task 1 Step 3 to that instance, then commit with the same message pattern as Tasks 1-4.

---

## Final verification (after Tasks 1-5)

- [ ] Run the full positive/negative sweep across all 5 files in one shot:

```bash
grep -rn "first line\|first reply line" plugin/skills/design-wrapper/modes/explore.md plugin/skills/design-wrapper/modes/review.md plugin/skills/dispatch/task-prompt.md plugin/skills/specify/mechanical-handoff.md plugin/skills/specify/red-team.md
```
Expected: no matches (empty output).

```bash
grep -c "STATUS:" plugin/skills/design-wrapper/modes/explore.md plugin/skills/design-wrapper/modes/review.md plugin/skills/dispatch/task-prompt.md plugin/skills/specify/mechanical-handoff.md plugin/skills/specify/red-team.md
```
Expected: every file ≥ 1 (task-prompt.md ≥ 2).

- [ ] Run `npm test` — expect full pass, no regressions.
