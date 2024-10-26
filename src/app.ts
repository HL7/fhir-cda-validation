#!/usr/bin/env node
import { logger, noticeLogs as notices, errorLogs as errors } from "./utils/logger";
import { sch } from "./model";
import { StructureDefinition } from "./processing/structureDefinition";
import { loadDefs } from "./utils/definitions";
import { mkdir, writeFile } from "fs/promises";
import { isEqual, merge, mergeWith, uniqWith } from "lodash";
import { voc } from "./processing/terminology";
import { InvalidOptionArgumentError, program } from "commander";
import { config, updateConfigFromOptions } from "./processing/config";

let inputIg: string = '';

program
  .name('fhir-cda')
  .description('FHIR/CDA Schematron Generator')
  .usage('<ig> [options]')
  .argument(
    '[ig]',
    'implementation guide to process (pass . to generate schematron for IG in the current directory)'
  )
  .option(
    '-d, --dependency <dependency...>',
    'additional dependencies to be loaded using format dependencyId@version'
  )
  .option(
    '-t, --terminology-server <url>',
    'terminology server to use for expanding value sets (set to x to disable)',
    'https://tx.fhir.org/r5/'
  )
  .option(
    '-l, --value-set-limit <number>',
    'maximum number of values to include in value set lookups',
    (value) => {
      const parsedInt = parseInt(value, 10);
      if (isNaN(parsedInt) || parsedInt < 0) {
        throw new InvalidOptionArgumentError('Value-set limit must be a positive integer')
      }
      return parsedInt;
    },
    500
  )
  .option(
    '-tId --template-id <oid>',
    'templateId root for unrecognized templateId warning',
  )
  .option(
    '-p --profile <string>',
    'process only a single profile (useful for testing)'
  )
  .action(arg => inputIg = arg)
  .parse();

const options = program.opts();

if (!inputIg) {
  logger.warn('No IG specified; using C-CDA 3.0 by default', { silent: true });
  inputIg = 'hl7.cda.us.ccda@3.0.0';
  if (!options.templateId) {
    options.templateId = '2.16.840.1.113883.10.20.22';
  }
}

inputIg = inputIg.replace('@', '#');  // either works for loadDeps; but only # works for finding the IGs
updateConfigFromOptions(options, inputIg);

if (!Array.isArray(options.dependency)) {
  options.dependency = [];
}

if (options['terminologyServer'] && options['terminologyServer'].toLowerCase() !== 'x') {
  voc.setServerUrl(options['terminologyServer']);
} else {
  logger.warn('No terminology server provided; external value sets will not be expanded');
}

const printFailingInvariants = false;
let processedTemplates = false;
const excludedProfiles: fhir5.StructureDefinition[] = [];

const dependencies = [inputIg, ...options.dependency];
async function main() {
  const deps = await loadDefs(dependencies);

  const packageId = config.igPackage;
  const ig: fhir5.ImplementationGuide = deps.allImplementationGuides(packageId)[0];

  const unhandledInvariants: Record<string, fhir5.ElementDefinitionConstraint[]> = {};
  const schematron = new sch.Schematron();

  const profiles = deps.allProfiles(packageId.replace('@', '#')) // allProfiles only wants #
    .filter((p) => options.profile ? p.name === options.profile : true);
  
  if (profiles.length === 0) {
    logger.error(options.profile ? `Profile ${options.profile} not found in ${packageId}` : 'No profiles found to process');
    process.exit(0);
  }

  const subProfiles: fhir5.StructureDefinition[] = [];
  const subProfileContexts: Record<string, string[]> = {};

  // Note - not doing promise.all, since the only async thing is TX requests, and we want those done in series
  for (const sd of profiles) {
    const processingResult = await new StructureDefinition(sd).process();
    if (processingResult.isSubTemplate) {
      subProfiles.push(sd);
      continue;
    }
    processedTemplates = true;
    if (processingResult.errorPattern) schematron.addErrorPattern(processingResult.errorPattern);
    if (processingResult.warningPattern) schematron.addWarningPattern(processingResult.warningPattern);
    mergeWith(unhandledInvariants, processingResult.unhandledInvariants, (o, s) => Array.isArray(o) ? o.concat(s) : o);
    mergeWith(subProfileContexts, processingResult.subProfileContexts, (o, s) => Array.isArray(o) ? o.concat(s) : o);
  };

  if (!processedTemplates) {
    logger.error('No CDA templates with templateId fields and identifiers found in the IG.');
    process.exit(0);
  }

  logger.info('Processing sub-profiles');
  for (const sd of subProfiles) {
    const context = subProfileContexts[sd.url];
    if (!context) {    // Profiled to something we don't recognize (or to something like a datatype)
      excludedProfiles.push(sd);
      continue;
    }

    const processingResult = await new StructureDefinition(sd).process(context.join(' | '));
    if (processingResult.errorPattern) schematron.addErrorPattern(processingResult.errorPattern);
    if (processingResult.warningPattern) schematron.addWarningPattern(processingResult.warningPattern);
    merge(unhandledInvariants, processingResult.unhandledInvariants);
  };

  for (const [key, value] of Object.entries(unhandledInvariants)) {
    unhandledInvariants[key] = uniqWith(value, isEqual);
    const details = printFailingInvariants ? "\n" + value.map(v => v.expression).join("\n") : '';
    logger.warn(`${key} (${value.length} instances)${details}`, { silent: true });
  }

  logger.info('Writing output files...');
  await mkdir('./output', {}).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await writeFile(`./output/${ig.name}.sch`, schematron.toXml(), 'utf-8');
  await writeFile(`./output/${ig.name}-Bindings.json`, voc.bindings(), 'utf-8');

  // Generate results
  const results = {
    errors,
    notices,
    skippedTemplates: excludedProfiles.map(p => p.url),
    unhandledInvariants,
    nonLoadedValueSets: voc.nonLoadedValueSets
  };
  await writeFile(`./output/${ig.name}-Results.json`, JSON.stringify(results, null, 2), 'utf-8');

  voc.saveCache();
  logger.info('Complete');
}
  
main();
