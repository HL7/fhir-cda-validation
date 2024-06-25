import { fragment } from "xmlbuilder2";
import { ns } from ".";
import { normalizeNCName } from "../utils/helpers";

export class Assert {
  public id?: string;
  public test: string;
  public text: string;
  public comment?: string;

  constructor(test: string, text: string, id?: string, comment?: string) {
    this.id = normalizeNCName(id);
    this.test = test;
    this.text = text;
    this.comment = comment;
  }

  // TODO - output template / context in error text
  public toXml = () => {
    const xml = fragment()
      // Temp remove id: this.id until we deduplicate
      .ele(ns.sch, 'assert', {test: this.test});
  
    // If we added a value-of; parse it out before building XML (cleaner way to do this??)
    const valueOf = this.text.match(/(.*)<value-of select="([^"]+)"\s?\/>(.*)/);
    if (valueOf) {
      xml.txt(valueOf[1]);
      xml.ele(ns.sch, 'value-of', { select: valueOf[2]} );
      xml.txt(valueOf[3]);
    } else {
      xml.txt(this.text);
    }

    return xml;
  }
}