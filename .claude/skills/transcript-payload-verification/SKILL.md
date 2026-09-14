---
name: transcript-payload-verification
description: Use when implementing against a tool, hook, or API payload whose shape is only known from a type declaration, SDK doc, or third-party spec — never an observed live payload — and getting it wrong would be expensive to discover later. Verifies the real shape by reading this session's own locally-stored transcript. Keywords - payload verification, hook contract, SDK types, live capture, ground truth, transcript.
---

# Transcript Payload Verification — Ground Truth Over Documented Contracts

A documented type declaration or SDK contract describes what a payload is *supposed* to look
like. The live boundary — a hook, a tool call, an API response — can differ from that
documentation without warning. This skill is the fix: before writing code that parses or
branches on a payload shape, check what the payload actually looked like the last time it
crossed that boundary in this very session.

**Lifecycle:** utility, no fixed position. Reach for it whenever a plan or task depends on the
exact shape of a tool/hook/API payload and the only evidence available is a type declaration or
documentation, not an observed instance.

## Why this matters

A type declaration is a claim about the documented contract, not a guarantee about what a
specific integration point actually sends. This project shipped an example of the gap: an
`AskUserQuestion` `PostToolUse` hook handler was implemented against the `@anthropic-ai/claude-agent-sdk`'s
documented `AskUserQuestionOutput` shape (`{questions, answers}`) — a reasonable, well-cited
assumption. The real `tool_response` at that hook boundary is always a plain string. Every
parsed `answer` field would have logged `null` forever in production. The mismatch was only
caught by reading a real captured transcript during a final review, by chance, rather than as a
standard step in implementing the handler.

## Procedure

1. **Locate the current session's transcript file.** Session transcripts are stored locally at
   `~/.claude/projects/<project-slug>/<session-id>.jsonl` (one line per turn/event, JSON-encoded).
   The project-slug is derived from the working directory path; the session-id is this session's
   own UUID.
   **Resolve the config root; do not assume `~/.claude`.** When `$CLAUDE_CONFIG_DIR` is set the
   store is `$CLAUDE_CONFIG_DIR/projects/`. On this machine that is
   `~/.claude-accounts/{account}/projects/`, which `~/.claude/projects/` happens to resolve to
   (same inode) — but the sibling `plugins/` directory does *not* coincide, and reading the
   `~/.claude` spelling of it is what made a probe in #418 report a registered marketplace as
   absent. Never generalize one child's coincidence to the rest of the tree.
2. **Grep for the target tool's `tool_use`/`tool_result` pairs.** Each `tool_use` block names the
   tool and its input; the matching `tool_result` (or a later `tool_use` referencing the same
   `tool_use_id`) carries what actually came back. Read several real examples, not just one — a
   single sample can't distinguish "always this shape" from "this shape, this one time."
3. **Treat the transcript's real payloads as the reference shape** — not the type declaration —
   when writing the parsing/handling code. If the two disagree, the transcript wins for what to
   implement against; the type declaration is worth noting as the documented-but-inaccurate
   contract, so a future reader isn't tempted to "fix" the code back toward it.
4. **Still write defensively.** Verifying against one session's transcript only confirms the
   current harness/SDK version's behavior — it doesn't guarantee future stability. Parse
   defensively (never throw on an unexpected shape) regardless of what the transcript showed; see
   `plugin/bin/lib/hooks/post-tool-use.js`'s `extractToolResponseText` for the pattern this project
   already uses for exactly this reason.

## A hook's *input* payload is not in the transcript at all

The procedure above reaches a tool's `tool_use`/`tool_result` pair — which is where a
`PostToolUse` handler's `tool_response` lives, the shape the Origin case below turned on. It does
**not** reach the **hook input envelope**: the object the harness hands the hook process on stdin
(`hook_event_name`, `agent_type`, `agent_id`, `permission_mode`, `agent_transcript_path`). Those
fields are never written to a session transcript — check it live rather than trusting a count
here: `grep -l hook_event_name "$CLAUDE_CONFIG_DIR"/projects/*/*.jsonl` finds nothing on this
machine's store, while the same grep for `tool_use` matches most files in it. Nothing under
`plugin/bin/lib/hooks/` persists the raw `ctx.input` either, so a run directory's `events.jsonl`
is not a substitute — it carries typed events, never the payload that produced them.

So for a hook-input field, "no relevant transcript exists — proceed defensively" (see *When not to
use*) is the wrong exit: there is never going to be one, and the field is capturable in minutes.
The route this repo has already proven is a **throwaway hook** — point `claude -p` at a scratch
settings file registering the event you care about, have it append its stdin to a capture file,
run each scenario you need to distinguish, then read the raw lines:

```bash
mkdir -p /tmp/cap && cat > /tmp/cap/hook-settings.json <<'JSON'
{"hooks":{"SubagentStop":[{"hooks":[{"type":"command","command":"cat >> /tmp/cap/capture.jsonl"}]}]}}
JSON
cd /tmp/cap && claude -p --settings /tmp/cap/hook-settings.json "<scenario prompt>"
```

Record #371 ran exactly this against `PostToolUse`/`Skill` and pinned five separate answers off
it, including two the reference docs did not state:
`.claude-tweaks/pipelines/archive/2026-08-13T201329-spec-371-372-373/spec-371/work/task0-findings.md`
holds the verbatim payload lines, and `plugin/bin/lib/hooks/skill-invocation.js`'s header comment
carries the distilled `(a)`-`(e)` results. Run one scenario per branch your code will take — that
capture is still the only *observed* `agent_type` value in this repo (`"general-purpose"`, a bare
built-in with no namespace), so the namespaced `plugin:agent-name` form that
`plugin/bin/lib/hooks/subagent-stop.js`'s `isExemptAgentType` branches on (#1596) rests on the
hooks reference doc alone, with no captured instance behind it.

**A second branch on the same footing (#2036).** That same file now also no-ops a `SubagentStop`
whose `agent_transcript_path` equals the same event's own `transcript_path`. The shape was
inferred from the *symptom* — `events.jsonl` `contract-violation` entries whose `firstLine` was
plainly the dispatcher's own async-wait narration — and pinned by hand-built fixtures in
`tests/hooks-log-modules.test.js`, never read off a captured hook-input envelope. Two branches in
one file now rest on inference, and the throwaway-hook recipe above settles both in a single
capture session: run it the next time `subagent-stop.js` is opened, with one scenario per branch
(a real dispatched subagent, and a dispatcher ending its turn on an async wait).

## A fixture is a claim, not ground truth

The same gap one level over: a fixture's literal values are an assertion about the real shape,
made by whoever wrote the fixture — usually the same person writing the code under test, at the
same moment, from the same mental model. When that assertion is wrong, the fixture does not fail;
it agrees with the bug, and the suite certifies the exact regression class it was written to catch.

Record #900 hit this three times inside one record's own fresh code:

- Every archive-path fixture in `tests/bin-lib/wrap-up/engine-verify.test.js` used a timestamp-free
  run id (`test-archived-parent-900`), while every real archived run's basename is
  ISO-timestamped. A fix-round change that stripped the timestamp prefix broke
  `resolveArchivedRunDir` for *every* real run and passed the whole suite. Caught by a
  whole-branch re-review reading the production path, not by a test.
- A worktree match-key fixture had been "fixed" to match the buggy code rather than the real path
  shape, so the defect and its test agreed.
- Acceptance-labeling fixtures never modeled a resolvable parent or a pr-first PR, though every
  real run of this pipeline has both.

So: before trusting a fixture as the reference shape, ask whether its literal values **occur in
production** — is a run id always ISO-timestamped, is a worktree always nested under a resolvable
parent, does a record always have a parent? Where the answer is "unknown", the fixture is suspect
until a real instance is found: a live run directory under `.claude-tweaks/pipelines/`, a real
issue via `gh issue view`, or this session's own transcript per the procedure above. A fixture
built to satisfy the code is worth less than one sampled from the world.

**The sharpest form: a fixture standing in for the producer the bug lives in.** A hand-built
stand-in for one component's output is a claim about how that *producer* behaves — so when the
defect is in the producer, the test cannot see it: it passes identically before and after the
fix. Record #1410's `resolveRun` fix (`plugin/bin/lib/hooks/context.js`) is the instance. The
contaminated `events.jsonl` entry came from `resolveRun` guessing a concurrent sibling
worktree's run dir, and the obvious test for it — hand-build a `ctx.ownedRun` and feed it to
`post-tool-use.js`'s `logAskUserQuestion` — would have exercised only the consumer and stayed
green through the entire bug. The shipped test in
`tests/hooks-post-tool-use-ask-user-question.test.js` instead calls the real `resolveRun`
against real `gitRepo()`/`linkedWorktreeOf()` worktrees and pipes its actual return value into
the consumer, reproducing the full path the bad entry travelled. So before hand-building any
input, ask which component produced it in the incident being pinned — if that component is the
suspect, the fixture must be its real output, not your model of it.

## When to use

- Implementing a hook handler, integration, or any code that parses a tool's input/output payload
- The only available shape description is a type declaration, SDK doc, or third-party spec — not
  an observed live payload
- Getting the shape wrong would fail silently (a parsed field quietly resolving to `null`/`undefined`
  forever) rather than loudly (a thrown error caught in testing)

## When not to use

- The payload's shape is already directly testable against the real thing (an API you can call, a
  live instance you can read) — call it instead of hunting through a transcript. A fixture checked
  into the repo does **not** qualify; see "A fixture is a claim, not ground truth" below
- No relevant transcript exists yet (the tool/hook has never fired in any session available to
  you) — there is nothing to verify against; note the gap and proceed defensively, or trigger the
  tool once deliberately to generate a sample first

## Origin

Surfaced during #452 (Add a Friction reflect lens fed by hook-denial and AskUserQuestion events) —
see that record's final review and `evals/NOTES.md`'s "AskUserQuestion input/output shapes"
section's Correction for the concrete incident this skill generalizes from.
