# Step 4: Perspectives

Loaded by `/claude-tweaks:design` when `status` resumes at step 4.

Five fresh readers, each given only the frame and the storyboard, read the design from one perspective each and return notes marked serious or minor. The maintainer decides each note's outcome. Steps 3 and 4 repeat until a round has no serious note, at most four rounds.

The perspectives, in this order: `user` (the person using it), `smallest` (the smallest version that would do), `ownership` (which part owns what), `token-cost` (the token cost), `introduction` (how it gets introduced).

`{N}` is the round `status` printed. Follow its `action`:

- `start-round` — run sections 1 to 5 for round `{N}`.
- `finish-round` — run `check-notes` (section 4) first; dispatch only the perspectives it lists in `missingPerspectives` (sections 1 to 3), then finish sections 4 and 5.
- `close-perspectives`, `cap-reached` — go straight to section 6.

## 1. Notes file and section

On `start-round`, create `{folder}/notes-round-{N}.md`:

```
# Perspective notes — round {N}
Status: in-progress
```

and, in `design.md` after `## Storyboard`, the section (on later rounds, add the round's line to the existing one):

```
## Perspectives
Status: in-progress
- Round {N}: notes-round-{N}.md
```

## 2. Briefs, then resolutions, then one dispatch

For each perspective to run, compose its brief:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" brief --folder "{folder}" --reader {perspective} --round {N}
```

Exit 1 → stop and show the reason its JSON names (`pending-outcomes`, `round-cap`, `no-frame`, `no-storyboard`); no reader of this round is started. Exit 2 → stop and show stderr.

With every brief in hand, resolve each perspective's tier and dispatch them per SKILL.md's `## Model`: every resolution first, and the whole group in one message only when all exited 0. Each reader's prompt is exactly its brief's stdout followed by the resolver's `effortLine` when it is non-empty — the brief is the reader's whole prompt; nothing from the conversation, the evidence or the decisions is added.

## 3. Read the replies

A valid reply is note blocks (`NOTE:` / `WHERE:` / `NOTE-TEXT:` / `WHY:`, at most 6) or the literal `NO NOTES`, with `STATUS: {WORD}` as its last non-empty line.

- **Malformed** — any other shape, or a status line that is not the last non-empty line: re-prompt that reader once, with `SendMessage` to the same agent, using `_shared/subagent-output-contract.md`'s Re-prompt on violation text and repeating the brief's output format. Never dispatch a new reader for it, since that spends another resolution. Still malformed after that → record one `minor` note for that perspective whose text says the reader's reply was unusable and why. It needs an outcome like any other note.
- **`NEEDS_CONTEXT` or `BLOCKED`** — the reader sees only the frame and storyboard by design, so what it lacked is a note: record it as one note for that perspective, `serious` when the frame or storyboard should have said it, `minor` otherwise. Never re-dispatch it with more context.
- **No tool calls** — a reader whose storyboard came inline needs none, so this alone is not a failed reply. A reader handed a storyboard file path that never read it is malformed.

## 4. Transcribe, decide, check

Add every note to `notes-round-{N}.md`, numbered `{N}.1`, `{N}.2`, … in perspective order, continuing after the highest number already there:

```
## {N}.{i} — {perspective} — {serious|minor}
> NOTE: {serious|minor}
> WHERE: {…}
> NOTE-TEXT: {…}
> WHY: {…}
Outcome: pending
```

Copy the reader's note block as written, every line prefixed `> `: no line of a note's own text may start with `## ` — it would read as a heading and make the round malformed — and the prefix also keeps a line of it from reading as an `Outcome:` line or a fence. A `NO NOTES` reply is recorded as `## {N}.{i} — {perspective} — none` with no `Outcome:` line.

Then take each note's outcome from the maintainer: one table of the round's notes — id, perspective, severity, the note in a line, and a recommended outcome with its reason — then one `AskUserQuestion` (apply all recommended, or override specific items). Write each outcome in place of `pending`, always with its explanation after the dash:

- `Outcome: changed — {what changed, and where}` — make the change now, in `## Frame` or the storyboard file
- `Outcome: declined — {why}`
- `Outcome: accepted-risk — {the risk, named}`

Append one line to `## Decisions` naming the round's outcomes (`- {date} — round {N} notes: {N}.1 changed, {N}.2 declined, … — by: maintainer`). Then check the round:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" check-notes --folder "{folder}" --round {N}
```

Exit 1 → its JSON names what stops the round: `pending` (notes with no outcome — take them from the maintainer), `missingPerspectives` (perspectives with no entry — run sections 2 and 3 for those only), `malformed` (`line N: why` — fix that line). Fix and run it again; never go on while it exits 1. Exit 2 → stop and show stderr.

## 5. Close the round

When `check-notes` exits 0, set the notes file's `Status: done`, add the round's tally to its line in `## Perspectives` (`- Round {N}: notes-round-{N}.md — {s} serious, {m} minor`), and run `status`.

## 6. Follow `status`

- `revise-storyboard` → the round had serious notes; load `step-3-storyboard.md` and revise.
- `start-round` → the storyboard is already revised; start round `{round}` at section 1.
- `close-perspectives` → the last round has no serious note: set `## Perspectives` to `Status: done`, run `status`, and continue at step 5.
- `cap-reached` → round 4 closed with serious notes, and a fifth round is never started. List every id in `openSerious` with its note and outcome, and ask with one `AskUserQuestion`: continue to step 5, or stop the session here. Recommend continue when every open serious note was changed or accepted as a risk, and stop when one still makes the design wrong as it stands; give the reason. On continue: set `## Perspectives` to `Status: done` and append the choice, naming the open serious notes, to `## Decisions` (`- {date} — continued past round 4 with open serious notes {ids} — by: maintainer`); then run `status`. On stop: say where the session stands and render only the resume line of SKILL.md's `## Next Actions` (`/claude-tweaks:design {argument}`).
