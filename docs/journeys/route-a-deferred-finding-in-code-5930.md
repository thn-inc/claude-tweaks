---
files:
  - plugin/bin/deferral-route.js
  - plugin/bin/lib/deferral-route/route.js
  - plugin/bin/lib/policy-schema.js
  - plugin/skills/_shared/materiality-floor.md
  - plugin/bin/lib/issues/record-payload.js
  - plugin/bin/lib/tiebreak.js
  - plugin/skills/review/step3-routing.md
  - plugin/skills/wrap-up/residue-sweep.md
  - plugin/skills/wrap-up/leftover-routing.md
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/reflect/full-mode.md
  - plugin/skills/visual-review/browser-review.md
  - plugin/skills/release/disposition.md
  - plugin/skills/_shared/ledger-format.md
  - plugin/skills/reflect/SKILL.md
---

# Route a Deferred Finding in Code

**Persona:** A claude-tweaks skill session (review, reflect, wrap-up's residue sweep) that has already run the deferral gate's fix-now test on a finding, failed it, and holds one valid `Defer-reason:` — and now has to decide whether the finding is filed as a record or appended to the digest.
**Goal:** Get that decision from one command instead of re-reading `_shared/materiality-floor.md`'s prose and applying it by hand.
**Entry point:** A finding with a `Defer-reason:` from `_shared/deferral-gate.md`'s vocabulary, the calling skill's own judgement of how the record would be scored at filing time (`size`, `priority`, `risk`), the finding's severity if it has one, and whether the finding was raised by an agent or typed by a human.
**Success state:** One JSON line naming the verdict (`file` or `digest`), the clause that decided it, and the inputs exactly as passed — or, for malformed input, a `refused` verdict naming what was wrong and what is accepted, exit 2.

## Steps

### 1. Ask for a verdict
- **URL:** `node plugin/bin/deferral-route.js --defer-reason pre-existing-outside-diff --size low --priority low --risk low --agent-raised`
- **Action:** Pass the reason, the three axes as the skill would score a fresh filing, `--severity` when the finding carries one, and exactly one of `--agent-raised` or `--human` (`--human` whenever the origin is unsure, because `--human` files).
- **Should feel:** Like asking a referee, not consulting a rulebook. One line comes back and it is the whole answer.
- **Should understand:**
  - `digest` comes from rule `floor` (every floor condition held) or rule `policy-reason` (the reason is listed in policy key `deferral-digest-reasons`, whatever the axes).
  - `rule` names the first clause that decided, in a fixed order: `refused`, `human`, `severity`, `policy-reason`, `tangential`, `not-low`, `floor`. A tangential finding at severity `high` reports `severity`, not `tangential`.
  - An axis passed as anything but the exact string `low` (`medium`, `Low`, omitted) counts as not low and files — it is never refused.
  - The command writes nothing and calls no `gh`; acting on the verdict is still the caller's job.
- **Red flags:** A `floor` digest with any axis other than `low`; a `digest` for `--human` or a `high`/`critical` severity; a `tangential` digest whose rule is not `policy-reason`; the command creating a file or a record.

### 2. Read a refusal and fix the call
- **URL:** `node plugin/bin/deferral-route.js --defer-reason not-a-reason --agent-raised` (or `--severity High`, `--agent-raised --human`, a flag with no value)
- **Action:** Read the `reason` field (also printed alone on stderr), correct the argument it names, and re-run.
- **Should feel:** Strict but specific — the message names the bad value and the accepted list, so the fix is a single edit.
- **Should understand:**
  - Exit 2 with `{"verdict":"refused","rule":"refused","reason":...}` on stdout is a malformed call, not a routing answer. A severity typo such as `High` is refused rather than read as not high, because reading it as not high could digest a critical finding.
  - `input` still echoes every flag as given, so the caller can see what it actually passed.
  - An omitted `--severity` is valid (reflect insights carry none) and counts as not high.
  - Exit 1 with nothing on stdout means the policy read failed (the resolver refused `--run`, or the working directory could not be read), with the message on stderr.
  - A refusal is exit 2 even when `--run` is also bad: it is decided before any policy read.
  - An invalid `deferral-digest-reasons` value prints one stderr warning naming the bad element, and routes as if the key were unset.
- **Red flags:** A refusal that exits 0; a reason that does not name the offending value; a `--severity` typo routed as `file` or `digest`.

### 3. Act on the verdict at the skill's own routing site
- **URL:** `plugin/skills/review/step3-routing.md`, `plugin/skills/release/disposition.md`, `plugin/skills/reflect/full-mode.md`, `plugin/skills/visual-review/browser-review.md`, `plugin/skills/wrap-up/residue-sweep.md`, `plugin/skills/wrap-up/leftover-routing.md`, and control mode's `belowFloor` in `_shared/ledger-format.md` and `wrap-up/review-console.md` step 10
- **Action:** Run the command from `_shared/materiality-floor.md`'s `## Applying the floor`, then file a backlog record on `file` and log a digest entry on `digest`; on `refused` or any other outcome, leave the item open and report what the command printed, never re-running it or falling back to the floor's prose.
- **Should feel:** The same answer wherever a deferral is routed; no site re-derives the floor from prose.
- **Should understand:**
  - Every routing site reads the verdict; none decides the floor itself.
  - A `refused` verdict is never digested; control mode, which must converge every item, files it.
  - An agent-supplied severity is passed through as given, not remapped to fit.
  - Reflect's auto-mode tangential staging (`plugin/skills/reflect/SKILL.md`) is the one site that stages instead of leaving the item open: on `digest` it appends the idea to the digest and stages no Queue write; on `file`, `refused` or any other outcome it stages the candidate as before.
  - A digest's label and ledger Resolution name the rule that sent it: `floor` reads below floor, `policy-reason` names `deferral-digest-reasons`.
- **Red flags:** A routing site that decides file-versus-digest without running the command; a `refused` verdict that gets digested, or that a non-control-mode site files; two sites giving different verdicts for the same finding.
