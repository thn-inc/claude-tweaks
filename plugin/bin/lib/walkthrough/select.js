// plugin/bin/lib/walkthrough/select.js — pure story selection for /claude-tweaks:walkthrough's
// `#N` resolution path (#2758). No gh/fs reads: the skill parses the record body and the story
// YAML files itself and hands both in as plain data.
'use strict';

function matchedByLabel(bySourceFiles, byJourney) {
  if (bySourceFiles && byJourney) return 'source_files+journey';
  if (bySourceFiles) return 'source_files';
  return 'journey';
}

function selectStories({ recordKeyFiles = [], recordJourneys = [], storyFiles }) {
  const keyFileSet = new Set(recordKeyFiles);
  const journeySet = new Set(recordJourneys);
  const matches = [];
  for (const file of storyFiles) {
    for (const story of file.stories) {
      const bySourceFiles = Array.isArray(story.source_files) && story.source_files.some((f) => keyFileSet.has(f));
      const byJourney = story.journey && journeySet.has(story.journey);
      if (!bySourceFiles && !byJourney) continue;
      matches.push({ path: file.path, id: story.id, matchedBy: matchedByLabel(bySourceFiles, byJourney) });
    }
  }
  return matches;
}

module.exports = { selectStories };
