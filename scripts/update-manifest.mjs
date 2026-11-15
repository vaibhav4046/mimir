// Recompute size + SHA-256 for every file pinned in public/release-manifest.json.
// Run after editing any pinned file: npm run manifest
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'public/release-manifest.json');
const raw = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(raw);
let changed = 0;
for (const art of manifest.artifacts) {
  const buf = fs.readFileSync(path.join(root, art.path));
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha256 !== art.sha256 || buf.length !== art.bytes) {
    art.sha256 = sha256;
    art.bytes = buf.length;
    changed += 1;
    console.log(`updated ${art.path}`);
  }
}
if (changed) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
console.log(changed ? `${changed} entr${changed === 1 ? 'y' : 'ies'} updated` : 'manifest already current');
