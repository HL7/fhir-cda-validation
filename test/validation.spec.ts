import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as validator from 'cda-schematron-validator';
import { differenceWith } from "lodash";


describe('Validate the generated schematron', () => {
  const schematrons = readdirSync('output', { withFileTypes: true }).filter(f => !f.isDirectory() && f.name.endsWith('.sch')).map(f => f.name.slice(0, -4));
  const testFiles: Record<string, string[]> = {};
  
  if (schematrons.length === 0) {
    console.warn('No .sch files detected in output directory. Cannot validate anything!');
  }
  for (const dir of readdirSync('validation', { withFileTypes: true }).filter(f => f.isDirectory())) {
    if (!schematrons.includes(dir.name)) {
      console.warn(`No ${dir.name}.sch file found, so files in the ${dir.name} directory will not be validated.`);
      continue;
    }
    const sampleFiles = readdirSync(path.join('validation', dir.name)).filter(f => f.endsWith('.xml'));
    if (sampleFiles.length === 0) {
      console.warn(`No xml files found in ${dir.name}. Nothing to validate.`);
    } else {
      testFiles[dir.name] = sampleFiles.map(f => path.join('validation', dir.name, f));
    }
  }

  for (const ig of Object.keys(testFiles)) {
    describe(`Validating ${ig} samples`, () => {
      // const schema = path.join('output', `${ig}.sch`);
      let schema = readFileSync(path.join('output', `${ig}.sch`), 'utf-8');

      // Lazy method since cda-schematron-validator doesn't handle variables, and I can't work on that right now
      const matches = Array.from(schema.matchAll(/<let name="(\w+)" value="('[^'"]+')"\/>/g));
      for (const variable of matches) {
        schema = schema.replaceAll(`$${variable[1]}`, variable[2]);
      }

      for (const testFile of testFiles[ig]) {
        describe(`Validating ${testFile}`, () => {
          const xml = readFileSync(testFile, 'utf-8');
          const expected = collectExpectedErrorsAndWarnings(xml);
          validator.clearCache();
          const results = validator.validate(xml, schema, { includeWarnings: true });

          it('should not have any unknown unsupported tests', () => {
            expect(results.ignored, JSON.stringify(results.ignored, null, 2)).to.be.empty;
          });

          if (expected.errors.length === 0) {
            it('should have no errors', () => {
              expect(results.errors, JSON.stringify(results.errors, null, 2)).to.be.empty;
            });
          } else {
            const missingErrors = differenceWith(expected.errors, results.errors, (expected, actual) => actual.description.includes(expected));
            const unexpectedErrors = differenceWith(results.errors, expected.errors, (actual, expected) => actual.description.includes(expected));
            it(`should have ${expected.errors.length} expected errors`, () => {
              expect(missingErrors, missingErrors.join('\n')).to.be.empty;
            });
            it('should not have any unexpected errors', () => {
              expect(unexpectedErrors, JSON.stringify(unexpectedErrors, null, 2)).to.be.empty;
            });
          }

          if (expected.warnings.length > 0) {
            const missingWarnings = differenceWith(expected.warnings, results.warnings, (expected, actual) => actual.description.includes(expected));
            it(`should find ${expected.warnings.length} expected warnings`, () => {
              expect(missingWarnings, missingWarnings.join('\n')).to.be.empty;
            });
          }
        });
      }
    });
  }
});

/**
 * Parse through XML and collect any comment that starts with e: or w: 
 * @param xml 
 * @returns 
 */
function collectExpectedErrorsAndWarnings(xml: string) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const expectedMessages = Array.from(xml.matchAll(/\n\s*(?:<!--)?\s*(e|w):([^\n]+)/gi))
  for (const message of expectedMessages) {
    let search = message[2].trim();
    if (search.endsWith('-->')) search = search.slice(0, -3).trim();
    if (message[1].toLowerCase() === 'e') errors.push(search);
    if (message[1].toLowerCase() === 'w') warnings.push(search);
  }
  return {
    errors,
    warnings
  };
}