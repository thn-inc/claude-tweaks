const path = require('node:path');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'residue.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

module.exports = { CLI, REPO_ROOT };
