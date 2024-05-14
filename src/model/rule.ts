import { fragment } from "xmlbuilder2";
import { Assert } from "./assert";
import { ns } from ".";
import { normalizeNCName } from "../utils/helpers";

export interface Let {
  name: string,
  value: string,
}

export class Rule {
  public id?: string;
  public context: string;
  public abstract?: boolean = false;
  private _extends?: string;
  public assertions: Assert[] = [];
  public lets: Let[] = [];

  constructor(id: string, context: string) {
    this.id = normalizeNCName(id);
    this.context = context;
  }

  public isEmpty = () => this.assertions.length === 0;

  public toXml = () => {
    if (!this.assertions.length) return;
    const ruleXml = fragment()
      .ele(ns.sch, 'rule', { id: abbreviateId(this.id) });
    if (this.context) ruleXml.att('context', this.context);
    if (this.abstract) ruleXml.att('abstract', 'true');
    if (this._extends) {
      ruleXml.ele(ns.sch, 'extends', { rule: this._extends });
    }
    for (const { name, value } of this.lets) {
      ruleXml.ele(ns.sch, 'let', { name, value })
    }

    for (const assertion of this.assertions) {
      if (assertion.comment) {
        ruleXml.com(assertion.comment);
      }
      ruleXml.import(assertion.toXml());
    }
    return ruleXml;
  }

  public assert = (test: string, text: string, id?: string) => {
    this.assertions.push(new Assert(test, text, id));
    return this;
  }

  public extends = (ruleId: string) => {
    this._extends = ruleId;
    return this;
  }
}

// Experiment - cuts current file size from 2MB down to 1.7MB. Worth it?
function abbreviateId(id?: string): string | undefined {
  return id; // Disable for now
  // if (!id) return;
  // const ew = id.includes('-errors-') ? 'e' : id.includes('-warnings-') ? 'w' : '';
  // if (!ew) return id;
  // return id.replace('urn-hl7ii', ew)
  //   .replace('urn-oid', ew)
  //   .replace('-errors-', '-')
  //   .replace('-warnings-', '-')
  //   .replace('2.16.840.1.113883.10.20.22', 'ccda')
  //   .replace('2.16.840.1.113883.10.20', 'ccd')
  //   .replace('1.3.6.1.4.1.19376.1.5.3.1.3', 'ihe');
}