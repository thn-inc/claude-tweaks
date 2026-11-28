---
name: design
description: Use when starting the design of anything that will be an order (a parent with parts), run as a session with the maintainer - evidence, frame, storyboard, five fresh readers, alternatives, pre-mortem, builder check, parts and estimate, approval, filing. Not visual design (/claude-tweaks:design-wrapper) or a single small fix (/superpowers:brainstorming). Keywords - design session, order, evidence, storyboard, perspectives, pre-mortem.
argument-hint: "<topic|#N>"
---

# Design — A design session for an order, saved as it happens

Runs a design session with the maintainer on the top model tier: it gathers what already exists before any idea is discussed, frames the problem, draws the cheapest picture of the result, tests that picture against five fresh readers, weighs real alternatives, runs a pre-mortem, checks that a builder could plan from the document alone, splits the approach into parts with an estimate, gets the maintainer's approval, and files the parts as issues through `/claude-tweaks:specify`. Every step is saved in one folder as it happens, so a lost session resumes from the files.

Lifecycle: **`/claude-tweaks:design`** → `/claude-tweaks:specify` — the entry for an order; the full chain is in `/claude-tweaks:help`.

## When to Use

- The work will be an order: a parent with parts, too big to shape as one record
- The design has not been settled, and builds would otherwise stop to ask what it should have said
- A design session was lost partway through — run it again with the same topic and it resumes

Not for:
- A single small fix — `/superpowers:brainstorming`, then `/claude-tweaks:specify`
- Visual polish or screen design on its own — `/claude-tweaks:design-wrapper`
- Building anything. This skill ends once the parts are filed and never starts a build.

## Input

`$ARGUMENTS` is parsed as `<topic|#N>`:

| Argument | Meaning |
|---|---|
| `topic` | Free text naming what is being designed. The folder slug is derived from it. |
| `#N` | An issue ref. The session reads the issue (`gh issue view {N} --json title,body,state`), uses its title as the topic for searching, and cites `#N` as a source. The folder slug is `issue-{N}`. |

Two placeholders follow from it. `{argument}` is what names the session: the `#N` as given, or the topic with every character other than letters (any script, `é` included), digits, spaces and `#` replaced by a space — the slug keeps only letters and digits, so the folder is the same, and no quote, `$` or backtick of free text reaches the shell. Every `folder --topic` call and every rerun or resume line uses `{argument}`. `{topic}` is the text searched for and written in headings: the topic as given, or the issue's title for `#N`.

The maintainer may also name, at start, the repository that holds most of the order's work. Without one, the repository is the current checkout.

## Session folder and resume

The session's folder is `docs/superpowers/specs/{YYYY-MM-DD}-{slug}/` in the repository, holding `evidence.md`, `design.md`, `storyboard.{ext}` and `notes-round-{N}.md`. The skill writes nothing outside it except step 10, which files issues and commits through `/claude-tweaks:specify`, and never creates a worktree or a branch.

1. `{repo root}` is `git rev-parse --show-toplevel` of the current checkout, or the absolute path of the local checkout the maintainer named.
2. **Worktree gate, before the first write.** Read `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values worktree-always` (it reads the current directory's project; for a named other repository, read `{repo root}/.claude-tweaks/policy.yml` for the same keys the hook reads: its `worktree-always:` line, or when that line is absent its legacy `worktree.always:` line; both absent means `false`; unlike the hook, which treats any value other than `true` as off, a value other than `true` or `false` counts as `true`, so the gate fails closed). When it is `true` and the checkout is the main checkout, not a linked worktree — `git -C "{repo root}" rev-parse --git-dir` prints the same as `git -C "{repo root}" rev-parse --git-common-dir` — stop. Tell the maintainer to start the session inside a worktree (`/superpowers:using-git-worktrees`) and run `/claude-tweaks:design {argument}` again: the `worktree-always` gate would refuse the write.
3. Find or create the folder:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" folder --topic "{argument}" --root "{repo root}" --create
   ```

   The printed folder is `{folder}` (also written `{design folder}`) in every later command, as an absolute path. An existing folder for the same slug is resumed, never duplicated.
4. Read where to continue:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" status --folder "{folder}"
   ```

   It prints `steps`, `resumeAt`, `round`, `action` and `openSerious`. Exit 2 → stop and show stderr.
5. **Session model check** (`## Model`, The session) — every start, whatever step `status` resumes at, before going on.
6. Continue at `resumeAt`, in the mode `action` names, and load only that step's sub-file (`## Steps`). `resumeAt: 'complete'` → say the session is finished and render `## Next Actions`; nothing is rewritten.

Run `status` again after each step finishes, and follow it; never pick the next step by hand.

The folder is uncommitted until the maintainer commits it, and a later session resumes it only from the same checkout. Say both when the session starts and when it ends.

`design.md` opens with `# {topic} — design` and holds its sections in this order: `## Frame`, `## Storyboard`, `## Perspectives`, `## Approaches`, `## Pre-mortem`, `## Builder check`, `## Parts`, `## Approval`, `## Filing`, `## Decisions`. A new section goes in its place in that order, before `## Decisions`, which is created with the first decision and stays last. Each step's section starts with a `Status: in-progress` line right under its heading while the step runs, set to `Status: done` only when the step is finished.

## Model

**The session.** At every start (item 5 of the list in `## Session folder and resume`), so always before the frame (step 2), run `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier` and compare its printed `model` with the session's own model family (`haiku` < `sonnet` < `opus` < `fable`). When the session's is lower, say so and ask with one `AskUserQuestion`: `Switch to the top tier and resume (Recommended)` — the session stops; the maintainer switches with `/model` and runs `/claude-tweaks:design {argument}` again — or `Continue on this model` — the session runs below the top tier while its readers still resolve to it. Recommend switching because the session itself judges every note and settles every guess. A choice to continue goes into `## Decisions` (`by: maintainer`) once `design.md` exists.

**Step 1's searchers** are the one exception to the top tier: they resolve with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" fast` (`step-1-evidence.md`).

**Readers** (steps 4, 6 and 7). Each reader resolves its tier with its own call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --exception design-reader --session-dir "{design folder}"
```

1. Resolve every reader of a dispatch group first, one call each, before any reader of that group is started. Resolve only readers not yet recorded: a resumed round resolves only the perspectives `check-notes` lists in `missingPerspectives`, since every resolution counts against the 22-per-session limit whether or not its reader ran.
2. Any call exits 3 → stop before any reader of that round is started. Show the `stepDown.reason` it printed. Never lower the tier, and never dispatch a reader on another profile.
   - `limit` — also show the count already used, the line count of `{folder}/frontier-exception-tally.log`, out of 22. The count belongs to this design folder and never resets: waiting, resuming or rerunning never clears it. Ask with one `AskUserQuestion`: `Record the gap and end at the handoff (Recommended)` — append to `## Decisions` which readers did not run (`- {date} — not read: {readers}, the folder's 22 readers are used — by: maintainer`), then render `## Next Actions` with the design as it stands — or `Stop here` — the session ends with nothing recorded, and the design stays unfinished, since no later session in this folder can run a reader. Recommend recording the gap, because stopping leaves a design no session can finish, while the recorded gap tells whoever shapes it which read is missing.
   - Any other reason. Ask with one `AskUserQuestion`: `Stop and resume later (Recommended)` — the session ends here and `/claude-tweaks:design {argument}` picks it up once the reason clears — or `Fix the cause and retry` — the maintainer clears the reason (for `policy`, `stance` or `ceiling`, the setting that caused it) and the same group is resolved again. Recommend stopping because a reader below the top tier would hand back weaker notes that look the same, and the session cannot judge the design without them.
3. Any call exits 1 → stop and show its stderr.
4. Only when every call exited 0, dispatch the whole group in one message: one `Agent` call per reader, a fresh agent (never `subagent_type: "fork"`), `model` = the printed `model`, `effort` = the printed `launchEffort` when it is not `null` (no `effort` when it is). The prompt is exactly the `brief` command's stdout followed by the printed `effortLine` when it is non-empty — the brief is the reader's whole prompt, and nothing from the conversation is added, summarized or reworded.
5. A reader that fails with a credit or usage-exhaustion error → run `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" record-failure {model}`, then stop and ask with one `AskUserQuestion`: `Stop and resume later (Recommended)` — the session ends; `/claude-tweaks:design {argument}` resumes it once the usage window resets — or `Retry now` — the group is resolved again, and the resolver steps down past the failed model, so step 2 applies. Recommend stopping, since a retry inside the same window resolves to a step-down that step 2 already refuses.

The exception's full rules are in `_shared/frontier-exception.md`.

## How it asks

1. Every question comes with a recommended answer and its reason. A recommendation rests on what is right for the design, never on what is cheaper or quicker to build.
2. Open questions about what the maintainer wants are asked openly, in a plain message, one at a time — not as a menu of guessed options.
3. Every decision is appended to `## Decisions` in `design.md` as `- YYYY-MM-DD — {decision} — by: maintainer|model`.

A choice among known options is one `AskUserQuestion` call with the recommended option marked. A batch — the notes of a round, the pre-mortem's failures, the builder's open guesses — is one table with a recommendation and its reason on every row, then one `AskUserQuestion` (apply all recommended, or override specific items, the overrides given as free text in the next message).

## Steps

Load only the sub-file of the step `status` resumes at, from this skill's directory.

| Step | Sub-file | Leaves | Done when |
|---|---|---|---|
| 1. Evidence | `step-1-evidence.md` | `evidence.md` | its `Status: done`, and `check-evidence` exits 0 |
| 2. Frame | `step-2-frame.md` | `## Frame` | its `Status: done` |
| 3. Storyboard | `step-3-storyboard.md` | `storyboard.{ext}`, `## Storyboard` with `Round:` and `File:` | its `Status: done`, and the file it names exists in the folder |
| 4. Perspectives | `step-4-perspectives.md` | `notes-round-{N}.md`, `## Perspectives` | its `Status: done`, with the last round free of serious notes or round 4 reached |
| 5. Alternatives | `step-5-alternatives.md` | `## Approaches` | its `Status: done` |
| 6. Pre-mortem | `step-6-pre-mortem.md` | `## Pre-mortem` | its `Status: done` |
| 7. Builder check | `step-7-builder-check.md` | `## Builder check` | its `Status: done` |
| 8. Parts | `step-8-parts.md` | `## Parts` | its `Status: done`, and `parts` exits 0 |
| 9. Approval | `step-9-approve.md` | `## Approval` | its `Status: done`, and `check-approval` exits 0 |
| 10. Filing | `step-10-file.md` | `## Filing`, issue marks | its `Status: done`, and every part marked |

To change an approved frame, approach or part, first run step 9's approval rule (`step-9-approve.md`): set the Approval section back to `Status: in-progress` and remove its `Approved:` line, make the change, then run step 9 again.

The readers' briefs live in `reader-briefs.md`; the `brief` command composes each reader's prompt from it and the folder's files.

## Next Actions

After step 10, or when `status` prints `resumeAt: 'complete'`, render only the resume line as plain markdown (docs/skill-authoring.md's Skill handoffs convention), since `/claude-tweaks:specify` already rendered the flow commands for the filed parts:

`/claude-tweaks:design {argument}` — resume or reread this session later, from the same checkout

When the session stops early (a step-down, a stop at the round cap, the worktree gate, a refused approval), render the same line. A `limit` gap recorded in `## Decisions` is not a stop: the session goes on to step 8.

## Component-Skill Contract

`/claude-tweaks:design` is standalone and human-present: no skill or pipeline invokes it, so there is no `PIPELINE_RUN_DIR` signal to check, and `## Next Actions` always renders. Step 10 invokes `/claude-tweaks:specify` with the Skill tool; that is the only skill this one calls. It is never run unattended: every step waits on the maintainer.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Proposing anything before `evidence.md` is shown | The design starts from a guess about what exists instead of from what exists |
| Lowering a reader's tier on a step-down, or dispatching it on another profile | The readers' judgment is the point of the round; a quiet step-down hands the maintainer weaker notes that look the same |
| Starting a fifth round | Four rounds is the cap; after the fourth the open serious notes go to the maintainer |
| Passing conversation, evidence or decisions to a reader | A reader that inherits the session's framing confirms it; the `brief` output is its whole prompt |
| Changing the frame, approach or parts after approval without a new approval | The filed issues stop matching what the maintainer approved — the problem this step exists to close |
| Going on while a note has no outcome | An undecided note is a design question left for the builder to guess |
| Writing outside the folder, creating a worktree or a branch, creating an issue or committing outside step 10, or starting to build | The session owns one folder and nothing else; shaping, filing and building are later skills' work |
