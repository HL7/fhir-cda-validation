import { create } from "xmlbuilder2";
import { Pattern } from "./pattern";
import { ns } from ".";
import { voc } from "../processing/terminology";
import {version, name, repository } from '../../package.json';

export class Schematron {
  public errors: Pattern[] = [];
  public warnings: Pattern[] = [];
  public comments: string[] = ['THIS SOFTWARE IS PROVIDED "AS IS" AND ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL HL7, OR ANY OF ITS CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
    '',
    `Generated from ${name} version ${version} on ${new Date().toDateString()}`,
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