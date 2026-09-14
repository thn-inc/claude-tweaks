// tests/issue-claims-pr-scan-composition.test.js — pins the citation-resolves fix (#1992)
// for plugin/skills/_shared/github-pr-scan.md and plugin/skills/_shared/issue-claims.md:
// every unconditional citation of a labeled item/step must find that label present in
// every resolved-`transport` composition, not just the one branch it was written next to.
// Composes through compose-context/compose.js's own `compose` so a fence that moves back
// (re-fencing a cited label) goes red here, the way flow-manifesto-composition.test.js does
// for the manifesto's mode markers.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compose, KEYS, VOCAB, UNRESOLVED } = require('../plugin/bin/lib/compose-context/compose');

const PR_SCAN_FILE = 'plugin/skills/_shared/github-pr-scan.md';
const CLAIMS_FILE = 'plugin/skills/_shared/issue-claims.md';
const prScanContent = fs.readFileSync(path.join(__dirname, '..', PR_SCAN_FILE), 'utf8');
const claimsContent = fs.readFileSync(path.join(__dirname, '..', CLAIMS_FILE), 'utf8');

// The file composed at `transport`, every other condition pinned to its first vocabulary
// value. `sourceContent` defaults to the real file; the discrimination tests pass a
// doctored copy through the same composition path.
function bundleFor(file, transport, sourceContent) {
  const conditions = Object.fromEntries(KEYS.map((key) => [key, key === 'transport' ? transport : VOCAB[key][0]]));
  return compose([{ path: file, content: sourceContent }], conditions);
}

function presence(bundle, strings) {
  return Object.fromEntries(strings.map((s) => [s, bundle.includes(s)]));
}

// -- github-pr-scan.md ------------------------------------------------------

const ITEM9_LABEL = '9. **Unarmed ready PR**';
const ITEM9_BODY_ONLY = 'PR_SCAN_UNARMED'; // occurs only inside item 9's fenced body — verified below
const TRIAGE_ITEM3 = '3. **Auto-merged this week**';
const ITEM4_LABEL = '4. **Merged/closed PRs with local remnants**';
const PR_BACKED_BULLET = '- **PR-backed items**';
const ITEM1_LABEL = '1. **PR lookup**';
// The last sentence of item 9's label paragraph — the discrimination test closes its doctored
// fence right after it, so it must exist verbatim or the doctoring is a silent no-op.
const ITEM9_LABEL_PARAGRAPH_END = 'no local run-dir join, so this check works from a fresh sandbox exactly like every other item here.';

test('github-pr-scan.md: ITEM9_BODY_ONLY occurs only inside item 9\'s fenced body in the raw file', () => {
  // grep -c PR_SCAN_UNARMED plugin/skills/_shared/github-pr-scan.md -> 12 matching lines, all
  // between the item-9 fence markers; this pins the fixture choice, not just asserts it once.
  // (The mcp composition test below is what proves "inside the fence": any occurrence outside a
  // transport=gh fence would survive into the mcp bundle and fail it.)
  const matchingLines = prScanContent.split('\n').filter((line) => line.includes(ITEM9_BODY_ONLY)).length;
  assert.equal(matchingLines, 12, 'fixture assumption: PR_SCAN_UNARMED matching-line count changed — pick a new item-9-only string');
  assert.ok(prScanContent.includes(ITEM9_LABEL_PARAGRAPH_END), 'fixture assumption: the discrimination test\'s fence-close anchor is no longer in the file verbatim');
});

test('github-pr-scan.md under mcp: item 9\'s label survives, its fenced body does not, and the other cited labels survive', () => {
  const bundle = bundleFor(PR_SCAN_FILE, 'mcp', prScanContent);
  assert.deepEqual(
    presence(bundle, [ITEM9_LABEL, ITEM9_BODY_ONLY, TRIAGE_ITEM3, ITEM4_LABEL, PR_BACKED_BULLET, ITEM1_LABEL]),
    {
      [ITEM9_LABEL]: true,
      [ITEM9_BODY_ONLY]: false,
      [TRIAGE_ITEM3]: false,
      [ITEM4_LABEL]: true,
      [PR_BACKED_BULLET]: true,
      [ITEM1_LABEL]: true,
    },
  );
});

test('github-pr-scan.md under gh and under unresolved transport: every cited label and item-9\'s body are present', () => {
  for (const transport of ['gh', UNRESOLVED]) {
    const bundle = bundleFor(PR_SCAN_FILE, transport, prScanContent);
    assert.deepEqual(
      presence(bundle, [ITEM9_LABEL, ITEM9_BODY_ONLY, TRIAGE_ITEM3, ITEM4_LABEL, PR_BACKED_BULLET, ITEM1_LABEL]),
      {
        [ITEM9_LABEL]: true,
        [ITEM9_BODY_ONLY]: true,
        [TRIAGE_ITEM3]: true,
        [ITEM4_LABEL]: true,
        [PR_BACKED_BULLET]: true,
        [ITEM1_LABEL]: true,
      },
      `mismatch under transport=${transport}`,
    );
  }
});

test('discrimination: re-fencing item 9\'s label under transport=gh goes red under mcp', () => {
  const doctored = prScanContent.replace(
    ITEM9_LABEL,
    `<!-- when: transport=gh -->\n${ITEM9_LABEL}`,
  ).replace(
    // close the fence right after the label's own paragraph, before its (still-fenced) body fence opens
    ITEM9_LABEL_PARAGRAPH_END,
    `${ITEM9_LABEL_PARAGRAPH_END}\n<!-- /when -->`,
  );
  assert.notEqual(doctored, prScanContent, 'doctoring was a no-op — an anchor literal drifted');
  const bundle = bundleFor(PR_SCAN_FILE, 'mcp', doctored);
  assert.equal(bundle.includes(ITEM9_LABEL), false, 'the fixture must actually strip item 9\'s label under mcp');
});

// -- issue-claims.md ----------------------------------------------------------

const GH_CLI_BULLET = '- **gh CLI:**';
const MCP_BULLET = '- **MCP:**';
const REPAIR_STEP1 = '1. Read the blob at';
const ISSUE_COMMENT_CMD = 'gh issue comment "$ISSUE"';
const MIRROR_MCP_FORM = '`add_issue_comment` with the issue number';
const WRAPPER_EXTRACT_JQ = "jq -r '.content'";
const MCP_NO_WRAPPER_SENTENCE = 'nothing to extract';
// The end of repair step 1 — the discrimination test closes its doctored fence right after it.
const REPAIR_STEP1_END = 'This step never depends on the content parsing.';

test('issue-claims.md: REPAIR_STEP1 and ISSUE_COMMENT_CMD literals exist in the raw file', () => {
  assert.ok(claimsContent.includes(REPAIR_STEP1), 'fixture assumption: "1. Read the blob at" not found verbatim');
  assert.ok(claimsContent.includes(ISSUE_COMMENT_CMD), 'fixture assumption: gh issue comment "$ISSUE" not found verbatim');
  assert.ok(claimsContent.includes(REPAIR_STEP1_END), 'fixture assumption: the discrimination test\'s fence-close anchor is no longer in the file verbatim');
});

test('issue-claims.md under gh: gh-only bullets present, mcp-only bullets absent, repair step 1 and the comment command present, the jq extraction stays, no MCP mirror form', () => {
  const bundle = bundleFor(CLAIMS_FILE, 'gh', claimsContent);
  assert.deepEqual(
    presence(bundle, [GH_CLI_BULLET, MCP_BULLET, REPAIR_STEP1, ISSUE_COMMENT_CMD, WRAPPER_EXTRACT_JQ, MIRROR_MCP_FORM, MCP_NO_WRAPPER_SENTENCE]),
    { [GH_CLI_BULLET]: true, [MCP_BULLET]: false, [REPAIR_STEP1]: true, [ISSUE_COMMENT_CMD]: true, [WRAPPER_EXTRACT_JQ]: true, [MIRROR_MCP_FORM]: false, [MCP_NO_WRAPPER_SENTENCE]: false },
  );
});

test('issue-claims.md under mcp: mcp-only bullets present, gh-only bullets and the gh comment command absent, repair step 1 present, the add_issue_comment mirror form present, no unqualified wrapper-object instruction', () => {
  const bundle = bundleFor(CLAIMS_FILE, 'mcp', claimsContent);
  assert.deepEqual(
    presence(bundle, [GH_CLI_BULLET, MCP_BULLET, REPAIR_STEP1, ISSUE_COMMENT_CMD, WRAPPER_EXTRACT_JQ, MIRROR_MCP_FORM, MCP_NO_WRAPPER_SENTENCE]),
    { [GH_CLI_BULLET]: false, [MCP_BULLET]: true, [REPAIR_STEP1]: true, [ISSUE_COMMENT_CMD]: false, [WRAPPER_EXTRACT_JQ]: false, [MIRROR_MCP_FORM]: true, [MCP_NO_WRAPPER_SENTENCE]: true },
  );
});

test('discrimination: re-fencing repair step 1 under transport=mcp goes red under gh', () => {
  const doctored = claimsContent.replace(
    REPAIR_STEP1,
    `<!-- when: transport=mcp -->\n${REPAIR_STEP1}`,
  ).replace(
    REPAIR_STEP1_END,
    `${REPAIR_STEP1_END}\n<!-- /when -->`,
  );
  assert.notEqual(doctored, claimsContent, 'doctoring was a no-op — an anchor literal drifted');
  const bundle = bundleFor(CLAIMS_FILE, 'gh', doctored);
  assert.equal(bundle.includes(REPAIR_STEP1), false, 'the fixture must actually strip repair step 1 under gh');
});
