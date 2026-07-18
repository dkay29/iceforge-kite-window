import fs from 'node:fs';
const files = fs.readdirSync('github-issues').filter((f) => /^\d+.*\.md$/.test(f)).sort();
for (const file of files) {
  const first = fs.readFileSync(`github-issues/${file}`, 'utf8').split('\n')[0];
  console.log(`${file}: ${first.replace(/^# /, '')}`);
}
