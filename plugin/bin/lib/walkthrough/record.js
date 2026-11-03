// plugin/bin/lib/walkthrough/record.js — which screenshots become the acceptance packet's
// walkthrough GIF, why none do, and where that GIF can be read from (#4612). Frames come from
// the happy-path stories' own step screenshots: this never starts a server or a browser.
//
// Pure: `listFrames` is injected, and nothing here spawns or reads a file.
'use strict';

const path = require('path');
const { planFrames } = require('./encode');
const { NEGATIVE_ID_PREFIX } = require('../wrap-up/packet-gather');

const RECORDING_FILE = 'walkthrough.gif';
const FRAME_WIDTH = 960;
const BUDGET_BYTES = 8 * 1024 * 1024;

const NO_STORY = 'no-story';
const NO_LOCAL_BASE_URL = 'no-local-base-url';
const NO_SCREENSHOTS = 'no-happy-path-screenshots';

const PASSING_STATUSES = new Set(['PASS', 'PASS_WITH_CAVEATS']);
const FRAME_NAME_RE = /^\d+_(.+)\.png$/;
const RAW_FRAME_SUFFIX = '-raw.png';
// `URL.hostname` keeps the brackets on an IPv6 address.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const PIPELINES_PREFIX = '.claude-tweaks/pipelines/';
const ARCHIVE_SEGMENT = 'archive/';

const notRun = (reason) => ({ status: 'not-run', reason });

function isLocalBaseUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// [] for a directory that names no frames or will not list. The caller reads that as a story
// with no recording, so one story's gap never becomes a partial GIF.
function storyFrames(dir, listFrames) {
  if (typeof dir !== 'string' || dir === '') return [];
  let names;
  try {
    names = [...listFrames(dir)];
  } catch {
    return [];
  }
  return names
    .filter((name) => FRAME_NAME_RE.test(name) && !name.endsWith(RAW_FRAME_SUFFIX))
    .sort()
    .map((name) => ({ file: path.join(dir, name), caption: FRAME_NAME_RE.exec(name)[1] }));
}

// The reason order is the contract: no story to record comes before no local url, and that
// before no screenshots. A report expected but not read counts as no screenshots, not no story.
function planRecording({
  report, qaExpected, storyIndexLost, storyIndex, listFrames,
}) {
  if (!Array.isArray(report?.stories)) return notRun(report || qaExpected ? NO_SCREENSHOTS : NO_STORY);
  const index = new Map((storyIndex ?? []).map(({ id, negative }) => [id, negative]));
  const isNegative = (story) => typeof story?.id === 'string' && (story.id.startsWith(NEGATIVE_ID_PREFIX) || index.get(story.id) === true);
  const happy = report.stories.filter((story) => !isNegative(story));
  if (happy.length === 0) return notRun(NO_STORY);
  if (!isLocalBaseUrl(report.base_url)) return notRun(NO_LOCAL_BASE_URL);
  // A story the index does not list could be a tag-only negative, so its screens could be errors.
  if (storyIndexLost || happy.some((story) => !index.has(story?.id))) return notRun(NO_SCREENSHOTS);

  const passing = happy.filter((story) => PASSING_STATUSES.has(story.status));
  const perStory = passing.map((story) => storyFrames(story.screenshot_dir, listFrames));
  // A gap mid-story reads as a whole story once the captions renumber, so fewer frames than steps
  // records nothing. More is fine, since Setup steps screenshot too, and an older report has no count.
  const hasGap = (frames, at) => frames.length === 0
    || (Number.isInteger(passing[at].steps_total) && frames.length < passing[at].steps_total);
  if (perStory.length === 0 || perStory.some(hasGap)) return notRun(NO_SCREENSHOTS);
  const frames = perStory.flat();
  return {
    status: 'ready',
    text: `Walkthrough of ${passing.map((story) => story.name || story.id).join(', ')}`,
    frames: frames.map(({ file }) => file),
    captions: frames.map(({ caption }) => caption),
  };
}

// What `encodeWalkthrough` takes for these frames.
function encodeSpec(framePaths) {
  return {
    framePaths,
    delays: planFrames(framePaths.length).map(({ delayCs }) => delayCs),
    width: FRAME_WIDTH,
    budgetBytes: BUDGET_BYTES,
  };
}

// An absolute path starts a token, or fills a quote and may then hold spaces. Everything after
// a bare path's last separator stays with the text, so `/a/b.png:` keeps its colon.
const PATH_ROOT = '(?:[A-Za-z]:)?[\\\\/]';
const TOKEN_START = '(?<![^\\s\'"`(=,\\[<])';
const QUOTED_PATHS = ['"', "'", '`'].map((quote) => `${quote}${PATH_ROOT}[^${quote}\\r\\n]*${quote}`);
const PATH_RE = new RegExp(`${QUOTED_PATHS.join('|')}|${TOKEN_START}${PATH_ROOT}[^\\s'"\`]*`, 'g');
const isSeparator = (char) => char === '/' || char === '\\';
const isQuote = (char) => char === '"' || char === "'" || char === '`';

// A token of separators alone has no last segment and stays. Walked by hand, not `[\\/]+$`,
// which restarts at every separator of a long run.
function lastSegment(token) {
  let end = token.length;
  while (end > 0 && isSeparator(token[end - 1])) end -= 1;
  const start = Math.max(token.lastIndexOf('/', end - 1), token.lastIndexOf('\\', end - 1)) + 1;
  return token.slice(start, end) || token;
}

function scrubPaths(message) {
  return message.replace(PATH_RE, (match) => (
    isQuote(match[0]) ? `${match[0]}${lastSegment(match.slice(1, -1))}${match[0]}` : lastSegment(match)
  ));
}

// The same two locations from either one, so a gather after archiving names what a gather
// before it did. Forward slashes in, forward slashes out.
function recordingLocations(relPath) {
  if (!relPath.startsWith(PIPELINES_PREFIX)) return { live: relPath, archived: relPath };
  const inPipelines = relPath.slice(PIPELINES_PREFIX.length);
  const tail = inPipelines.startsWith(ARCHIVE_SEGMENT) ? inPipelines.slice(ARCHIVE_SEGMENT.length) : inPipelines;
  return { live: `${PIPELINES_PREFIX}${tail}`, archived: `${PIPELINES_PREFIX}${ARCHIVE_SEGMENT}${tail}` };
}

module.exports = {
  RECORDING_FILE, planRecording, encodeSpec, scrubPaths, isLocalBaseUrl, recordingLocations,
};
