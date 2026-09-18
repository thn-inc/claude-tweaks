---
name: capture
description: Use when capturing ideas that need specification later — brain dumps, half-formed features, things to not forget
argument-hint: '<idea text> [--route=brainstorm|keep|absorb:N] [--title="..."] [--type=bug|feature|task] [--needs-definition|--no-needs-definition] [--batch <path>]'
---

# Capture — Quickly note an idea for later specification

Quick capture for ideas that aren't ready for full specification. Part of the workflow lifecycle:

Lifecycle: `/claude-tweaks:init` → **`/claude-tweaks:capture`** → `/superpowers:brainstorming`

## When to Use

- User mentions something that should be a feature but isn't specified
- Discovery during implementation reveals something that needs its own spec
- "We should probably..." or "Don't forget to..." moments
- Anything that would otherwise be lost or forgotten

> **Backlog vs parked:** Use `/claude-tweaks:capture` for new ideas and half-formed features — these land as fresh backlog records: no stage label under `work-backend: github-issues`, no `stage:` frontmatter under `work-backend: local-files`. Work deferred from an active build/review goes through `/claude-tweaks:tidy`'s Defer action instead — the existing record gains the `parked` label (`github-issues`) or `stage: parked` frontmatter (`local-files`) plus a trigger. `/claude-tweaks:wrap-up`'s leftover routing is the other producer of `parked` records: it stages a *new* record for each unfinished spec section, which the Review Console creates on approval. Either way a deferred record carries origin context, file references, and a timing trigger that a fresh backlog record doesn't have. See `_shared/work-record.md` for the full stage vocabulary (backlog / parked / ready).

## Input

`$ARGUMENTS` is parsed as `<idea text> [--route=<value>] [--title="..."] [--type=<value>] [--needs-definition|--no-needs-definition] [--batch <path>]`:

| Argument | Behavior |
|----------|----------|
| Free-text idea | The body of the new backlog record (title is derived from the first phrase or supplied via `--title=`). Mutually exclusive with `--batch` — a batch invocation has no single idea text. |
| `--batch <path>` | Multi-entry filing — see Batch Mode below. `<path>` is a JSON file listing `{title, body, type?}` entries; each files through the same per-entry pipeline a single invocation runs, in one routing/confirmation pass for the whole set. Every other flag in this table applies uniformly across the batch unless an individual entry object supplies its own same-named field, which wins for that entry only. |
| `--route=brainstorm` / `--route=keep` / `--route=absorb:N` | Skip the post-capture routing prompt; apply the route directly. Legacy `--route` values are still accepted as aliases — see Immediate Routing. |
| `--title="..."` | Override the auto-derived title. |
| `--type=bug` / `--type=feature` / `--type=task` | Override the keyword-guessed Type outright — skips Guessing the Type below. Useful for auto-mode/headless capture calls (a Routine, or a scripted call from another skill's Next Action) where there is no next message to send a free-text correction in, and for any calling skill that already knows the correct type. |
| `--needs-definition` / `--no-needs-definition` | Override the content-judged Definition call outright — skips Judging Definition below. Same auto/headless rationale as `--type=`: forces the flag either way with no free-text turn to correct it. |
| `--defer-reason=<value>` | One of `DEFER_REASONS` (`bin/lib/issues/record.js`; vocabulary in `_shared/deferral-gate.md`). **Required** when the filing is a deferral — the body carries an `Origin:` line, `--origin=` was supplied, or any `--source` was given (a producer's Capture route) — `--source intake` excepted; missing then → stop and report, file nothing. Optional otherwise. A `Defer-reason: {value}` line already inside the idea text counts as supplied (validated the same way). See the Shaped-body branch below. This includes health-skill triage captures passing `--source` — `tangential` is the usual fit. |
| `--risk=<low\|medium\|high>` / `--size=<low\|medium\|high>` | Shaped-body branch only: override the self-judged scoring — same auto/headless rationale as `--type=`. Ignored on the stub branch (a fresh capture is never scored). |
| `--origin="<text>"` | Shaped-body branch only: an `Origin:` provenance line for the composed body (producers' Capture routes pass their own). Its presence makes the filing a deferral (see `--defer-reason=`). |

When `$ARGUMENTS` is empty, prompt the user for the idea body.

## Workflow

| Step | What |
|------|------|
| 1 | Add the record — GitHub issue via `recordPayload`, or a `specs/{id}-{slug}.md` record via `local-store.js`, per Backend Selection below; a spec-shaped `$BODY` takes the Shaped-body branch (files scored + `ready`, skips the cap and the chain); under the born-ready condition, chains `/claude-tweaks:specify #{n} --chained` immediately after the record exists — see Backend Selection. **Pre-empted by the headless bar** (`routing.md`'s Headless bar): an agent-driven filing that qualifies to absorb never reaches this step at all — it absorbs into the candidate directly and files nothing. |
| 2 | Route per `--route` arg, or via the Routing Prompt below. |
| 3 | Commit (when this is a standalone invocation; component-skill callers commit themselves). `work-backend: local-files` captures always have something to commit — the new record file, or, under route `absorb:N`, the edited/deleted target record file. `work-backend: github-issues` captures have nothing new to commit unless the failure fallback wrote a local `specs/{id}-{slug}.md` record — its `absorb:N` route edits the target issue via `gh` CLI only (see Route execution below), so no local file is touched. |

## Batch Mode

Reached only when `--batch <path>` is supplied — files multiple entries from one JSON file through the same per-entry pipeline Workflow Step 1 runs for a single invocation, with one routing/confirmation pass and one summary table for the whole set. Read `batch-mode.md` in this skill's directory for the full procedure: the entry-file shape, the per-entry loop and its fail-safe batching, over-cap entry handling, batch-level routing, and the Batch Summary template.

## Backend Selection

Read the `work-backend` field from the project's CLAUDE.md (under a `## Work records` section, written by `/claude-tweaks:init`). A missing flag is treated as `local-files` — same missing-flag convention as `design-integration`.

`$TITLE`/`$BODY`/`$TYPE` below are the same fields Entry Format and Adding an Entry (further down) have always asked for: `$BODY` is the `**Related:**`/`Context:`/`Scope:` block assembled per Entry Format; `$TYPE` is the guessed-then-confirmed Type from Adding an Entry.

Apply `by:capture`, the Type expression, and `needs:definition` (only when `$NEEDS_DEFINITION` is `true` — see Judging Definition below) and nothing else — that is the whole of this skill's permission-matrix row in `_shared/work-record.md`. Never stamp a scoring, `parked`, `auto:*`, or `bot:*` label on a fresh **stub** capture; a new record carries no stage label at all (the stage vocabulary is backlog / parked / ready, and `/claude-tweaks:tidy` and `/claude-tweaks:specify` are what move a record along it) — with three exceptions below: the ceiling-gated chained shaping, the Shaped-body branch's scored, born-`ready` filing (its own section below), and absorb's raise-only `size:` on the target record.

**One exception, off by default.** Under `autonomy: trusted` or higher, and only when the
`producer:capture` class carries a `clean` trust verdict, a fresh capture is chained straight into
`/claude-tweaks:specify` shaping immediately after filing (`Skill(skill: "claude-tweaks:specify",
args: "#{n} --chained")` — headless, no Next Actions), so the record lands spec-shaped, scored,
and `ready` under specify's own authority — able to pass `/claude-tweaks:backlog refine` Step
3.5's spec-shape gate, which a bare `ready` stamp on a raw stub never could (#575). See
`_shared/autonomy-ceiling.md`. At `supervised`, the default and the state of any repo that has not
opted in, this never fires and the paragraph above holds unchanged. A filing that took the
Shaped-body branch (below) never chains either — there is nothing left to shape.

**Skip entirely when this filing carries `needs:definition`** (`$NEEDS_DEFINITION` is `true` —
see Judging Definition below). A record naming a genuine open choice cannot be born-ready by
construction: `ready` means agent-sized and unambiguous, and an undecided record is neither. Skip
before the `gh issue list`/git-log round-trip below, not just its conclusion — spending that
round-trip on a record that structurally cannot be born-ready is wasted work, not just a display
bug. File plain (no chain) and proceed straight to Backend Selection's filing step.

Resolve it as a **single decision, before filing**, and only under `work-backend: github-issues`
(the trust table reads `demo:*` labels, which do not exist on the `local-files` driver). Resolve
both policy values in ONE call — `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values autonomy trust-revert-window-days`
(one value per line, in request order) — and substitute the first line's literal value for
`{resolved-ceiling}`. When it resolves to `supervised`, skip
this block entirely rather than fetching anything.

Substitute the second line's literal value (the resolved `trust-revert-window-days`) for
`{resolved-window}` below. If the `gh` call, the `git log`
call, or the node block fails for any reason, skip the chain — the record stays a plain capture:
this path fails toward the default, never toward the grant (unchanged from before this sub-issue). `{resolved-window}` reaches the
script as a `process.argv` arg after `--`, never spliced into the JS source — a value containing a
quote character would otherwise break out of the string literal, the same reason
`code-health/focus-mode.md`'s F1 block passes its own values that way.

Read through the session-scoped record snapshot (`_shared/record-queue-fetch.md`) instead of a
bare fetch — `comments` carries each record's own comment bodies (the negative-evidence marker
path, #268, reads `<!-- trust-negative-evidence: ... -->` back from here; the node block below
spreads `...i` so it reaches `trustRows` unchanged), and the snapshot's union field set already
carries it:

Resolve this fence's session-scoped destination path first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CAPTURE_TRUST_RECORDS=capture-trust-records.json)"
{Session-scoped record snapshot's read-fresh-or-fetch block, with {tmp-records-file} =
 $CAPTURE_TRUST_RECORDS}
```

Resolve the integration branch per `_shared/integration-branch.md`'s resolution ladder, substituting
its value for `{integration-branch}` below. The git-log dump follows the same session-scoped
freshness rule as the record snapshot (`_shared/record-queue-fetch.md`'s Session-scoped record
snapshot section) — reuse `/tmp/ct-gitlog-{session-id}.txt`
(`record-snapshot.js`'s `gitLogPath($CLAUDE_CODE_SESSION_ID)`) when fresh, else regenerate it.
The destination this fence writes to is this run's own session-scoped path, re-resolved here
(`_shared/session-tmp-root.md`) — distinct from the `$GITLOG` cache-freshness path above, which
is a session-wide snapshot rather than this skill's own working copy:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CAPTURE_TRUST_GIT_LOG=capture-trust-git-log.txt)"
GITLOG=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').gitLogPath(process.env.CLAUDE_CODE_SESSION_ID) || '')")
if [ -n "$GITLOG" ] && node -e "
  const { isFresh } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js');
  process.exit(isFresh(process.argv[1], Number(process.argv[2])) ? 0 : 1)
" "$GITLOG" "$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values record-snapshot-ttl-seconds)"; then
  cp "$GITLOG" "$CAPTURE_TRUST_GIT_LOG"
else
  git log "{integration-branch}" --format='%H%x1f%B%x1e' > "$CAPTURE_TRUST_GIT_LOG"
  [ -n "$GITLOG" ] && cp "$CAPTURE_TRUST_GIT_LOG" "$GITLOG"
fi
```

Re-resolve both session-scoped paths this fence needs (a fresh bash invocation does not inherit
either prior fence's shell variables, `_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" \
  CAPTURE_TRUST_RECORDS=capture-trust-records.json \
  CAPTURE_TRUST_GIT_LOG=capture-trust-git-log.txt)"
node -e "
  const fs = require('fs');
  const root = '${CLAUDE_PLUGIN_ROOT}';
  const { trustRows, parseGitLog } = require(root + '/bin/lib/issues/trust.js');
  const { resolveCeiling, permittedGrants } = require(root + '/bin/lib/issues/autonomy.js');
  const issues = require('$CAPTURE_TRUST_RECORDS').map((i) => ({ ...i, labels: i.labels.map((l) => l.name) }));
  const gitLog = parseGitLog(fs.readFileSync('$CAPTURE_TRUST_GIT_LOG', 'utf8'));
  const policy = { 'trust-revert-window-days': process.argv[1] };
  // This skill's own class. A fresh capture carries by:capture and no risk
  // score, and riskBand() bands an unscored record 'elevated' — so that is the
  // cell the record about to be filed will land in, and the only one that may
  // authorize it. Never read producer:capture|low here: it is a different class
  // with different evidence.
  const row = trustRows(issues, gitLog, Date.now(), policy).find((r) => r.key === 'producer:capture|elevated');
  const ceiling = resolveCeiling({ policy: '{resolved-ceiling}' });
  const permitted = permittedGrants({ ceiling, row });
  const g = permitted.grants.bornReady;
  console.log(JSON.stringify({ bornReady: g.granted, reason: g.reason, verdict: row ? row.verdict : 'no-cell' }));
" -- "{resolved-window}"
```

Never add `ready` to the label set below — a capture files plain at every ceiling. When
`bornReady` is `true`, complete the filing first, then invoke
`Skill(skill: "claude-tweaks:specify", args: "#{n} --chained")` in the same turn — shaping mode
composes the spec-shaped body around the stub (preserved as its `## Original request`), stamps
scoring and `ready` in its single compose-then-write-once call, and renders no interactive prompt
— and log one `decisions.md` line in `_shared/autonomy-ceiling.md`'s Logging shape (the
filed-then-shaped form). Never infer the answer from the policy value alone — the class verdict is
half the condition, and on a repo with no acceptance evidence `bornReady` is `false` at every
ceiling. If the `gh` call, the `git log` call, the node block, or the chained shaping itself fails
for any reason, the record simply stays a plain capture: this path fails toward the default, never
toward the grant.

**When `work-backend: github-issues`:**

1. Bootstrap per `_shared/label-bootstrap.md`, `LABELS_JSON`:

   ```bash
   # Bootstrap per _shared/label-bootstrap.md, LABELS_JSON =
   # [["by:capture", "Origin: filed via /capture"]]
   ```

   When the project's `work-types` key reads `labels`, also bootstrap the guessed `type:{t}` label the same way — its pair lives in `record.js`'s `TYPE_LABELS` (e.g. `['type:bug', 'Type: a defect in existing behavior']` when the guess is `bug`).

   When `$NEEDS_DEFINITION` is `true`, also bootstrap `needs:definition` the same way — its pair
   lives in `_shared/label-bootstrap.md`'s `LABELS_JSON` (`["needs:definition", "Undecided idea —
   must go through /specify's brainstorm redirect before reaching ready"]`).

2. Build the payload and write the body file via `bin/compose-record.js` (#686/#800's CLI precedent — replaces the hand-rolled compose-then-extract `node -e` pair). The temp payload path keys off `$CLAUDE_CODE_SESSION_ID` (the same session identity `_shared/issue-claims.md` stamps on a claim) rather than a fixed name — a concurrent `/capture` invocation against the same checkout gets its own path, never this session's:

   ```bash
   node -e "require('fs').writeFileSync('/tmp/capture-' + (process.env.CLAUDE_CODE_SESSION_ID||'') + '-payload.json', JSON.stringify({title:process.argv[1], body:process.argv[2], type:process.argv[3], origin:'capture'}))" "$TITLE" "$BODY" "$TYPE"

   node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-payload.json" --out "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-body.md"
   ```

   **Type expression branch.** Read the project's `work-types` config key once before filing and branch — never re-probe mid-flow (`_shared/work-record.md`'s config-key table; the key is written by `/init`). `work-types: native` applies `$TYPE` via GitHub's native Issue Type; `work-types: labels` adds the matching `type:$TYPE` label instead (the pairs live in `record.js`'s `TYPE_LABELS`):

   ```bash
   # work-types: native
   gh issue create \
     --title "$TITLE" \
     --body-file "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-body.md" \
     --type "$TYPE" \
     --label by:capture

   # work-types: labels
   gh issue create \
     --title "$TITLE" \
     --body-file "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-body.md" \
     --label by:capture \
     --label "type:$TYPE"
   ```

   Append `--label needs:definition` to whichever `gh issue create` call above ran, when
   `$NEEDS_DEFINITION` is `true`.

   **Recent-commit overlap check.** Immediately after the `gh issue create` call above succeeds, run `_shared/health-recent-commit-check.md` and apply it in full (`title: "$TITLE"`) — it screens the just-filed record against recently-merged commits and, on a strong match, posts a triage comment rather than blocking or reopening anything.

   Immediately after the `gh issue create` call succeeds, invalidate the session-scoped record
   snapshot (`_shared/record-queue-fetch.md`) — this filing changed what a `--state all` pull
   would return, so the next consumer must re-fetch rather than read the pre-filing snapshot — and
   remove this step's own temp files, now that `gh issue create` has read them:

   ```bash
   node -e "require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').invalidateSnapshot(process.env.CLAUDE_CODE_SESSION_ID)"
   rm -f "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-payload.json" "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-body.md"
   ```

3. **On failure** (GitHub unreachable, `gh` broken, `gh` not installed, transient API error): fall back to the local driver — write the record via `local-store.js`'s `createRecord` (atomic id allocation; see the local-files branch below for why `allocateId`+`writeRecord` is unsafe for creating a brand-new record). Same script as the local-files branch below, with one difference: `facets` also includes `unsynced: true`.

   Tell the user issue creation failed and the record landed locally instead (path printed by the script), `unsynced: true`. No further marker is needed beyond that facet — `/claude-tweaks:tidy`'s record scan surfaces `unsynced` local records as Sync findings, reconciling them onto GitHub on a later pass.

   **Decision (#1352): no MCP-first attempt, `gh`-absent included.** Unlike `/claude-tweaks:backlog refine`'s headless posture, whose whole Routine firing does nothing when `gh` is absent with no fallback, one capture's failure only delays a record's GitHub-side existence — `unsynced: true` is already a working, human-reconcilable path the headless posture categorically lacked. MCP-first here would also need the same treatment across every health-skill filing site sharing this pattern, out of this record's scope. Revisit only if a Routine's capture step is observed hard-failing `gh`-absent in practice; `_shared/github-write-transport.md`'s "Create an issue" row is then a one-call wire-in.

**When `work-backend: local-files` (or the flag is missing):**

Write the record via `local-store.js`'s `createRecord` — no `unsynced` facet (there is no GitHub side to reconcile against). This is the same script the `github-issues` branch's On-failure fallback above reuses, with `unsynced: true` added to `facets`. Use `createRecord`, not `allocateId`+`writeRecord`: two near-simultaneous `/capture` (or `/specify` decomposition) invocations calling `allocateId`+`writeRecord` separately can both read the same directory listing, both compute the same next id, and both succeed under different slugs — two records silently sharing one numeric id, corrupting any later `facets.parent`/`facets.blockedBy` reference that assumes id uniqueness. `createRecord` closes that race by allocating the id and writing the file as one atomic step (see `bin/lib/issues/local-store.js`'s header comments on `allocateId` and `createRecord`):

```bash
node -e "const fs=require('fs');
  const {createRecord, deriveSlug}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const dir='specs';
  const existingSlugs=fs.existsSync(dir)
    ? fs.readdirSync(dir).map((n)=>/^\d+-(.+)\.md$/.exec(n)).filter(Boolean).map((m)=>m[1])
    : [];
  const slug=deriveSlug(process.argv[1], existingSlugs);
  const record = createRecord(dir, {
    slug,
    title: process.argv[1],
    body: process.argv[2],
    facets: { type: process.argv[3], origin: 'capture' }
  });
  console.log(record.path)" "$TITLE" "$BODY" "$TYPE"
```

Add `needsDefinition: true` to the `facets` object literal above, parallel to `type`/`origin`, when
`$NEEDS_DEFINITION` is `true` — the local-files mirror of the `github-issues` branch's
`--label needs:definition`.

`{slug}` is derived from the title by `local-store.js`'s `deriveSlug(title, existingSlugs)` — lowercase, collapse runs of non-alphanumeric characters to a single `-`, trim leading/trailing `-`, truncate to 60 characters, dedupe against `existingSlugs` with a numeric suffix (`-2`, `-3`, ...). One deterministic implementation, not a hand-executed algorithm — see `bin/lib/issues/local-store.js` and its tests in `tests/bin-lib/issues/local-store.test.js`. `createRecord('specs', { slug, ... })` allocates the numeric `{id}` prefix atomically as part of the same call — do not call `allocateId` separately when creating a brand-new record.

## Shaped-body branch

**Detection is by what is supplied, never by who invoked.** Split `$BODY` on line-anchored `## ` headings. The body is **shaped** when it contains `## Current State`, `## Deliverables`, `## Release Note`, and exactly one of `## Acceptance Criteria` / `## Open Question`, each followed by non-empty content, and no placeholder marker from `_shared/work-record.md` appears outside the exempt `## Original request` section (#1240). Anything before the first heading becomes `header` (e.g. a `Trigger:` line the caller supplied) — EXCEPT an `Origin:` line and a `Defer-reason:` line, each lifted out of `header` into `provenance` (`origin` / `deferReason`) so the composer renders each exactly once; when both a body-carried `Origin:` line and `--origin=` are supplied, the body's line wins and the flag is ignored with a one-line note. A body that has the headings but fails the check falls through to the stub branch with one line saying why. The deferral check runs regardless of branch — it keys on content and `--source`, not on shape, so an unshaped `--source` filing without a valid reason also stops. A human who pastes a shaped body takes this branch too; a human typing a short idea still gets the stub and today's behavior.

On match, skip Entry Format's stub assembly and its character-budget cap, and run this precedence:

**Before composing, run `_shared/dependency-narration-check.md`'s check** against `currentState`/`deliverables` (applies to every branch below) — auto-populates a `blocked-by:` edge on a hit.

1. **Judging Definition first — and it wins.** `needs:definition` (judged, or `--needs-definition`, or an `## Open Question` section present) → compose via `specShapedBody` with `openQuestion`, `filedBy: 'capture'`, footer `_Filed by \`capture\` via specShapedBody._`, and file with `needs:definition`, no `ready`, no scoring (an undecided record is never born-ready). `--defer-reason=` is **not** required here — a needs-you record is not a deferral; when supplied it is still rendered via `provenance.deferReason`.
2. **The deferral check.** The filing is a deferral when the body carries an `Origin:` line, `--origin=` was supplied (both content signals — either way the composed body carries provenance), **or** any `--source` value other than `intake` was given — the rule keys on "any `--source`", not named producers. A deferral with no `--defer-reason=` and no `Defer-reason:` line in the text → **stop and report the missing reason; file nothing** (the same hard gate `wrap-up/refused-proposals.md` enforces at the console). This check is evaluated before branch selection — a supplied `--defer-reason=` is never silently dropped on the stub path (a stub deferral's validated value is passed to `recordPayload({deferReason})`, which inserts the body line). This is the one deliberate content-keyed exception where invoker identity enters (`--source` as the headless-caller equivalent of the `Origin:` content signal), named as such.
3. **Score and file born-ready.** Judge `risk`/`size` per `_shared/work-record.md`'s Scoring axis (or take `--risk=`/`--size=` overrides), compose via `specShapedBody({ header, currentState, deliverables, acceptanceCriteria, filedBy: 'capture', provenance: { origin: <the lifted line's value (the text after `Origin: `), else the `--origin=` text, else omitted>, deferReason }, footer: '_Filed by `capture` via specShapedBody._' })`, and file via Backend Selection's existing filing step with `recordPayload({ …, origin: 'capture', risk, size, ready: true, deferReason })` — `ready` regardless of the autonomy ceiling.

**Decision (recorded, not an omission):** `ready` on this branch follows from the born-ready rule's own reasoning — a `specShapedBody`-composed, scored body is structurally what health skills file, and they are `ready` by construction — not from a trust verdict; the human gate stays the grant at `refine`, and the trust ledger's `producer:capture` class grades outcomes post-hoc. Self-judged scoring is likewise deliberately unconditional (the same judgment `/specify` shaping mode makes).

**Skips on this branch:** the `gh issue list`/git-log trust fetch and #575's chain-into-`/claude-tweaks:specify` step never run — the record is already the shape that chain exists to produce. Presentation line: `Added: '{title}' (Type: {t}, Definition: clear, shaped — risk:{r} size:{s}, ready)`.

## Entry Format

Both drivers share the same body shape — this is `$BODY` in Backend Selection above:

```markdown
**Related:** {optional related record numbers, or "none"}

Context: 1-2 sentences on why this came up or what triggered it

Scope: Rough sense of what it might involve (can be vague)
```

**`work-backend: github-issues`** — this becomes the issue body; the issue title (`$TITLE`) is the short entry title.

**`work-backend: local-files`** — this becomes the record body under the frontmatter; `local-store.js`'s `writeRecord` composes the `# {title}` heading above it automatically.

### Hard cap: ~400 characters per entry

Measured over the `Context:` + `Scope:` field content combined (the prose after each label, not the labels themselves, not `**Related:**`) — a character budget, not a line count. Line count is gameable: a long paragraph wrapped or packed onto exactly 5 lines is not shorter than the same words spread across ten, and a naive line-count cap lets it through uncapped. Roughly 400 characters matches the two one-line "Good entries" examples below.

When the combined content exceeds the budget, it's past the raw-capture stage — branch on what kind of "past raw-capture" it is:

- **Genuinely undecided, half-formed thinking** (the common case) — run `/superpowers:brainstorming` on it instead.
- **Already-decided, evidence-carrying content** (an audit- or health-sweep-derived finding that already names a file/line and a determined fix, and would just be padded to fit the stub fields otherwise) — compose it as a spec-shaped body (`## Current State` / `## Deliverables` / `## Acceptance Criteria`) and pass that as `$BODY` instead of the stub fields. This takes the Shaped-body branch above, which has no length cap and files the record scored and `ready` — the sanctioned exception path, not a workaround of this cap.

Applies to both drivers. The cap governs the stub branch only — a supplied shaped body (see Shaped-body branch above) is exempt by design, which is also where the second case above lands.

## Adding an Entry

Both drivers run Backend Selection above; don't overthink — capture the essence.

When the idea proposes building a new `bin/` CLI, check for a same-named deliverable already
shipped or already proposed elsewhere before filing — `_shared/issue-claims.md`'s
Deliverable-name-collisions section owns the check and the grep.

### Guessing the Type

When `--type=<value>` is supplied, skip this entirely and use it as `$TYPE` — no guessing. Otherwise, Type is guessed from the idea's title/body text — advisory only:

| Title/body contains | Guessed Type |
|---|---|
| `fix`, `broken`, `crash`, `error`, `bug`, `regression`, `wrong`, `fails` | `bug` |
| `add`, `support`, `enable`, `new`, `allow`, `feature` | `feature` |
| none of the above | `task` |

The guess rides in the existing "Added: '{title}' (Type: {t})" presentation (see Immediate Routing below) — no new question is added. In interactive mode, the user can still override via free text in the next message even after a guess; `--type=` is the deterministic override for auto/headless invocation, where there is no next message.

### Judging Definition

When `--needs-definition` or `--no-needs-definition` is supplied, skip this entirely and use it
as `$NEEDS_DEFINITION` — no judgment, and the presentation line below renders with no rationale
clause (the human already decided). Otherwise, judge from the idea's content in this same turn:
does it name a genuine open choice with no tradeoff made yet — two or more viable directions,
no stated preference — or does it read as a single clear ask? This is a content call, not a
structural heuristic: resist scoring it by length or keyword match, the same way `solution:unjustified`'s
judgment is a content call rather than a mechanical check. `$NEEDS_DEFINITION` is `true` only when
the idea genuinely names an undecided choice; default `false` (clear) otherwise. When `true`, form
a one-line rationale naming the open choice — this becomes `$DEFINITION_RATIONALE`, surfaced in
the presentation line below and, later, bootstrapped/labeled per Backend Selection above.

The judgment rides in the same "Added: '{title}' (Type: {t}, Definition: {needed|clear})"
presentation the Type guess uses (see Immediate Routing below) — no new question is added.
When `$NEEDS_DEFINITION` is `true` and came from the judgment (not an override), append the
rationale inline: `(Type: {t}, Definition: needed — {$DEFINITION_RATIONALE})`. An override renders
without the rationale clause: `(Type: {t}, Definition: needed)` / `(Type: {t}, Definition: clear)`.

## Immediate Routing

After adding the record, route the item per the `--route` arg or by asking — except when the headless bar pre-empts filing entirely: an agent-driven filing that qualifies to absorb never reaches Workflow Step 1's own filing at all, since the bar is judged before the record is created. Read `routing.md` in this skill's directory for the full procedure — the `--route` arg fast path, the routing prompt (headless structural bar, two-criteria high-similarity definition, absorb-visibility search, local-files driver mapping), route execution per backend, absorb mechanics (size re-judge, priority handling, the 55,000-char threshold, the `## Absorbed:` heading format), and the good/bad entry examples.

## Review Workflow

Periodically (or when the backlog gets long), use `/claude-tweaks:tidy` to batch-review all backlog records with recommended actions.

## Next Actions

When invoked by a parent skill, omit this block — the parent owns the handoff. When invoked directly by a user, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:capture {next idea}`** — capture another idea while you're in brainstorming flow (recommended)
`/claude-tweaks:tidy` — review and triage backlog records (promote, absorb, or drop stale items)
`/claude-tweaks:specify {ref}` — promote this record straight to a spec ({ref} is `#{n}` under `work-backend: github-issues`, or the record id under `work-backend: local-files`); omit this line when the born-ready chain already shaped the record earlier this turn — there is nothing left to promote

## Component-Skill Contract

This skill is a **component skill** — directly invoked by `/claude-tweaks:build` (Common Step 4, design-mode follow-up capture) and by `/claude-tweaks:reflect` (both `full` and `hindsight` modes' Capture disposition, routing an insight/finding that's too complex or uncertain to act on without brainstorming — a distinct path from reflect's Defer disposition, which files directly and is not a capture parent). `/claude-tweaks:visual-review`, `/claude-tweaks:wrap-up`, and `/claude-tweaks:demo` file a new backlog record directly without going through this skill, so they are NOT capture parents — they only recommend `/capture` in Next Actions for the user's next session.

Parent invocation of `/capture` is signaled by `$PIPELINE_RUN_DIR` being set in the environment. Direct invocation may pass `--source <parent-skill>` (e.g. `--source build`, `--source intake`) as an explicit fallback when ambiguity exists (rare; `$PIPELINE_RUN_DIR` is the primary signal) — prose-trusted. This fallback matters here specifically: a standalone (non-`/flow`) design-mode `/build` invocation never resolves a run dir of its own (per `_shared/run-dir-resolution.md`'s resolution order, the record-mode materialization exception and the standalone-auto allowlist both exclude design-mode `/build` — confirmed by `build/SKILL.md`'s own "Auto mode (including a standalone `auto` invocation with no pipeline run dir)" language). Standalone `/reflect` likewise has no run dir of its own to forward. When invoked from within a parent's workflow (via either signal), omit the `## Next Actions` block — the parent owns the handoff. When invoked directly by a user (neither signal present), render Next Actions as shown above.

**Side effect of `$PIPELINE_RUN_DIR`-based detection:** if a user invokes `/capture` directly while an active `/flow` pipeline is running, Next Actions are suppressed because the env var is set. This is intentional — pipeline-mid-flow handoff suggestions would conflict with the orchestrator's flow; same for `--source intake`.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Capturing an idea that already has a spec | Duplicates intent across two files — absorb into it so it stays the source of truth |
| A *human brain-dump* growing past the character budget to dodge the cap | Half-formed thinking that needs length needs `/superpowers:brainstorming`, not a longer stub. A supplied spec-shaped body is different — that is the Shaped-body branch's intended input, filed born-ready |
| Never reviewing the backlog | Without periodic `/claude-tweaks:tidy` triage the backlog becomes a graveyard and ideas lose context |
| Adding implementation details to a backlog record | A record captures *what* and *why* — *how* is brainstorming + spec territory and shifts faster than the idea |
| Skipping `/superpowers:brainstorming` and jumping straight to specs | Specs encode unchallenged premises without the assumptions and constraints brainstorming surfaces |
| Putting notes about existing specs into a new backlog record | Notes drift from the spec they describe — absorb into it so the note moves with the work |
