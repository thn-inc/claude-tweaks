# Step 5: Alternatives

Loaded by `/claude-tweaks:design` when `status` resumes at step 5.

Lay out two or three real ways to do it, with what each gives up; the maintainer chooses. `action: 'continue'` → read the partial `## Approaches` and pick up where it stopped.

## 1. Find the ways

Each way is real: it meets the frame's goals, stays inside its non-goals and anti-goals, and could be built. The design the storyboard shows is one of them. A strawman put up to lose is not a way, and two ways that differ only in a detail are one.

For each way: what it is, in a few lines; what it gives up next to the others; and which notes, evidence or decisions bear on it.

## 2. Choose

Show the ways side by side, then recommend one with its reason (SKILL.md's `## How it asks` — on what is right for the design, never on what is cheaper or quicker to build). Ask with one `AskUserQuestion`, one option per way, the recommended one marked, each option's description the one-clause consequence of choosing it.

## 3. Write

The section in `{folder}/design.md`, after `## Perspectives`:

```
## Approaches
Status: in-progress

### A. {name}
{what it is}
Gives up: {…}

### B. {name}
{what it is}
Gives up: {…}

Chosen: {letter} — {the maintainer's reason}
```

Append the choice to `## Decisions` (`by: maintainer`). When the chosen way changes what the frame or the storyboard says, change it there now and say what changed in the section. Set `Status: done`, then run `status` and continue.
