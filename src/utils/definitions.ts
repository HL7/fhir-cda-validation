import { FHIRDefinitions, loadDependencies } from "fhir-package-loader";
import { logMessage } from "./logger";

// TODO - load dependencies from IG resource?

export let defs = new FHIRDefinitions();

export async function loadDefs(
  dependencies: string[] = []
) {
  //const deps = await Promise.all(loadConfiguredDependencies(dependencies));
  defs = await loadDependencies(dependencies.map(d => d.replace('@', '#')), undefined, logMessage);
  return defs;
}