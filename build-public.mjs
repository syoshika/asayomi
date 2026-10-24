import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, 'dist-public');
// Explicit allowlist: documentation, generators and temporary files never enter a deployment.
const files = ['index.html', '404.html', '_headers', 'css/style.css', 'js/app.js', 'js/storage.js'];
for (const file of files) {
  const source = join(root, file);
  if (!existsSync(source) || !statSync(source).isFile() || lstatSync(source).isSymbolicLink()) {
    throw new Error(`Required public file is missing or not a regular file: ${file}`);
  }
  if (!realpathSync(source).startsWith(realpathSync(root) + sep)) throw new Error('Source escapes project');
}
// Only the generated, fixed-name folder directly beneath this project may be replaced.
if (dirname(out) !== resolve(root) || out === resolve(root)) throw new Error('Unsafe output path');
if (existsSync(out)) {
  if (lstatSync(out).isSymbolicLink() || realpathSync(out) !== join(realpathSync(root), 'dist-public')) {
    throw new Error('Refusing to replace redirected output folder');
  }
  rmSync(out, { recursive: true });
}
mkdirSync(out);
for (const file of files) {
  const destination = join(out, file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, file), destination);
}
function collect(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? collect(join(dir, e.name), prefix + e.name + '/') : [prefix + e.name]);
}
if (JSON.stringify(collect(out).sort()) !== JSON.stringify([...files].sort())) throw new Error('Unexpected public files');
console.log(`Public build verified: ${files.length} allowlisted files in dist-public/`);
