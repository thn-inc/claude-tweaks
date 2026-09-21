---
record: 649
origin: capture
risk: low
size: medium
ceremony: standard
grants: [build]
---
# 649: subagent contract: fan-out prose says parallel but never says emit all Agent calls in one message — red-team launched 18 agents serially

**Related:** #619

Origin: /claude-tweaks:feedback session evaluation (Instruction efficacy lens), 2026-08-16 session

## Current State

`skills/specify/red-team.md`'s Parallel dispatch block says "Dispatch the selected persona(s) as parallel Task agents … each runs independently and returns Template-A findings … Assemble results after all agents complete." `_shared/subagent-output-contract.md`'s fan-out guidance likewise says "parallel" without stating the mechanism. In the evaluated `/specify` run (6 `ceremony:standard` sub-issues → 18 personas), every `Agent` call was emitted as its own assistant message, ~7 s apart, each launch acknowledged before the next was issued — 2m11s of serialized launch round-trips for a dispatch the text calls parallel. The dispatch prompts themselves were contract-conformant (status line, Template A inlined, `[Use: Standard]` resolved, minimal input); only the dispatch *shape* diverged. The harness runs tool calls concurrently only when they are emitted as multiple `tool_use` blocks in one message; nothing in the plugin's text says so.

## Deliverables

- [ ] `_shared/subagent-output-contract.md` fan-out section: one explicit sentence — "emit all N `Agent`/`Task` calls of a fan-out as tool_use blocks in a single assistant message; a call per message is a serialized dispatch even when the prose says parallel" — plus the batching unit for large fan-outs (one message per record's persona set, never one per agent).
- [ ] `skills/specify/red-team.md` Parallel execution block: cite that sentence and state the unit for this dispatch (one message per sub-issue trio; a `fast-lane` sub-issue's single Skeptical Reviewer joins the next message).
- [ ] The other fan-out sites named in CLAUDE.md's Subagent Contract paragraph (`/browse`, `/dispatch`, `/help`, `/init`, `/review`, `/test`, `/tidy`, `/visual-review`) each cite the contract sentence once — no restated mechanism.
- [ ] `tests/subagent-contract-clauses.test.js`: pins the contract sentence's presence and each fan-out site's citation.

## Acceptance Criteria

1. `grep -n "single assistant message" skills/_shared/subagent-output-contract.md` matches once; each listed fan-out site cites the contract's fan-out section (test-pinned).
2. A `/specify` red-team over 2+ `ceremony:standard` sub-issues launches its personas in ≤ (number of sub-issues) assistant messages, verified in the transcript by `Agent` tool_use blocks sharing a message id.

