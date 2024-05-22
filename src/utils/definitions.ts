import { FHIRDefinitions, loadDependencies, loadDependency, mergeDependency } from "fhir-package-loader";
import { logMessage, logger } from "./logger";

export let defs = new FHIRDefinitions();

export async function loadDefs(
  dependencies: string[] = []
) {
  const octoDeps = dependencies.map(d => d.replace('@', '#'));
  defs = await loadDependencies(octoDeps, undefined, logMessage);

  let depsAdded = true;
  while (depsAdded) {
    depsAdded = false;
    for (const ig of defs.allImplementationGuides()) {
      for (const dep of ig.dependsOn || []) {
        if (!dep.packageId || !dep.version) continue;
        if (octoDeps.includes(`${dep.packageId}#${dep.version}`)) continue;
        logger.info(`Loading ${ig.name} dependency ${dep.packageId}#${dep.version}`);
        defs = await loadDependency(dep.packageId, dep.version, defs);
        octoDeps.push(`${dep.packageId}#${dep.version}`);
        depsAdded = true;
      }
    }
  }

  return defs;
}