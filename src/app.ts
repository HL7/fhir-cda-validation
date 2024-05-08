#!/usr/bin/env node
import { logger } from "./utils/logger";
import { sch } from "./model";
import { StructureDefinition } from "./processing/structureDefinition";
import { loadDefs } from "./utils/definitions";
import { mkdir, writeFile } from "fs/promises";
import { merge, mergeWith } from "lodash";
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
    'implementation guide to process'
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
    '--value-set-limit <number>',
    'maximum number of values to include in value set lookups',
    (value) => {
      const parsedInt = parseInt(value, 10);
      if (isNaN(parsedInt) || parsedInt < 0) {
        throw new InvalidOptionArgumentError('Value-set limit must be a positive integer')
      }
      return parsedInt;
    },
    200
  )
  .option(
    '-p --profile <string>',
    'Process only a single profile (useful for testing)'
  )
  .action(arg => inputIg = arg)
  .parse();

const options = program.opts();
updateConfigFromOptions(options);


if (!inputIg) {
  logger.warn('No IG specified; using C-CDA 3.0 by default');
  inputIg = 'hl7.cda.us.ccda@current';
  options.dependency = [
    'hl7.terminology#5.2.0',
    'us.nlm.vsac#0.17.0',
    'us.cdc.phinvads#0.12.0',
    'hl7.fhir.us.core#current'
  ]
}

if (!Array.isArray(options.dependency)) {
  options.dependency = [];
}
if (!options.dependency.find((d: string) => d.startsWith('hl7.cda.uv.core'))) {
  options.dependency.push('hl7.cda.uv.core@2.0.0-sd-snapshot1');
}

// TODO - need to load all deps if we want vocab
if (options['terminologyServer'] && options['terminologyServer'].toLowerCase() !== 'x') {
  voc.setServerUrl(options['terminologyServer']);
} else {
  logger.warn('No terminology server provided; external value sets will not be expanded');
}

const printFailingInvariants = false;

const dependencies = [inputIg, ...options.dependency];
async function main() {
  const deps = await loadDefs(dependencies);

  const errors: string[] = [];
  const notices: string[] = [];
  const unhandledInvariants: Record<string, fhir5.ElementDefinitionConstraint[]> = {};

  const schematron = new sch.Schematron();

  const profiles = deps.allProfiles(inputIg.replace('@', '#')) // allProfiles only wants #
    .filter((p) => options.profile ? p.name === options.profile : true);
  
  if (profiles.length === 0) {
    logger.error(options.profile ? `Profile ${options.profile} not found in ${inputIg}` : 'No profiles found to process');
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
    if (processingResult.errorPattern) schematron.addErrorPattern(processingResult.errorPattern);
    if (processingResult.warningPattern) schematron.addWarningPattern(processingResult.warningPattern);
    mergeWith(unhandledInvariants, processingResult.unhandledInvariants, (o, s) => Array.isArray(o) ? o.concat(s) : o);
    mergeWith(subProfileContexts, processingResult.subProfileContexts, (o, s) => Array.isArray(o) ? o.concat(s) : o);
    errors.push(...processingResult.errors);
    notices.push(...processingResult.notices);
  };

  logger.info('Processing sub-profiles');
  for (const sd of subProfiles) {
    const context = subProfileContexts[sd.url];
    if (!context) continue;  // Profiled to something we don't recognize (or to something like a datatype)

    const processingResult = await new StructureDefinition(sd).processSubTemplate(context.join(' | '));
    if (processingResult.errorPattern) schematron.addErrorPattern(processingResult.errorPattern);
    if (processingResult.warningPattern) schematron.addWarningPattern(processingResult.warningPattern);
    merge(unhandledInvariants, processingResult.unhandledInvariants);
    errors.push(...processingResult.errors);
    notices.push(...processingResult.notices);
  };


  errors.map(logger.error);
  notices.map(logger.warn);

  logger.info('Writing output files...');
  await mkdir('./output', {}).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await writeFile('./output/CCDA-SD.sch', schematron.toString(), 'utf-8');
  await writeFile('./output/CCDA-SD-voc.xml', voc.toXml(), 'utf-8');
  await writeFile('./output/Bindings.json', voc.bindings(), 'utf-8');

  for (const [key, value] of Object.entries(unhandledInvariants)) {
    const details = printFailingInvariants ? "\n" + value.map(v => v.expression).join("\n") : '';
    logger.warn(`${key} (${value.length} instances)${details}`);
  }

  logger.info('Complete');
}
  
main();
