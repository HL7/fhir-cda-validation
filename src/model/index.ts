import { Assert } from "./assert"
import { Pattern } from "./pattern"
import { Rule } from "./rule"
import { Schematron } from "./schematron"

export const ns: Record<string, string> = {
  sch: 'http://purl.oclc.org/dsdl/schematron',
  cda: 'urn:hl7-org:v3',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  sdtc: 'urn:hl7-org:sdtc'
}

export const nsPrefix = (uri: string): string | undefined => {
  return Object.keys(ns).find(prefix => ns[prefix] === uri);
}


export const sch = {
  Schematron,
  Pattern,
  Rule,
  Assert
}