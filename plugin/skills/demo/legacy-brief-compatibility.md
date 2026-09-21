# Compatibility: briefs with no Observation plan

Full procedure for `skills/demo/SKILL.md` Step 2's Compatibility branch — a label-backed brief
posted before the `### Observation plan` schema shipped, which still carries the retired
`### See it yourself` / `### Verify it yourself (manual)` headings instead. Those two heading
names are quoted below **deliberately**, for backward compatibility with briefs already posted —
not as a reintroduction of the sections themselves. Such a brief walks the flow below in place of
the Show-first walkthrough (`SKILL.md`'s own `### Show-first walkthrough` / `### Verdict`
sections).

Remove this file (and `SKILL.md`'s routing branch to it) when no open record still carries a
pre-schema brief — observable as `/claude-tweaks:tidy`'s acceptance-gap sweep and
`/claude-tweaks:help`'s outstanding-sign-off list (Stage 4.7) surfacing zero `demo:pending`
records whose brief predates the `### Observation plan` schema (shipped with #323 and its
sub-issues, v6.78.0).

Call `AskUserQuestion` with `question`: `"Does {title} do what you asked
for?"`, `header`: `"Verdict"`, `multiSelect`: `false`:

- Option 1 — `label`: `"Approve"`, `description`: `"This does what was asked"`
- Option 2 — the label names the section it actually walks: `"See it yourself"` when the brief's `### See it yourself` entry point resolved and browser tools are available, `"Verify it yourself"` when the brief carries `### Verify it yourself (manual)`. Offer it under either condition, never both labels at once; `description`: `"Check this before deciding"`
- Option 3 — `label`: `"Request changes"`, `description`: `"There's a gap — I'll describe it"`
- Option 4 — `label`: `"Skip for now"`, `description`: `"Leave demo:pending — I'll come back to this"` (this branch only ever reaches label-backed entries — a closing-commit reconstruction always composes an Observation plan, per `SKILL.md` Step 1's rewrite, and a session-recall entry composes one too whenever recall yields a path list; only when recall yields no path list does session-recall omit the section, and in that case Step 2's routing takes the brief straight to the Verdict question rather than through this branch).

**Non-interactive record** (the brief carries `### Verify it yourself (manual)` instead of
`### See it yourself` — the classifier that composed this brief judged the changed paths as
having no interactive surface): skip the browser pre-flight below entirely — there is no dev
server or page to reach. Walk the brief's manual steps with the user directly, one at a time —
the command, file path, or behavior to check, and what to expect. After the human finishes,
re-ask the Verdict question above with only Approve / Request changes / Skip for now (the manual
walk already happened — don't offer "Verify it yourself" twice for the same record).

**Interactive record:** picking this option never hands over untested instructions. First, run a
pre-flight check:

1. Resolve a working dev server via `dev-url-detection.md`'s existing procedure — already
   project-agnostic (port probing, `CLAUDE.md`/`package.json` command detection, worktree
   awareness) and already auto-starts an ephemeral server on a free port when nothing is running.
2. Open a quick `playwright-cli` session at the resolved entry point (following
   `/claude-tweaks:browse`'s conventions directly — the same relationship
   `/claude-tweaks:visual-review` already has with `/claude-tweaks:browse`) and confirm the target
   page actually renders, not just an HTTP 200. If the page requires auth and credentials are
   already resolvable (the Auth Vault, the same source `/claude-tweaks:stories` uses), attempt
   login too. No configured credentials → skip the login check; reachability/render alone is
   still worth confirming.
3. Close the session.

Runs once per record per `/claude-tweaks:demo` session and is reused for the rest of that record's walkthrough.

**Pre-flight succeeds:** ask one short follow-up — `question`: `"Do you want to look at this
live, or get the steps to check it yourself?"`, `header`: `"How to check"`, `multiSelect`:
`false`:

- Option 1 — `label`: `"Show me live"`, `description`: `"Open a live browser session now"`
- Option 2 — `label`: `"Give me the steps"`, `description`: `"I'll run it myself"`

**"Show me live" (sub-choice):** open a fresh `playwright-cli` session at the already-verified
entry point (or reuse the pre-flight's own session if still open). After the human finishes
looking, close the session (leaked sessions consume resources — same discipline
`/claude-tweaks:browse`'s own Anti-Patterns table requires), then re-ask the Verdict question
above with only Approve / Request changes / Skip for now (the live look already happened — don't
offer "See it yourself" twice for the same record).

**"Give me the steps" (sub-choice):** compose manual instructions from the pre-flight's own
verified URL/port/credentials — never a guessed default — following this checklist:

- **Self-contained** — every command block includes its own `cd` to the right checkout/worktree;
  never assume an inherited working directory.
- **Copy-paste-clean** — no inline commentary inside a block meant to be pasted as-is;
  explanation goes in prose before/after the block, never inside it.
- **Proactively explain surprising-but-correct state** the pre-flight itself observed while
  rendering (e.g. an empty dashboard on first load) — inline, before the human has to ask.

After presenting the steps, re-ask the Verdict question above with only Approve / Request changes
/ Skip for now, same as the live sub-choice above.

**Pre-flight fails:** this is evidence, not a side quest to chase mid-conversation. Capture what
broke (screenshot, console error) and fold it directly into this record's brief as grounds for
**Request changes** — skip the live-vs-manual follow-up question entirely, a broken environment
is broken either way. `/claude-tweaks:demo` never debugs or fixes the underlying application code itself — that
stays out of scope the same way code-quality judgment already does (`/claude-tweaks:review`'s job).

**Browser tools unavailable:** same fallback `verification-brief.md` already documents — skip
without blocking, note visual verification wasn't available in this environment, proceed with
Approve / Request changes / Skip for now only (no "See it yourself" option at all in this case).
