import { create } from "xmlbuilder2";
import { Pattern } from "./pattern";
import { ns } from ".";
import { voc } from "../processing/terminology";
import {version, name, repository } from '../../package.json';
import { config } from "../processing/config";
import { knownTemplateIds } from "../utils/logger";

export class Schematron {
  public errors: Pattern[] = [];
  public warnings: Pattern[] = [];
  public comments: string[] = ['THIS SOFTWARE IS PROVIDED "AS IS" AND ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL HL7, OR ANY OF ITS CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
    '',
    `Generated from ${name} version ${version} on ${new Date().toDateString()}`,
    `Includes validation of Value Sets with fewer than ${config.valueSetMemberLimit} concepts`,
    `More information may be found at ${repository.url}`];

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

  private addTemplateIdPattern = () => {
    if (knownTemplateIds.size === 0) return;

    const knownTemplates = Array.from(knownTemplateIds).join(' ');

    this.addWarningPattern('UnknownTemplateIds')
      .addRule('unknown-template-ids', `cda:templateId[@root[starts-with(., '${config.commonTemplateIdRoot}')]]`)
      .assert(
        `contains(' ${knownTemplates} ', concat(' ', substring-after(@root, '${config.commonTemplateIdRoot}'), ';', @extension, ' '))`, 
        `Unrecognized templateId <value-of select="string(concat(@root, ';', @extension, substring('no-extension', 1 div not(@extension))))" /> Please ensure this is the correct templateId.`,
        undefined,
        `The substring('no-extension'...) logic tells XPath 1.0 to only output the string if extension does not exist. XPath is weird.`
      );
  }

  public toXml = () => {
    const schematronXml = create({
      encoding: 'UTF-8',
      standalone: true,
      defaultNamespace: {
        ele: ns.sch
      },
      namespaceAlias: ns
    })
      .com(['', ...this.comments, ''].join("\n"))
      .ele(ns.sch, 'schema');
    for (const prefix of Object.keys(ns)) {
      schematronXml.ele(ns.sch, 'ns', { prefix, uri: ns[prefix as keyof typeof ns] });
    }

    this.addTemplateIdPattern();

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

    return schematronXml.end({ format: 'xml', prettyPrint: true });
  }

}