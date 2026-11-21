import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pairs = [['.env.local.example', '.env.local'], ['backend/.env.example', 'backend/.env']];
if (pairs.some(([, target]) => existsSync(new URL(target, root)))) {
  console.error('Configuration already exists. No files changed. Edit your existing environment files to reconfigure.');
  process.exit(1);
}
const key = randomBytes(40).toString('hex');
for (const [source, target] of pairs) {
  const text = readFileSync(new URL(source, root), 'utf8').replace(/^((?:API_KEY|RELAY_API_KEY)=).*$/m, (_match, prefix) => `${prefix}${key}`);
  writeFileSync(fileURLToPath(new URL(target, root)), text, { mode: 0o600, flag: 'wx' });
}
console.log('Created .env.local and backend/.env with a shared random key and owner-only permissions.');
console.log('Run npm run backend in one terminal and npm run dev in another.');
console.log('The test clip works without yt-dlp; see README.md for YouTube setup.');
