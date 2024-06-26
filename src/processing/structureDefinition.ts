import { Pattern } from "../model/pattern";
import { Rule } from "../model/rule";
import { processInvariant } from "./invariant";
import { ns, nsPrefix } from "../model";
import { logger } from "../utils/logger";
import { cdaTypeFromDef, dateRules, profileFromDef, profileName, templateIdContext, templateIdContextFromProfile, typeFilter, xmlNameFromDefs } from "../utils/cdaUtil";
import { getErrorMessage } from "../utils/helpers";
import { voc } from "./terminology";
import { ProfiledToSubProfile } from "../utils/errors";

interface ProcessingResult {
  unhandledInvariants?: Record<string, fhir5.ElementDefinitionConstraint[]>;
  subProfileContexts?: Record<string, string[]>;
  errorPattern?: Pattern;
  warningPattern?: Pattern;
  isSubTemplate?: boolean;
}

type RuleMap = Record<string, Rule>;

const subTemplateResult = (): ProcessingResult => ({
  unhandledInvariants: {},
  isSubTemplate: true
});

type PopulatedStructureDefinition = fhir5.StructureDefinition & {
  snapshot: NonNullable<fhir4.StructureDefinition['snapshot']>
}


/**
 * Primary class used for parsing a FHIR StructureDefinition object
 *
 * @export
 * @class StructureDefinition
 */
export class StructureDefinition {
  private sd: PopulatedStructureDefinition
  private errorRules: RuleMap = {};
  private warningRules: RuleMap = {};
  private contextsToXpath: Record<string, string> = {};
  private templateUri?: string;
  private subProfileContexts: Record<string, string[]> = {};
  readonly name: string;

  constructor(sd: fhir5.StructureDefinition, updateRoot = false) {
    if (!sd.snapshot) {
      throw new Error(`Missing snapshot on ${sd.name}`);
    }
    this.sd = sd as PopulatedStructureDefinition;
    this.name = sd.name;

    this.templateUri = this.sd.identifier?.[0].value;

    if (updateRoot) {
      this.updateRoot();
    }
  }

  root = (): string | undefined => this.sd.snapshot.element[0].id;

  /**
   * Copy some data to the root element, so ElementDefinition-based functions are easier to work with
   */
  private updateRoot = () => {
    const rootEd = this.sd.snapshot.element[0];
    if (!rootEd.type) {
      rootEd.type = [{
        code: this.sd.type
      }];
    }
    rootEd.extension = Object.assign(rootEd.extension || [], this.sd.extension || []);
  }

  process = async (xPathContext?: string): Promise<ProcessingResult> => {
    const sd = this.sd;
    const templateId = this.templateUri;

    this.updateRoot();

    // If passed in, this is a sub-template; otherwise, we need to look up the root context.
    if (!xPathContext) {
      if (!templateId || !this.elementDefAtId(`${this.root()}.templateId`)) {
        return subTemplateResult();
      }

      const templateRoot = this.xmlNodeName(this.root());
      if (!templateRoot) {
        logger.error(`Cannot determine root XML node of ${sd.name} ${JSON.stringify(sd.extension)}`);
        return {};
      }

      const templateIdContextExp = templateIdContext(templateId);
      if (!templateIdContextExp) {
        logger.error(`Unable to determine context for ${sd.name}`);
        return {};
      }

      xPathContext = `${templateRoot}[${templateIdContextExp}]`;
    }

    const templateErrorPattern = new Pattern(`${sd.name}-errors`, templateId);
    const templateWarningPattern = new Pattern(`${sd.name}-warnings`, templateId);

    this.contextsToXpath['.'] = xPathContext;

    this.errorRules['.'] = new Rule(`${sd.name}-errors-root`, xPathContext);
    this.warningRules['.'] = new Rule(`${sd.name}-warnings-root`, xPathContext);

    // Require parent templateId (this is because we're mainly processing differential; not snapshot)
    if (this.sd.baseDefinition) {
      const parentTemplateId = templateIdContextFromProfile(this.sd.baseDefinition, true);
      if (parentTemplateId) {
        const parentName = profileName(this.sd.baseDefinition);
        this.errorRules['.'].assert(parentTemplateId, `SHALL conform to (contain the templateId of) ${parentName}`);
      }
    }

    const results: ProcessingResult = {
      unhandledInvariants: {},
      subProfileContexts: this.subProfileContexts,
      errorPattern: templateErrorPattern,
      warningPattern: templateWarningPattern
    }

    for (const diffDef of sd.differential!.element) {
      if (!diffDef.id) continue; 
      const snapDef = this.elementDefAtId(diffDef.id);
      if (!snapDef) {
        logger.warn(`No corresponding snapshot definition for differential ${diffDef.id}. Skipping...`);
        continue;
      }
      try {
        await this.processElementDefinition(snapDef, results);
      } catch (e) { 
        logger.error(`${sd.name}: ${getErrorMessage(e)}`);
      }
    };

    templateErrorPattern.rules = [...new Map(Object.values(this.errorRules).map(v => [v.context, v])).values()];
    templateWarningPattern.rules = [...new Map(Object.values(this.warningRules).map(v => [v.context, v])).values()];

    return results;
  }


  processElementDefinition = async (element: fhir5.ElementDefinition, results: ProcessingResult): Promise<void> => {
    if (!element.id) {
      logger.warn(`Skipping element with path ${element.path} in ${this.sd.name} because it is missing an id field`);
      return;
    }

    // We don't need extra rules for templateId when we're in the context of templateId already...
    if (element.id.startsWith(`${this.root()}.templateId`)) {
      return;
    }

    // Not a real element
    if (element.extension?.find(e => e.url === 'http://hl7.org/fhir/tools/StructureDefinition/xml-choice-group')?.valueBoolean) {
      return;
    }

    const pathSegments = element.id.split('.');

    for (const constraint of element.constraint || []) {
      const invRule = await processInvariant(constraint, this, element.id);
      if (invRule.Processed) {
        if (invRule.Processed.Strength === 'warning') {
          this.warningRule(element.id).assertions.push(invRule.Processed.Assertion);
        } else {
          this.errorRule(element.id).assertions.push(invRule.Processed.Assertion);
        }
      } else if (invRule.Unsupported) {
        if (!results.unhandledInvariants) results.unhandledInvariants = {};
        (results.unhandledInvariants[invRule.Unsupported] ||= []).push(constraint);
      }
    }

    if (pathSegments.length <= 1) return; // nothing more to process on the root

    const nodeXml = this.xmlNodeName(element);
    if (!nodeXml) return; // Would've already logged a warning
    const nodeDisplay = this.xmlNodeName(element, true);

    // Fixed value (look up before cardinality check; might save us an assertion)
    const fixed = this.fixedValue(element);

    // Cardinality
    const max = element.max ?? element.base?.max ?? '';
    const min = element.min ?? element.base?.min ?? 0;
    const maxInt = parseInt(max);
    if (isNaN(maxInt) && max !== '*') logger.warn(`Element ${element.id} in ${this.sd.name} had an invalid max value (${max})`);
    const required = (min > 0);
    const prohibited = (max === '0');

    // Certain cases we don't need to bother with cardinality
    let skip = (required && fixed && maxInt === 1);
    if (min === 0 && element.max === '*') skip = true;
    if (this.isAttribute(element) && min === 0 && maxInt === 1) skip = true;

    if (!skip) {
      const val = `count(${nodeXml})`;
      let assertion;
      if (min === maxInt) assertion = `${val}=${min}`;
      else if (max === '0') assertion = `${val}=0`;
      else if (!isNaN(maxInt)) assertion = (min > 0 ? `${val} >= ${min} and ${val} <= ${max}` : `${val} <= ${max}`);
      else assertion = `${val}>=${min}`;
      this.errorRule(element.id, true).assert(assertion, `Cardinality of ${nodeDisplay} is ${min}..${max}`);
    }

    // Fixed values
    if (fixed && !this.ignoreValueAt.includes(element)) {
      if (required) {
        this.errorRule(element.id, true).assert(`${nodeXml} = '${fixed}'`, `${nodeDisplay} SHALL = '${fixed}'`);
      } else {
        this.errorRule(element.id, true).assert(`not(${nodeXml}) or ${nodeXml} = '${fixed}'`, `${nodeDisplay}, if present, SHALL = '${fixed}'`);
      }
    }

    // (Also - stop throwing errors for profiles to data types.... hmm....)
    const profiles = this.ignoreProfileAt.includes(element) ? [] : profileFromDef(element);
    if (profiles.length > 0) {
      try {
        const context = profiles.map(p => `(${templateIdContextFromProfile(p)})`).join(' or ');
        const profileNames = profiles.map(profileName).join(' or ');
        this.errorRule(element.id, false).assert(context, `${nodeDisplay} SHALL conform to ${profileNames}`);
      } catch (e) {
        if (e instanceof ProfiledToSubProfile && profiles.length === 1) {
          this.addSubProfileContext(this.idToContext(element.id), profiles[0]);
        } else {
          throw e;
        }
      }
      
    }

    // No need to record / handle bindings if we're enforcing a fixed value
    if (!fixed) {
      await this.processBinding(element);
    }

    // If slicing is closed - don't allow any other instances of this node that do not conform to one of the slices
    if (element.slicing?.rules === 'closed') {
      const slices = this.sd.snapshot.element.filter(e => e.path === element.path && e !== element && e.id);
      const sliceNames = slices.map(s => s.sliceName).join(', ');
      const sliceXPaths = slices.map(s => this.sliceFilter(s.id!));
      this.errorRule(element.id, true).assert(`count(${nodeXml}[not(${sliceXPaths.join(' or ')})]) = 0`, `Slicing is closed, each ${nodeDisplay} must conform to one of the following slices: ${sliceNames}`);
    }

    // Apply specific type-rules
    const cdaType = cdaTypeFromDef(element);
    if (cdaType.includes('ts-simple') && dateRules(element).includes('tz-for-time')) {
      // Could use matches() but avoiding XPath2.0 functions where possible
      const sign = `substring(${nodeXml}, string-length(${nodeXml}) - 4, 1) = '+' or substring(${nodeXml}, string-length(${nodeXml}) - 4, 1) = '-'`;
      const hour = `number(substring(${nodeXml}, string-length(${nodeXml}) - 3, 2)) >= 0 and number(substring(${nodeXml}, string-length(${nodeXml}) - 3, 2)) <= 12 and string-length(substring(${nodeXml}, string-length(${nodeXml}) - 3, 2)) = 2`;
      const min = `number(substring(${nodeXml}, string-length(${nodeXml}) - 1, 2)) >= 0 and number(substring(${nodeXml}, string-length(${nodeXml}) - 1, 2)) <= 59 and string-length(substring(${nodeXml}, string-length(${nodeXml}) - 1, 2)) = 2`;
      const tzOffset = [sign, hour, min].map(x => `(${x})`).join(' and ');
      this.errorRule(element.id, true).assert(`not(${nodeXml}) or string-length(${nodeXml}) <= 8 or (${tzOffset})`, 'Timestamps more precise than the day SHALL include a timezone offset (+/- HHMM)');
    }
  }

  elementDefAtId = (id: string): fhir5.ElementDefinition | undefined => this.sd.snapshot.element.find(e => e.id === id);

  /**
   * Core function to figure out the context (xpath attribute of rule) given an ElementDefinition id
   * It does this by recursively appending the output of xmlNodeName to the context of the element's parent
   * The root context is set by StructureDefinition.process() according to either a templateId or a 
   * set of sub-contexts (for things like addr or name)
   *
   * @param {string} id
   * @param {boolean} [parent=false] if true - get the context of the parent element, not this element
   * @memberof StructureDefinition
   */
  idToContext = (id: string, parent = false): string => {
    const pathSegments = id.split('.').slice(0, parent ? -1 : undefined);

    if (pathSegments.length <= 1) {
      return '.';
    }

    const thisContext = pathSegments.slice(1).join('.');
    if (this.contextsToXpath[thisContext]) {
      return thisContext;
    }

    // Don't have this one yet - need to make it from the parent

    const parentContext = this.idToContext(pathSegments.join('.'), true);
    if (!this.contextsToXpath[parentContext]) {
      throw new Error(`Unable to determine context for ${id}. Parent context is not defined.`);
    }

    const nodeName = this.xmlNodeName(pathSegments.join('.'));
    // "fake" node (like AD.item) - context is same as parent
    if (nodeName === 0) {
      this.contextsToXpath[thisContext] = this.contextsToXpath[parentContext];
      this.errorRules[thisContext] = this.errorRules[parentContext];
      this.warningRules[thisContext] = this.warningRules[parentContext];
      return parentContext;
    }
    if (!nodeName) {
      throw new Error(`Cannot generate context for ${id}.`);
    }

    // Splitting is for sub-profiles whose root context is a union of several paths
    const newXpath = this.contextsToXpath[parentContext]
      .split(' | ')
      .map(oneContext => `${oneContext}/${nodeName}`)
      .join(' | ');
    this.contextsToXpath[thisContext] = newXpath;

    this.errorRules[thisContext] = new Rule(`${this.sd.name}-errors-${thisContext}`, newXpath);
    this.warningRules[thisContext] = new Rule(`${this.sd.name}-warnings-${thisContext}`, newXpath);

    // Need to generate contexts for full path, but currently we're looking for the context of path-1
    if (pathSegments.length === 1) {
      return '.';
    }

    return thisContext;
  }

  isAttribute = (element: fhir5.ElementDefinition) => (element.representation || []).includes('xmlAttr');

  /**
   * Generate the xml xpath for a single node. Will prefix with namespace if needed.
   * Handles attributes (as @nodeName) and nodes which are xml-text.
   * 
   * Will return null or 0 for elements that are not "real" (e.g. "item" elements for multi-choice fields in AD or EN)
   *
   * @param {(fhir5.ElementDefinition | string)} [elementOrId]
   * @param {boolean} [displayOnly=false] Get the name of the element for message (not xpath) purposes
   * @memberof StructureDefinition
   */
  xmlNodeName = (elementOrId?: fhir5.ElementDefinition | string, displayOnly = false): string | void | 0 => {
    const element = typeof elementOrId === 'string' ? this.elementDefAtId(elementOrId) : elementOrId
    if (!element) {
      return;
    }

    const representation = element.representation || [];

    if (representation.includes('xmlText')) {
      return 'text()[normalize-space()]';
    }

    const lastPiece = (element.id || '').split('.').pop()!;

    const [nameFromId, sliceName] = lastPiece.split(':');

    // Not a real element
    if (element.extension?.find(e => e.url === 'http://hl7.org/fhir/tools/StructureDefinition/xml-choice-group')?.valueBoolean) {
      return 0;
    }

    const xmlName = element.extension?.find(e => e.url === 'http://hl7.org/fhir/tools/StructureDefinition/xml-name')?.valueString || nameFromId;
    const xmlNS = element.extension?.find(e => e.url === 'http://hl7.org/fhir/tools/StructureDefinition/xml-namespace')?.valueUri || ns.cda;

    if (this.isAttribute(element)) {
      return `@${xmlName}`;
    }

    const prefix = nsPrefix(xmlNS);
    if (!prefix) {
      logger.warn(`Unknown namespace ${xmlNS} for element ${element.id}`);
      return xmlName
    }

    if (displayOnly) {
      return sliceName ? `${xmlName}:${sliceName}` : xmlName;
    }

    const sliceContext = sliceName ? '[' + this.sliceFilter(element.id!) + ']' : '' ;

    return `${prefix}:${xmlName}${sliceContext}`;
  }

  // Set during slice filtering - if the context is already defined by profile or value, 
  // there's no reason to add an assertion requiring that profile or value later
  private ignoreProfileAt: fhir5.ElementDefinition[] = [];
  private ignoreValueAt: fhir5.ElementDefinition[] = [];

  // Called on the slice-definition element
  sliceFilter = (id: string): string => {
    const sliceRoot = id.split(':').slice(0, -1).join(':');
    const slicingInfo = this.elementDefAtId(sliceRoot)?.slicing;
    if (!slicingInfo) {
      throw new Error(`No slicing information found for slice ${id}`);
    }
    if (!slicingInfo.discriminator?.length) {
      throw new Error(`Need discriminator to identify slicing for ${id}`);
    }

    return slicingInfo.discriminator.map((d) => {
      const pathDef = this.elementDefAtId(d.path === '$this' ? id : `${id}.${d.path}`);
      if (!pathDef) {
        throw new Error(`Cannot find definition for path ${d.path} on slice ${id}`);
      }
      if (d.type === 'type') return typeFilter(pathDef);
      const xPath = this.pathToXpath(id, d.path);
      switch (d.type) {
        case 'exists':
          return pathDef.max === '0' ? `not(${xPath})` : `(${xPath})`;
        case 'value':
          const value = this.fixedValue(pathDef);
          if (!value && pathDef.max !== '0') {
            throw new Error(`Missing value or max=0 for slice ${id} at path ${d.path}`);
          }
          if (value!.includes('"') || value!.includes("'")) {
            throw new Error(`Unexpected quoted value (${value}) for slice ${id} at path ${d.path}`);
          }
          this.ignoreValueAt.push(pathDef);
          return pathDef.max === '0' ? `not(${xPath})` : `(${xPath} = '${value}')`
        case 'profile':
          const profiles = profileFromDef(pathDef);
          if (profiles.length === 0) return `not(${xPath})`;
          const templateContext = profiles.map(p => `(${templateIdContextFromProfile(p)})`).join(' or ');
          this.ignoreProfileAt.push(pathDef);
          return `${xPath}[${templateContext}]`;
        default:
          throw new Error(`Slicing type ${d.type} not yet supported`);
          break;
      }
    }).filter(Boolean).join(' and ');
  }

  pathToXpath = (context: string, path: string, intermediatePath?: string): string => {
    if (path.includes('(')) {
      throw new Error(`FHIRPath functions are not allowed in CDA slicing discriminators (${context}.${path})`);
    }

    const contextPS = intermediatePath ? '.' + intermediatePath : '';

    let breakOut = false;
    let currentDef = this.elementDefAtId(context + contextPS);
    if (!currentDef) {
      if (intermediatePath) {
        const intermediateSegments = intermediatePath.split('.');
        for (let numSegs = intermediateSegments.length-1; numSegs > 0; numSegs--) {
          const tailDef = this.elementDefAtId(context + '.' + intermediateSegments.slice(0, numSegs).join('.'));
          if (tailDef) {
            return xmlNameFromDefs(tailDef, path, intermediateSegments.slice(numSegs).join('.'));
          }
        }
      }
      throw new Error(`${context} not found in SD`);
    }
    const pathSegments = path.split('.');

    return pathSegments.map((_field, index) => {
      if (breakOut) return; 
      const newDef = this.elementDefAtId(context + contextPS + '.' + pathSegments.slice(0, index + 1).join('.'));
      if (newDef) {
        currentDef = newDef; // reset for next time around
        return this.xmlNodeName(newDef);
      } else {
        breakOut = true;
        // Could not find in this SD. Start from the last successful def, and get the path from there
        const newPath = pathSegments.slice(index).join('.');
        return xmlNameFromDefs(currentDef!, newPath);
      }
    }).filter(Boolean).join('/');
  }

  findAllElementDefinitions = (startingWith: string, endingWith: string): fhir5.ElementDefinition[] => {
    return this.sd.snapshot.element.filter(e => e.id?.startsWith(`${startingWith}`) && e.id?.endsWith(`.${endingWith}`));
  }

  fixedValue = (element: fhir5.ElementDefinition): string | undefined => {
    const key = Object.keys(element).find(k => k.startsWith('pattern') || k.startsWith('fixed'));
    if (!key) return;
    if (!['patternString', 'patternCode', 'patternBoolean', 'fixedString', 'fixedCode', 'fixedBoolean'].includes(key)) {
      logger.error(`Unexpected ${key} in ${element.id}`);
      return;
    }
    return element[key as keyof typeof element] as string;
  }

  processBinding = async (element: fhir5.ElementDefinition, required = false) => {
    const valueSet = element.binding?.valueSet;
    const strength = element.binding?.strength;
    if (!element.id || !valueSet || !['required', 'preferred', 'extensible'].includes(strength || '')) return;
    const type = cdaTypeFromDef(element);
    if (type.length !== 1) {
      logger.warn(`Cannot process binding on ${element.id}; missing single type`);
      return;
    }
    // TODO - verify types we care about BEFORE loading
    const vsName = await voc.loadValueSet(valueSet);

    // Can save regardless of whether it's loaded
    voc.saveBinding(this.contextsToXpath[this.idToContext(element.id)], valueSet, strength!);

    if (!vsName)  {
      return;
    }

    let test: string = '';
    switch (type[0]) {
      case 'ADXP':
      case 'ENXP':
        test = `not(@partType) or contains($${vsName}, @partType)`;
        break;
      case 'PQ':
        test = `not(@unit) or contains($${vsName}, @unit)`;
      case 'CD':
      case 'CE':
      case 'CO':
      case 'CS':
      case 'CV':
      case 'SC':
      case 'PQR': //technically I suppose it could be on unit, but @code is more likely
        test = `@nullFlavor or contains($${vsName}, @code)`
        break;
      case 'cs-simple':
        test = `contains($${vsName}, .)`
        break;
    
      default:
        throw new Error(`Unexpected type with binding: ${type[0]}`);
        break;
    }
    if (strength === 'required') {
      this.errorRule(element.id).assert(test, `SHALL be selected from ValueSet ${vsName}`);
    } else {
      this.warningRule(element.id).assert(test, `SHOULD be selected from ValueSet ${vsName}`);
    }
  }

  addSubProfileContext = (context: string, profile: string) => {
    const xPath = this.contextsToXpath[context];
    if (!this.subProfileContexts[profile]) {
      this.subProfileContexts[profile] = [xPath];
    } else {
      this.subProfileContexts[profile].push(xPath);
    }
  }


  errorRule = (id: string, attachAtParent = false): Rule => {
    return this.errorRules[this.idToContext(id, attachAtParent)];
  }

  warningRule = (id: string, attachAtParent = false): Rule => {
    return this.warningRules[this.idToContext(id, attachAtParent)];
  }

}