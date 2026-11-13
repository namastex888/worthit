#!/usr/bin/env node
// worthit's one version, numbered as Automagik numbers its releases: each release is 0.N (semver 0.N.0,
// tagged v0.N.0), N one above the highest release tag. Nobody types a version: merging a pull request
// into dev cuts the next one (.github/workflows/release.yml).
//
//   node scripts/version.mjs check            every field carries the package.json version; exit 1 when not
//   node scripts/version.mjs set <version>    write it everywhere
//   node scripts/version.mjs next             the next release: 0.(highest v0.N.0 + 1).0, 0.1.0 first
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAJOR = 0;
export const VERSION = /^0\.(0|[1-9]\d{0,3})\.0$/;
export const RELEASE_TAG = /^v0\.(0|[1-9]\d*)\.0$/;
// every file and JSON path that carries the version
export const FIELDS = [
  { file: 'package.json', path: ['version'] },
  { file: 'package-lock.json', path: ['version'] },
  { file: 'package-lock.json', path: ['packages', '', 'version'] },
];

const read = file => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
const at = (value, path) => path.reduce((node, key) => (node == null ? undefined : node[key]), value);

export const drift = version => FIELDS.flatMap(({ file, path }) => { const v = at(read(file), path); return v === version ? [] : [`${file}:${path.join('.') || '.'} = ${String(v)}`]; });

export function setVersion(version) {
  if (!VERSION.test(version)) throw new Error(`not a version: ${version} (want ${MAJOR}.N.0)`);
  for (const file of new Set(FIELDS.map(f => f.file))) {
    const json = read(file);
    for (const f of FIELDS.filter(c => c.file === file)) at(json, f.path.slice(0, -1))[f.path.at(-1)] = version;
    writeFileSync(join(ROOT, file), JSON.stringify(json, null, 2) + '\n');
  }
}

// the release after the highest v0.N.0 in tags (0.1.0 when there is none); other tags are ignored
export const nextVersion = tags => `${MAJOR}.${Math.max(0, ...tags.map(t => RELEASE_TAG.exec(t)?.[1]).filter(n => n !== undefined).map(Number)) + 1}.0`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, arg] = process.argv.slice(2), root = read('package.json').version;
  if (command === 'check') {
    const problems = drift(root);
    for (const p of problems) console.error(`version: ${p}, not ${root}`);
    if (problems.length) process.exit(1);
    console.log(`version: ${root} everywhere`);
  } else if (command === 'set' && arg) { setVersion(arg); console.log(`version: ${arg}`); }
  else if (command === 'next') console.log(nextVersion(execFileSync('git', ['tag', '--list', `v${MAJOR}.*`], { cwd: ROOT, encoding: 'utf8' }).split('\n')));
  else { console.error('usage: node scripts/version.mjs check | set <version> | next'); process.exit(2); }
}
