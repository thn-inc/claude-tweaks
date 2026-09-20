---
record: 626
origin: capture
risk: low
size: low
ceremony: fast-lane
grants: [build, merge]
surface: backend
---
# 626: github-pr-scan.md:29 passes {owner}/{repo} to gh api graphql with -f — static string, placeholders never substitute, query returns repository:null

Surface: backend

## Current State

`plugin/skills/_shared/github-pr-scan.md` line 29 issues a `gh api graphql` review-thread query with `-f owner='{owner}' -f repo='{repo}' -F pr={number}`. `gh api -f` sends the field value as a static string, so the `{owner}`/`{repo}` placeholders are never substituted — verified live during #608, where the identical defect in `record-creation.md`'s databaseId lookup produced `Could not resolve to a Repository with the name '{owner}/{repo}'` under `-f`, and resolved correctly under `-F`. The same line already uses `-F` for `pr`, making the inconsistency visible on one line. Two consumers read this query's result: `/claude-tweaks:tidy` and `/claude-tweaks:help`'s PR scans (item 9's green-check filter) — both iterate a `repository: null` GraphQL response as if it were real data, since the query silently returns null instead of erroring.

## Deliverables

- [ ] Change `github-pr-scan.md` line 29's two flags from `-f owner='{owner}' -f repo='{repo}'` to `-F owner={owner} -F repo={repo}` (drop quotes — `-F` is the already-resolved-value mechanism, per the `gh-api-module-pattern` skill's -f/-F distinction).
- [ ] Add a repo-wide prose-pin test asserting no `gh api graphql` line in any skill file passes `-f owner=` or `-f repo=` with a brace placeholder — the same defect class #608 pinned for `record-creation.md`, widened to every skill file.

## Acceptance Criteria

1. `plugin/skills/_shared/github-pr-scan.md` line 29 uses `-F owner={owner} -F repo={repo}` (no quotes around the value).
2. A new `node --test` case fails on any `gh api graphql` invocation across `plugin/skills/**/*.md` that passes `-f owner=`/`-f repo=` with an unsubstituted `{owner}`/`{repo}` placeholder, and passes on the current (fixed) corpus.
3. `npm test` passes with the new test included.

## Technical Approach

This is the same defect class #608 already fixed once in `record-creation.md` — `-f` sends a literal string while `-F` resolves shell/env values, so a placeholder like `{owner}` used with `-f` is passed through verbatim instead of being substituted. The fix is a one-line flag swap; the pin test generalizes #608's existing single-file assertion into a repo-wide sweep.

### Key Files

- `plugin/skills/_shared/github-pr-scan.md` — swap `-f owner=`/`-f repo=` to `-F owner=`/`-F repo=` on the review-thread query line
- `tests/` — add the repo-wide `-f owner=`/`-f repo=` placeholder pin test

## Gotchas

- Follow the `gh-api-module-pattern` skill's -f vs -F distinction exactly: `-F` for already-resolved values, `-f` only for static strings — never generalize one to the other.
- Scope the new pin test's grep/regex to `gh api graphql` lines specifically carrying a brace placeholder (`{owner}`, `{repo}`) after `-f`, not every `-f` usage in the corpus, or it will false-positive on legitimate static-string `-f` flags elsewhere.

## Original request

github-pr-scan.md:29 passes {owner}/{repo} to gh api graphql with -f — static string, placeholders never substitute, query returns repository:null

**Related:** #608 (the same -f/-F placeholder defect, found and fixed in record-creation.md's databaseId lookup by #608's final review)

Context: `skills/_shared/github-pr-scan.md` line 29's review-thread query uses `-f owner='{owner}' -f repo='{repo}' -F pr={number}`. `gh api -f` adds a static string; only `-F` fills the `{owner}`/`{repo}` placeholders in a field value (verified live during #608: `-f` → `Could not resolve to a Repository with the name '{owner}/{repo}'`; `-F` → correct). The line already uses `-F` for `pr`, so the inconsistency is visible in one line. Consumers: /tidy and /help PR scans (item 9's green-check filter) — the jq then iterates over null.

Scope: change the two flags to `-F owner={owner} -F repo={repo}` (drop the quotes), and add a repo-wide prose-pin test that no `gh api graphql` line passes `-f owner=` / `-f repo=` with a brace placeholder — the same class of pin #608 added for record-creation.md, widened to every skill file.
