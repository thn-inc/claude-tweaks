# Feedback — The `--upstream` Draft-Only Path

Referenced by `skills/feedback/SKILL.md`'s routing paragraph after Step 2. Read only when
`--upstream <value>` was passed; an invocation without the flag never reads this file.

**This path drafts; it never publishes.** Step 7 (Confirm) and Step 8 (File) do not run here.
Nothing is created, commented on, or labelled in any repository, and this skill's filing CLI is
never invoked — the human is the filer. Being inside a pipeline changes none of that, and `auto`
mode does not silence this path, the same stance `SKILL.md`'s Component-Skill Contract already
takes on Steps 6 and 7.

Entered with Step 1's gathered material (summary, affected component, title, and either repro
steps plus expected-vs-actual, or a use case) and Step 2's `defect`/`gap` kind already in hand.
Steps A-E below stand in for `SKILL.md`'s Steps 3-9.

## Step A: Self-target guard and normalization

This file is the **sole home** of `--upstream`'s normalization and its compare against
claude-tweaks. `SKILL.md`'s routing paragraph dispatches on the flag's presence only and never
grows its own copy.

**Empty value.** `--upstream` with nothing after it is a hard error. Stop and report, verbatim:

```
'--upstream' needs a value: an owner/name slug, a GitHub URL, or the dependency's name
```

**Resolvable forms.** Strip one trailing `/` if present, then one trailing `.git` if present,
then match the remainder against:

| Form | Example |
|---|---|
| `owner/name` | `vercel-labs/agent-browser` |
| `github.com/owner/name` | `github.com/vercel-labs/agent-browser` |
| `https://github.com/owner/name` | `https://github.com/thomasholknielsen/claude-tweaks` |
| `git@github.com:owner/name` | `git@github.com:ThomasHolkNielsen/claude-tweaks` |

`owner` and `name` are each exactly one segment of `[A-Za-z0-9._-]` characters. A value carrying a
third path segment, a query string, or a fragment is **not** resolvable. Lower-case both segments;
the normalized result is always `owner/name`.

**Self-target.** When the normalized slug equals `thomasholknielsen/claude-tweaks`, this learning
is not third-party at all. Say so — "`--upstream {the raw value}` names claude-tweaks itself;
filing normally" — and **return to `SKILL.md` Step 3**, which then runs unchanged through Step 9.
Nothing below this line runs. This is neither an error nor a draft.

**Unresolved target.** Any other non-empty value is an **unresolved target**, never an error: the
classifier could name the dependency but not its repository (`agent-browser`, `superpowers`), or
the dependency has no GitHub repository at all. This is the expected common case when the value
came from `/claude-tweaks:intake` or `/claude-tweaks:reflect` rather than a typed flag. The path
continues, with exactly three differences, stated once here:

- **U1.** Step E's hand-off renders the literal placeholder `<owner/name>` where the slug would go.
- **U2.** Step B's dedup search is skipped, with a one-line note saying why.
- **U3.** Step D's header comment records `target: unresolved ({the raw value})`.

**One question, only in `interactive` mode.** Before Step D persists anything, resolve mode per
`_shared/auto-mode-contract.md`. **`interactive`** (the default for a standalone invocation with no
pipeline mode signal): ask exactly one `AskUserQuestion`: `question: "Which GitHub repository owns
\`{the raw value}\`?"`, `header: "Upstream"`, `multiSelect: false`, options `I don't know — keep
the placeholder (Recommended)` plus `Other`, where the human types an `owner/name` slug. A typed
slug re-enters the normalization above, self-target check included. This is the path's only
question: there is no confirm gate here, because there is nothing to confirm.

**`auto`/`confirm`/`hybrid`, and any headless invocation** (a scheduled Routine or a `claude -p`
run, resolved from session state, never a hard-coded literal): this is not a HARD-GATE and carries
no row in the contract's "does NOT silence" list, so its strict rule applies — skip the question
and keep the placeholder instead of asking. When `$PIPELINE_RUN_DIR` is set, additionally log one
`STAGED` entry per `auto-mode-contract.md`'s Skill integration pattern (stage path:
`staged/upstream-draft-{N}.md`) so the unresolved target surfaces at the Review Console rather than
vanishing silently.

## Step B: Dedup — retargeted, read-only, advisory

An unresolved target skips this step (U2): say so in one line — "no repository to search; search
their tracker yourself before pasting" — and go to Step C. Otherwise:

```bash
gh issue list --repo <owner/name> --search '<component>' --state all --limit 10 --json number,title,state,url
```

`<component>` is the affected component name **only** — their component name as the learning names
it — and never the free-text symptom or summary, which is draft-derived text that has not yet
passed Step D's scrub criteria. That is `SKILL.md` Step 4's privacy constraint, and it transfers
here unchanged: nothing draft-derived is sent to a public search API before the scrub gate runs.

This is a coarse screen in a tracker whose conventions this skill cannot know, so both irrelevant
matches and missed duplicates are accepted costs. It is **advisory only**: render any matches as
context under the heading "Search their tracker first — possible related issues", and never stop
on one. Judging whether an existing thread really is the same bug is the human's call, not this
skill's. A failed search — transient or not — attaches its reason in one line and the path
continues; there is no retry loop, because nothing downstream depends on the result.

## Step C: Draft — the adapted template

Title: `<component>: <symptom>`, formed exactly as `SKILL.md` Step 5 forms it.

Body:

```
**Summary:** <one line>

**Kind:** Defect | Gap

**Affected component:** <their component, as the learning names it>

**Repro steps:** (defect only)
1. ...

**Expected vs. actual:** (defect only)
Expected: ...
Actual: ...

**Use case:** (gap only)
<what you were trying to do and why their current behavior does not support it>

**Environment:** <a version string — only when the learning text itself states one>
```

`SKILL.md` Step 5's `**Objective:**`, `**Measurement:**`, `**Cost this session:**`,
`**Definition:**`, and `**Plugin version:**` lines, its `Filed via /claude-tweaks:feedback.`
footer, and its `<!-- fingerprint: <marker> -->` marker are all **dropped**. Every one of them is
claude-tweaks-internal bookkeeping that means nothing in someone else's tracker, and the
fingerprint marker specifically drives this repo's own dedup-on-refile check, which never runs on
this path.

Emit `**Environment:**` only when the learning text itself states a version. This skill performs
no version lookup against the dependency; with no version stated, omit the line entirely rather
than guessing or writing "unknown".

Honoring the target's issue template, and judging whether a Discussion is the better venue than an
issue, stay with the human — they are judgments this skill cannot make.

## Step D: Scrub, then persist

**Scrub first, unchanged.** Run `SKILL.md` Step 6 exactly as written: the same removal criteria,
the same unconditional posture, and the same `[Use: Capable]` singleton Task dispatch. This path
reuses that one dispatch; it never adds a second. The gate is if anything more load-bearing here
than on the filing path — a draft a human pastes leaks a credential exactly as well as one a CLI
files.

**If the learning cannot survive the scrub, stop.** `SKILL.md` Step 6's hard stop applies here in
full: write nothing to disk, report that the learning is unfileable as-is, and hand it back.
Everything below runs only on the scrubbed body.

**`--dry-run`.** Render the scrubbed draft and Step E's hand-off block, then stop without
persisting: no file is written, and the hand-off leaves `<absolute path>` as a placeholder.
`SKILL.md`'s `--dry-run` precedence rule is untouched by this path.

**Where the file goes.** Resolve the run directory per `_shared/pipeline-run-dir.md`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir
```

- **Exit 0 — a run directory resolved.** Write the scrubbed body to a scratch file whose name ends
  in `.md` — `stage-item.js` derives the persisted file's extension from the scratch file's own
  extension, never from `--id` — then stage it as `staged/upstream-draft-{N}.md` through the
  sanctioned writer:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "<the resolved run dir>" --id upstream-draft-{N} --file <scratch path>
  ```

  `{N}` is 1 plus the highest `{N}` already present among that run's `staged/upstream-draft-*.md`
  files, or `1` when there are none. `stage-item.js` creates a per-item path, so no lock is
  needed. It echoes the written absolute path on stdout; report **that** path, not the `--run`
  input string, which can differ from it after realpath resolution.
- **`stage-item.js` exits 3.** The run directory is missing, or it is a worktree-local shadow rather than an
  anchored main-checkout path (`_shared/pipeline-run-dir.md`'s Anchoring section, `[IL-127]`).
  Fall back to the scratch path below and report why. Never hand-write into a worktree-local
  shadow to work around this.
- **`resolve-run-dir` exits non-zero.** No run directory at all — the ordinary case, since this
  skill is commonly invoked standalone. Fall back to the scratch path below, silently; this is
  not a degradation worth reporting.

**Scratch fallback**, per `_shared/session-tmp-root.md` — substitute the current UTC timestamp for
`{YYYYMMDDTHHMMSS}` before running:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" UPSTREAM_DRAFT=feedback-upstream-draft-{YYYYMMDDTHHMMSS}.md)"
```

Write the scrubbed body to `$UPSTREAM_DRAFT` with the Write tool and report that absolute path. A
timestamp replaces `{N}` here because the session directory has no other writer to number against.

**The name is load-bearing.** `upstream-draft-{N}.md` sits deliberately outside the
`staged/wrap-up-upstream-*.md` glob that `wrap-up/review-console.md` and
`flow/multispec-review-console.md` both scan, so a stop-and-resume never re-enumerates a hand-off
draft as a fresh filing proposal — the same constraint `SKILL.md` Step 8's `upstream-unfiled-{N}.md`
fallback already observes. It also sits outside `/claude-tweaks:tidy`'s `staged/upstream-unfiled-*`
backstop glob, by design: a drafted-but-never-pasted report is a courtesy that outlives the
session, not a tracked item that resurfaces.

**File header.** The persisted file opens with one comment line, then the scrubbed body verbatim
and nothing else:

```
<!-- upstream-draft: {owner/name, or "unresolved ({the raw value})"} | {defect|gap} | drafted {ISO date} -->
```

so a later reader can tell target and kind without the session that produced it.

## Step E: Report — the hand-off

Report three things, in this order: the absolute path the draft was written to, the command, and
the web fallback.

```
gh issue create --repo <owner/name> --title '<title>' --body-file <absolute path>

Web: https://github.com/<owner>/<name>/issues/new  (paste the body from <absolute path>)
```

**Substitution.** `<owner/name>`, `<owner>`, and `<name>` take Step A's normalized slug — or stay
literal for an unresolved target (U1), for the human to fill in. `<absolute path>` is Step D's
reported path. `<title>` is Step C's title, **single-quoted, with every embedded `'` replaced by
the four-character sequence `'\''`** — close the quote, escape one literal apostrophe, reopen the
quote. That is the one form under which backticks, `$(...)`, `;`, and `&&` inside a title are inert
in every POSIX shell, and the hazard is real precisely because a human runs this command in their
own shell. A title of `it's $(rm -rf x)` renders as `'it'\''s $(rm -rf x)'` and creates an issue
titled literally `it's $(rm -rf x)`.

The body travels via `--body-file`, never inlined: `gh` has no `--title-file`, so the title must be
inlined and escaped as above, while the body has no such constraint and gains nothing from the
risk.

**Never render a prefilled URL.** `https://github.com/.../issues/new?title=&body=` truncates
silently past a length limit that real bodies routinely exceed, and a silently truncated body is
worse than a manual paste.

Close by saying, in one line, that the draft is the human's to send and that nothing was published.

`## Next Actions` renders per `SKILL.md`'s Component-Skill Contract — omitted inside a pipeline —
and never offers a command that files anything anywhere.
