#!/usr/bin/env node
'use strict';
/* Builds the static GitHub Pages site into _site/ (or the directory given as the first argument). */
const fs = require('node:fs');
const path = require('node:path');
const E = require('../lib/electricity');
const {buildSummary} = require('./summary');

const root = path.resolve(__dirname, '..');
const out = path.resolve(root, process.argv[2] || '_site');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(out, file)), {recursive: true}); fs.writeFileSync(path.join(out, file), text); };
const copy = file => { fs.mkdirSync(path.dirname(path.join(out, file)), {recursive: true}); fs.copyFileSync(path.join(root, file), path.join(out, file)); };

function standalone(html) {
  const css = read('assets/atlas.css');
  const scripts = [read('lib/electricity.js'), read('assets/atlas.js')]
    .map(code => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>').join('\n');
  const icon = 'data:image/svg+xml,' + encodeURIComponent(read('assets/mark.svg'));
  return html.replace('<link rel="stylesheet" href="assets/atlas.css">', '<style>\n' + css + '\n</style>')
    .replace(/<script src="(?:lib\/electricity|assets\/atlas)\.js" defer><\/script>/g, '')
    .replaceAll('assets/mark.svg', icon)
    .replace('</body>', () => scripts + '\n</body>');
}

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
for (const file of ['index.html', 'explore.html', 'lib/electricity.js', 'data/events.json']) copy(file);
for (const file of fs.readdirSync(path.join(root, 'assets'), {recursive: true})) {
  if (fs.statSync(path.join(root, 'assets', file)).isFile()) copy(path.join('assets', file));
}
const hasAddresses = fs.existsSync(path.join(root, 'data', 'addresses.json'));
if (hasAddresses) copy('data/addresses.json');

const archive = E.importData(JSON.parse(read('data/events.json')), 'events.json');
const summary = buildSummary(archive, hasAddresses ? JSON.parse(read('data/addresses.json')) : null);
write('data/summary.json', JSON.stringify(summary));

// Old addresses of the local dashboard keep working.
const explore = read('explore.html');
write('electricity_dashboard.html', explore);
write('electricity_dashboard_standalone.html', standalone(explore));
write('.nojekyll', '');

console.log('Built ' + path.relative(root, out) + ': ' + summary.groups.length + ' subgroups (' + summary.counts.active + ' active, ' +
  summary.counts.off + ' off), observed until ' + summary.observedUntil);
