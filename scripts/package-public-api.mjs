import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const stage = resolve(root, '.deployment', 'public-vector', 'api-package');
if (existsSync(stage)) throw new Error('API staging directory already exists; preserve it and choose a fresh release directory.');
const args = ['ls', '--workspace=@app/public-api', '--omit=dev', '--all', '--parseable'];
const graph = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd: root, encoding: 'utf8' })
  : spawnSync('npm', args, { cwd: root, encoding: 'utf8' });
if (graph.status !== 0) throw new Error('Installed production dependency graph is invalid.');
const sourceLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'packages', 'public-api', 'package.json'), 'utf8'));
const packages = { '': { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies, engines: manifest.engines } };
const entries = [];
for (const absolute of graph.stdout.trim().split(/\r?\n/)) {
  const path = relative(root, absolute).split(sep).join('/');
  if (!path || path === 'node_modules/@app/public-api') continue;
  const entry = sourceLock.packages[path];
  if (!path.startsWith('node_modules/') || !entry || entry.link || entry.dev) {
    throw new Error(`Unexpected production dependency: ${path}`);
  }
  packages[path] = entry;
  entries.push([absolute, path]);
}
mkdirSync(stage, { recursive: true });
for (const [absolute, path] of entries) cpSync(absolute, resolve(stage, path), { recursive: true });
cpSync(resolve(root, 'packages', 'public-api', 'server.mjs'), resolve(stage, 'server.mjs'));
writeFileSync(resolve(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(stage, 'package-lock.json'), `${JSON.stringify({
  name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages,
}, null, 2)}\n`);
console.log(`Staged ${entries.length} locked production dependencies; no private workspace artifacts included.`);
