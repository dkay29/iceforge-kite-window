import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const dir = path.resolve('schemas');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
for (const file of files) {
  const schema = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  ajv.compile(schema);
  console.log(`valid: ${file}`);
}
