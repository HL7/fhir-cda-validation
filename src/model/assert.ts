import { fragment } from "xmlbuilder2";
import { ns } from ".";
import { normalizeNCName } from "../utils/helpers";

export class Assert {
  public id?: string;
  public test: string;
  public text: string;
  public comment?: string;

  constructor(test: string, text: string, id?: string) {
    this.id = normalizeNCName(id);
    this.test = test;
    this.text = text;
  }

  // TODO - output template / context in error text
  public toXml = () => {
    return fragment()
      // Temp remove id: this.id until we deduplicate
      .ele(ns.sch, 'assert', {test: this.test})
      .txt(this.text);
  }
}