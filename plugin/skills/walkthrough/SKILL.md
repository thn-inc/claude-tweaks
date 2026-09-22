---
name: walkthrough
description: Use for producing a shareable animated GIF plus an ordered caption list from an executed user story — a walkthrough a second person can open, attach to a PR, or commit into docs, distinct from ephemeral QA screenshots. Keywords - walkthrough, GIF, animated demo, screen recording, share, caption.
argument-hint: "[<story-path>|--story <name>|#N] --base <url> [--budget-mb <n>] [--width <px>] [--delay-ms <n>] [--settle-ms <n>]"
---

# Walkthrough — Shareable animated GIF from an executed story

Executes an existing schema-v2 user story through Playwright CLI, captures one PNG frame per step, and encodes an animated GIF plus an ordered caption list — a walkthrough that survives being attached to a PR, dropped in chat, or committed into docs, unlike the QA screenshots every `/claude-tweaks:test qa` run already captures and discards to a scratch location.

Not `/claude-tweaks:demo` — that name means human acceptance sign-off on a built thing. This produces a shareable artifact, nothing more.

## When to Use

- A finished feature needs a shareable visual walkthrough for a PR description, a chat message, or a docs page
- An existing story already exercises the flow worth sharing
- You want the "what happens when you do this" story, not a full video recording (this plugin ships no video capability — see Non-Goals below)

Not for: acceptance sign-off (`/claude-tweaks:demo`), authoring a new story (`/claude-tweaks:stories`, which this skill offers and stops when no story matches), true motion capture (cursor travel, scroll, CSS transitions — Playwright CLI exposes no screencast operation).

## Input

`$ARGUMENTS` is parsed as `[<story-path>|--story <name>|#N] --base <url> [--budget-mb <n>] [--width <px>] [--delay-ms <n>] [--settle-ms <n>]`:

| Argument | Default | Behavior |
|---|---|---|
| `<story-path>` | — | A direct path to a `stories/*.yaml` file; if it carries more than one story, ask which. |
| `--story <name>` | — | Matches a `stories[].id` directly across every `stories/*.yaml` file. |
| `#N` | — | Fetches record `N` via `gh issue view N --json body`, extracts Key Files with `extractKeyFiles`, collects any `docs/journeys/{name}.md` names the body cites, and calls `selectStories` over the parsed `stories/*.yaml` files. Zero matches: offer `/claude-tweaks:stories` and stop. More than one: one `AskUserQuestion` listing candidates by `id` and `matchedBy`. |
| *(none)* | — | Uses the current branch's changed files as the key-file set for the same `selectStories` call as `#N`; asks when ambiguous, never guesses. |
| `--base` | **required** | The URL to run the story against. Stop with a one-line message when absent — this skill never auto-detects a dev server, since a walkthrough recorded against the wrong environment is silently wrong rather than obviously broken. |
| `--budget-mb` | `8` | Maximum encoded GIF size, passed straight through to `walkthrough-encode.js`. |
| `--width` | *(none — original frame width)* | Downscale target in pixels; passed straight through. |
| `--delay-ms` | `2000` | Per-step frame hold, all but the last step. |
| `--settle-ms` | `500` | Wait after each step's action before screenshotting — a command-completion signal is not a visual-stability one. Authors may also add explicit `wait` steps for slow async renders even when QA never needed one. |

## Step 1: Resolve the story

Per the Input table above. Once resolved, read the story YAML directly — do not re-derive its steps through `/claude-tweaks:stories`.

## Step 2: Probe `--base` and open the session

Probe `--base` reachability (a plain HTTP HEAD/GET); stop with a one-line message if unreachable. Open one Playwright CLI session named `walkthrough-{story-id}`:

```bash
playwright-cli -s=walkthrough-{story-id} open {base-url}
```

then set the viewport explicitly (Task 0's live probe found the headless default already matches `1280x720`, but this skill sets it anyway — that default is an implementation detail of the installed browser, not a documented contract):

```bash
playwright-cli -s=walkthrough-{story-id} resize 1280 720
```

## Step 3: Execute each step and capture a frame

For each step, run the action exactly as `plugin/agents/qa-agent.md` Section 4 maps it — a `snapshot` to resolve the story's locator to an `eN` ref, then the ref-based `click <eN>` / `fill <eN> "<text>"` / `check <eN>` / `hover <eN>` command (escaping every story-supplied string per that file's escaping rule before interpolation); `assert_visible` re-snapshots and checks tree membership with no action; `navigate` steps use `goto <url>`, never `open` (which is reserved for the session's first navigation in Step 2). Wait `--settle-ms` after the action completes, then screenshot to a session-scoped frame path:

```bash
playwright-cli -s=walkthrough-{story-id} screenshot --filename={frame-path}
```

`{frame-path}` is `sessionTmpPath(sessionId, 'walkthrough-{story-id}/{NN}.png')` per `_shared/session-tmp-root.md` (under the OS temp dir, never under the repo's disposable artifacts scratch tree), `{NN}` zero-padded in step order.

On a locator miss, report the step number and stop — **never degrade the locator to a raw CSS selector**; a walkthrough that needed one would break on the next markup change and is lying about being semantic.

## Step 4: Encode

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/walkthrough-encode.js" --frames {frame-dir} --out {gif-path} --delay-ms {delay-ms} --budget-mb {budget-mb}
```

Add `--width {width}` when given. Branch on the exit code: `0` → the GIF is written; proceed to Step 5. `1` → malformed invocation — relay the message and stop (should not occur; this skill builds the argv itself). `2` → an unreadable, undecodable, or dimension-mismatched frame — relay the message (it names the offending path) and stop; a dimension mismatch means the viewport changed mid-run, which Step 2's explicit `resize` is meant to prevent. `3` → over budget — relay the printed lever list (`fewer steps`, then `lower --width`) and stop; do not retry with a guessed width without the user's input.

On success, delete the frame directory — frames are intermediate, the GIF is the artifact. On any failure above, leave the frames in place for diagnosis and report their path.

## Step 5: Write the caption list and choose a destination

Write `{name}.md` beside the GIF — one ordered line per step, from the story's own `caption` fields (falling back to `{action} {locator}` for steps without one, exactly as `captionList` renders it). Then ask the output location with one `AskUserQuestion`:

- `question`: `"Where should the walkthrough go?"`, `header`: `"Save walkthrough"`, `multiSelect`: `false`
- Option 1 — `label`: `"Archive path (Recommended)"`, `description`: `"Write to docs/walkthroughs/{story-id}.gif and .md (creates docs/walkthroughs/ if absent)"`
- Option 2 — `label`: `"Current directory"`, `description`: `"Write to ./{story-id}.gif and .md"`
- Option 3 — `label`: `"Don't save"`, `description`: `"Keep the frame directory description in this conversation only — nothing written"`

An explicit path comes through `Other`. The GIF and caption list are copied together with the Write tool. Nothing is written into the repository without this choice, and nothing is ever committed on the user's behalf — the walkthrough exists to be kept, so it never defaults to the disposable artifacts scratch tree that `/claude-tweaks:tidy` prunes after 30 days.

Close the Playwright CLI session on every path — success, a Step 3 locator miss, or a Step 4 encode failure.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:walkthrough --story {other-id} --base {url}`** — record another story (recommended when more than one story matched at Step 1)
`/claude-tweaks:stories` — author a new story when none matches
`/claude-tweaks:help` — full pipeline status

## Component-Skill Contract

`/claude-tweaks:walkthrough` is a **standalone-only** skill — no lifecycle skill invokes it. There is no `PIPELINE_RUN_DIR` signal to check; the `## Next Actions` block always renders, and Step 5's save-location question always runs.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Degrading a locator to CSS on a miss | A walkthrough built on a CSS selector breaks on the next markup change and is lying about being semantic — stop and report the step instead |
| Writing the GIF into the repo's disposable artifacts scratch tree or committing it | That tree is disposable by declaration; nothing is committed on the user's behalf in any mode |
| Retrying with a guessed `--width` after a budget-exceeded exit | The lever list names the levers in order for a reason — relay it and let the user choose, never auto-shrink |
| Selecting a non-`playwright-cli` browser backend here | Restricted to human ad-hoc use in `browse/SKILL.md`; this skill is the same kind of pipeline-adjacent consumer as `qa-agent`/`/stories` and stays `playwright-cli`-only |
| Authoring a story when none matches | `/claude-tweaks:stories` owns story authoring — offer it and stop |
