import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
async function inspect(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') await inspect(path);
    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', join(root, path)], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
    }
  }
}
await inspect('');
const html = await readFile(join(root, 'public/index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="\/([^"#]+)"/g)) await access(join(root, 'public', match[1]));
console.log('JavaScript syntax and local HTML asset references: PASS');
