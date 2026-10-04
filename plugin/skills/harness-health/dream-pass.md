# Dream Pass — cross-session self-healing (#2691)

A nightly-shaped, corpus-wide pass over this account's own Claude Code session transcripts,
distinct from this skill's own per-target audit above: it looks for tool-call failures whose
signature repeats across **two or more independent sessions** rather than judging one target
against the codebase. Prototype scope (the record's own Technical Approach): a new, narrow pass
rather than folded into the main `/harness-health` audit loop, since the evidence-bar requirement
(two independent sessions, quoted turns) is a different shape of check than anything else in this
skill.

## Safety model (structural, not just documented)

- **Read-only over the transcript corpus.** The scan (`plugin/bin/lib/dream/scan.js`) only ever
  calls `readdirSync`/`statSync`/`readFileSync` against session JSONL files — nothing in it writes
  back to a transcript.
- **Propose-only, enforced by what the tool can write at all.** The CLI
  (`plugin/bin/dream-scan.js`) has exactly three write paths: the two already-sanctioned run-dir
  writers this project uses everywhere else (`bin/stage-item.js`'s `writeStagedItem`,
  `bin/log-decision.js`'s `appendEntry` — both confined to the `--run-dir` the caller passes) and
  its own `report.md`, written at a fixed path under that same run dir. There is no flag or code
  path that accepts an arbitrary output path, so this tool cannot reach CLAUDE.md or any
  `plugin/skills/**/*.md` file even on a bug — mirrors `_shared/staged-patch.md`'s existing
  staged-proposal pattern (propose, never apply) rather than reinventing a new one.
- **The two-session evidence bar is a hard floor in code**, not a configurable default:
  `filterByEvidenceBar` clamps any `minSessions` argument up to `MIN_SESSIONS_FLOOR` (2), and the
  CLI's `--min-sessions` flag rejects (exit 2) any value below that floor outright. A pattern that
  repeated twice within a single session, but never in a second independent session, is dropped —
  verified by `tests/bin-lib/dream/scan.test.js`'s "single-session anomaly... is EXCLUDED" test,
  which first confirms the pattern really was found (ruling out a false-negative from missing
  data) and then confirms the evidence-bar filter still drops it.
- **Scope is this account's own session history only** — `{config-dir}/projects/*/*.jsonl`, where
  `config-dir` defaults to `$CLAUDE_CONFIG_DIR` (falling back to `~/.claude`) — never widened to
  another account's transcripts on a shared machine. Every transcript-derived field — the quoted
  command, the error excerpt, the grouping signature's error line, and a Bash command's leading
  verb — passes through one `redact()` (`bin/lib/dream/scan.js`) before it reaches a staged
  proposal, `report.md`, or `decisions.md`: absolute paths become `<path>`, and well-known
  credential shapes (`Authorization`/`Bearer`/`Basic` values, `NAME=value` and `--name value`
  where NAME contains TOKEN/SECRET/PASSWORD/API_KEY/ACCESS_KEY/PRIVATE_KEY/CREDENTIAL, and
  GitHub/`sk-`/Slack/AWS-key-id token prefixes) become `<secret>`. Secret redaction is
  pattern-based and best-effort — it over-redacts rather than under-redacts, and a credential of
  an unrecognized shape can still appear, so review a proposal before copying its evidence into a
  committed file. Quoted excerpts are then truncated (command to 200 chars, error text to 300).

## Running it

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug dream-standalone --create
node "${CLAUDE_PLUGIN_ROOT}/bin/dream-scan.js" --run-dir "{printed-run-dir}" [--window-days 14] [--min-sessions 2] [--max-proposals 10] [--config-dir <dir>]
```

`--window-days` bounds the scan to a sliding recent window (default 14) — the record's own
Technical Approach: "not the full corpus unbounded." Each qualifying pattern is staged as
`staged/dream-proposal-{n}.md` (collision-safe allocation, same as every other staged proposal in
this project) and logged as one `STAGED` entry in `decisions.md`; a `report.md` at the run dir root
always summarizes the pass, including the (normal, expected) zero-proposals outcome.

## Reviewing proposals

Each staged file is a self-contained writeup: the pattern, the evidence-bar count, up to three
quoted sessions (session id, timestamp, truncated command, truncated error), and an explicit
reminder that nothing has been applied. A human reviews the quoted evidence, decides whether it
represents a real, generalizable mistake worth documenting, and — if so — makes that documentation
edit themselves (a CLAUDE.md Don'ts entry, a skill's Gotchas note, or a new auto-memory file). A
rejected proposal needs no action; the staged file can be deleted or left for the next cleanup
pass, since it was never applied anywhere.

## Not yet wired to a Routine

Unlike this skill's own `routine-template.yml`, the dream pass has no scheduled-Routine template
yet — it is invoked by hand per the CLI above. A future iteration can add one once the pattern
library above has been used enough to tune `--window-days`/`--min-sessions` defaults for this
project's actual session cadence.
