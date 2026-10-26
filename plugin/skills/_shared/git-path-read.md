# Git Path-List Reads

The rule for any `plugin/bin` code that reads a git path list: `--name-only`, `--name-status`, `ls-tree --name-only`, `diff-tree --name-only`, `log --name-only` / `log --name-status`, `ls-files`, full-format `ls-tree`, `--numstat` (diff/log/show), and `status --porcelain`. Pass `-z` and split the output on NUL, never on newlines. Pass `--end-of-options` before any ref, range, or sha (a `-- <pathspec>` tail still follows the ref).

- **Why `-z`:** without it, `core.quotepath` (on by default) C-quotes any path with a non-ASCII byte, a tab, or a newline — `docs/café.txt` prints as `"docs/caf\303\251.txt"`, a string no file matches, so the path is silently dropped.
- **Why `--end-of-options`:** without it, a dash-leading ref is parsed as an option. Not `--`, which flips git into pathspec mode (`gh-api-module-pattern` skill, flag-injection bullet).

## Reference implementations

- `plugin/bin/lib/verify/changed-files.js` — `diff --name-status -z` and `diff --name-only -z --no-renames`.
- `plugin/bin/lib/compose-subject.js` — `diff --name-only -z --end-of-options <range>`; its `gh pr diff --name-only` call is the one non-git exemption (the `gh` CLI has no `-z`).

## Parsers

`plugin/bin/lib/git-z.js` exports `splitNul` (verbatim NUL tokens), `parseNameStatusZ` (`STATUS\0path\0`, two paths for `R`/`C`), `splitLogZ` (a `log -z --format=<header>` stream), `parseNumstatZ`, `parseStatusPorcelainZ` (a rename lists the new path first), and `parseLsTreeZ`. `git log -z` puts one leading `\n` on the first path (or status) token of each commit that lists any files; an empty commit's header is followed directly by the next header. `splitLogZ` strips the `\n` before testing for a header. `runGit`/`runGitAsync` (`plugin/bin/lib/hooks/git-exec.js`) trim stdout by default; a `-z` reader passes `{ raw: true }` so a leading-space first path survives.

A patch's `diff --git` headers have no `-z`, so they stay C-quoted: `unquoteCPath` decodes one, and `plugin/bin/lib/design-detect/surface-lines.js` applies it.

## Exempt reads

A read that never turns git's output into a path — emptiness, an exit code, display, or counts for a caller-named path — carries `// git-path-read: not a path list (<reason>)` at the end of the same line instead of `-z`. `wrap-up/facts.js`'s `-U0` scan is not a path read (it matches `-#` lines only).

## Pinned by

`tests/git-path-read-conformance.test.js`: every `'--name-only'` / `'--name-status'` argv line in `plugin/bin` also carries `'-z'` on the same line, and so does a `git ... --name-only` template string passed straight to an exec-named call (`backlog.js`). So does every `'ls-files'` / `'ls-tree'` / `'--numstat'` argv line and every `'status'` line carrying `'--porcelain'` (or `'--porcelain=v1'` / `'--porcelain=v2'`) or the short form `'-s'` / `'--short'` (and their exec template strings), unless it carries the exemption marker. The marker also waives the `--end-of-options` check below. Every `--name-only`/`--name-status` line, every `'ls-tree'` line, and every `--numstat` line under `diff`/`log`/`show` also carries `'--end-of-options'`, except the two readers that take no ref: `pre-tool-use.js` (the staged index) and `freshness.js` (a pathspec-only log). Every `runGit(` / `runGitAsync(` line that passes `'-z'` also carries `raw: true`, because runGit's default trim would strip a leading space from the first NUL-delimited path.

## Not covered yet

`git worktree list --porcelain` readers (raw, but newline-delimited), `blame --line-porcelain`, and argv arrays split across lines, which a line-based pin cannot see.
