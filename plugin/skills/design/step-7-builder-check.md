# Step 7: Builder check

Loaded by `/claude-tweaks:design` when `status` resumes at step 7.

One fresh reader tries to plan the build from `design.md` alone and reports only what it would have to guess. Every guess is then answered in the document.

`action: 'continue'` with a `## Builder check` section that already lists guesses: skip to section 3 and settle the ones without an answer. Otherwise start at section 1.

## 1. Brief, resolve, dispatch

Add the section to `{folder}/design.md`, after `## Pre-mortem`, with `Status: in-progress`. Compose the brief — `design.md` without its `## Decisions` list, so the reader plans from the design and not from how it was decided:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" brief --folder "{folder}" --reader builder
```

Exit 1 → stop and show the reason its JSON names (`pending-outcomes` in the last notes round, `no-frame`, or `symlink` — a session file is a symlink, so stop and tell the maintainer). Exit 2 → stop and show stderr.

Resolve the reader's tier and dispatch it per SKILL.md's `## Model` (a group of one). Its prompt is exactly the brief's stdout followed by the resolver's `effortLine` when it is non-empty — the brief is the reader's whole prompt; nothing from the conversation is added.

## 2. Read the reply

A valid reply is guess blocks (`GUESS:` / `WHERE:` / `NEEDED-BECAUSE:`) or the literal `NO GUESSES`, with `STATUS: {WORD}` as its last non-empty line. A malformed reply is re-prompted once with `SendMessage` to the same agent, using `_shared/subagent-output-contract.md`'s Re-prompt on violation text and repeating the brief's output format. Still malformed → tell the maintainer the reply was unusable and ask whether to run one more reader (one more resolution of the 22), recommending yes, since the check has no answer without it.

## 3. Answer each guess

Sort every guess into one of three:

1. **Already answered in the conversation** — the maintainer said it, but the document does not. Write the answer into `design.md` where it belongs.
2. **Small** — it follows from the document, the evidence or the repository's own conventions, any careful builder would settle it the same way, and a wrong answer would be plain to see at review. Settle it, write it into `design.md`, and append it to `## Decisions` with `by: model`.
3. **The rest** — put them to the maintainer in one message: one table, each guess with a recommended answer and its reason, then one `AskUserQuestion` (apply all recommended, or override specific items). Write each answer into `design.md` and `## Decisions` (`by: maintainer`).

## 4. Write

```
## Builder check
Status: in-progress

- {the guess} — answered in {section} — by: conversation|model|maintainer
```

One bullet per guess; `NO GUESSES` is recorded as a plain line saying so. Set `Status: done`, run `status` (it prints `resumeAt: 'complete'`), remind the maintainer that the folder is uncommitted, and render SKILL.md's `## Next Actions`.
