import { AxiosError } from "axios";
import { randomUUID } from "crypto";
import { omit } from "lodash";

// Allow piping the output of one function to the next
export const pipe = <T>(fn1: (a: T) => T, ...fns: Array<(a: T) => T>) =>
  fns.reduce((prevFn, nextFn) => value => nextFn(prevFn(value)), fn1); 

/**
 * Wrapper to get a string from any error thrown
 * If Error is from a FHIR operation containing an OperationResponse, will output the details or text of the issue
 * @param error 
 * @returns 
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError && error.response?.data?.resourceType === 'OperationOutcome') {
    const oO = error.response.data as fhir5.OperationOutcome;
    const issue = oO.issue.map(i => i.details?.text ? `${i.code}: ${i.details.text}` : i.code).join();
    if (issue) return issue;
    if (oO.text?.div) return oO.text.div;
  }
  if (error instanceof Error) return error.message
  return String(error)
}

function randomNCName() {
  const randomId = randomUUID();
  return randomId.match(/^[a-zA-Z]/) ? randomId : 'a' + randomId.slice(1);
}

export function normalizeNCName(id: string | undefined, required = false): string | undefined {
  if (!id) return required ? randomNCName() : id;
  id = id.trim().replace(/[^\w.-]/g, '-');
  if (id.trim().match(/^[a-zA-Z_][\w.-]*$/)) return id.trim();
  if (id.trim().match(/^[\w.-]*$/)) return `_${id.trim()}`;
  if (required) {
    return randomNCName();
  }
}

export function vsUrlToNCName(url: string): string {
  const parts = url.split('/');
  return normalizeNCName(parts[parts.length - 1], true)!;
}

/**
 * Flatten a ValueSet expansion, turning all .contains lists into a single array of concepts
 * @param concepts 
 * @returns 
 */
export const flattenConcepts = (concepts: fhir5.ValueSetExpansionContains[]): fhir5.ValueSetExpansionContains[] => {
  return concepts.flatMap((c) => c.contains ? [omit(c, 'contains'), ...flattenConcepts(c.contains)] : c);
}

export const filterConcept = (concept: fhir5.ValueSetExpansionContains): boolean => {
  if (concept.property?.find(p => p.code === 'notSelectable')?.valueBoolean) return false;

  return true;
}

export const valueSetOrCodeSystemToOID = (vsOrCs: fhir5.ValueSet | fhir5.CodeSystem): string | undefined => {
  const oid = (vsOrCs.identifier || []).find(i => i.value && i.value.startsWith('urn:oid:'));
  if (oid) return oid.value!.slice(8);
}