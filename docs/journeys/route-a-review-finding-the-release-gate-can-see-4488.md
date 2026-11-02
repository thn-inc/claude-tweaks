---
files:
  - plugin/bin/review-routing-line.js
  - plugin/bin/lib/log-decision/review-routing.js
  - plugin/bin/log-decision.js
  - plugin/skills/review/step3-routing.md
  - plugin/skills/release/SKILL.md
  - plugin/skills/release/disposition.md
  - tests/review-routing-line-prose-conformance.test.js
---

# Route a Review Finding the Release Gate Can See

**Persona:** A review agent in `/claude-tweaks:review` Step 3 Routing, inside a `/claude-tweaks:flow` run or `/claude-tweaks:release`'s whole-branch review. A lens has just confirmed a high-severity security finding in `app/routes/posts.$postId.tsx:12`, and the agent must log where it went.
**Goal:** Log one `## /review` line that `/claude-tweaks:release` Step 3's token match classifies correctly, and that points at the right file, without composing the wording by hand.
**Entry point:** `review/step3-routing.md`'s AUTO / STAGED / KEPT-PROMPT bullets, whose `Log:` field is a `review-routing-line.js` command.
**Success state:** `decisions.md` holds `STAGED … — Step 3 Routing: high-severity finding security at app/routes/posts.$postId.tsx:12. Stage path: staged/review-3.patch. Reversibility: high.` The release gate reads it as `review: blocking`, and the agent never typed a severity token, a step prefix or a quote escape beyond `'\''`.

## Steps

### 1. Pick the route — the ceiling table
- **URL:** `plugin/skills/review/step3-routing.md`'s ceiling-keyed routing table
- **Action:** The agent reads the finding's severity against the resolved `review-auto-apply-ceiling`. High routes STAGED at every ceiling; critical always routes KEPT-PROMPT; low/medium route AUTO or STAGED by ceiling.
- **Should feel:** Decided for it. The table names one route per severity and ceiling.
- **Should understand:** The route picks the CLI's `--route` value. KEPT-PROMPT still stages a patch, but its log line never names one.
- **Red flags:** The bullet invites `--stage-path` on a KEPT-PROMPT line, or a high finding looks routable to AUTO.

### 2. Run the cited command — `review-routing-line.js`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/review-routing-line.js" --run "$PIPELINE_RUN_DIR" --route staged --severity high --category 'security' --at 'app/routes/posts.$postId.tsx:12' --stage-path staged/review-3.patch`
- **Action:** The agent fills the placeholders and runs the command, single-quoting `--category` and `--at` (a `'` inside a value is written `'\''`). The CLI composes the text and appends it under `## /review` with step `Step 3 Routing`, echoing the line.
- **Should feel:** Like filling a form. Severity case (`High`) doesn't matter, and the token order is not the agent's job.
- **Should understand:** Exit 2 means the call was refused and nothing was written: a route/severity pairing the table never produces, a flag that doesn't belong to the route (`--commit` on staged), a non-hex `--commit`, a malformed `--stage-path`, or a `--category`/`--at`/`--lever` that carries a line break or `severity finding` / `critical finding`. Exit 3 means the run dir is missing or not anchored under the main checkout. `tests/review-routing-line-prose-conformance.test.js` runs the command each `Log:` bullet and the record-proposal paragraph cite, and fails if `step3-routing.md` regains a hand-typed `Step 3 Routing` template. A bullet that drifts from the CLI fails CI.
- **Red flags:** The `$postId` segment vanishes from the logged path (the value was double-quoted), or a hand-typed `{severity}-severity {category} finding` reaches `decisions.md`.

### 3. No patch to stage — a record proposal (`staged/review-followup-{n}.md`)
- **URL:** `plugin/skills/review/step3-routing.md`'s "Staging a record proposal" paragraph
- **Action:** A finding the table routes AUTO or STAGED fails the deferral gate's fix-now criteria with a valid `Defer-reason:`. Its fix is a new work record, not a diff.
  - **Low or medium, below the materiality floor and not `tangential`:** the finding goes to the digest with the floor's `AUTO … materiality-floor:` line, and its ledger row is written `accepted`. A `high` finding never takes this branch, so its staged line always carries `high-severity finding`.
  - **Otherwise:**
    1. The agent writes the proposal (`Title:`/`Type:`/`Labels:`/`Defer-reason:`/`Finding:` header, a blank line, then the body) to a `.md` scratch path.
    2. It stages the file with `stage-item.js --id review-followup-1 … --allocate`.
    3. It reads `{n}` from the first stdout line.
    4. It logs `review-routing-line.js --route staged … --stage-path staged/review-followup-{n}.md`.
- **Should feel:** Like the patch path with a different payload. The name is fixed, so there is nothing to invent.
- **Should understand:** Nothing is filed here: the Review Console's Queue writes step files the record on approval. The ledger row is written `deferred`, naming the staged file: `spec-{N}/staged/review-followup-{n}.md` in a multi-spec run, so one path names one proposal. If the console refuses the proposal for want of a valid `Defer-reason:`, that row returns to `open` and the staged file is removed (`settle-a-refused-staged-proposal-in-the-ledger-4772.md`). `--id review-{n}.md` is refused as `unmapped-prefix`, and a literal `{n}` in `--id` exits 2.
- **Red flags:** A record proposal staged as `review-{n}.md`, a STAGED line naming a different `{n}` than the file `--allocate` wrote, a low/low/low finding filed as a backlog record, or a `high` finding digested with no `high-severity finding` line.

### 4. A hand-typed prefix is refused — `log-decision.js`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status STAGED --step "Step 3 Routing" --text "Step 3 Routing: …"`
- **Action:** An agent that bypasses the composer and copies an old template's `Step 3 Routing:` into `--text` gets exit 2, with stderr naming both the `--step` and the `--text` values.
- **Should feel:** Caught before damage — the doubled `Step 3 Routing: Step 3 Routing:` line never lands.
- **Should understand:** `log-decision.js` writes `{step}: ` itself, so a text that begins with its own `--step` + `:` is always a mistake. The same refusal covers `--text-file` and every `--entries` element.
- **Red flags:** The doubled prefix is written, or the refusal fires on a text that merely mentions the step without the colon prefix.

### 5. The release gate reads it — `/claude-tweaks:release` Step 3
- **URL:** `plugin/skills/release/SKILL.md` Step 3's verdict table
- **Action:** **The release agent** reads the `## /review` lines after its marker and classifies on the literal tokens `critical finding` / `high-severity finding`.
- **Should feel:** Trustworthy. A staged high or critical finding always blocks.
- **Should understand:** The composer is what guarantees the token's presence and order; `tests/bin-lib/log-decision/review-routing.test.js` reads the tokens from this table, so a reworded gate fails there.
- **Red flags:** A staged high finding classifies as `review: findings` or `review: clean`.

### 6. Step 8 disposition settles every staged file — `release/disposition.md`
- **URL:** `plugin/skills/release/disposition.md`'s Review staging roster and Routing table
- **Action:** **The release agent** inventories `staged/`. It matches `review-3.patch` to the `review-{n}` row (`confirmed`) and `review-followup-2.md` to the `review-followup-` row (`proposal`). It reads each file's severity from its `Finding:` line and pre-fills one Recommended disposition per row.
- **Should feel:** Mechanical. Every file the review staged has a row, and none needs a hand-written disposal note.
- **Should understand:** `review-{n}` covers only `.patch`. The roster↔SECTION_MAP test in `tests/release-run-dir-lifecycle-conformance.test.js` fails if a roster example cannot be staged, if a row's Example names no `staged/` file (the example check would pass over it), or if a `review-*` console prefix has no roster row (#4647).
- **Red flags:** A `review-followup-` file reported as `unrecognised staged file, no route`, or a high record proposal floor-tested as medium because its `Finding:` line is missing.

## Origin
- Created during build of #4488 (review routing line composer + `--step` prefix refusal)
- Steps 1-2 and 4-5 built in #4488; steps 3 and 6 added in the build of #4484 (the `review-followup-{n}.md` staging name, its roster row, and the auto-mode materiality floor)
- Updated during the wrap-up of #4772: step 3 notes the spec-qualified Resolution path in a multi-spec run, and that a refused record proposal reopens its ledger row.
- Related: #4481 (the run whose hand-typed lines carried the doubled prefix and the mis-ordered token), #3792 (git/user text never double-quoted)
