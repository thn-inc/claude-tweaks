# Git Path-List Reads

The rule for any `plugin/bin` code that reads a git path list: `--name-only`, `--name-status`, `ls-tree --name-only`, `diff-tree --name-only`, `log --name-only` / `log --name-status`. Pass `-z` and split the output on NUL, never on newlines. Pass `--end-of-options` before any ref, range, or sha (a `-- <pathspec>` tail still follows the ref).

- **Why `-z`:** without it, `core.quotepath` (on by default) C-quotes any path with a non-ASCII byte, a tab, or a newline — `docs/café.txt` prints as `"docs/caf\303\251.txt"`, a string no file matches, so the path is silently dropped.
- **Why `--end-of-options`:** without it, a dash-leading ref is parsed as an option. Not `--`, which flips git into pathspec mode (`gh-api-module-pattern` skill, flag-injection bullet).

## Reference implementations

- `plugin/bin/lib/verify/changed-files.js` — `diff --name-status -z` and `diff --name-only -z --no-renames`.
- `plugin/bin/lib/compose-subject.js` — `diff --name-only -z --end-of-options <range>`; its `gh pr diff --name-only` call is the one non-git exemption (the `gh` CLI has no `-z`).

## Parsers

`plugin/bin/lib/git-z.js` exports `splitNul` (verbatim NUL tokens), `parseNameStatusZ` (`STATUS\0path\0`, two paths for `R`/`C`), and `splitLogZ` (a `log -z --format=<header>` stream). `git log -z` puts one leading `\n` on the first path (or status) token of each commit that lists any files; an empty commit's header is followed directly by the next header. `splitLogZ` strips the `\n` before testing for a header.

## Pinned by

`tests/git-path-read-conformance.test.js`: every `'--name-only'` / `'--name-status'` argv line in `plugin/bin` also carries `'-z'` on the same line, and so does a `git ... --name-only` template string passed straight to an exec-named call (`backlog.js`). Every such argv line also carries `'--end-of-options'`, except the two readers that take no ref: `pre-tool-use.js` (the staged index) and `freshness.js` (a pathspec-only log).

## Not covered yet

`--numstat`, `ls-files`, and `status --porcelain` readers — same quoting hazard, no sweep or pin yet. Also unswept: the full-format `ls-tree` readers in `plugin/bin/lib/health-core/durable-state.js` and `plugin/bin/lib/issues/claims-git-cas.js`, and the `diff -U0` patch-header parsing in `plugin/bin/lib/wrap-up/facts.js`.
