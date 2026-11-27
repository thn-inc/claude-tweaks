# Step 3: Storyboard

Loaded by `/claude-tweaks:design` when `status` resumes at step 3.

Draw the cheapest picture of the result — what someone sees, sends or gets once it exists — so the readers of step 4 judge something concrete. `status`'s `action` says which pass this is:

- `start` — the first storyboard, for round 1.
- `continue` — a storyboard was started; finish it.
- `revise-storyboard` — round `{round} - 1` closed with serious notes; revise the storyboard for round `{round}`.

## 1. Pick the form

Pick the form the kind of result needs, and say which and why:

| The result is | Storyboard |
|---|---|
| Screens a person uses | Screen sketches through `/claude-tweaks:design-wrapper shape {topic} --description "{the frame's Problem line}"`; write or copy its output into the folder as `storyboard.md` (images it makes go into the folder too, named from the storyboard) |
| A command, API or tool | Example calls with their answers, including one that fails |
| Data or state | Sample rows before and after |
| A conversation or agent flow | A typed-out session, start to finish |
| A system of parts | A one-page local HTML picture (`storyboard.html`, no external resources) |

When `/claude-tweaks:design-wrapper shape` returns skipped (Impeccable unavailable), say so and draw the screens as text in `storyboard.md` instead.

Show the result the frame promises, not the machinery behind it. One file, `storyboard.{ext}`, in `{folder}`.

## 2. Revising (`revise-storyboard`)

Read `notes-round-{round - 1}.md`. Revise the storyboard so it answers every serious note and shows every `changed` outcome; say, note by note, what changed. A note declined or accepted as a risk is left as it is.

## 3. Write

The section in `{folder}/design.md`, after `## Frame` (`{round}` is 1 on the first pass):

```
## Storyboard
Status: in-progress
Round: {round}
File: storyboard.{ext}

{one paragraph: the form chosen and why; on a revision, what changed and for which notes}
```

`File:` is the plain file name in the folder, no path. On a revision, set the existing section's `Status: in-progress` while revising, update `File:` if the file changed, and leave `Round:` at its old value. Show the storyboard to the maintainer and confirm it. On confirmation set `Status: done` — and on a revision, change `Round:` to `{round}` only now, since `status` reads a `Round:` above the last notes round as a finished revision. Then run `status` and continue.
