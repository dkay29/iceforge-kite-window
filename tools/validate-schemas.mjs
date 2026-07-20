import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const dir = path.resolve('schemas');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
const validators = new Map();
for (const file of files) {
  const schema = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  validators.set(file, ajv.compile(schema));
  console.log(`valid schema: ${file}`);
}

// Config documents that must validate against a given schema.
const documentsBySchema = {
  'spot.schema.json': ['backend/src/config/spots/west-dennis-beach-ma.json'],
};

let hasDocumentErrors = false;
for (const [schemaFile, documentPaths] of Object.entries(documentsBySchema)) {
  const validate = validators.get(schemaFile);
  if (!validate) {
    throw new Error(`No compiled schema found for ${schemaFile}`);
  }
  for (const documentPath of documentPaths) {
    const document = JSON.parse(fs.readFileSync(path.resolve(documentPath), 'utf8'));
    const valid = validate(document);
    if (!valid) {
      hasDocumentErrors = true;
      console.error(`invalid document: ${documentPath} against ${schemaFile}`);
      console.error(validate.errors);
    } else {
      console.log(`valid document: ${documentPath} against ${schemaFile}`);
    }
  }
}

if (hasDocumentErrors) {
  process.exitCode = 1;
}
