# Design Mode — shape

Invoked via `/claude-tweaks:design-wrapper shape <topic>`. Returns `{mode, result: "ok", output}` or `{mode, skipped, ...}` to caller.

## When this runs

Called by `/claude-tweaks:specify` as a pre-decomposition step on frontend design docs. The output is appended verbatim to the design doc before decomposition into specs.

## Preconditions

Run the universal preconditions from `../SKILL.md`, **skipping Layer 2** — no spec exists yet (the caller is `/specify` working from a design doc, not a numbered spec).

- **Layer 1 (kill-switch)** still applies.
- **Layer 3 sniff** is optional — `/specify` already determined frontend before invoking; the wrapper trusts that determination here.
- **Availability check** still applies — `/impeccable:impeccable*` skill must resolve.

## Procedure

### Step 1: Run preconditions (Layer 1 + availability)

On any skip, return the skip object — the caller continues without the shape pre-step.

### Step 2: Invoke shape command

Invoke via the Skill tool, passing the topic **and**, when the caller supplied one via `--description <text>` (see `../SKILL.md`'s Input section), the description verbatim beneath it:

```
/impeccable:impeccable shape <topic>

<description, verbatim>
```

**Forward the description; never pre-classify it.** Upstream's `shape` enters `reference/new-work.md`, whose first step ("Decide what is already true") classifies the work itself — redesign, established world to inherit, incomplete brand, or no visual authority — and rules that a section or component inside an established surface inherits that surface rather than becoming a new identity exercise. That classification is upstream's to make, and it needs the description to make it. Forwarding a bare noun phrase forces it to classify from nothing; deciding the job type here and forwarding a verdict re-derives what upstream already does — the same defect that retired the keyword tables in `../command-map.md`. Do not summarize, label, or otherwise interpret the text on the way through.

**When no description was passed, forward the topic alone.** That is a degraded call, not an error: upstream still classifies, just from less. Never substitute a locally-inferred job type for the missing text.

### Step 3: Capture output verbatim

Do not parse — the caller (`/specify`) will append the full output text to the design doc.

## Output to caller

```json
{
  "mode": "shape",
  "result": "ok",
  "output": "<full text from /impeccable:impeccable shape>"
}
```

Shape mode is read-only with respect to source code (it produces planning text, not code changes).

**Return to caller:** this output is consumed by the calling skill — control returns to the caller, whose next step runs in this same turn; never end the turn on this render.
