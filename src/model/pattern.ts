import { fragment } from "xmlbuilder2";
import { ns } from ".";
import { Rule } from "./rule";
import { normalizeNCName } from "../utils/helpers";

export class Pattern {
  public id: string;
  public rules: Rule[] = [];
  public comment?: string;

  constructor(id: string, comment?: string) {
    this.id = normalizeNCName(id, true)!;
    this.comment = comment;
  }

  public isEmpty = () => !this.rules.find(r => !r.isEmpty());

  public toXml = () => {
    const fragments = this.rules.map(r => r.toXml()).filter(Boolean);
    if (fragments.length === 0) return fragment();  //TODO
    const patternXml = fragment()
      .ele(ns.sch, 'pattern', { id: this.id });
    if (this.comment) patternXml.com(this.comment);
    for (const fragment of fragments) {
      patternXml.import(fragment!);
    }
    return patternXml;
  }

  public addRule = (id: string, context: string) => {
    const newRule = new Rule(id, context);
    this.rules.push(newRule);
    return newRule;
  }

  // public addAbstractRule = (id: string) => {
  //   const newRule = new Rule(id, true);
  //   this.rules.push(newRule);
  //   return newRule;
  // }
}