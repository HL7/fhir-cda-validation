import { Type } from "fhir-package-loader";
import { defs } from "../utils/definitions";
import { get, post } from "axios";
import { logger } from "../utils/logger";
import { create, fragment } from "xmlbuilder2";
import { ns } from "../model";
import { filterConcept, flattenConcepts, getErrorMessage, valueSetOrCodeSystemToOID, vsUrlToNCName } from "../utils/helpers";
import { groupBy } from "lodash";
import { config } from "./config";
import { UnsupportedValueSetError } from "../utils/errors";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

interface LoadedValueSet {
  name: string,
  concepts: fhir5.ValueSetExpansionContains[],
  oid?: string,
}

interface BindingLocation {
  xpath: string,
  valueSetId: string,
  strength: fhir5.ElementDefinitionBinding['strength'],
  name?: string,
  oid?: string,
}

const configFilePath = path.join(__dirname, 'config', 'terminology.json');

class TerminologyPool {
  private serverUrl: string | undefined;
  
  private unknownFhirSystems: string[] = [];
  private fhirSystemToOID: Record<string, string> = {};
  private uniqueNameToId: Record<string, string> = {};
  private loadedValueSets: Record<string, LoadedValueSet> = {};

  private unsupportedValueSets: Record<string, string> = {};

  private bindingLocations: BindingLocation[] = [];

  private apiCache: Record<string, object> = {};

  constructor() {
    try {
      const data = readFileSync(configFilePath, 'utf-8');
      this.apiCache = JSON.parse(data);
    } catch (e) {
      // Meh. Don't care
    }
  }

  public saveCache = (): boolean => {
    try {
      if (!existsSync(path.dirname(configFilePath))) {
        mkdirSync(path.dirname(configFilePath));
      }
      writeFileSync(configFilePath, JSON.stringify(this.apiCache), 'utf-8');
      return true;
    } catch (e) {
      return false;
    }
  }

  public clearCache = (): boolean => {
    try {
      unlinkSync(configFilePath);
      this.apiCache = {};
      return true;
    } catch (e) {
      return false;
    }
  }

  public setServerUrl = (url: string): boolean => {
    // TODO - ping!
    this.serverUrl = url;
    return true;
  }

  /**
   * 
   * @param concepts 
   * @returns 
   */
  private loadSystemOIDs = async (concepts: fhir5.ValueSetExpansionContains[]): Promise<void> => {
    if (!Array.isArray(concepts)) return;
    for (const concept of concepts) {
      // Already handled
      if (!concept.system || this.unknownFhirSystems.includes(concept.system) || this.fhirSystemToOID[concept.system]) continue;

      let cs: fhir5.CodeSystem = defs.fishForFHIR(concept.system, Type.CodeSystem);
      if (!cs && this.serverUrl) {
        logger.info(`Looking up CodeSystem ${concept.system} from ${this.serverUrl}`);
        const response = await get('CodeSystem', {
          baseURL: this.serverUrl,
          params: {
            url: concept.system,
            _format: 'application/json'
          }
        });
        if (response.data.resourceType === 'Bundle' && response.data.entry.length === 1 && response.data.entry[0].resource.resourceType === 'CodeSystem') {
          cs = response.data.entry[0].resource;
        } else {
          console.log(response);
        }
      }
      if (!cs) {
        logger.warn(`CodeSystem ${concept.system} not found; cannot be included in schematron vocabulary.`);
      }

      const oid = valueSetOrCodeSystemToOID(cs);
      if (oid) {
        this.fhirSystemToOID[concept.system] = oid;
      } else {
        this.unknownFhirSystems.push(concept.system);
        // logger.warn(`No OID found for code system ${concept.system}; cannot be included in schematron vocabulary.`);
      }
    }
  }

  private saveValueSetToCache = async (vs: fhir5.ValueSet, originalId: string): Promise<string> => {
    if (!vs.expansion || !Array.isArray(vs.expansion.contains) || vs.expansion!.contains.length === 0) {
      return '';
    }

    // Get a unique-name for the value set
    let uniqueName = vs.name ?? vs.title ?? vs.url ?? vs.id ?? originalId;
    if (this.uniqueNameToId[uniqueName] && this.uniqueNameToId[uniqueName] !== originalId) {
      let counter = 1;
      let newName = `${uniqueName}_${counter}`;
      while (this.uniqueNameToId[newName] && this.uniqueNameToId[newName] !== originalId) {
        newName = `${uniqueName}_${++counter}`;
      }
      uniqueName = newName;
    }

    const concepts = flattenConcepts(vs.expansion.contains)
      .filter(filterConcept);

    if (concepts.length > config.valueSetMemberLimit) {
      vs.expansion.contains = concepts;
      throw this.unsupportedError(originalId, `ValueSet ${originalId} contains ${concepts.length} concepts. This is greater than the configured limit ${config.valueSetMemberLimit}, so this value set will not be included in the schematron`);
    }

    if (concepts.find(c => c.code?.includes("'"))) {
      throw this.unsupportedError(originalId, `ValueSet ${originalId} contains codes with apostrophes, which is currently not supported.`);
    }

    // TODO - this is not needed unless we go the voc.xml route
    // await this.loadSystemOIDs(concepts);

    this.uniqueNameToId[uniqueName] = originalId;
    this.loadedValueSets[originalId] = {
      name: uniqueName,
      oid: valueSetOrCodeSystemToOID(vs),
      concepts
    }
    return uniqueName;
  }

  private unsupportedError = (valueSetId: string, message: string): UnsupportedValueSetError => {
    this.unsupportedValueSets[valueSetId] = message;
    return new UnsupportedValueSetError(message);
  }

  public getSavedValueSetName = (valueSetId: string): string | void => {
    return this.loadedValueSets[valueSetId]?.name;
  }

  public loadValueSet = async (valueSetId: string): Promise<string | void> => {

    if (this.loadedValueSets[valueSetId]) return this.loadedValueSets[valueSetId].name;

    const unsupportedReason = this.unsupportedValueSets[valueSetId];
    if (unsupportedReason) {
      throw new UnsupportedValueSetError(unsupportedReason);
    }

    const vs: fhir5.ValueSet = defs.fishForFHIR(valueSetId, Type.ValueSet);
    if (!vs) {
      throw this.unsupportedError(valueSetId, `Value Set ${valueSetId} not found`);
    }
    if (!vs.url) {
      throw this.unsupportedError(valueSetId, `Value Set ${valueSetId} needs a URL`);
    }
    if (vs.expansion?.contains) {
      return this.saveValueSetToCache(vs, valueSetId);
    }
    if (!this.serverUrl) {
      throw this.unsupportedError(valueSetId, `Value Set ${valueSetId} is not expanded and no terminology server was specified.`);
    };
    
    logger.info(`Expanding ${valueSetId} from ${this.serverUrl}`);

    try {
      const response = await post('ValueSet/$expand', {
        resourceType: 'Parameters',
        parameter: [{
          name: 'valueSet',
          resource: vs
        }, {
          name: 'excludeNested',  // could just use our flattenConcepts...but I don't trust myself enough
          valueBoolean: true,
        }]
      }, {
        baseURL: this.serverUrl,
      });

      if (response.data.resourceType === 'ValueSet') {
        const contains = response.data.expansion?.contains;
        if (!Array.isArray(contains)) {
          throw this.unsupportedError(valueSetId, `Response from ${this.serverUrl} did not contain any codes in its expansion.`);
        }
        return await this.saveValueSetToCache(response.data, valueSetId);
      } else {
        logger.warn(`Did not receive a value set response from ${this.serverUrl} for ${valueSetId}`);
        console.log(response.data);
      }
    } catch (e: any) {
      throw this.unsupportedError(valueSetId, getErrorMessage(e));
    };
     
  }

  public saveBinding = (xpath: string, valueSetId: string, strength: fhir5.ElementDefinitionBinding['strength']) => {
    const { name, oid } = this.loadedValueSets[valueSetId] ?? {};
    this.bindingLocations.push({
      xpath,
      strength,
      valueSetId,
      name,
      oid
    })
  }


  /**
   * Outputs
   */

  public toLets = () => {
    const letFragments = fragment();
    for (const [url, { name, concepts }] of Object.entries(this.loadedValueSets)) {
      const codes = concepts.map(v => v.code).filter(Boolean).join(' ');
      letFragments.ele(ns.sch, 'let', { name: vsUrlToNCName(name), value: `'${codes}'` });
    }
    return letFragments;
  }

  public toXml = () => {
    const vocXml = create({
      encoding: 'UTF-8',
      defaultNamespace: {
        ele: 'http://www.lantanagroup.com/voc'
      }
    }).ele('valueSets');
    for (const [url, { name, concepts }] of Object.entries(this.loadedValueSets)) {
      const valueSetFragment = fragment().ele('valueSet', { url, name });
      for (const { code, system } of concepts) {
        if (!code || !system) continue;
        const oid = this.fhirSystemToOID[system];
        if (!oid) continue;
        valueSetFragment.ele('concept', { code, oid });
      }
      vocXml.import(valueSetFragment);
    }
    return vocXml.toString({prettyPrint: true});

    return JSON.stringify({
      cs: this.fhirSystemToOID,
      vs: this.loadedValueSets
    }, undefined, 2);
  }

  public bindings = () => {
    return JSON.stringify(groupBy(this.bindingLocations, 'strength'), undefined, 2);
  }

}


export const voc = new TerminologyPool();