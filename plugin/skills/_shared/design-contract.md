# Impeccable's Direction Contract — locating and reading it

Impeccable records a **direction contract** under a `## Direction contract` heading in the
relevant **surface brief**, before the code — never in the artifact it builds. This file is the
single procedure for finding that section and reading it back. It is cited by
`/claude-tweaks:design-wrapper`'s `review` mode (which extracts the seed key and records it) and
by `/claude-tweaks:demo` (which renders the blocks to a human). Both cite it; neither restates it.

## What this repo does and does not own

**Upstream owns the contract.** Its definition — the block names, the word budget, what each block
must say, and what makes a block inadequate — lives in the Impeccable plugin's own
`skills/impeccable/reference/new-work.md`, in the "Record the decision" step. Read it there.

This repo **never** defines, validates, reformats, or paraphrases it. Nothing here explains what a
block is supposed to contain, and nothing here judges whether a block is any good. Auditing the
render against the contract is `impeccable-finish-reviewer`'s job — upstream spawns it at the end of
its own build, and `/claude-tweaks:design-wrapper`'s `review` mode dispatches it again at code-review
time over the diff under review (`../design-wrapper/modes/review.md` Step 3.7). Either way the judging
is that agent's, never this procedure's.

What this repo does is narrower and purely structural:

1. find the surface brief's `## Direction contract` section,
2. recognize the five block labels well enough to split the text into blocks,
3. copy the seed key out of the `FORM` block as an opaque token,
4. hand both to a human at the acceptance gate.

The block labels are the only piece of upstream's contract this repo hard-codes, and they are
pinned by an assertion in `tools/upstream-drift/manifest.yml` so a rename upstream surfaces as
drift rather than as a silently empty brief.

## Step 1: Read the surface brief

**Candidate files.** Whatever file list the calling skill already has — `review` mode's resolved
changed-UI-file list, `/demo`'s changed-path list from the closing commit or session recall. This
procedure never discovers files on its own.

**One engine call per candidate, first hit wins.** For each candidate, in order, run
`node "${CLAUDE_PLUGIN_ROOT}/bin/impeccable-engine.js" run surface-brief <candidate-path>` —
`bin/lib/impeccable-engine`'s `run('surface-brief', [candidatePath], {projectPath: <repo root>})`
when called from JS. The candidate's own path (or route) is the `<target>` — the same value
Impeccable's own `surface-brief write <primary-target> ...` step names when it records the
contract (`reference/new-work.md` §5). `projectPath` doubles as both which Impeccable install
`resolve()` selects and the spawn's working directory (the surface brief lives at
`.impeccable/surfaces/<target>.md` relative to it) — pass the repo root, never a bare relative
path. Stop at the first candidate whose read surfaces a `## Direction contract` heading (Step 2).

**Two ways a candidate yields nothing, both treated alike:**

- `{ok: false, ...}` — no brief exists for that target, or the call failed outright. The engine
  reports no dedicated "not found" reason; every `ok: false` means "nothing to read here."
- `{ok: true, value: <brief text>}` with no `## Direction contract` heading anywhere in `value` —
  a brief exists but was never used to record a contract.

Either way, move to the next candidate. **No candidate yields anything** → "No contract" (Step 4).

## Step 2: Recognize the blocks

Five labels, each a bare name immediately followed by `:` —

```
THESIS:   OWN-WORLD:   STORY:   FIRST VIEWPORT:   FORM:
```

Match case-insensitively, allowing any run of whitespace inside `FIRST VIEWPORT`. A block's body
runs from its own label to the start of the next label found, or to the end of the brief text for
the last one. Order is not required: use the labels' actual positions, sorted, rather than
assuming upstream's ordering — presence is structural, ordering is not.

**All five must be present.** Four is malformed, not partial — see Step 4.

This is the whole of the recognition. Do not check a block's length, do not check the 150-word
budget, do not judge whether a block "reads like a mood." Those are upstream's criteria, applied by
upstream's own reviewer.

## Step 3: Extract the seed key

Look inside the **`FORM` block only** for a label matching `seed key`, `seed-key`, or `seed`
(case-insensitive) followed by `:`. Everything after that colon, up to the end of that line or the
end of the block — whichever comes first — is the seed value, **trimmed of surrounding whitespace
and copied verbatim**.

**The value is an opaque token.** Do not validate it, normalize case, strip punctuation, check a
length, or test it against a hex pattern. It only *defaults* to eight hex characters: the key is
freely user-supplied via `--from <key>` or `IMPECCABLE_CONCEPT_SEED`, so any shape is legal. Opaque
handling is also what makes a richer value survive — if the `FORM` block names a whole reproduction
recipe (`--scope direction --mode persuade --from a1b2c3d4 --reroll 1`) rather than a bare key, that
is copied through intact and is strictly more useful, because a re-roll round is part of what
reproduces a build and a bare key alone does not carry it.

**No label, no seed.** If the `FORM` block carries no such label, the seed is absent — Step 4's third
case. Do not go hunting for a bare token elsewhere in the block; a guess written into a record as
provenance is worse than a gap, because nothing downstream can tell the two apart.

## Step 4: The three outcomes

Every call to this procedure ends in exactly one of these. There is no fourth.

| Outcome | Condition | What the caller does |
|---|---|---|
| **No contract** | No candidate's surface brief read returns a `## Direction contract` heading (Step 1's two no-hit shapes) | Nothing. Render exactly as if this procedure did not exist — no empty section, no "not found" placeholder, no `Design-seed:` line. Most records will never have a contract, so this is the ordinary case and must be silent. |
| **Malformed** | A found `## Direction contract` section carries some but not all five labels, or a label with no body | Treat as **No contract** for every rendering and recording purpose, **and log it** (below). Never render the blocks that did parse. |
| **Contract, no seed** | Five labels present, `FORM` carries no seed label | Render the blocks. **Omit** the seed entirely — omit the `Design-seed:` line rather than writing it empty. This is normal, not drift: upstream's own wording carries the seed key *"when the seed dealt stagings,"* so a contract without one is a legal contract. |

**Logging the malformed case.** Inside a pipeline (`$PIPELINE_RUN_DIR` resolved), write one
`SCANNED` entry to `{run-dir}/decisions.md` per `auto-decision-log.md`, naming the file and which
labels were found. Outside a pipeline, say it in one line in the skill's own output. The point is
that a contract silently downgraded to "absent" leaves a trace — otherwise a renamed block upstream
looks identical to a record that simply never had a contract.

## Return shape

```json
{
  "found": true,
  "file": "src/routes/+page.svelte",
  "blocks": {
    "THESIS": "...", "OWN-WORLD": "...", "STORY": "...",
    "FIRST VIEWPORT": "...", "FORM": "..."
  },
  "seed": "a1b2c3d4"
}
```

`found: false` is the No-contract and Malformed outcomes both — `blocks` and `seed` are absent, and
`file` is absent too. `seed` is omitted (never `null`, never `""`) in the Contract-no-seed outcome,
so "the contract did not carry one" and "we wrote an empty one" can never be confused downstream.

## Consumers

| Skill | Uses |
|---|---|
| `/claude-tweaks:design-wrapper` `review` mode | Step 3.6 — runs this on the changed UI files it already resolved, then writes `seed` onto the work record as its `Design-seed:` body-metadata line |
| `/claude-tweaks:demo` | Step 2 — runs this on the changed-path list Step 1 already produced, and renders `blocks` under `### The design contract this was built against` (rendering rules in `demo/design-contract-section.md`, read only when a contract resolves or parses malformed) |

`/demo` re-reads the live surface brief rather than a copy captured at build time. That is
deliberate: the acceptance gate should show the contract that is actually in the brief as it
stands when the human is asked to sign off, and a cached copy could differ from it by the time
anyone looks.
