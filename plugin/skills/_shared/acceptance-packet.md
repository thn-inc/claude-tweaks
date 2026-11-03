# Acceptance Packet — one evidence-validated comment per work record

Canonical contract for the acceptance packet (#4611): the one marker comment on a work record that
tells the human what changed, how to test it, what could not be tested and what was tried against
it. Code gathers the facts and renders the comment. The only LLM-written input is a narrative of
claims, and a claim that cites no gathered evidence is dropped, visibly. The code is
`bin/acceptance-packet.js` over `bin/lib/wrap-up/packet-*.js`, whose constants this file restates;
`tests/acceptance-packet-contract-conformance.test.js` pins the two equal. Every consumer cites this
file and restates none of it.

## Sections

Nine sections, in this render order. The owner is the record whose work fills the section; until
it lands, the section's empty line stands in.

1. **What changed** — claims citing `change` facts. Empty: `not applicable: no change facts were gathered`.
2. **Recording** — owner: the recording record. One item per `recording` fact, through `renderRecordingSection` (`## Recording`). Empty: `not recorded`.
3. **Test guide** — numbered steps from the kept claims, each with its cited link or command, then the
   refused links and the `Checks that passed:` list. Empty: `not applicable: no tested stories or links were gathered`.
4. **Couldn't test** — placed rows and moved claims. Empty: `not applicable: every expected check ran`.
5. **Tried to break** — kept claims, moved claims and placed rows. Empty: `not applicable: no negative stories or failures ran`.
6. **Least confident** — claims citing `finding` facts. Empty: `not applicable: no low-confidence review findings`.
7. **Risk proofs** — owner: the risk-flag record. This section always renders, its placeholder standing in when no risk flag was kept (Decision Q10). Empty: `not applicable: no kept risk flags`.
8. **Decisions left for you** — owner: the control-mode records. One line per `decision` fact, omitted when empty, heading included.
9. **Deploy status** — owner: the dev-target record. The deploy fact's text. With no deploy record: `target: local`.

Any other section left empty states why in its one line; a heading is never empty. Recording,
Decisions left for you and Deploy status render facts directly and are never narrated claims. Above the
sections sit the marker, the `## Acceptance packet — #{N}` title, the partial-gather note when the
gather has one, the dropped line, and the screened line when an entry was screened.

**The observation plan**, when given in `_shared/observation-plan.md`'s grammar, follows Deploy status
as a `### Observation plan` appendix and survives the trip to `/claude-tweaks:demo`: a first-line plan
heading is dropped so it is not doubled, each line keeps its list marker and its whole backtick spans,
and each keeps its indentation up to three columns past the open list item's content, so a sub-bullet
stays under its parent and no line becomes an indented code block. What follows the marker is free text
(`## Untrusted content`).

**Row placement (Decision Q3).** Every `check`/`story` fact renders exactly one row, placed by the
first rule that matches: status `skipped` or `not-run` → Couldn't test; status `failed` → Tried to
break; status `passed` with `negative: true` → Tried to break; any other `passed` → the Test guide's
`Checks that passed:` list. The row count therefore equals the fact count. **Decision Q8:** no
edge-case signal exists yet: no check counts as an edge case until one does, so Tried to break holds
negative stories and failures only, and a routine pass never renders there. A `recording` fact with status
`not-run` and any reason but `no-story` also renders one row in Couldn't test, beside its own line in Recording.

## Canonical copy and lookup

- **The marker.** The canonical comment's first line is `<!-- acceptance-packet: v1 -->`. The first
  line must equal the marker exactly: trailing text or a padded version is prose, not a packet. A
  same-shaped line naming another version is a packet too, and reads as `unreadable` (`## Reader rules`).
- **Trust.** Only a comment from a trusted author counts (`bin/lib/issues/comment-trust.js`, stated
  in `_shared/pr-run-comments.md`'s Trusted authors). An untrusted marker comment is skipped and named.
- **Which comment.** The canonical copy is the earliest trusted comment by `createdAt`, not by comment
  id, because real ids are opaque node ids. When any candidate's `createdAt` will not parse, the order
  the comments were given in stands. It is then edited in place through its own id; extras are
  reported, never edited or deleted. A re-run never adds a second packet: a comment it cannot edit is
  reported and nothing is posted (`## Failure contract`).
- **The PR.** `Acceptance packet: {comment url}` is appended to the PR body idempotently, a line
  already there being left alone. A line with another url on the same `/issues/{N}#` is replaced in
  place. A line on another record's `/issues/{N}#` stays, since a multi-spec run shares one PR across
  records. No PR, no link. A failed link is reported in the result's `prLink` and
  does not fail the publish, since the packet landed.
- **`local-files`.** The packet sits between the whole-line delimiters `<!-- acceptance-packet:start -->` and
  `<!-- acceptance-packet:end -->` in the record body, replaced in place, and is appended at the end
  of the body when no such block exists. Whitespace around a delimiter does not change what it is. An
  end closes the nearest start above it. Repeated blocks collapse into one at the first one's place, and
  any text between them stays. A start with no end pairing it loses its delimiter line, and the text after it stays.
  An end delimiter with no start above it is ordinary text: it is never a block, and it stays where it is.
  When the first start in the body is such an orphan, the packet lands on that orphan's line, ahead of any
  complete block below it, which is removed like any repeated block.
- **How many.** One packet per work item. A legacy brief comment is left untouched, and "exactly one"
  counts packet comments only.
- **Parents.** Decomposed work: the packet lives on the parent and a sub-issue's wrap-up posts none.
  The parent-gate routing is unchanged: until the feature-level acceptance record (#4617) changes it,
  the parent gate posts the legacy `## Verification Brief`, whose template lives in
  `wrap-up/verification-brief-parent-gate.md`.
- **MCP transport (Decision Q4).** This transport has no comment edit, and it never posts a superseding
  comment. Read the record's comments (`issue_read`, `get_comments`) and apply this section's rules to
  them. On it, a re-run that finds an existing packet is reported, not re-posted: it is a failed edit under
  `## Failure contract`. With no existing packet, it posts via `add_issue_comment` and only then applies
  the label, composing the body per `_shared/github-write-transport.md`'s Marker comments on the MCP path.
- **Below the floor (Decision Q5).** Below the oversight floor every record with no parent still gets
  a packet, posted with no pending label.

## Facts and claims

`schemaVersion: 1` is one constant used by the facts, the narrative and the marker.

**The facts document** is `{ schemaVersion, record, surface, allowedHosts, partial[], refused[], facts[] }`.
A fact is `{ id, kind, status, reason?, source }` plus the optional render fields `text`, `url`,
`command`, `label`, `negative`, `live`, `target`, `url_or_path`, `archive_path`, `captions`, `failure`, `redactions` and `exposure`.

**Fact kinds:** `change`, `check`, `story`, `finding`, `link`, `recording`, `flag`, `decision`, `deploy`.

**Fact statuses:** `passed`, `failed`, `skipped`, `not-run`.

**Fact ids** are `{kind}:{key}`, the key passed through `encodeFactKey`: every character outside
`[A-Za-z0-9._/#:@-]` becomes `%HH` of its UTF-8 bytes, so a real path can never fail the id shape, and
the readable path stays on the fact's `text`. A repeated id keeps its first fact and states a partial note.

**The narrative** is the envelope `{ "schemaVersion": 1, "claims": [{ "section", "text", "refs" }] }`,
and each claim is `{ section, text, refs[] }`, its refs copied from the facts file. A claim's section
limits the kinds it may cite:

| Section | Kinds a claim may cite |
|---|---|
| `what-changed` | `change` |
| `test-guide` | `story`, `link` |
| `tried-to-break` | `story`, `check` |
| `least-confident` | `finding` |
| `risk-proofs` | `flag`, `check`, `story`, `recording`, `link` |

A `risk-proofs` claim also needs at least one `flag` and at least one proof fact among its refs. Later
records extend the schema only by adding rows to the table.

## Validation policy

A dropped claim is never silent. One line always renders above the sections, zero included:
`N claims were dropped for missing evidence`, or `1 claim was dropped for missing evidence` in the
singular.

A claim drops with one fixed reason: `unknown section`, `no refs`, `absent fact`, `incompatible fact`,
`risk proof cites no flag`, `risk proof cites no proof fact`, or
`tried-to-break claim cites no negative or failed fact`. The dropped list lives in the working copy
(`render --dropped-out`): each entry's section and fixed reason, never the claim's text, section value or refs.

An unknown section drops first. Any other claim whose text shows a credential shape goes to `screened`
ahead of every evidence rule below, whatever its section (`## Links and credentials`).

**Verification words:** `tested`, `verified`, `works`.

Routing by status applies only for a claim asserting verification, one whose text contains a
verification word (Decision Q9): a failed cited `check` or `story` moves it to Tried to break, and a
skipped or not-run one, with none failed, moves it to Couldn't test, in each case stating the fact that
moved it. A claim already in Tried to break stays there on a failed fact. Any other claim is kept: a plain manual step stays
in the Test guide whatever its cited story's status, so a packet built without QA keeps its testing steps.

A Tried to break claim must cite a failed fact or a negative story that ran and passed. One citing only
skipped or not-run negative stories moves to Couldn't test whatever its wording (Decision Q12): the
plain-wording exemption covers Test-guide manual steps only. One citing neither is dropped.

A risk proof citing no proof fact is dropped. A risk proof citing a failed or skipped `check` or `story`
proof routes to Tried to break or Couldn't test whatever its wording, because a proof asserts itself.

## The expected check set

**Verify checks (Decision Q6).** The check names come from the project's verify-scope declaration:
`decl.suites` plus `types`/`lint` when declared, read through `readDeclaration`. No field is added to
`verify-expectations.json`, and wrap-up passes no list. A missing declaration is a normal project shape:
no expected verify checks and no partial note (Decision Q11). A present but unreadable or invalid one is
a partial gather with the note `verify-scope declaration not read — expected checks not derived`.

**Adjudicated runs.** A check's status follows verify's verdict, not its raw exit code. With
`effectivePass: true` in the `report.json`, a check that exited non-zero is `passed` and states why:
`baseline-adjudicated vs {baseRef}`, `declared pre-existing failure`, or `adjudicated by verify`.

**Acceptance criteria.** The spec's criteria are parsed from its `## Acceptance Criteria` section in
numbered (`1.`), `1)`, bold-number (`**1.**`), bulleted and checkbox forms, with positional ids `AC1`,
`AC2` for the unnumbered ones. A checkbox with no text is no criterion and takes no id. Each is a
`check:ac-{id}` fact. A spec with none gets a partial note.

**Stories (Decision Q13).** Only the stories `/test` selected for this diff are expected: the QA
`report.json`'s `stories[]` plus, when the QA pass stamp's `sha` is the current commit, the stamp's
stories as passed. A matching stamp wins over a report result for the same id. A story `/test` did not
select is not listed; the story files' `stories[].id`/`tags` supply only the negative flag (an id
prefixed `neg-` or the tag `negative`). No report and no stamp is a partial note only when
`decisions.md` logged a selection or a report was unreadable, never for a zero-match skip, `skip-qa` or
a project with no stories.

**`not run`.** An expected item with no result renders as `not run` with its reason, `no result recorded`
for a verify check and `no spec-compliance result recorded` for a criterion, and never as silence.

**Partial notes.** Each gap in the gather is stated in the facts' `partial` list and rendered above the sections:

- `verify report not found`
- `verify-scope declaration not read — expected checks not derived`
- `spec not found — acceptance criteria not derived`
- `spec holds no parsed acceptance criteria — acceptance criteria not derived`
- `git changes not gathered`
- `git change range is empty — changes not listed`
- `review decisions log not found`
- `QA report not read — selected stories not listed`
- `QA report entries with no story id, not listed: {n}`
- `repeated fact ids, first kept: {ids}`
- `spec-compliance results match no acceptance criterion: {keys}`
- `review findings not read — low-confidence findings not listed`
- `{flag} input not read — treated as absent`

## Pipeline

`snapshot` at wrap-up Phase 1 → `gather` → narrate → validate and `render` → `post` (`local` on the
`local-files` backend). Narration is the one LLM step: it writes the narrative file, citing fact ids
copied from the facts file and inventing none.

**Subcommands:** `snapshot`, `gather`, `render`, `post`, `local`.

The snapshot exists because the verify and QA reports are not in the run dir, and Step 4 can run after
the worktree holding them is gone. It copies them, the QA pass stamp, `head` and `mergeBase` to
`{run-dir}/packet-inputs/` under a `manifest.json`; it is an input to gather, never a packet copy any
reader consults. `snapshot` also encodes the recording while the QA screenshots are on disk (`## Recording`).
The working copy lives in session temp and is never read after the run: the facts,
narrative, rendered markdown and dropped list are session-temp paths (`_shared/session-tmp-root.md`)
passed to the CLI.

Exit codes:

- Every subcommand exits 0 on success, `snapshot`'s two skips included (nothing ahead of the base; a
  snapshot already there on a re-run from the main checkout).
- `snapshot` and `gather` exit 3 on a `--run` the run-dir anchoring refuses, and `snapshot` on a failed write.
- `render` exits 1 on invalid input and removes any earlier output, so a stale packet is not there to
  post. `render` exits 1 and nothing is posted when `chars` still exceeds the cap after truncation.
- `post` exits 4 when gh is absent, the MCP path. `post` exits 2 on a malformed invocation, a body file
  with no marker on its first line included: nothing runs, and the MCP path is never taken. `post` exits
  1 on a failure, its result JSON naming what happened (`## Failure contract`).
- `local` exits 2 on the same marker check, leaving the record unchanged, and 1 on an unreadable record
  or body file or a failed write.

## Reader rules

Every reader finds the packet through `readPacket`, or by its rules on a transport that cannot run it.
It reads only the comments it is given, so a run-dir copy can never stand in for the record. It returns
`none`, `found`, or `unreadable` for a trusted packet of an unknown schema version, and an `unreadable`
packet fails the reader: a legacy brief beside it does not pass it. Legacy brief readers are reached only
when no trusted packet exists.

Below the floor a record carries no pending label, so a trusted packet comment on the record also counts
as a landed signal (`_shared/acceptance-labeling-landed.md`).

A Recording path is local to the machine that ran the pipeline: the reader checks the live location first
and then the `once archived:` one, and a file in neither is gone, never a failed packet.

## Untrusted content

Narrative and fact free text are prose only: newlines collapsed, link brackets and `<` escaped, leading
`#` escaped, as are a backslash, a backtick, a leading `~`, and a line of only `=` or `-`. A leading
block marker is escaped too, `>`, a list marker, `1.` or `1)`, so `- ## Couldn't test` forges no nested
heading, and so is a character reference's `&`, since `&#35;12` and `&commat;octocat` would decode into a
live reference and a live mention. A URL in free
text renders as a code span, as does every other shape GitHub would link or notify: any `scheme://` URL,
`mailto:`, a bare email, `@mention`, `#12` and `owner/repo#12`, and `GH-12`, tokens that touch sharing one span. A bare commit SHA and `owner/repo@sha` stay live. A `command` renders in a backtick-safe
code span. Links render only from `link` facts and a `recording` fact's `url`, or its `url_or_path` or `archive_path` on a `linked-private` fact. A recording is therefore a path, or on a `linked-private` fact a plain link to a non-image page, and never an embedded image: only a screened fact produces a live link, and media
belongs to the recording record.

## Links and credentials

**Host rule.** A link fact's `url` is http(s) only, and its host must be the local base URL host or the
`dev-base-url` host. Hosts compare by hostname, ignoring port. A `recording` link gets the credential screen and the non-image rule with no host rule, since a recording may live on any host, and renders live only when `decideExposure` returned `linked-private`. A refused one renders `(recording url refused)`, and one refused for a credential, a bearer-shaped path segment included, renders `recording withheld: link contained a credential-shaped value`.

**Bearer-shaped path segments.** The bearer-segment rule binds `link` facts as well as recording links: a path segment of 20 or more of `[A-Za-z0-9_-]`, with a digit and a letter in it, is refused on any host. A UUID-keyed or dated-slug path on an allowed host therefore renders `(link refused: credential in path segment)`, and the Try it block still names the route. A link the gather refused has no fact, so its refusal reads `{N} link(s) refused: {id} (credential in path segment)`.

**Credential keys:** `token`, `access_token`, `password`, `passwd`, `secret`, `session`, `sessionid`, `jwt`, `auth`, `key`, `api_key`, `sig`, `signature`, `x-amz-signature`.

**In a URL**, the keys are matched in the query, the fragment and the userinfo, case-insensitive after
percent-decoding, so `?TOKEN=` and `?tok%65n=` both refuse. Decoding is per escape run, tolerating a stray
`%`. A query inside a fragment (`#/cb?token=abc`) and nested keys in a query (`?next=/cb?token=abc`) are
screened. A benign path such as `/docs/token-guide` is not. A key counts as a whole word, as the last
word of a compound (`authToken`, `clientSecret`, `v2token`, `CLIENTSECRET`), or in brackets
(`token[]=`, `token[sub]=`, `user[password]=`), as described under **In text**.

**In text.** The same constant screens every `command` string, every claim's text in any section, each
observation-plan line, and all other free text that renders: a `reason`, decision and deploy
text, a refused reason and a partial note. The Recording section redacts its text instead (`## Recording`). Decision Q2 sets a minimum, and a secret on this public
surface is the spec's anti-goal. Matching is also
case-insensitive after percent-decoding: `tok%65n=`, or `100% tok%65n=` with a stray `%` beside it. The shapes:

- `{key}=` or `{key}:`, with `-` and `_` ignored in the key and counting as a boundary before it:
  `session_id=`, `apikey=`, `GITHUB_TOKEN=`.
- A quoted JSON key: `"token":`.
- The flag `--{key}`, followed by end, whitespace or `=`, the same way and behind a hyphenated prefix:
  `--api-key`, `--client-secret`.
- The header `Authorization:`.
- URL userinfo in text: `https://user:pass@example.com`.

A key is a whole word or the last word of a compound, and a word break is a `-` or `_`, a change from
lowercase to uppercase (`authToken`, `APIToken`), a change between letters and digits (`v2token`), or the
start of an all-caps key at the end of an all-caps word (`CLIENTSECRET`), so `_authToken=` and
`curl --authToken abc` match. A key also matches inside brackets, with the brackets skipped: `token[]=`,
`token[sub]=`, `user[password]=`. A lowercase word that merely contains a key, with no such break,
is no match: `monkey=`, `keyboard=`, `author=`, `tokenizer=`. The screen over-matches on purpose,
so `?sort_key=name` and an all-caps `MONKEY=` are dropped too.

`monkey=1`, `/docs/token-guide` and `acceptance-packet.js --help` are not matches. A match
drops that entry, and its omission is stated by id or key, never its text, and the packet still posts:

- A command link goes to `refused` with the reason `credential key in command: {key}`.
- A claim goes to `screened`, whatever its section, and so does an observation-plan line. A line
  following a dropped line that ends in a backslash, and any more deeply indented line under a dropped
  line, goes with it, since a key often leaves its value there. The screened line names each match by section and key:
  `{N} entries omitted for credential-shaped content: Test guide (password); Observation plan (token)`,
  or `1 entry omitted` in the singular. `render --dropped-out` holds the same section and key.
- A `reason` renders `(reason withheld: credential-shaped)` and its row stays, so the row count holds.
- Any other free text renders `(text withheld: credential-shaped)`.
- A fact id or refused id renders `(id withheld: credential-shaped)` and its row stays. Inside a claim's
  citation list a withheld id renders without a second pair of parentheses: a claim whose only citation
  is withheld reads `(id withheld: credential-shaped)`, a mixed list reads
  `(id withheld: credential-shaped, \`story:x\`)`. Validation is unchanged: a withheld id stays citable.

**Credentials in the Test guide** appear only as vault entry names: a step that needs a login names the
entry to use, never its value.

**Unverified links (Decision Q7).** Each Test-guide link carries
`(link unverified: deploy not confirmed live)` only when the deploy target is `dev` and the feature is not
confirmed live; a `local` target's links carry none. The Deploy status section still states the target.

## Recording

**Source of frames.** The recording is an animated GIF built from the step screenshots the pipeline's own happy-path stories already wrote to their `SCREENSHOT_PATH` directories. No new browser run, and the recording step never starts a server. Negative stories are excluded, so error screens never enter it. Video is out of scope.

**Local base URL.** A recording needs the base URL the story run itself was given, whose host is `localhost`, `127.0.0.1` or `::1`. Nothing auto-detects a server.

**Storage and exposure.** The GIF is stored in the run's local directory and never uploaded, in any repository visibility, and the Recording line names that path and, on a `once archived:` line, where it moves. The packet never embeds the recording or any screenshot in any repository visibility: no markdown image syntax and no `img` tag. A remote store is allowed later only if it enforces authenticated collaborator access, proven by an anonymous-fetch probe that fails; secret gists and Actions artifacts of a public repository do not qualify. Exposure values:

- `local-only` — the v1 default, and the result for any unreachable or unprobed store.
- `linked-private` — a remote store that passed the probe.
- `withheld` — a link the credential rule refused.

**Redaction.** Every string the section renders from a recording fact, its text, captions, link label and failure message, passes `renderRecordingSection`, applied at one choke point. Redaction keeps the key name and replaces the whole value, so `api_key=sk_live_1` becomes `api_key=[redacted]`. The placeholder renders `[redacted]`, the raw comment holds the fixed token, and its escaped opener means a line can never become a link reference definition. Over what no rule removed the credential screen still runs, so a shape the redactor misses renders `(text withheld: credential-shaped)`. A non-zero count renders as `redacted values: {n}` and does not change the exposure, which is already the strictest that applies. Redaction is text only and cannot scan pixels: the stored GIF is unredacted and local-only, and stories must run against seed data and throwaway credentials. A local path the credential screen or the redactor would change renders the withheld line; the bearer-segment rule does not bind a plain local path, so a run id or a dated slug stays. A fact id the redactor would change renders `(id withheld: credential-shaped)` in the section and in its Couldn't test row. A blank value renders nothing, and a blank `label` falls to `text`.

**The not-recorded fact.** `{ id, kind: 'recording', status: 'not-run', reason }`, with `reason` one of `no-story`, `no-local-base-url`, `no-happy-path-screenshots` or `encoder-failed`. The first renders plain `not recorded` only. The other three also appear under Couldn't test, since a recording was expected and impossible, and a failure message renders on its own line. `checkFact` refuses a `not-run` recording with any other reason.

**The link rule.** A link is live only from a store that passed the probe, on the screens of `## Links and credentials`; a link to an image is refused, and a link with a credential-shaped value renders `recording withheld: link contained a credential-shaped value`. A `url_or_path` or `archive_path` opening with a `scheme://` meets those link rules whatever its exposure.

## Facts-poor and infra items

**Commands-only surfaces:** `infra`, `backend`.

On one of them the Test guide lists commands and renders no links, and a `url` link is refused with
`infra surface lists commands, not links`.

An item with few facts still posts. Every section states its one line, the partial note states what the
gather could not read, and nothing is filled in by guesswork.

## Size

The packet is capped at 60,000 characters. Truncation omits whole items, from the longest section first,
and states `truncated: N items omitted`. Notes are never omitted, so a section can end on
`all items omitted by truncation`. When the notes alone exceed the cap no drop can meet it, so every item
stays. A packet still over the cap is not posted (`## Pipeline`).

## Old brief section map

| Old section | Packet section |
|---|---|
| The ask | What changed |
| What shipped | What changed |
| Confirmed | Test guide and Tried to break |
| Observation plan | Test guide (rendered as the `### Observation plan` appendix `/claude-tweaks:demo` walks) |
| The Try it block | Test guide |

## Failure contract

When the post or edit of a packet fails, the pending label is not added and any existing one, in either
spelling, is removed: `demo:pending` or `accept:pending`. Labels are read first and only labels present are
removed, so an absent label never fails the step. A stale packet is never left under a pending label. The
failure report names the stale packet (`stalePacket`) and states what happened to the label (`labelRemoval`:
`removed`, `absent` or `failed`); a failed removal is reported as failed, never as cleared.

On the MCP transport a re-run that finds an existing packet is one such failed edit: no pending acceptance
label is applied, nothing is posted, and an existing label is removed the same way (Decision Q4). A failed
`add_issue_comment` is another.

A failed comment read or an unreadable existing packet makes no write calls: neither is a failed post or
edit. A label that fails to apply after the packet landed leaves the packet in place and reports the failure.
