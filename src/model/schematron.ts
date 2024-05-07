import { create } from "xmlbuilder2";
import { Pattern } from "./pattern";
import { ns } from ".";
import { voc } from "../processing/terminology";


export class Schematron {
  public errors: Pattern[] = [];
  public warnings: Pattern[] = [];

  public addWarningPattern = (id: string | Pattern) => {
    const newPattern = typeof id === 'string' ? new Pattern(id, id) : id;
    this.warnings.push(newPattern);
    return newPattern;
  }
  public addErrorPattern = (id: string | Pattern) => {
    const newPattern = typeof id === 'string' ? new Pattern(id, id) : id;
    this.errors.push(newPattern);
    return newPattern;
  }
  public addWarningPatterns = (patterns?: Pattern[]): Pattern[] => Array.isArray(patterns) ? patterns.map(this.addWarningPattern) : [];
  public addErrorPatterns = (patterns?: Pattern[]): Pattern[] => Array.isArray(patterns) ? patterns.map(this.addErrorPattern) : [];

  public toXml = () => {
    const schematronXml = create({
      encoding: 'UTF-8',
      defaultNamespace: {
        ele: ns.sch
      },
      namespaceAlias: ns
    })
      .ele(ns.sch, 'schema');
    for (const prefix of Object.keys(ns)) {
      schematronXml.ele(ns.sch, 'ns', { prefix, uri: ns[prefix as keyof typeof ns] });
    }

    if (this.errors.length > 0) {
      const phase = schematronXml.ele(ns.sch, 'phase', { id: 'errors' });
      this.errors.filter(e => !e.isEmpty()).map(({ id: pattern }) => phase.ele(ns.sch, 'active', { pattern }));
    }
    if (this.warnings.length > 0) {
      const phase = schematronXml.ele(ns.sch, 'phase', { id: 'warnings' });
      this.warnings.filter(w => !w.isEmpty()).map(({ id: pattern }) => phase.ele(ns.sch, 'active', { pattern }));
    }

    for (const pattern of [...this.errors, ...this.warnings]) {
      schematronXml.import(pattern.toXml());
    }

    schematronXml.import(voc.toLets());

    return schematronXml;
  }

  public toString = () => this.toXml().toString({prettyPrint: true});

}