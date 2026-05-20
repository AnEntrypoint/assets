#!/usr/bin/env node
// Walks ./baked and emits manifest.baked.json — same shape as manifest.json
// (category -> [{name, path, thumb, baked}]) but augmented with `baked` = the
// path to the progressive root GLB (./baked/output_<basename>/model.progressive.glb).
// Entries whose raw .glb didn't bake are simply omitted from the baked array.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, 'manifest.json');
const bakedDir = path.join(root, 'baked');

const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
const streamingDir = path.join(root, 'streaming');
const sourceDir = existsSync(streamingDir) ? streamingDir : bakedDir;
const sourceLabel = sourceDir === streamingDir ? 'streaming' : 'baked';
const bakedDirs = new Set((await readdir(sourceDir)).filter((d) => d.startsWith('output_')));

const out = {};
let hit = 0, miss = 0;
for (const [cat, items] of Object.entries(raw)) {
  out[cat] = [];
  for (const item of items) {
    const base = path.basename(item.path, path.extname(item.path));
    const dirName = `output_${base}`;
    const ok = bakedDirs.has(dirName) && existsSync(path.join(sourceDir, dirName, 'model.progressive.glb'));
    if (ok) {
      hit++;
      out[cat].push({
        name: item.name,
        path: item.path,
        thumb: item.thumb,
        baked: `${sourceLabel}/${dirName}/model.progressive.glb`,
      });
    } else {
      miss++;
    }
  }
}
await writeFile(path.join(root, 'manifest.baked.json'), JSON.stringify(out));
console.log(`[manifest.baked] source=${sourceLabel} ${hit} baked, ${miss} unbaked (omitted), ${Object.keys(out).length} categories`);
