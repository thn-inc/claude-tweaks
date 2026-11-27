# Step 6: Pre-mortem

Loaded by `/claude-tweaks:design` when `status` resumes at step 6.

One fresh reader is asked: it is three months later and this failed; why? Each answer becomes a change to the design or a risk the maintainer accepts by name.

`action: 'continue'` with a `## Pre-mortem` section that already lists failures: skip to section 3 and decide the ones without a disposition. Otherwise start at section 1.

## 1. Brief, resolve, dispatch

Add the section to `{folder}/design.md`, after `## Approaches`, with `Status: in-progress`. Compose the brief:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" brief --folder "{folder}" --reader pre-mortem
```

Exit 1 → stop and show the reason its JSON names (a pending outcome in the last notes round). Exit 2 → stop and show stderr.

Resolve the reader's tier and dispatch it per SKILL.md's `## Model` (a group of one). Its prompt is exactly the brief's stdout followed by the resolver's `effortLine` — the brief is the reader's whole prompt; nothing from the conversation is added.

## 2. Read the reply

A valid reply is failure blocks (`FAILURE:` / `LIKELIHOOD: high | medium | low` / `EVIDENCE:`) or the literal `NO FAILURES`, with `STATUS: {WORD}` as its last non-empty line. A malformed reply is re-prompted once with `SendMessage` to the same agent, using `_shared/subagent-output-contract.md`'s Re-prompt on violation text and repeating the brief's output format. Still malformed → tell the maintainer the reply was unusable and ask whether to run one more reader (one more resolution of the 22), recommending yes, since the step has no answer without it.

## 3. Decide each failure

One table: each failure, its likelihood and evidence, and a recommended disposition with its reason — a change to the design (which section, what change) or a risk to accept, named. Then one `AskUserQuestion` (apply all recommended, or override specific items). A change is made in `design.md` (or the storyboard) now. A risk is accepted only by the maintainer, and only by name: append each to `## Decisions` (`- {date} — accepted risk: {the risk} — by: maintainer`).

## 4. Write

```
## Pre-mortem
Status: in-progress

### 1. {the failure, in a line}
Likelihood: {high|medium|low} — {evidence}
Disposition: changed — {what changed, and where}   (or: Disposition: accepted-risk — {the risk, named})
```

One `###` entry per failure; `NO FAILURES` is recorded as a plain line saying so. Set `Status: done`, then run `status` and continue.
