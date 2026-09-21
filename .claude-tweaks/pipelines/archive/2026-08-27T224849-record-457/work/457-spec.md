---
record: 457
origin: capture
risk: medium
size: low
ceremony: standard
grants: [build]
surface: backend
---
# 457: EnterWorktree PostToolUse handler may be dead code — no hooks.json matcher

Surface: backend

## Current State

#452's final review found `hooks/hooks.json` had no PostToolUse matcher for `AskUserQuestion`, making its hook handler unreachable in production despite the handler code itself being correct. The same defect class has now been spotted a second time: `checkWorktreeStaleness` (`bin/lib/hooks/post-tool-use.js`, from #307) checks `tool_name === 'EnterWorktree'`, but `hooks/hooks.json`'s PostToolUse array has no `EnterWorktree` matcher either — only `Bash`, `Write`, `Skill`, and `AskUserQuestion` are registered — so `checkWorktreeStaleness` is possibly also dead code in production, exactly like #452's finding.

## Deliverables

- [ ] Audit every `tool_name` value checked anywhere in `post-tool-use.js`'s `run()` and its dispatched handlers against `hooks.json`'s PostToolUse matcher array.
- [ ] Add any missing matcher(s) `hooks.json` needs so every handler that checks a `tool_name` is actually reachable.
- [ ] Add a pinning test per matcher in `tests/hooks-dispatcher.test.js`, modeled on #452's `AskUserQuestion` pinning test, so this gap class can't recur silently for any handler added in the future.

## Acceptance Criteria

- Every `tool_name` string compared in `post-tool-use.js` (directly in `run()` or inside a dispatched handler) has a corresponding matcher in `hooks.json`'s PostToolUse array — confirmed by the audit and, where a gap is found, closed by adding the matcher.
- `tests/hooks-dispatcher.test.js` carries one pinning test per PostToolUse matcher, asserting the matcher is present and would route to its handler — same pattern as #452's `AskUserQuestion` test.
- `npm test` green, including the new pinning tests.

## Technical Approach

Grep `post-tool-use.js` for every `tool_name ===` (or equivalent) comparison, across `run()` and every handler it dispatches to (including `checkWorktreeStaleness`), building the full set of tool names the module actually depends on being routed. Diff that set against `hooks.json`'s PostToolUse matcher array. For each tool name present in the code's dependency set but absent from `hooks.json`, add the matcher entry. Then add one pinning test per matcher in `tests/hooks-dispatcher.test.js`, following #452's `AskUserQuestion` pinning test as the template — each test should fail if its matcher is ever removed from `hooks.json` without the corresponding handler code also being removed, closing the class of gap this record and #452 both found.

### Key Files

- `plugin/hooks/hooks.json` — PostToolUse matcher array; add any missing entries
- `plugin/bin/lib/hooks/post-tool-use.js` — `run()` and dispatched handlers (including `checkWorktreeStaleness` from #307); source of the `tool_name` audit
- `tests/hooks-dispatcher.test.js` — add one pinning test per matcher, modeled on #452's `AskUserQuestion` test

## Gotchas

- This is the second instance of the same defect class #452 found (missing `AskUserQuestion` matcher) — the audit should be exhaustive across every handler, not just the one instance (`EnterWorktree`/`checkWorktreeStaleness`) that prompted this record, since other silently-unreachable handlers may exist too.
- Confirm `checkWorktreeStaleness` is genuinely unreachable (not reachable through some other matcher or dispatch path) before treating it as dead code — the audit step should verify this rather than assume it from the pattern match to #452 alone.

## Original request

EnterWorktree PostToolUse handler may be dead code — no hooks.json matcher

**Related:** #452

Context: #452's final review found hooks.json had no PostToolUse matcher for AskUserQuestion, making its hook handler unreachable in production. `checkWorktreeStaleness` (`bin/lib/hooks/post-tool-use.js`, from #307) checks `tool_name === 'EnterWorktree'`, but `hooks/hooks.json`'s PostToolUse array has no `EnterWorktree` matcher either (only `Bash`, `Write`, `Skill`, `AskUserQuestion`) — the same defect class, possibly also dead code in production.

Scope: audit every `tool_name` checked in `post-tool-use.js`'s `run()` and its dispatched handlers against `hooks.json`'s PostToolUse matchers, add any missing matcher(s), and add a pinning test per matcher in `tests/hooks-dispatcher.test.js` (modeled on #452's AskUserQuestion pinning test) so this gap class can't recur silently.

