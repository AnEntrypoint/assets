// Generate the unified assets manifest from the cluster-LOD corpus.
//
// Walks the git-tracked streaming-cluster/*.cluster.glb files and emits
// manifest.json = { <Category>: [ { name, path, thumb } ] }, the single source of
// truth consumed by the streaming-gltf demo and the spoint editor model picker
// (both fetch it from the assets GitHub Pages host).
//
// Filenames are `streaming-cluster/<Category>__<base>.cluster.glb`. Category is
// the prefix before `__`; the human name is derived from <base> (strip hash/vN
// suffixes, spacify, title-case). Thumbnails live at thumbs/<path>.png.
//
//   node docs/gen-manifest.js            # writes ./manifest.json
//   node docs/gen-manifest.js <outPath>  # writes to <outPath>

const { execSync } = require('child_process');
const fs = require('fs');

const out = process.argv[2] || 'manifest.json';

function humanize(base) {
  return base
    .replace(/_[a-f0-9]{8}_v\d+$/, '')
    .replace(/_v\d+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const files = execSync('git ls-files "streaming-cluster/*.cluster.glb"')
  .toString().trim().split('\n').filter(Boolean);

const manifest = {};
for (const path of files) {
  const file = path.split('/').pop(); // Category__base.cluster.glb
  const stem = file.replace(/\.cluster\.glb$/, '');
  const sep = stem.indexOf('__');
  const category = sep >= 0 ? stem.slice(0, sep) : 'Misc';
  const base = sep >= 0 ? stem.slice(sep + 2) : stem;
  const thumb = `thumbs/${path.replace(/\.glb$/, '.png')}`;
  (manifest[category] ||= []).push({ name: humanize(base), path, thumb });
}
for (const cat of Object.keys(manifest)) manifest[cat].sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(out, JSON.stringify(manifest));
console.log(`[gen-manifest] ${files.length} models -> ${out} (${Object.keys(manifest).length} categories)`);
