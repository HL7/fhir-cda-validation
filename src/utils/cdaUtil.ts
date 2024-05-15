import { Type } from "fhir-package-loader";
import { StructureDefinition } from "../processing/structureDefinition";
import { defs } from "./definitions";
import { ProfiledToSubProfile } from "./errors";

const cdaRoot = 'http://hl7.org/cda/stds/core/StructureDefinition/';

const cdaClinicalDocumentProfileId = `${cdaRoot}ClinicalDocument`;

/**
 * Main helper outside of a parsed StructureDefinition to get the XPath for a given FHIR Path
 * @param element (ElementDefinition) starting point from which to search for definitions
 * @param path FHIR path for element(s) we need the XPath for
 * @param intermediatePath 
 * @returns 
 */

/**
 * Main helper outside of a parsed StructureDefinition to get the XPath for a given FHIR Path
 *
 * @param {fhir5.ElementDefinition} element starting point from which to search for definitions
 * @param {string} path FHIR path for element(s) we need the XPath for
 * @param {string} [intermediatePath] Like path, but contains fields between the element and the path we're looking for
 * @return {*}  {string}
 */
export const xmlNameFromDefs = (element: fhir5.ElementDefinition, path: string, intermediatePath?: string): string => {
  if (!element?.id) {
    throw new Error(`No id for element provided in xmlNameFromDefs`);
  }
  if (!element.type?.length) {
    // Base element recursive
    if (element.id.indexOf('.') === -1) { return ''; }
    throw new Error(`No type defined for element ${element.id}`);
  }

  const profiles: string[] = [];

  for (const type of element.type) {
    if (type.profile) profiles.push(...type.profile);
    else profiles.push(type.code);
  }

  if (intermediatePath?.startsWith('%resource.')) {
    profiles.length = 0;
    profiles.push(cdaClinicalDocumentProfileId);
    intermediatePath = intermediatePath.slice(10);
  }

  let singleXPath: string | undefined;
  for (const profile of profiles) {
    // TODO - fshForFHIR creates a clone - should we cache?
    const sd: fhir5.StructureDefinition = defs.fishForFHIR(profile, Type.Type, Type.Logical, Type.Profile);
    if (!sd) {
      throw new Error(`Cannot find definition for ${profile} for element ${element.id}`);
    }

    const parsedSD = new StructureDefinition(sd);

    const root = parsedSD.root();
    if (!root) {
      throw new Error(`Unable to determine root for definition ${profile}.`);
    }

    // const newRoot = intermediatePath ? `${root}.${intermediatePath}` : root;
    
    const xpath = parsedSD.pathToXpath(root, path, intermediatePath);
    if (xpath && singleXPath && xpath !== singleXPath) {
      throw new Error(`Ambiguous XML representation for ${path} at ${element.id} (${xpath} vs ${singleXPath})`)
    }
    if (xpath) {
      singleXPath = xpath;
    }
  }
  if (!singleXPath) {
    return '';
  }
  return singleXPath;
}


/**
 * Return a FHIR StructureDefinition given a Type, which may be "CDA.Act" or a full URL
 */
const sdRawFromCdaType = (type: string): fhir5.StructureDefinition => {
  const noCdaDot = type.startsWith('CDA.') ? type.slice(4) : type;
  const url = noCdaDot.startsWith(cdaRoot) ? noCdaDot : `${cdaRoot}${noCdaDot.replace('_', '-')}`;
  const sd: fhir5.StructureDefinition = defs.fishForFHIR(url, Type.Type, Type.Logical, Type.Profile);
  if (!sd) {
    throw new Error(`Cannot find type definition for ${url}`);
  }
  return sd;
}

/**
 * Return a parsed StructureDefinition object given a Type, which may be "CDA.Act" or a full URL
 */
export const sdFromCdaType = (type: string): StructureDefinition => {
  const sd = sdRawFromCdaType(type);
  return new StructureDefinition(sd, true);
}

/**
 * Generates an XPATH filter for a given CDA type, which may be something like "CDA.CD" or a full URL
 */
export const ofType = (type: string): string => {
  const sd = sdFromCdaType(type);

  const xmlName = sd.xmlNodeName(sd.root());
  if (xmlName) return xmlName;
  return `*[${cdaTypeToFilter(type)}]`;
}

/**
 * Return the array of CDA types from an element definition.
 * If the "type" of the element definition is a CDA logical model, that will be returned,
 * but if the "type" is "code" (i.e. a primitive string), then the profile will be used instead
 */
export const cdaTypeFromDef = (element: fhir5.ElementDefinition): string[] => {
  if (!element.type || element.type.length === 0) return [];
  return element.type.map(t => {
    const cdaType = t.code === 'code' ? t.profile?.[0] ?? '' : t.code;
    return cdaType.startsWith(cdaRoot) ? cdaType.replace(cdaRoot, '') : '';
  }).filter(Boolean);
}


export const typeFilter = (element: fhir5.ElementDefinition) => {
  if (!element.type || element.type.length === 0) {
    throw new Error(`Cannot create type filter on ${element.id}. No types are defined.`);
  }

  return element.type.map(t => {
    const cdaType = t.code;
    if (!cdaType) {
      throw new Error(`Cannot create type filter on ${element.id}. Missing type.code.`);
    }
    if (!cdaType.startsWith(cdaRoot)) {
      throw new Error(`Cannot create type filter on ${element.id}. Type is not a CDA type.`);
    }

    return cdaTypeToFilter(cdaType.replace(cdaRoot, ''));
  }).join(' or ');
}

/**
 * Create an XPath filter given a CDA Type
 * CAUTION: not very robust! Just looks for xsi:type={cdaType} except for a few special cases.
 */
export const cdaTypeToFilter = (cdaType: string): string => {
  cdaType = cdaType.replace('-', '_');
  // For the most part, just checking xsi:type = type should be good enough
  const rules = [`@xsi:type='${cdaType}'`];

  // In some instances, however, xsi:type is not populated, so let's try to be smart
  switch (cdaType) {
    case 'IVL_TS':
      rules.push(
        'cda:low',
        'cda:high',
        '@value'
      );
      break;
  
    default:
      break;
  }

  return rules.join(' or ');
}

// Return the name of a profile, given its URL.
export const profileName = (profile: string): string | undefined => {
  const sd: fhir5.StructureDefinition = defs.fishForFHIR(profile, Type.Type, Type.Logical, Type.Profile);
  if (!sd) {
    throw new Error(`Cannot find definition for ${profile}`);
  }
  return sd.name;
}

// SUPER temp until we fix profiles that aren't actually profiles
const filteredProfiles = [
  'http://hl7.org/cda/stds/core/StructureDefinition/oid',
  'http://hl7.org/cda/stds/core/StructureDefinition/uuid',
  'http://hl7.org/cda/stds/core/StructureDefinition/ruid',
];
const filterProfile = (profile: string): boolean => {
  if (profile.startsWith('http://hl7.org/cda/stds/core/StructureDefinition/') && profile.endsWith('-simple')) return false;
  return !filteredProfiles.includes(profile);
}

// Return all the profiles for a given CDA ElementDefinition
export const profileFromDef = (element: fhir5.ElementDefinition) => {
  return (element.type || []).map(t => t.profile || []).flat().filter(filterProfile);
  // if (!element.type || element.type.length !== 1 || !element.type[0].profile || element.type[0].profile.length !== 1) {
  //   throw new Error(`Cannot find single profile from ${element.id}`);
  // }
  // return element.type[0].profile[0];
}

// Generate XPath for a templateId given a URI-formatted StructureDefinition identifier
export const templateIdContext = (identifier: string) => {
  const matches = identifier.match(/^urn:(?:oid|hl7ii):(\d(?:\.\d+)+)(?::([^:]+))?$/);
  if (matches) {
    return matches[2] ? `cda:templateId[@root='${matches[1]}' and @extension='${matches[2]}']`
        : `cda:templateId[@root='${matches[1]}' and not(@extension)]`;
  }
}

// Generate XPath for a templateId given the URL of a profile
export const templateIdContextFromProfile = (profile: string, silent = false): string | undefined => {
  // TODO - fshForFHIR creates a clone - should we cache?
  const sd: fhir5.StructureDefinition = defs.fishForFHIR(profile, Type.Type, Type.Logical, Type.Profile);
  if (!sd) {
    if (silent) return;
    throw new Error(`Cannot find definition for ${profile}`);
  }
  
  // TODO - could be easier than loading the class?
  const parsedSD = new StructureDefinition(sd);
  if (!parsedSD.elementDefAtId(`${parsedSD.root()}.templateId`)) {
    // Possibly just check for required elements?
    // throw new Error(`Profile ${profile} does not contain templateId; needs to be handled elsewhere.`);
    if (silent) return;
    throw new ProfiledToSubProfile(profile);
  }
  
  const identifier = sd.identifier?.[0].value;
  if (!identifier) {
    if (silent) return;
    throw new Error(`Profile ${profile} does not have an identifier`);
  }

  return templateIdContext(identifier);
}