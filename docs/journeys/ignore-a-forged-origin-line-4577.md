---
files:
  - plugin/bin/lib/issues/provenance.js
  - plugin/bin/lib/issues/trust.js
  - plugin/bin/lib/issues/record-payload.js
  - plugin/bin/lib/issues/author-association.js
  - plugin/bin/lib/issues/record-snapshot.js
  - plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js
  - plugin/skills/_shared/record-queue-fetch.md
  - plugin/skills/backlog/trust-signal.md
---

# Ignore a Forged Origin Line

**Persona:** A maintainer of a public repository that uses the plugin's trust table. Anyone with a GitHub account can open an issue there, and a stranger has filed one whose body starts `Origin: demo changes-requested from #7`.
**Goal:** The trust table and every grant decision that reads it treat the stranger's `Origin:` line as absent. The forged line must not count as a corrective follow-up against #7's class, and must not add the issue to any side-effect class.
**Entry point:** Any step that builds trust rows from the session record snapshot: `/claude-tweaks:backlog refine` (the trust signal and the headless grant gate, `bin/backlog-grant-gate.js`), `_shared/trust-table.md`'s table, or `/claude-tweaks:capture`'s born-ready check.
**Success state:** #7's row shows no new follow-up, and the stranger's issue sits in `human:human` like any other outsider-filed record. Issues filed by the maintainer, collaborators and installed apps keep their side-effect classes exactly as before.

## Steps

### 1. Fetch the session snapshot — `_shared/record-queue-fetch.md`'s read-fresh-or-fetch block
- **URL:** any consumer's first `gh issue list --state all --json {UNION_FIELDS}` pull (or `fetchAllRecords` in `bin/lib/backlog-grant-gate/backlog-grant-gate.js`)
- **Action:** The snapshot is stale or missing, so the fetch runs. It now includes the `author` field. It then calls `author-association.js`'s enrichment, which looks up `authorAssociation` with aliased GraphQL batches of 200 for every non-bot record carrying its own `Origin:` line (step 4's rule, via `hasOriginLine`).
- **Should feel:** Invisible. The extra lookup adds a few seconds to a fresh pull, nothing is printed, and a fresh cached snapshot is reused without re-querying.
- **Should understand:** `gh issue list --json` has no author-association field, so the lookup is a separate step. Only records whose `Origin:` line could matter are queried, and bot authors are skipped since they are trusted anyway.
- **Red flags:** Every record queried, not just the `Origin:` ones. A cached snapshot re-enriched on every read. The snapshot fetch failing because the lookup failed.

### 2. Read the trust table with the stranger's issue in the record set — `trustRows`
- **URL:** `_shared/trust-table.md`'s table, or the trust signal in `/claude-tweaks:backlog refine`
- **Action:** The stranger's issue carries `authorAssociation: NONE` (or `CONTRIBUTOR`) and a forged `Origin: demo changes-requested from #7` line. Render the table.
- **Should feel:** Like the forgery never happened. #7's follow-up count and rate are unchanged, and no side-effect row gained a sample.
- **Should understand:** `provenance.js`'s `issueAuthorTrust` decides per record:
  - `OWNER`, `MEMBER`, `COLLABORATOR` or a bot read as `trusted`.
  - Any other association reads as `untrusted`, and its `Origin:` line is ignored.
  - No association data at all reads as `unknown` and keeps the pre-#4577 behaviour (fail open).
  
  The record still counts as human-filed work.
- **Red flags:** #7's row flipping from `clean` to `mixed` because of the stranger's issue. The stranger's issue forming a `side-effect:demo changes-requested` row. A maintainer's or github-actions' side-effect record suddenly in `human:human`.

### 3. Run while the lookup fails — a rate limit, an outage, or an unresolvable repo
- **URL:** the same fetch as step 1, when `gh api graphql` errors or `gh repo view` cannot resolve the repo
- **Action:** Run any trust-table consumer.
- **Should feel:** Degraded but honest. The run completes, and one stderr line says `author-association enrichment incomplete (…)`.
- **Should understand:** Records left without an association are `unknown`, so their `Origin:` lines count exactly as they did before this change: fail open, and loud.
  
  The association is the author's current one, as the fetching token sees it. A former collaborator's old records, or a private org member seen through a token without org visibility, can read `CONTRIBUTOR` and fall into `human:human`. That is the accepted fail-closed direction.
- **Red flags:** A silent degrade with no stderr line. A trust table built from a half-written snapshot. The whole fetch aborting.

### 4. Read the trust table after a human-filed record absorbs a capture — `ownOriginLine`
- **URL:** the same trust-table consumers as step 2, after `/claude-tweaks:capture`'s absorb route appended `## Absorbed: {date} — {title}` holding `Origin: demo changes-requested from #7` to a record the maintainer filed by hand (no `Origin:` line of its own)
- **Action:** Render the table.
- **Should feel:** Unremarkable. The absorbing record stays in `human:human`, and #7's follow-up count is unchanged. A record whose `Origin:` line is only quoted inside a fenced code block reads the same way.
- **Should understand:** A record's provenance comes from its own `Origin:` line only. `record-payload.js`'s `ownOriginLine` is the one reader, shared by `provenance.js` and `trust.js`, so the class and the follow-up always come from the same line. A line inside a fenced block never counts. A line under a `## Absorbed:` heading never counts, up to the next `## ` heading. A line under `## Original request` still counts, because it is the record's own earlier text. A bare own `Origin:` line still reads as `unstructured:empty-origin` and hides any later line.
- **Red flags:** The absorbing record moving into the capture's side-effect class. #7 gaining a follow-up from absorbed or fenced text. A record whose only `Origin:` line sits under `## Original request` dropping into `human:human`.

## Origin
- Created during build of #4577 (provenance and trust ignore an `Origin:` line from an author outside the repository)
- Updated during build of #4502 (step 4: provenance and follow-ups read only the record's own `Origin:` line, never fenced or absorbed text)
- Related specs: #4577, #4502, #3358 (the same trust rule for marker comments)
