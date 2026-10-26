# Banned guard shapes (frozen fixture, #4028)

One `bash` fence per detector id in `tools/guard-refusals/shapes.js`. The id is
the `##` heading above each fence; `tests/guard-refusals/shapes.test.js` asserts
the scan flags exactly that id for the fence.

## complete-token

```bash
gh run list --status complete
```

## git-env-var-subst

```bash
MY_GIT_SHA=abc echo $(date)
```

## github-url-with-var

```bash
gh pr view "https://github.com/o/r/pull/7" --json body --template "$TPL"
```

## gh-jq-pipe-chained

```bash
gh pr view 2 --json comments --jq '.comments[] | .body'; echo exit=$?
```

## git-text-redirect-var

```bash
printf '%s' '{"note":"git log is empty"}' > "$RUN/ctx.json"
```

```bash
# a digit count
echo 3 > "$RUN/count.txt"
```

## git-in-substitution

```bash
SHA=$(git rev-parse HEAD)
```

## git-var-operand

```bash
WT="$(pwd)"
git -C "$WT" status --short
```

## node-eval-script-var-with-git

```bash
git log -1 --format=%H | node -e "require('$ROOT/bin/lib/read.js')"
```

## node-git-text

```bash
node -e 'require("child_process").execFileSync("git", ["status"])'
```

```bash
node - <<'EOF'
// read the git index
EOF
```

## sed-var-path

```bash
sed -n '1,20p' "$WT/README.md"
```

## node-var-script

```bash
node "$ROOT/bin/verify.js" --stamp-status
```

## node-eval-computed-arg

```bash
node -e 'console.log(process.argv[1])' "$HOME"
```

## graphql-multivar-mutation

```bash
gh api graphql -f query='mutation($id:ID!,$body:String!){ addComment(input:{subjectId:$id,body:$body}){ clientMutationId } }' -f id=1 -f body=x
```

## eval-token

```bash
eval "$(node /abs/bin/env.js)"
```

## gh-computed-input

```bash
cat > "$TMPDIR/body.md" <<'EOF'
Body text.
EOF
gh issue comment 9 --body-file "$TMPDIR/body.md"
```

```bash
N="$(node /abs/bin/resolve.js --value n.txt)"
gh issue view "$N" --repo o/r --json title
```

```bash
B="$(node /abs/bin/resolve.js --value b.json)"
gh api repos/o/r/issues --input - < "$B"
```

## chained-heredoc-write

```bash
cd /abs/wt && cat > notes.txt <<'EOF'
line
EOF
```

## test-string-compare

```bash
test main = main
```

## backslash-space

```bash
cat /Users/me/My\ Docs/a.md
```
