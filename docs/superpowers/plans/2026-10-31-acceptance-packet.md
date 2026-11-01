# Acceptance Packet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace wrap-up's Verification Brief template with an acceptance packet — one marker-block comment per work record, edited in place, built by a deterministic gather / validated narration / deterministic render pipeline (record #4611).

**Architecture:** Five pure sibling modules under `plugin/bin/lib/wrap-up/` (`packet-contract.js` constants, `packet-links.js` link rules, `packet-validate.js` claim validation, `packet-render.js` renderer, `packet-gather.js` gather + `readPacket`) plus `packet-post.js` (gh-backed publish through an injectable runner) and one CLI `plugin/bin/acceptance-packet.js`. Wrap-up prose (`verification-brief.md` Step 4) runs gather → narrate (LLM, writes a narrative JSON) → render (validates) → post, in that order. `_shared/acceptance-packet.md` is the contract every later record cites. `engine-verify.js`'s acceptance-labeling check learns to accept the packet comment; legacy brief readers stay.

**Tech Stack:** Node 18+ CommonJS, built-ins only, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T202631-record-4611/work/4611-spec.md` (re-materialized with the maintainer's `## Plan Review Decisions` Q1–Q10; the earlier copies predate Q9–Q10)

**Scope keywords:** Verification Brief, acceptance-packet, run-comment: brief

## Global Constraints

- Marker: the canonical comment's first line is exactly `<!-- acceptance-packet: v1 -->`; `schemaVersion: 1` is one constant used by facts, narrative and marker.
- `local-files` delimiters: `<!-- acceptance-packet:start -->` / `<!-- acceptance-packet:end -->`, replaced in place.
- Fact: `{ id, kind, status, reason?, source }` (+ optional render fields `text`, `url`, `command`, `negative`, `live`); `kind` ∈ `change, check, story, finding, link, recording, flag, decision, deploy`; `status` ∈ `passed, failed, skipped, not-run`.
- Claim: `{ section, text, refs[] }`; `section` ∈ `what-changed, test-guide, tried-to-break, least-confident, risk-proofs`.
- Section→kind table: what-changed → `change`; test-guide → `story`, `link`; tried-to-break → `story`, `check`; least-confident → `finding`; risk-proofs → `flag` plus the proof fact (`check`, `story`, `recording`, `link`), at least one `flag`.
- Section order (rendered headings): What changed, Recording, Test guide, Couldn't test, Tried to break, Least confident, Risk proofs, Decisions left for you, Deploy status.
- Dropped-claims line, always rendered: `N claims were dropped for missing evidence` (`1 claim was dropped for missing evidence` singular).
- Size cap 60,000 characters; truncation omits whole items and states `truncated: N items omitted`.
- Credential keys (one shared constant, case-insensitive after percent-decoding, matched in query, fragment and userinfo): `token`, `access_token`, `password`, `passwd`, `secret`, `session`, `sessionid`, `jwt`, `auth`, `key`, `api_key`, `sig`, `signature`, `x-amz-signature`.
- Links: http(s) only, host must be the local base URL host or the `dev-base-url` host; when the deploy target is `dev` and the feature is not confirmed live, each Test-guide link carries `(link unverified: deploy not confirmed live)` — links on a `local` target carry no suffix (Plan Review Decision Q7, Reading B); the deploy section still states the target.
- Expected verify checks (Plan Review Decision Q6, Reading A): gather derives them from the project's verify-scope declaration — the names `verify.js` runs from `decl.checks` (`readDeclaration` in `plugin/bin/lib/verify/declaration.js`): every `decl.suites` name plus `types`/`lint` when `decl.checks.types`/`decl.checks.lint` is non-null. No field is added to `verify-expectations.json`; wrap-up passes no check list.
- Edge-case checks (Plan Review Decision Q8, Reading A): no check counts as an edge case until a signal for it exists — Tried to break holds negative stories (`negative: true`) and failures only; a passing check renders under `Checks that passed:`. Defining an edge-case signal is out of scope.
- The verify `report.json` `checks` field is an object keyed by check name (`composeReport` in `plugin/bin/lib/verify/report.js` builds `byName`), each entry `{ command, exitCode, summary, … }` or `{ command, skipped }` — not an array (a plan-review finding claimed an array; the source says otherwise).
- Story files (`/stories`, schema v2) hold many stories under `stories:` as `- id: …` items with `tags: [...]`; a negative story has an id prefixed `neg-` and/or the tag `negative` (`plugin/skills/stories/negative-stories.md`). QA results come from the QA run's `report.json` (`plugin/bin/lib/qa-report/compose.js`): `stories[]` of `{ id, status, error }`, `status` ∈ `PASS`, `PASS_WITH_CAVEATS`, `FAIL`, `SKIPPED`.
- Credential screening of text (Plan Review Decision Q2, Reading B): the same `CREDENTIAL_KEYS` constant screens a link fact's `command` string and every Test-guide claim's `text`. Shapes, matched case-insensitively after percent-decoding: `{key}=` / `{key}:` (optional whitespace before the `=`/`:`; the key preceded by start of text or a character outside `[a-z0-9_]`), the flag `--{key}` (followed by end, whitespace or `=`), and the header `authorization:`. A match drops that entry (a command link goes to `refused` with reason `credential key in command: {key}`; a claim goes to `screened`) and the packet states the omission by id/section and key only — the matched text is never rendered. The packet as a whole still posts.
- Parent gate (Plan Review Decision Q1, Reading A): the parent gate keeps posting the legacy `## Verification Brief`; its template moves verbatim into `plugin/skills/wrap-up/verification-brief-parent-gate.md`. `verification-brief.md` Step 4 ends holding exactly one template, the packet.
- Row placement (Plan Review Decision Q3, Reading A): every `check`/`story` fact renders exactly one row, placed by the first matching rule — status `skipped`/`not-run` → Couldn't test; status `failed` → Tried to break; status `passed` with `negative: true` → Tried to break; any other `passed` → the Test guide's `Checks that passed:` list. A routine pass never renders under Tried to break, and a narrated tried-to-break claim must cite at least one `negative` or `failed` fact.
- MCP re-run (Plan Review Decision Q4, Reading A): the gh-absent transport cannot edit a comment, so a re-run that finds an existing packet counts as a failed edit under the Failure contract — it reports the failure, posts nothing, and applies no pending acceptance label (`/accept` never reads a stale packet under a pending label). With no existing packet, the MCP path posts via `add_issue_comment` and only then applies the label.
- Below the floor (Plan Review Decision Q5, Reading B): every record with no resolvable parent gets a packet, below the oversight floor included. Below the floor the packet posts without `--label` (no `demo:pending` bootstrap or label; the #2383 `oversightExempt` record stays), and the below-floor **Posting it alone** path (the Try it block posted by itself) is retired — **Posting it alone** remains only for parent-linked sub-issues.
- Verification-claim routing (Plan Review Decision Q9, Reading B): only a claim that asserts verification routes by the status of the `check`/`story` facts it cites — its text matches `VERIFICATION_CLAIM_RE` (`/\b(tested|verified|works)\b/i`, built from the one `VERIFICATION_WORDS` constant `['tested', 'verified', 'works']`). A failed cited fact moves it to Tried to break; a skipped/not-run one moves it to Couldn't test. Any other claim (a plain manual step) stays `kept` in its own section whatever its cited facts' status, so a packet built without QA keeps its testing steps.
- Risk proofs always renders (Plan Review Decision Q10, Reading A): with no kept risk flags its one line is `not applicable: no kept risk flags` — the heading is never omitted.
- `Surface: infra`/`backend`: Test guide lists commands, renders no links.
- Empty section → one line stating why (`not applicable: …`), never an empty heading; "Decisions left for you" is omitted when empty.
- Every `execFileSync`/`spawnSync` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`).
- Commit style: `{Verb} {what} — {detail} — refs #4611`, never `closes`/`fixes`, ending with the trailer line `Claude-Session: https://claude.ai/code/session_016yg3zpL6rWzH5sXqj58ub9`.
- Run single test files with `node --test {file}`; the full suite runs centrally at Common Step 5, not inside tasks.

## Premise decisions (logged departures from the spec)

- **Working copy location.** The spec puts the facts/rendered working copy in the run directory. This plan writes them to session-temp paths (`bin/session-tmp-resolve.js`, `_shared/session-tmp-root.md`) passed explicitly to the CLI: the run dir is anchored under the main checkout and refuses Write-tool writes from a worktree session (the narrative is LLM-written), and the copy is never read after the run either way. The contract states it.
- **`engine-render.js`.** The spec lists it as "render integration"; it renders the curation engine's Phase 2 trace and console sections and has no brief code. The packet gets its own renderer (`packet-render.js`); `engine-render.js` is not modified.
- **Base URLs.** No `dev-base-url` / local-base-url policy key exists yet (a control-mode record adds policy keys); the CLI takes `--local-base-url` / `--dev-base-url` flags and the prose resolves the local one via `_shared/dev-url-detection.md`.

## AC coverage map

| Clause | Task | Test |
|---|---|---|
| AC1.1 | 3 | `AC1 skipped check under Couldn't test, failure under Tried to break, row count matches` |
| AC1.2 | 3 | same test — check/story row count equals fact count |
| AC2.1 | 2, 3 | `validatePacket drops a claim citing an absent fact`; `AC2 dropped line` |
| AC2.2 | 2 | `drops a claim with no refs` |
| AC2.3 | 2, 3 | `a verified claim citing a failed fact moves to tried-to-break`; render places moved claims under Tried to break |
| AC2.4 | 2 | `a claim citing a skipped fact moves to couldnt-test` |
| AC2.5 | 2, 3 | each clause above has its own named test |
| AC2.6 | 3, 4 | `AC2a expected AC with no result renders not-run`; `AC2a not-run renders as not run` |
| AC2.7 | 4 | `AC2b readPacket`; `AC2b stale run-dir copy is ignored` |
| AC2.8 | 5, 6 | `AC2c post failure applies no label`; CLI `post` exit 1 records no `issue edit` |
| AC2.9 | 3 | `AC2d truncation` |
| AC3.1 | 5 | `AC3 second run edits the same comment` |
| AC4.1 | 3 | `AC4 narrative is inert` |
| AC5.1 | 1, 8 | `host not allowed` cases; contract conformance test pins `vault entry name` and the link rules |
| AC5.2 | 1, 8 | `TOKEN=`, `tok%65n=`, `#sig=`, `user:pass@`, `sessionid=` cases; contract credential-list pin |
| AC5.3 | 1 | `/docs/token-guide` accepted |
| AC5.4 | 3, 4 | `AC5 infra lists commands, no links`; gather refuses url links under infra |
| AC5.5 | 3 | `AC5 one-line reason for empty sections` |
| AC6.1 | 7, 9 | engine-verify packet tests; wrap-up conformance test (post applies `demo:pending`, Routing untouched) |
| AC6.2 | 8b, 9 | Task 8b Step 3 and Task 9 Step 4 run every wrap-up/brief-pinning suite |
| Decision Q1 | 8b, 9 | `parent gate holds the legacy brief template`; `verification-brief.md holds exactly one template` |
| Decision Q2 | 1, 2, 3, 4 | `findCredentialInText` cases; `a test-guide claim with credential-shaped text is screened`; `screened entries render as an omission line, never their text`; `a command link carrying a credential flag is refused` |
| Decision Q3 | 2, 3, 8 | `a tried-to-break claim citing only routine passes is dropped`; `Q3 routine passes render under Checks that passed, never Tried to break`; contract `## Sections` states the placement rule |
| Decision Q4 | 8, 9 | contract conformance `MCP re-run with an existing packet applies no label`; wrap-up conformance `exit-2 MCP path: existing packet → report, post nothing, no label` |
| Decision Q5 | 6, 9 | wrap-up conformance `below the floor posts the packet without --label`; `Posting it alone is for parent-linked sub-issues only`; CLI `local` without `--pending` leaves `acceptance` unset |
| Decision Q6 | 4, 6, 8 | `expected checks: null declaration is a stated partial`; CLI `gather derives expected checks from the verify-scope declaration`; contract `## The expected check set` names the declaration |
| Decision Q7 | 3, 8 | `unverified link suffix` (dev + not live → suffix; dev + live and local → none); contract states the dev-only rule |
| Decision Q8 | 3, 8 | `Q3 routine passes render under Checks that passed, never Tried to break` (Tried to break empty-reason wording); contract states no edge-case signal exists |
| Decision Q9 | 1, 2, 3, 8 | `VERIFICATION_WORDS` pin; `a plain manual step citing a not-run story stays in the test guide`; `Q9 plain step stays under Test guide`; contract `## Validation policy` names the verification words |
| Decision Q10 | 3, 8 | `AC5 one-line reason for empty sections` (Risk proofs heading present with `not applicable: no kept risk flags`); contract `## Sections` states Risk proofs always renders |
| AC7.1 | 11 | full suite at Common Step 5 |

Waived plugin/bin/lib/issues/comment-trust.js: read-only dependency (Task 4 `readPacket` consumes `isTrustedComment`/`untrustedSkipNote`).
Waived plugin/bin/lib/wrap-up/engine-render.js: not the packet's render point (premise decision above); unchanged.
Waived plugin/bin/lib/activity/render.js: reference pattern only (spec: read, do not edit).
Waived tests/try-it-contract-conformance.test.js: edited by Task 9 only where Step 1's probe finds a pin on changed text; run in Task 9 Step 4 either way.

## Review Focus

1. A credential smuggled by case, percent-encoding (`tok%65n=`), a fragment (`#sig=`) or userinfo (`user:pass@`) is refused; a benign path `/docs/token-guide` is not — Task 1 tests.
2. Narrative text containing newlines, `## Couldn't test` or `[x](https://evil.example)` renders inert — Task 3 tests.
3. A work record already carrying an untrusted-author marker comment and/or two trusted packet comments — the earliest trusted one is edited, extras reported, no second packet created — Task 5 tests.
4. A gather with no verify report / no spec renders a stated `partial` note and every expected check as `not run`, never silence — Task 4 tests.
5. A verification claim (`tested`/`verified`/`works`) citing a mix of passed and failed facts lands under Tried to break, not Test guide; a plain manual step citing the same facts stays in the Test guide (Decision Q9) — Task 2 tests.
6. A credential in a command (`--token abc`, `Authorization: Bearer x`) or in Test-guide claim text (`password=hunter2`) never reaches the rendered markdown, the omission is stated, and the packet still renders; `node plugin/bin/acceptance-packet.js --help`, `monkey=1` and `/docs/token-guide` are not screened — Tasks 1–4 tests.
7. The parent gate's legacy brief template is byte-identical to the one Step 4 held before this record (moved, not rewritten) — Task 8b.
8. A passed non-negative story or check never appears under Tried to break; a negative story that passed does; a skipped negative story goes to Couldn't test; the row count still equals the check/story fact count — Task 3 tests (Decision Q3).

---

### Task 1: Packet contract constants and link rules

**Files:**
- Create: `plugin/bin/lib/wrap-up/packet-contract.js`
- Create: `plugin/bin/lib/wrap-up/packet-links.js`
- Test: `tests/bin-lib/wrap-up/packet-links.test.js`

**Interfaces:**
- Produces (`packet-contract.js`, frozen exports): `SCHEMA_VERSION = 1`; `PACKET_MARKER = '<!-- acceptance-packet: v1 -->'`; `PACKET_MARKER_RE = /^<!-- acceptance-packet: v(\d+) -->/`; `LOCAL_START = '<!-- acceptance-packet:start -->'`; `LOCAL_END = '<!-- acceptance-packet:end -->'`; `FACT_KINDS` (array, order above); `FACT_STATUSES`; `CLAIM_SECTIONS`; `SECTION_KINDS` (object section → allowed kinds array); `SECTIONS` (array of `{ key, heading }` in render order, keys `what-changed, recording, test-guide, couldnt-test, tried-to-break, least-confident, risk-proofs, decisions, deploy`, headings exactly the Global Constraints list); `MAX_PACKET_CHARS = 60000`; `CREDENTIAL_KEYS` (array, exact list above); `FACT_ID_RE = /^[a-z][a-z-]*:[A-Za-z0-9._\/#:@-]+$/`; `VERIFICATION_WORDS = ['tested', 'verified', 'works']` and `VERIFICATION_CLAIM_RE` built from it (`new RegExp('\\b(' + VERIFICATION_WORDS.join('|') + ')\\b', 'i')`, Decision Q9).
- Produces (`packet-links.js`): `normalizeKey(raw: string) → string` (repeat `decodeURIComponent` up to 3 times until stable, catching URIError, then `toLowerCase()`); `checkLink(url: string, { allowedHosts: string[] }) → { ok: true } | { ok: false, reason: string }`. Reasons (exact prefixes): `unparseable url`, `scheme not http(s)`, `host not allowed: {hostname}`, `credential in userinfo`, `credential key in query: {key}`, `credential key in fragment: {key}`. Host comparison is by lowercased `URL.hostname`; `allowedHosts` entries are full base URLs or bare hosts (both accepted — take `new URL(x).hostname` when it parses, else the lowercased string). Fragment keys: split the fragment on `&`, take each part's text before `=`.
- Produces (`packet-links.js`, Decision Q2): `findCredentialInText(text: string) → string | null` — `normalizeKey(text)` first (percent-decoded, lowercased), then the first match among: the header shape `authorization\s*:` (returns `authorization`); for each key in `CREDENTIAL_KEYS` sorted longest-first, `(^|[^a-z0-9_])--{key}(?=$|[\s=])` (flag) and `(^|[^a-z0-9_]){key}\s*[=:]` (assignment/header), keys regex-escaped. Returns the matched key, else `null`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/wrap-up/packet-links.test.js`, allowed hosts `['http://localhost:3000', 'https://dev.example.com']`:
  - `checkLink('http://localhost:3000/settings?role=admin', …).ok === true`
  - `https://dev.example.com/docs/token-guide` → ok (path is never checked)
  - `https://evil.example/x` → reason `host not allowed: evil.example`
  - `javascript:alert(1)` and `ftp://localhost:3000/` → `scheme not http(s)`
  - `http://localhost:3000/?TOKEN=abc` → `credential key in query: token`
  - `http://localhost:3000/?tok%65n=abc` → `credential key in query: token`
  - `http://localhost:3000/p#sig=abc` → `credential key in fragment: sig`
  - `http://user:pass@localhost:3000/` → `credential in userinfo`
  - `http://localhost:3000/?sessionid=1` → `credential key in query: sessionid`
  - `http://localhost:3000/?X-Amz-Signature=1` → `credential key in query: x-amz-signature`
  - `not a url` → `unparseable url`
  - `CREDENTIAL_KEYS` deep-equals the 14-key list above; `PACKET_MARKER` equals the marker string; `SECTIONS.map(s => s.heading)` equals the nine headings in order; `VERIFICATION_WORDS` deep-equals `['tested', 'verified', 'works']`, `VERIFICATION_CLAIM_RE` matches `Login Verified` and `it works` and does not match `Open the login page` or `networks` (Decision Q9).
  - `findCredentialInText` (Decision Q2): `curl -H "Authorization: Bearer x" http://localhost:3000/` → `authorization`; `cli --key abc` → `key`; `cli --token=abc` → `token`; `export API_KEY=abc` → `api_key`; `TOKEN=abc npm start` → `token`; `tok%65n=abc` → `token`; `Open settings with password: hunter2` → `password`; `x-amz-signature=1` → `x-amz-signature`; `node plugin/bin/acceptance-packet.js --help` → `null`; `see /docs/token-guide` → `null`; `monkey=1` → `null`; `Open the session list` → `null`.

- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/packet-links.test.js` — Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement both modules** per the Interfaces block. Use the WHATWG `URL` global; query keys from `url.searchParams.keys()` (already decoded once) passed through `normalizeKey`.

- [ ] **Step 4: Run** `node --test tests/bin-lib/wrap-up/packet-links.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `Add acceptance-packet contract constants and link rules — refs #4611`.

### Task 2: Claim validation (`validatePacket`)

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/wrap-up/packet-validate.js`
- Test: `tests/bin-lib/wrap-up/packet-validate.test.js`

**Interfaces:**
- Consumes: Task 1 constants.
- Produces: `class SchemaError extends Error { errors: {path, message}[] }`; `validateFactsShape(facts) → { ok, errors }` (requires `schemaVersion === SCHEMA_VERSION`, `facts` array of facts whose `id` matches `FACT_ID_RE` and is unique, `kind` ∈ `FACT_KINDS`, `status` ∈ `FACT_STATUSES`, `source` string; `partial` array of strings; `record` integer); `validateNarrativeShape(narrative) → { ok, errors }` (requires `schemaVersion === SCHEMA_VERSION`, `claims` array of `{ section: string, text: string, refs: string[] }`); `validatePacket(facts, narrative) → { kept: Claim[], moved: { claim, to: 'couldnt-test'|'tried-to-break', because: Fact }[], dropped: { claim, reason }[], screened: { claim, key }[] }` — throws `SchemaError` when either shape check fails (schema-version mismatch included).
- Rules, applied per claim in order: section not in `CLAIM_SECTIONS` → dropped `unknown section {s}`; section `test-guide` and `findCredentialInText(text)` returns a key → `screened` with that key (Decision Q2; not counted as dropped, never kept or moved); `refs` empty → dropped `no refs`; any ref not a fact id → dropped `absent fact {id}`; any ref whose kind is not in `SECTION_KINDS[section]` → dropped `incompatible fact {id} ({kind}) for {section}`; risk-proofs with no `flag` ref → dropped `risk proof cites no flag`; tried-to-break with no cited fact that is `failed` or carries `negative: true` → dropped `tried-to-break claim cites no negative or failed fact` (Decision Q3). Then status routing (only `check`/`story` facts route, and only for a claim whose `text` matches `VERIFICATION_CLAIM_RE` — Decision Q9; any other claim is `kept` whatever its cited facts' status): any cited fact `failed` → `moved` to `tried-to-break` (a claim already in `tried-to-break` stays `kept`); else any cited fact `skipped`/`not-run` → `moved` to `couldnt-test`; otherwise `kept`. `because` is the first fact that triggered the move.

- [ ] **Step 1: Write the failing tests** (facts fixture: `change:src/a.js` passed, `check:unit-tests` passed, `check:lint` failed reason `2 errors`, `story:login` passed, `story:login#negative-2` skipped reason `no dev server`, `link:settings` passed with url, `finding:1` passed, `flag:auth` passed):
  - `validatePacket drops a claim citing an absent fact` — test-guide claim refs `['link:nope']` → one `dropped`, reason `absent fact link:nope`.
  - `drops a claim with no refs` — reason `no refs`.
  - `drops an incompatible kind` — test-guide citing `check:unit-tests` → reason `incompatible fact check:unit-tests (check) for test-guide`.
  - `a verified claim citing a failed fact moves to tried-to-break` — with `story:login` set to failed, a test-guide claim `Login verified` citing `['story:login', 'link:settings']` → `moved` to `tried-to-break`, `because.id === 'story:login'`; a tried-to-break claim citing `check:lint` (failed) stays `kept`.
  - `mixed passed and failed refs moves to tried-to-break` (Review Focus 5) — claim text `Settings flow verified`.
  - `a claim citing a skipped fact moves to couldnt-test` — test-guide claim `Negative login tested` citing `['story:login#negative-2']` → `moved.to === 'couldnt-test'`.
  - `a plain manual step citing a not-run story stays in the test guide` (Decision Q9) — add `story:signup` not-run (`no story result recorded`); test-guide claim `Open the signup page and submit the form` citing `['story:signup', 'link:settings']` → `kept`, absent from `moved`; the same refs with text `Signup works` → `moved` to `couldnt-test`; a plain step citing failed `story:login` → `kept`.
  - `risk-proofs needs a flag` — refs `['check:unit-tests']` → dropped `risk proof cites no flag`; refs `['flag:auth', 'check:unit-tests']` → kept.
  - `schema mismatch is refused` — `schemaVersion: 2` on facts, then on narrative → `assert.throws(…, SchemaError)`.
  - `a test-guide claim with credential-shaped text is screened` — test-guide claim `Log in with password=hunter2` citing `['link:settings']` → in `screened` with key `password`, absent from `kept`/`moved`/`dropped`; the same text in a what-changed claim citing `change:src/a.js` is `kept` (screening is Test-guide only).
  - `a tried-to-break claim citing only routine passes is dropped` (Decision Q3) — tried-to-break claim citing `['check:unit-tests', 'story:login']` (both passed, not negative) → dropped `tried-to-break claim cites no negative or failed fact`; with `story:login` given `negative: true` and status passed → kept.

- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/packet-validate.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `Add acceptance-packet claim validation — refs #4611`.

### Task 3: Renderer (`renderPacket`)

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/wrap-up/packet-render.js`
- Test: `tests/bin-lib/wrap-up/packet-render.test.js`

**Interfaces:**
- Consumes: Tasks 1–2 (`validatePacket`, `checkLink`, constants).
- Produces: `inline(s: string) → string` (collapse `\s*[\r\n]+\s*` to one space, trim, backslash-escape `[`, `]`, and a leading `#`); `renderPacket(facts, narrative, { observationPlan?: string, poster?: string } = {}) → { markdown: string, dropped: {claim, reason}[], truncated: number, chars: number }`. Throws `SchemaError` (from validation).
- Layout: line 1 `PACKET_MARKER`; blank; `## Acceptance packet — #{record}`; blank; when `facts.partial.length` a `> partial gather: {inline(note); …}` line; the dropped line; then each `SECTIONS` entry as `### {heading}` + its items. Citations render as code ids after the text: `- {inline(text)} (` + "`id`" + `, …)`. Never render narrative-supplied URLs; links render only from cited `link` facts.
  - **What changed / Least confident / Risk proofs:** kept claims of that section; empty → `not applicable: no {what-changed: change facts were gathered | least-confident: low-confidence review findings | risk-proofs: kept risk flags}` (Risk proofs reads `no kept risk flags`).
  - **Recording:** each `recording` fact as `- {inline(text)}: {url}`; none → `not recorded`.
  - **Test guide:** kept test-guide claims numbered `1.` …; after each claim's text, every cited `link` fact renders as its `url` (re-checked with `checkLink` against `facts.allowedHosts`; a failing recheck renders `(link refused: {reason})` instead) or, when the fact has `command`, as `` `command` ``. When `facts.surface` is `infra` or `backend`, a `url` link never renders (commands only). When the `deploy` fact's `target === 'dev'` and its `live !== true` (Decision Q7), each rendered url is followed by ` (link unverified: deploy not confirmed live)`; a `local` target (the default) adds no suffix. When `facts.refused` is non-empty, add `- {n} link(s) refused: {id} ({reason}); …`. No kept claims → `not applicable: no tested stories or links were gathered`. Then (Decision Q3), when any `check`/`story` fact is `passed` without `negative: true`, a `Checks that passed:` line followed by one row per such fact: `` - `id` — passed ``.
  - **Couldn't test:** one row per `check`/`story` fact with status `skipped` or `not-run`: `` - `id` — skipped: {reason} `` / `` - `id` — not run: {reason} ``; then moved-to-couldnt-test claims as `- {text} (moved: cites `id` — {status}: {reason})`. Empty → `not applicable: every expected check ran`.
  - **Tried to break:** kept tried-to-break claims and moved-to-tried-to-break claims (`(moved: cites `id` — failed: {reason})`), then one row per `check`/`story` fact with status `failed`, or status `passed` with `negative: true` (Decision Q3 — a routine pass renders under Test guide instead): `` - `id` — failed: {reason} `` / `` - `id` — passed ``. Empty → `not applicable: no negative stories or failures ran` (Decision Q8: no edge-case signal exists, so the wording names none).
  - **Decisions left for you:** `decision` facts as `- {text}`; the whole section (heading included) is omitted when there are none.
  - **Deploy status:** the `deploy` fact's text; none → `target: local`.
  - **Observation plan appendix:** when `observationPlan` is a non-empty string, append `### Observation plan` and its lines, each line with a leading `#` escaped (`\#`) — the agent procedure `/claude-tweaks:demo` walks; not a narrated claim.
  - **Poster line:** when `poster` is set, the final lines are `---` and `_Posted by {inline(poster)}. Resolve with \`/claude-tweaks:demo\`._` (counted in the size cap, never truncated).
- Dropped line wording: `{n} claim(s) were dropped for missing evidence` with exact singular `1 claim was dropped for missing evidence` and plural `N claims were dropped for missing evidence` (0 included).
- Note-line order, fixed: the dropped line, then the screened line (when any), then the `truncated:` line (when any) — each directly after the one before it.
- Screened line (Decision Q2): when `screened` is non-empty, directly after the dropped line, `{n} Test guide entr{y|ies} omitted for credential-shaped content: {key}; {key}` (`1 Test guide entry omitted …` singular) — keys only, never the claim text. A `refused` command link renders through the Test guide's existing refused line (`{id} ({reason})`), never its command. The return gains `screened: {claim, key}[]` (the CLI's `--dropped-out` JSON carries it, so the working copy lists them).
- Truncation: when the joined markdown exceeds `MAX_PACKET_CHARS`, drop whole list items (lines starting `- ` or `{n}. `) from the end of the longest section first, re-measuring, until it fits; then insert `truncated: N items omitted` after the dropped line and the screened line (when present), per the note-line order above. Headings, marker and notes are never dropped.
- Every check/story fact renders exactly one row across Couldn't test + Tried to break + the Test guide's `Checks that passed:` list, placed by the Global Constraints row-placement rule.

- [ ] **Step 1: Write the failing tests:**
  - `AC1 skipped check under Couldn't test, failure under Tried to break, row count matches` — facts with `check:unit-tests` failed (`3 failing`) and `check:lint` skipped (`fail-fast`) and `story:login` passed; assert the Couldn't test section contains `` `check:lint` — skipped: fail-fast ``, Tried to break contains `` `check:unit-tests` — failed: 3 failing ``, Test guide contains `` `story:login` — passed `` after `Checks that passed:`, and the count of check/story rows across the three places equals the number of check/story facts (3).
  - `Q3 routine passes render under Checks that passed, never Tried to break` — facts `check:tests` passed, `story:login` passed, `story:login#negative-1` passed `negative: true`, `story:login#negative-2` skipped `negative: true` (`no dev server`), `check:lint` failed (`2 errors`) → Tried to break holds exactly `story:login#negative-1` and `check:lint` rows; Test guide's `Checks that passed:` list holds exactly `check:tests` and `story:login`; Couldn't test holds `story:login#negative-2`; total rows 5. With only routine passes, Tried to break reads `not applicable: no negative stories or failures ran` (Decision Q8).
  - `AC2 dropped line` — one claim citing an absent fact → markdown contains `1 claim was dropped for missing evidence`; zero dropped → `0 claims were dropped for missing evidence`.
  - `AC2a not-run renders as not run` — a `not-run` check → `` `check:types` — not run: no result recorded ``.
  - `AC2d truncation` — 3,000 kept what-changed claims of 40 chars citing one change fact → `chars <= 60000`, `truncated > 0`, markdown contains `truncated: {truncated} items omitted`, and every `### ` heading is still present.
  - `AC4 narrative is inert` — a what-changed claim text `ok\n## Couldn't test\n[x](https://evil.example)` → the markdown has exactly one line starting `### Couldn't test` and contains `\[x\](https://evil.example)` and no line starting `## Couldn't test`.
  - `AC5 infra lists commands, no links` — `surface: 'infra'`, link facts one with `command: 'node plugin/bin/acceptance-packet.js --help'` and one with `url: 'http://localhost:3000/x'` both cited → markdown contains the command in backticks and does not contain `http://localhost:3000/x`.
  - `AC5 one-line reason for empty sections` — facts with only a deploy fact → What changed reads `not applicable: no change facts were gathered`; the `### Risk proofs` heading is present followed by `not applicable: no kept risk flags` (Decision Q10); no heading is followed directly by another heading.
  - `Q9 plain step stays under Test guide` — a test-guide claim `Open the signup page` citing a not-run `story:signup` and a link → rendered as item `1.` under Test guide, with `` `story:signup` — not run: … `` under Couldn't test; a claim `Signup verified` with the same refs renders under Couldn't test as a moved claim instead.
  - `unverified link suffix` (Decision Q7) — deploy fact `{ target: 'dev', live: false }` → url followed by `(link unverified: deploy not confirmed live)`; `{ target: 'dev', live: true }` → no suffix; `{ target: 'local', live: null }` → no suffix, and the Deploy status section still reads `target: local`.
  - `note lines in fixed order` — a render with one dropped claim, one screened claim and forced truncation → the dropped, screened and `truncated:` lines appear consecutively in that order.
  - `first line is the marker` and `Decisions left for you omitted when empty`.
  - `screened entries render as an omission line, never their text` — a test-guide claim `Log in with password=hunter2` and a `refused` entry `{ id: 'link:deploy', reason: 'credential key in command: token' }` → markdown contains `1 Test guide entry omitted for credential-shaped content: password` and `link:deploy (credential key in command: token)`, does not contain `hunter2`, and still contains every `### ` heading (the packet renders).
- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/packet-render.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `Add acceptance-packet renderer — refs #4611`.

### Task 4: Deterministic gather and the packet reader

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/wrap-up/packet-gather.js`
- Test: `tests/bin-lib/wrap-up/packet-gather.test.js`

**Interfaces:**
- Consumes: Task 1 (`checkLink`, constants), `plugin/bin/lib/issues/comment-trust.js` (`isTrustedComment`, `untrustedSkipNote`).
- Produces:
  - `parseAcceptanceCriteria(specText: string) → { id: string, text: string }[]` — items under the `## Acceptance Criteria` heading up to the next `## ` heading, lines matching `/^\s*(\d+[a-z]?)\.\s+(.*)$/`.
  - `parseLowConfidenceFindings(decisionsText: string) → { n: number, text: string }[]` — every line containing `low-confidence`, numbered from 1, `text` = the part after the first ` — `.
  - `expectedChecksFromDeclaration(decl: object|null) → string[]|null` (Decision Q6) — `null` decl → `null`; else `[...decl.suites, ...['types', 'lint'].filter((k) => decl.checks[k] !== null)]` (the `decl` shape `readDeclaration` returns).
  - `parseStoryFile(text: string) → { id: string, negative: boolean }[]` — a line scan of one `/stories` schema-v2 YAML file (no YAML dependency): each `- id: {id}` item (quotes stripped) starts a story; within that item, a `tags:` line in inline form (`tags: [negative, form]`) or block form (following `- negative` lines indented deeper than `tags:`) is read; `negative` is true when the id starts `neg-` or the tags contain `negative`. Lines outside an item (`schema_version:`, `stories:`) and nested `steps:` content never start a story — only `- id:` lines at the indent of the first story item do.
  - `storyResultsFromQaReport(report: object|null) → { id, status, reason? }[] | null` — `null`/non-object or no `stories` array → `null`; each `stories[]` entry maps `PASS`/`PASS_WITH_CAVEATS` → `passed`, `FAIL` → `failed` (reason `error` or `story failed`), `SKIPPED` → `skipped` (reason `error` or `skipped`); an unknown status → `not-run` with reason `unrecognized QA status {status}`.
  - `gatherPacketFacts(inputs) → facts` (pure). `inputs = { record: number, surface: string|null, specText: string|null, report: object|null, expectedChecks: string[]|null, plannedStories: {id, negative}[], storyResults: {id, status, reason?}[] | null, acResults: {[id]: 'met'|'partially met'|'not met'} | null, decisionsText: string|null, changes: {status, path}[] | null, commits: {sha, subject}[] | null, links: {id, label, url?, command?}[], localBaseUrl: string|null, devBaseUrl: string|null, deploy: {target, live}|null, recordings: {id, text, url}[], flags: {id, text}[], decisions: {id, text}[] }`. Returns `{ schemaVersion: 1, record, surface, allowedHosts, partial: string[], refused: {id, reason}[], expected: string[], facts: Fact[] }`.
  - Mapping: `change:{path}` per change and `change:commit-{sha7}` per commit (status `passed`, source `git`); `check:{name}` for every name in `expectedChecks` (when non-null) ∪ `Object.keys(report.checks)` (`report.checks` is an object keyed by check name — Global Constraints) — `exitCode === 0` → passed, `skipped` set → skipped (reason the `skipped` value), other exit code → failed (reason `report.checks[name].summary` or `exit {code}`), absent → not-run reason `no result recorded`; `check:ac-{id}` per parsed AC — `met` → passed, other value → failed (reason the value), missing → not-run reason `no spec-compliance result recorded`; `story:{id}` per planned story ∪ result id (negative flag kept), result status mapped through, missing → not-run `no story result recorded`; `finding:{n}` per low-confidence line (status passed, source `decisions.md`); `link:{id}` per link that passes `checkLink` against `allowedHosts` (= the two base URLs that are set) — a `command` link passes unless `findCredentialInText(command)` returns a key, which refuses it with reason `credential key in command: {key}` (Decision Q2); a `url` link under surface `infra`/`backend` is refused with reason `infra surface lists commands, not links`; refused links go to `refused`, never `facts`; `deploy:status` from `deploy` (default `{ target: 'local', live: null }`, text `target: {target}` plus `, confirmed live` / `, not confirmed live` for dev; the fact carries `target` and `live` fields so Task 3's Decision Q7 suffix rule can read them); `recording:*`, `flag:*`, `decision:*` pass through with status passed. Non-check/story facts always carry status `passed` (meaning "gathered"). `expected` lists every check/story id derived from inputs other than results (verify names, ACs, planned stories).
  - Partial notes (exact text): `verify report not found` (report null), `verify-scope declaration not read — expected checks not derived` (expectedChecks null, Decision Q6), `spec not found — acceptance criteria not derived` (specText null), `git changes not gathered` (changes null), `review decisions log not found` (decisionsText null).
  - `readPacket(comments: object[]) → { status: 'found'|'none'|'unreadable', comment: object|null, version: number|null, extras: string[], skipped: string[] }` — candidates are comments whose `body` matches `PACKET_MARKER_RE` on its first line; untrusted → `skipped` notes; trusted ones ordered by `createdAt` (array order when absent); the earliest is `comment`; the rest go to `extras` as `url || id`; earliest's version ≠ `SCHEMA_VERSION` → `status: 'unreadable'` with `version` set. Never touches the filesystem.
- [ ] **Step 1: Write the failing tests:**
  - `AC2a expected AC with no result renders not-run` — specText with ACs `1.`, `2a.`; `acResults: { '1': 'met' }` → fact `check:ac-1` passed, `check:ac-2a` not-run reason `no spec-compliance result recorded`; `expected` includes both.
  - `verify report maps exit codes` — report `{checks: {tests: {command: 'npm test', exitCode: 0}, lint: {command: 'x', skipped: 'fail-fast'}, types: {command: 'y', exitCode: 1, summary: '2 errors'}}}` (the real object-keyed shape) and `expectedChecks: ['tests','lint','types','e2e']` → passed / skipped(fail-fast) / failed(2 errors) / not-run(no result recorded).
  - `expected checks from the declaration` (Decision Q6) — `expectedChecksFromDeclaration({ suites: ['tests', 'journeys'], checks: { types: null, lint: 'npm run lint', tests: {} } })` → `['tests', 'journeys', 'lint']`; `expectedChecksFromDeclaration(null)` → `null`.
  - `expected checks: null declaration is a stated partial` — `expectedChecks: null` with a report holding only `tests` → `partial` includes `verify-scope declaration not read — expected checks not derived` and the only check fact is `check:tests`.
  - `parseStoryFile reads a real multi-story file` — the schema-v2 fixture from `plugin/skills/stories/story-examples.md` Example 1 (three stories: `front-page-loads` tags `[smoke, navigation]`, `navigate-to-page-two`, `neg-404-handling` tags `[negative, error-handling]`, each with nested `steps:` lists) → exactly three entries in order, only `neg-404-handling` negative; a block-form `tags:` list containing `- negative` on a non-`neg-` id → negative; a `steps:` entry's nested `- action:` lines never produce a story.
  - `storyResultsFromQaReport maps QA statuses` — `{ stories: [{id:'a',status:'PASS'},{id:'b',status:'PASS_WITH_CAVEATS'},{id:'c',status:'FAIL',error:'Locator not found'},{id:'d',status:'SKIPPED'}] }` → passed / passed / failed(`Locator not found`) / skipped(`skipped`); `null` → `null`.
  - `partial gather is stated` (Review Focus 4) — `report: null, specText: null` → `partial` includes `verify report not found` and `spec not found — acceptance criteria not derived`, every `expectedChecks` name is not-run.
  - `refused links never become facts` — url to `https://evil.example` → in `refused`, absent from `facts`; infra surface url link → refused with the infra reason; command link → fact.
  - `a command link carrying a credential flag is refused` — command `deploy --token abc123` → `refused` entry with reason `credential key in command: token`, absent from `facts`, and `JSON.stringify(refused)` does not contain `abc123`.
  - `low-confidence findings` — decisionsText with two `STAGED … Staged to Review Console as low-confidence …` lines → `finding:1`, `finding:2`.
  - `AC2b readPacket` — comments: untrusted marker (`NONE`, earliest), trusted v1 (`MEMBER`, createdAt T2), trusted v1 (`OWNER`, T3) → `status 'found'`, `comment.id` is the T2 one, `extras` has the T3 url, `skipped` has one note; a lone trusted `<!-- acceptance-packet: v2 -->` → `unreadable`, `version 2`; no marker → `none`.
  - `AC2b stale run-dir copy is ignored` — write a temp file `packet-4611.md` with body `STALE` under `os.tmpdir()`; `readPacket` of a comment list with body `<!-- acceptance-packet: v1 -->\nLIVE` returns the `LIVE` body (the reader takes no path argument).
- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/packet-gather.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `Add acceptance-packet gather and reader — refs #4611`.

### Task 5: Publish (find by marker, edit in place, label after success)

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/wrap-up/packet-post.js`
- Test: `tests/bin-lib/wrap-up/packet-post.test.js`

**Interfaces:**
- Consumes: Task 4 `readPacket`; Task 1 `LOCAL_START`, `LOCAL_END`.
- Produces:
  - `publishPacket({ issue: number, bodyFile: string, repo?: string, prNumber?: number|null, label?: string|null, runner, readFile, writeFile, tmpPath }) → { ok: boolean, action: 'created'|'updated'|null, url: string|null, id: string|null, extras: string[], skipped: string[], labelApplied: boolean, prLink: { ok: boolean, action: 'appended'|'present'|null, error?: string } | null, error?: string }`. `runner(args: string[]) → string` runs `gh` with those args (throws on non-zero). `--repo {repo}` is appended to every gh call when `repo` is set.
  - Sequence: (1) `['issue','view',String(issue),'--json','comments']` → `readPacket(JSON.parse(out).comments)`; `unreadable` → `ok:false`, error `existing packet comment is unreadable (schemaVersion {v}) — not posting a second packet`. (2) found → `['api','graphql','-f','query=mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id url}}}','-f',`id=${id}`,'-F',`body=@${bodyFile}`]`, url from the response; a throw → `ok:false`, `action:'updated'`, error `could not edit packet comment {url}: {message}` (nothing posted). none → `['issue','comment',String(issue),'--body-file',bodyFile]`, url = trimmed stdout; a throw → `ok:false`, error `could not post packet comment: {message}`. (3) only when (2) succeeded and `label` is set: `['issue','edit',String(issue),'--add-label',label]` → `labelApplied:true`; a throw → `ok:false`, error names the label failure. (4) only when ok and `prNumber`: `['pr','view',String(prNumber),'--json','body']`; line `Acceptance packet: {url}` already present → `action:'present'`; else write body + `\n\nAcceptance packet: {url}\n` to `tmpPath` and `['pr','edit',String(prNumber),'--body-file',tmpPath]` → `appended`; PR-link failures set `prLink.ok:false` without failing the publish.
  - `upsertLocalPacket(recordBody: string, packetMarkdown: string) → string` — replace everything between (and including) the delimiters with `LOCAL_START\n{packet}\nLOCAL_END`, or append it after one blank line when absent.
- [ ] **Step 1: Write the failing tests** with a fake `runner` that holds an in-memory issue (comments with `id`, `url`, `body`, `authorAssociation`, `createdAt`), a PR body, and a label list, and records every call:
  - `AC3 second run edits the same comment` — publish twice with different body files → after both, exactly one comment carries the marker, its `id` is unchanged, its body is the second body, `action` is `created` then `updated`.
  - `AC2c post failure applies no label` — runner throws on `issue comment` → `ok:false`, `labelApplied:false`, no `issue edit` call recorded, error starts `could not post packet comment`.
  - `edit failure posts nothing` — existing trusted packet, runner throws on `api graphql` → `ok:false`, no `issue comment` call, no label.
  - `duplicates: earliest trusted is edited, extras reported` (Review Focus 3) — untrusted marker + two trusted → the earliest trusted id is the one updated, `extras.length === 1`, `skipped.length === 1`, no new comment.
  - `unreadable existing packet posts nothing` — trusted v2 marker → `ok:false`, no write calls.
  - `PR link appended once` — two publishes with `prNumber` → the PR body contains `Acceptance packet: {url}` exactly once; second `prLink.action === 'present'`.
  - `upsertLocalPacket` — append when absent; replace in place when present (content before and after the delimiters unchanged; exactly one `LOCAL_START`).
- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/packet-post.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces (no `fs`/`child_process` in this module — the CLI injects them).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `Add acceptance-packet publish with edit-in-place — refs #4611`.

### Task 6: CLI `plugin/bin/acceptance-packet.js`

**Files:**
- Create: `plugin/bin/acceptance-packet.js`
- Test: `tests/acceptance-packet-cli.test.js`
- Modify: `docs/plugin-structure.md` (one CLI line beside `find-run-comment.js`'s, same shape: synopsis, exit codes, test file)

**Interfaces:**
- Consumes: Tasks 3–5; `plugin/bin/lib/issues/local-store.js` (`readRecord`, `writeRecord`); `plugin/bin/lib/verify/declaration.js` (`readDeclaration`, `DECLARATION_PATH`) for Decision Q6.
- Produces: `run(argv, deps) → exitCode` and `module.exports = { run, parseArgs }`; `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps)`. Follow the `gh-api-module-pattern` skill's `cli-wrapper-contract.md` (read it first): injectable deps, strict flag parsing (unknown flag / repeated flag / missing value → exit 2), `--help` → usage on stdout, exit 0.
  - `gather --record <n> --out <file> [--spec <file>] [--report <file>] [--scope <file>] [--stories-dir <dir>] [--story-results <file>] [--ac-results <file>] [--decisions <file>] [--base <ref>] [--links <file>] [--surface <s>] [--local-base-url <u>] [--dev-base-url <u>] [--deploy <file>] [--recordings <file>] [--flags <file>] [--decision-items <file>]` — reads every given file (an unreadable optional file is treated as absent, so it becomes a partial note). Expected checks (Decision Q6): `readDeclaration(--scope, default DECLARATION_PATH resolved against the cwd)` → `expectedChecksFromDeclaration(decl)`; a missing declaration (`missing: true`) or a failed read (`ok: false`) passes `expectedChecks: null` (the stated partial note). `plannedStories` = `parseStoryFile` over every `*.yaml`/`*.yml` file in `--stories-dir` (sorted by name, concatenated); `storyResults` = `storyResultsFromQaReport(JSON of --story-results)` (the QA run's `report.json`). `--recordings`, `--flags` and `--decision-items` each read a JSON array of `{ id, text[, url] }` (the recording, risk-flag and control-mode records fill them; wrap-up passes `--recordings` only when Step 4 committed screenshots). Runs `git diff --name-status {base}...HEAD` and `git log --format=%H%x09%s {base}..HEAD` through `deps.git` when `--base` is given (a git failure → `changes: null`), calls `gatherPacketFacts`, writes JSON to `--out`. Prints `{"out": "...", "facts": N, "partial": [...]}`. Exit 0.
  - `render --facts <file> --narrative <file> --out <file> [--dropped-out <file>] [--observation-plan <file>] [--poster <text>]` — writes the markdown to `--out` and `{dropped, screened, truncated, chars}` JSON to `--dropped-out` when given (`screened` as `{section, key}` per entry — never the claim text); prints `{"out": "...", "dropped": N, "screened": N, "truncated": N, "chars": N}`. `SchemaError` or an unreadable/unparseable input → stderr names it, exit 1.
  - `post --record <n> --body-file <file> [--pr <n>] [--label <name>] [--repo <owner/name>]` — `gh` absent (`deps.ghAvailable()` false) → stderr `gh absent — follow _shared/acceptance-packet.md's MCP path`, exit 2. Otherwise `publishPacket` with `tmpPath` from `bin/lib/session-tmp.js` (or `os.tmpdir()` fallback the module already uses); prints the result JSON; exit 0 when `ok`, else 1.
  - `local --record-file <file> --body-file <file> [--pending]` — `readRecord`, `body = upsertLocalPacket(body, packet)`, `facets.acceptance = 'pending'` only when `--pending` is given (the `local-files` twin of `post --label`; omitted below the oversight floor, Decision Q5), `writeRecord`; prints `{"recordFile": "...", "pending": bool}`; exit 0, unreadable → 1.
  - Real deps: `git`/`gh` via `execFileSync` with `windowsHide: true`, `encoding: 'utf8'`, `stdio: ['ignore','pipe','pipe']`.
- [ ] **Step 1: Write the failing tests** in-process via `run(argv, fakeDeps)`: `--help` exit 0; unknown subcommand and unknown flag exit 2; `gather` with a report + spec fixture in a temp dir writes facts whose `check:tests` is passed; `gather derives expected checks from the verify-scope declaration` (Decision Q6) — a temp `--scope` file declaring `checks: { tests: { tests: 'npm test', journeys: 'x' }, lint: 'y' }` and a report holding only `tests` → facts carry `check:journeys` and `check:lint` as not-run; a `--scope` path that does not exist → the partial note `verify-scope declaration not read — expected checks not derived`; `gather` with `--stories-dir` holding one multi-story YAML (two stories, one `neg-`) and `--story-results` holding a QA `report.json` → two `story:` facts with the negative flag and mapped statuses; `--recordings` with one entry → a `recording:` fact; `render` round-trip writes markdown starting with the marker and its `--dropped-out` JSON carries `screened`; `local` without `--pending` leaves `facets.acceptance` unset and with `--pending` sets it to `pending`; `render` with `schemaVersion: 2` narrative exits 1; `post` with `ghAvailable: () => false` exits 2; `post` with a fake gh runner whose comment post throws exits 1 and records no `issue edit`; `local` upserts into a temp record file. Plus one real subprocess: `spawnSync(process.execPath, [BIN, '--help'], { windowsHide: true })` exits 0.
- [ ] **Step 2: Run** `node --test tests/acceptance-packet-cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the CLI and add the `docs/plugin-structure.md` line.
- [ ] **Step 4: Run** `node --test tests/acceptance-packet-cli.test.js tests/windows-hide-spawn-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Add acceptance-packet CLI — refs #4611`.

### Task 7: Acceptance-labeling verify accepts the packet

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (the `acceptance-labeling` check, before the `fullBrief` scan)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`

**Interfaces:**
- Consumes: Task 4 `readPacket`.
- Behavior: after the `demo:pending` label check, `const packet = readPacket(comments)`; push `packet.skipped` into `ignored`; `found` → pass (with `passedNotes` as today); `unreadable` → `fail('#{target}: acceptance packet comment is unreadable (schemaVersion {v})')`; `none` → fall through to the existing legacy brief / pointer logic unchanged. Update the block comment above the check to name the packet as the current form and the brief forms as legacy readers (kept until `demo/legacy-brief-compatibility.md`'s cleanup record).
- [ ] **Step 1: Write the failing tests** using the file's existing acceptance-labeling fixture helpers: a target with `demo:pending` and one trusted comment whose body is `<!-- acceptance-packet: v1 -->\n## Acceptance packet — #N` → `result: 'pass'`; the same comment from a `NONE` author → `fail` with the skip note in the detail; a trusted `v2` packet → `fail` naming `unreadable`; an existing legacy `## Verification Brief` + `### Confirmed` fixture still passes.
- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/engine-verify.test.js` — Expected: the new tests FAIL, existing ones PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** — `Accept the acceptance packet in wrap-up's acceptance-labeling check — refs #4611`.

### Task 8: The packet contract and the marker registration

**Files:**
- Create: `plugin/skills/_shared/acceptance-packet.md`
- Modify: `plugin/skills/_shared/pr-run-comments.md` (register the marker; update the `brief` rows)
- Test: `tests/acceptance-packet-contract-conformance.test.js`

**Interfaces:**
- Consumes: Task 1 constants (the test pins prose against them — `prose-code-twin-pin` / `skill-prose-conformance-tests` project skills).
- Contract contents (headings in this order): `## Sections` (the nine, in order, plus the Decision Q3 row-placement rule — skipped/not-run → Couldn't test, failed or passed-negative → Tried to break, routine pass → the Test guide's `Checks that passed:` list, one row per check/story fact; no check counts as an edge case until a signal for it exists, so Tried to break holds negative stories and failures only (Decision Q8) — each section with its owner: sections 2 Recording → the recording record; 7 Risk proofs → the risk-flag record; 8 Decisions left for you → the control-mode records; 9 Deploy status → the dev-target record; placeholders `not recorded`, `no kept risk flags`, omitted, `target: local`; Risk proofs always renders, its placeholder standing in when no risk flag was kept (Decision Q10)); `## Canonical copy and lookup` (marker on line 1, trusted-author rule citing `bin/lib/issues/comment-trust.js`, earliest trusted edited by comment id, extras reported never edited or deleted, cannot-edit → report and post nothing, PR body line `Acceptance packet: {comment url}` appended idempotently, no PR → no link, `local-files` delimiters, one packet per work item, a legacy brief comment is left untouched and "exactly one" counts packet comments only, decomposed work → the packet lives on the parent and a sub-issue's wrap-up posts none, the parent-gate routing unchanged — until the feature-level acceptance record (#4617) changes it, the parent gate posts the legacy `## Verification Brief`, whose template lives in `wrap-up/verification-brief-parent-gate.md`; MCP transport (Decision Q4): no comment edit — a re-run that finds an existing packet is a failed edit under `## Failure contract`: report it, post nothing, apply no pending acceptance label; with none, post via `add_issue_comment`, then apply the label; below the oversight floor (Decision Q5) every record with no parent still gets a packet, posted with no pending label); `## Facts and claims` (the schemas, the section→kind table, ids, `schemaVersion: 1`, later records extend only by adding rows to the table); `## Validation policy` (visible drop, the dropped line wording, routing by status — only for a claim asserting verification, i.e. containing one of the words `tested`, `verified`, `works`; a plain manual step stays in the Test guide whatever its cited story's status (Decision Q9) — the dropped list in the working copy); `## The expected check set` (verify check names derived from the project's verify-scope declaration — `decl.suites` plus `types`/`lint` when declared, read through `readDeclaration`; no field in `verify-expectations.json`, no list passed by wrap-up (Decision Q6); ACs; planned stories parsed from the story files' `stories[].id`/`tags`; `not run`; partial notes); `## Pipeline` (gather → narrate → validate+render → post, the CLI subcommands, working copy in session temp and never read after the run); `## Reader rules` (`readPacket`); `## Untrusted content` (narrative is prose only — newlines collapsed, link brackets escaped, leading `#` escaped; URLs render only from link facts); `## Links and credentials` (host rule, the 14 credential keys verbatim as a backticked comma list, credentials appear only as vault entry names, the unverified-link suffix — only when the deploy target is `dev` and the feature is not confirmed live; a `local` target's links carry none (Decision Q7); the same constant screens Test-guide `command` strings and Test-guide claim text — the `{key}=`/`{key}:`, `--{key}` and `Authorization:` shapes, case-insensitive after percent-decoding — and a match drops that entry with its omission stated by id/key, never its text, while the packet still posts); `## Facts-poor and infra items`; `## Size` (60,000 cap, `truncated: N items omitted`); `## Old brief section map` (table: The ask → What changed; What shipped → What changed; Confirmed → Test guide and Tried to break; Observation plan → Test guide (rendered as the `### Observation plan` appendix `/claude-tweaks:demo` walks); the Try it block → Test guide); `## Failure contract` (post/edit failure → no pending label, reported; an MCP-transport re-run that finds an existing packet is one such failed edit — Decision Q4).
- `pr-run-comments.md`: add a `## Work-record markers` section after the Comment kinds table — one row: `acceptance-packet` | `/claude-tweaks:wrap-up` (`verification-brief.md` Step 4) | `<!-- acceptance-packet: v1 -->` on the **work record**, not the PR; find/edit rules live in `_shared/acceptance-packet.md`. Change the `brief` Comment-kinds row and Consumer-table row to say new runs post the acceptance packet on the record instead and the `brief` kind is read for legacy runs only (keep every marker string the existing tests pin).
- [ ] **Step 1: Write the failing conformance test:** reads the contract and asserts — the backticked credential list parsed from the `## Links and credentials` section deep-equals `CREDENTIAL_KEYS`; that section names `command` strings, claim text and `Authorization:` (Decision Q2); the file contains `PACKET_MARKER`, `LOCAL_START`, `LOCAL_END`; the `## Sections` list's headings equal `SECTIONS.map(h => h.heading)` in order; it states `vault entry name`; it states `60,000`; every `CLAIM_SECTIONS` key appears in the section→kind table with exactly `SECTION_KINDS`' kinds; `pr-run-comments.md` contains `<!-- acceptance-packet: v1 -->` inside its `## Work-record markers` section; `MCP re-run with an existing packet applies no label` (Decision Q4) — the `## Failure contract` section names the MCP transport and states that no pending acceptance label is applied, and `## Canonical copy and lookup` names `add_issue_comment` and says an existing packet is reported, not re-posted; the contract states that a record below the oversight floor still gets a packet, without the pending label (Decision Q5); `## The expected check set` names `verify-scope` and `readDeclaration` and states no field is added to `verify-expectations.json` (Decision Q6); `## Links and credentials` ties the unverified-link suffix to a `dev` target and states a `local` target's links carry none (Decision Q7); `## Sections` states that no edge-case signal exists yet (Decision Q8); the backticked verification words parsed from `## Validation policy` deep-equal `VERIFICATION_WORDS` (Decision Q9); `## Sections` states Risk proofs always renders (Decision Q10). Go-red control: each assertion's message names what drifted; for the credential list, the test also asserts a copy with one key removed does not deep-equal (proves the comparison can fail).
- [ ] **Step 2: Run** `node --test tests/acceptance-packet-contract-conformance.test.js` — Expected: FAIL (file missing).
- [ ] **Step 3: Write** the contract and the `pr-run-comments.md` edits.
- [ ] **Step 4: Run** `node --test tests/acceptance-packet-contract-conformance.test.js tests/pr-run-comments.test.js tests/comment-trust-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Add the acceptance-packet contract and register its marker — refs #4611`.

### Task 8b: The parent gate takes the legacy brief template (Decision Q1)

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md` (`## Compose the parent brief` only)
- Test: `tests/acceptance-packet-wrap-up-conformance.test.js` (new; Task 9 extends it)

**Interfaces:**
- In `## Compose the parent brief`, replace the sentence opening `Render the same \`## Verification Brief\` template Step 4 (\`verification-brief.md\`) renders, with:` by `Render this template — the legacy Verification Brief, kept for the parent gate until the feature-level acceptance record (#4617) moves parents to the acceptance packet (\`_shared/acceptance-packet.md\`) — with:`, and insert directly above that sentence the `markdown` fence `verification-brief.md` Step 4 holds today (from its `## Verification Brief` line through the `_Posted by {poster}. …_` footer), copied byte for byte — take it with `git show HEAD:plugin/skills/wrap-up/verification-brief.md` and the line range between the `Render this exact template:` line and the closing fence, never retyped. Everything else in the sentence (The ask / What shipped / Confirmed / Try it / `{poster}` / omit Observation plan / `### Branch`) stays. Nothing else in the file changes; `/tidy`'s opened-parent-gate check and `engine-verify.js`'s brief scan stay as they are.
- `wc -c plugin/skills/wrap-up/verification-brief-parent-gate.md` must stay under 52500 (today ~41,900; the fence adds ~2,300).
- [ ] **Step 1: Write the failing test** `parent gate holds the legacy brief template`: the test reads `verification-brief-parent-gate.md` (live file) and asserts its `## Compose the parent brief` section contains a fenced `markdown` block whose body starts `## Verification Brief\n\n### The ask` and contains `### Confirmed`, `### Observation plan` and `_Posted by {poster}. Resolve with \`/claude-tweaks:demo\`._`; and the section no longer contains `Render the same`. Run `node --test tests/acceptance-packet-wrap-up-conformance.test.js` — Expected: FAIL.
- [ ] **Step 2: Edit** the parent-gate file as above; verify the copy is byte-identical by extracting both fences to scratch files and comparing them (`cmp`), quoting the result in the task report.
- [ ] **Step 3: Run** `node --test tests/acceptance-packet-wrap-up-conformance.test.js tests/accept-label-reader-conformance.test.js tests/comment-trust-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-root-migration.test.js tests/demo-full-verification-pointer.test.js tests/below-floor-parent-close-conformance.test.js tests/try-it-contract-conformance.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/console/backfill.test.js` — Expected: PASS.
- [ ] **Step 4: Commit** — `Move the legacy brief template into the parent-gate procedure — refs #4611`.

### Task 9: Wrap-up composes and posts the packet

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief.md` (title/intro, Step 3, Step 4's template and posting, the Oversight-floor gate's `exceeds: false` bullet and the Try it block's **Posting it alone** paragraph (Decision Q5); Routing, Steps 1–2.5 and the screenshot-evidence routing stay)
- Modify: `plugin/skills/_shared/try-it.md` (consumers + "Where it appears": the Try it block and observation plan feed the packet's Test guide)
- Modify: pinned tests whose asserted text this task intentionally changes — Step 1's probe finds them (expected: `tests/pr-run-comments.test.js`, `tests/try-it-contract-conformance.test.js`); a pin on unchanged text is never edited.
- Test: `tests/acceptance-packet-wrap-up-conformance.test.js` (extend — Task 8b created it)

**Interfaces:**
- Consumes: the Task 6 CLI, the Task 8 contract (cite it; never restate its rules), and Task 8b (the parent gate now holds its own copy of the legacy template, so removing Step 4's leaves the parent path intact).
- `verification-brief.md`'s `## Parent-Gate Procedure` pointer section stays; where it or any other line in the file says the parent gate renders "the same template" as Step 4, repoint it to the parent-gate file's own template. After this task Step 4 holds exactly one template — the packet pipeline — never the legacy brief beside it (Decision Q1).
- `verification-brief.md` Step 3 becomes **Gather the packet inputs** (same evidence sources, now feeding gather: the visual-review screenshots become `recording`/`link` inputs, the review's Spec Compliance table becomes the `--ac-results` JSON — a transcription, written with the Write tool to a session-temp path — `decisions.md` becomes `--decisions`, the verify `report.json` path becomes `--report`, the Try it block's Entry point becomes a `link` input, a command for `cli`/`flow` plans). Step 4 keeps its heading `## Step 4: Compose and post the brief` (pinned by `tests/verification-brief-evidence-routing.test.js`) and its whole screenshot-commit routing verbatim, then replaces the `## Verification Brief` template and the issue/PR posting blocks with: resolve session-temp paths (`bin/session-tmp-resolve.js` — `FACTS=packet-facts-{N}.json NARRATIVE=packet-narrative-{N}.json PACKET=packet-{N}.md DROPPED=packet-dropped-{N}.json`, no literal `/tmp/` paths); `acceptance-packet.js gather` with every flag and its source named in the prose: `--record {N}`; `--out {FACTS}`; `--spec` the worktree's materialized `work/{N}-spec.md`; `--report` the verify `report.json` the test phase's pass stamp names; `--stories-dir` the project's stories directory (only when QA stories exist); `--story-results` the QA run's `report.json` (only when QA ran); `--ac-results` the transcribed Spec Compliance JSON; `--decisions` `$PIPELINE_RUN_DIR/decisions.md`; `--base origin/{integration-branch}` (`_shared/integration-branch.md`); `--links` the session-temp links JSON (the Try it block's Entry point, or its command for `cli`/`flow` plans); `--surface` the materialized header's `surface:`; `--local-base-url` the dev URL `_shared/dev-url-detection.md` resolves (UI surfaces only); `--recordings` the Step 4 screenshot URLs (only when screenshots were committed). No `--scope` (the CLI reads the default verify-scope declaration itself — Decision Q6) and no expected-checks list; `--dev-base-url`, `--deploy`, `--flags` and `--decision-items` are named as filled by the dev-target, risk-flag and control-mode records and not passed by this record; narrate — write the narrative JSON with the Write tool, every claim citing fact ids from the facts file, never inventing one (the `fact-validated-narration` project skill is the checklist); `acceptance-packet.js render … --poster {poster}` with `--observation-plan` = Step 2's plan; `acceptance-packet.js post --record {N} --body-file {PACKET} --label demo:pending [--pr {pr-number}]` (`--pr` only when `run-state.json` carries a `pr` object; `--label` omitted below the floor, Decision Q5) — exit 1 → the label is not applied, report the failure in the summary and log it; exit 2 → the contract's MCP path (Decision Q4: read the record's comments through MCP and run `readPacket`'s rules by hand; an existing packet → report the failed edit, post nothing, apply no label; none → `add_issue_comment`, then the label, then — when the run has a PR — append the `Acceptance packet: {comment url}` line to the PR body through MCP `update_pull_request` unless the line is already present, matching `publishPacket`'s step 4); `local-files` → `acceptance-packet.js local --record-file … --body-file {PACKET} --pending` (`--pending` omitted below the floor, Decision Q5).
- Oversight-floor gate (Decision Q5, Reading B): the `exceeds: false` bullet stops skipping Steps 1–4. It skips Step 1 (no `demo:pending` bootstrap) and Step 2.5 (the visual-review safety net is ceremony), runs Steps 2, 3 and 4, and Step 4 posts the packet without `--label`; the #2383 `oversightExempt` recording, the no-acceptance-label close and the `/claude-tweaks:demo #N` closing-commit fallback sentences stay. The Try it block's **Posting it alone** paragraph drops "a record below the floor (`exceeds: false`)" and the "A below-floor record gets no comment on the issue" sentence: it covers parent-linked sub-issues only, and every record with no parent carries its Try it block inside the packet's Test guide. The packet lives on the record in both the `pr` and no-`pr` cases; the PR gets the body link line instead of a brief comment; the issue pointer line is no longer posted. The `timing` PR run comment stays as it is. The `{poster}` rule keeps its substance, passed as `render --poster`.
- [ ] **Step 1: Probe the pins.** Run `grep -rln "verification-brief" tests` and, for each hit, read the exact strings it asserts from `verification-brief.md`/`try-it.md`; list which ones this task's edits change. Record the list in the task report.
- [ ] **Step 2: Write failing tests** in `tests/acceptance-packet-wrap-up-conformance.test.js`: `verification-brief.md`'s Step 4 section names `acceptance-packet.js gather`, `render`, `post` in that order (index comparison); `gather call names every flag` — the Step 4 section names each of `--record`, `--out`, `--spec`, `--report`, `--stories-dir`, `--story-results`, `--ac-results`, `--decisions`, `--base`, `--links`, `--surface`, `--local-base-url`, `--recordings`, and contains no `--expected-checks`; the exit-2 MCP branch names `update_pull_request` and `Acceptance packet:`; the `local-files` branch names `--pending`; it no longer contains `## Verification Brief\n\n### The ask` (`verification-brief.md holds exactly one template` — and the parent-gate file still does, Task 8b's test); the whole file contains no literal `/tmp/` path; it cites `_shared/acceptance-packet.md`; `post` is named before any sentence applying `demo:pending` and the exit-1 branch says the label is not applied; `exit-2 MCP path: existing packet → report, post nothing, no label` (Decision Q4) — Step 4's exit-2 branch names `add_issue_comment`, an existing packet, and that no label is applied; `below the floor posts the packet without --label` (Decision Q5) — the Oversight-floor gate's `exceeds: false` bullet (between `**\`exceeds: false\`**` and `**\`exceeds: true\`**`) names Step 4 and `without \`--label\``, still says no `demo:pending` bootstrap, still names `Record the exemption (#2383)`, and no longer contains `Skip Step 1 through`; `Posting it alone is for parent-linked sub-issues only` — the **Posting it alone** paragraph no longer contains `exceeds: false` or `below the floor`; `try-it.md` names the packet's Test guide. The existing pin `below the floor: no demo:pending, but the walkthrough still posts` (`tests/try-it-contract-conformance.test.js`) is an intended change: it keeps `no \`demo:pending\` bootstrap` and the #2383 assertion and swaps the **Posting it alone** match for the packet-without-label statement. Update the intended pins Step 1 found to the new shape — each changed assertion keeps an equivalent statement of the new behavior, never deleted outright. Run `node --test tests/acceptance-packet-wrap-up-conformance.test.js` — Expected: FAIL.
- [ ] **Step 3: Edit** `verification-brief.md` and `try-it.md`.
- [ ] **Step 4: Run** `node --test tests/acceptance-packet-wrap-up-conformance.test.js tests/try-it-contract-conformance.test.js tests/pr-run-comments.test.js tests/verification-brief-evidence-routing.test.js tests/demo-full-verification-pointer.test.js tests/below-floor-parent-close-conformance.test.js tests/session-tmp-root-migration.test.js tests/log-decision-text-file-sites-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/timing-prose-conformance.test.js tests/verify-json-acceptance-guard-conformance.test.js tests/comment-trust-conformance.test.js tests/verify-expectations-writer-conformance.test.js tests/timing-nested-parent-roster.test.js tests/accept-label-reader-conformance.test.js tests/bin-lib/console/backfill.test.js` — Expected: PASS. `wc -c plugin/skills/wrap-up/verification-brief.md` prints under 52500.
- [ ] **Step 5: Commit** — `Compose and post the acceptance packet from wrap-up — refs #4611`.

### Task 10: Readers find the packet

**Files:**
- Modify: `plugin/skills/demo/entry-paths.md` (the `#N` label-backed lookup reads the packet first)
- Modify: `plugin/skills/_shared/acceptance-labeling-landed.md` (Live-state tier: drop the stale "issue pointer comment is a plain post that duplicates" premise; the packet is edited in place on the record; the `demo:pending` check is unchanged)
- Test: `tests/acceptance-packet-wrap-up-conformance.test.js` (extend)

**Interfaces:**
- `demo/entry-paths.md`: the label-backed `#N` lookup first takes the earliest trusted issue comment whose first line is `<!-- acceptance-packet: v1 -->` (the acceptance packet, `_shared/acceptance-packet.md`): its Test guide stands in for the Try it block and its `### Observation plan` appendix is the plan Step 2 walks; only when none exists does it fall back to the `## Verification Brief` / pointer forms, unchanged (legacy runs).
- [ ] **Step 1: Write failing tests:** `demo/entry-paths.md` names `<!-- acceptance-packet: v1 -->` before its first `## Verification Brief` mention and says "earliest trusted"; `acceptance-labeling-landed.md` no longer contains `issue pointer comment is a plain post` and still names `demo:pending`. Run `node --test tests/acceptance-packet-wrap-up-conformance.test.js` — Expected: the new tests FAIL.
- [ ] **Step 2: Edit** both files.
- [ ] **Step 3: Run** `node --test tests/acceptance-packet-wrap-up-conformance.test.js tests/pr-run-comments.test.js tests/try-it-contract-conformance.test.js` plus `grep -rln "acceptance-labeling-landed\|entry-paths" tests` hits — Expected: PASS.
- [ ] **Step 4: Commit** — `Read the acceptance packet in demo and the landed check — refs #4611`.

### Task 11 (folded into Common Step 5): full verification

The full suite runs once centrally through `/claude-tweaks:test` / `verify.js` at Common Step 5 (AC 7) — no separate implementer task.
