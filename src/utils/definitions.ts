import { FHIRDefinitions, loadDependencies, loadDependency } from "fhir-package-loader";
import { logMessage, logger } from "./logger";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { ImplementationGuide } from "fhir/r5";

export let defs = new FHIRDefinitions();

// Copy of loadFromPath - without checking URL
async function loadLocalIG() {
  let ig: ImplementationGuide | undefined;
  const files = readdirSync('output').filter(f => f.endsWith('.json'));
  for (const file of files) {
    const def = JSON.parse(
      readFileSync(join('output',  file), 'utf-8').trim()
    );
    if (def.resourceType === 'ImplementationGuide') {
      ig = def;
    }
    defs.add(def);
  }
  if (!ig) {
    throw new Error('No ImplementationGuide found in output directory');
  }
  defs.package = ig.id!;
  logger.info(`Loaded ImplementationGuide ${ig.packageId}@${ig.version}`);
}

export async function loadDefs(
  dependencies: string[] = []
) {
  const octoDeps = dependencies.map(d => d.replace('@', '#'));
  if (dependencies.length > 0 && dependencies[0] === '.') {
    loadLocalIG();
    dependencies.shift();
    for (const dep of dependencies) {
      const [packageId, version] = dep.split('@');
      defs = await loadDependency(packageId, version, defs);
      octoDeps.push(`${packageId}#${version}`);
    }
  } else {
    defs = await loadDependencies(octoDeps, undefined, logMessage);
  }

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