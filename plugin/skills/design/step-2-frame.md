# Step 2: Frame

Loaded by `/claude-tweaks:design` when `status` resumes at step 2.

Settle with the maintainer what the work is for, before any picture of it is drawn. `action: 'continue'` → read the partial `## Frame` in `{folder}/design.md` and ask only what it does not settle yet.

## 1. Ask

Cover these, one question at a time, each open question asked openly in a plain message (SKILL.md's `## How it asks`). Where the evidence suggests an answer, offer it as the recommendation with its reason and the claim it rests on.

| Part | What it settles |
|---|---|
| Problem | What is wrong or missing today, for whom, in the maintainer's words |
| Why now | What makes this worth doing now rather than later |
| Goals | What is true once it is done |
| Non-goals | What it deliberately leaves out |
| Anti-goals | What it must not do or make worse |
| Measure | The one thing to measure afterwards, and for how long, to know it was worth it — or "not measurable", said plainly with the reason |

Record each answer in the section as it is given, so a lost session keeps it. Every choice the maintainer makes along the way goes into `## Decisions`.

## 2. Write

Create `{folder}/design.md` when it does not exist yet, opening with `# {topic} — design`. The section:

```
## Frame
Status: in-progress

Problem: {…}
Why now: {…}
Goals:
- {…}
Non-goals:
- {…}
Anti-goals:
- {…}
Measure: {the one measure} — for {duration}   (or: Measure: not measurable — {why})
```

No line inside the section starts with `## `. Show the whole frame and confirm it with the maintainer; on confirmation set `Status: done`. Then run `status` and continue.
