import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adjustLengths, convertExpression, deunionizeContains, removeDoubleBrackets, unwrapParens } from '../src/processing/invariant';
import { StructureDefinition } from '../src/processing/structureDefinition';
import { afterEach } from 'node:test';


vi.mock('../src/utils/cdaUtil', async (original) => ({
  ...await original<typeof import('../src/utils/cdaUtil.js')>(),
  templateIdContextFromProfile: vi.fn(profile => `cda:templateId[@root='1.2.3' and @extension='${profile}']`),
}))

describe('Invariant tests', () => {
  let sd: StructureDefinition;
  let context: string;
  beforeEach(() => {
    sd = new StructureDefinition({
      resourceType: 'StructureDefinition',
      abstract: false,
      kind: 'logical',
      name: 'fake',
      status: 'active',
      type: 'fake',
      url: 'fake',
      snapshot: {
        element: []
      },
      differential: {
        element: []
      },
      identifier: [{
        value: 'urn:oid:1.2.3.4'
      }]
    });
    // TODO - reset sd to something basic
    sd.pathToXpath = (_c, p) => p;
    context = 'root';
  });

  afterEach(() => vi.restoreAllMocks());

  const assertConversion = (test: string, expectation: string) => expect(convertExpression(test, sd, context)).toEqual(expectation);
  const assertFailure = (test: string, failureText: string) => expect(() => convertExpression(test, sd, context)).toThrow(failureText);

  describe('Unsupported variables / literals', () => {
    it('should throw when encountering @', () => {
      assertFailure('abc = @2024', 'DateTime literals');
    });
    it('should throw when encountering %', () => {
      assertFailure('abc = %root', 'Variables');
    });

    it('should allow characters inside strings', () => {
      assertConversion("abc = '@%def~'", "abc = '@%def~'");
    })
  });

  describe('Basic Conversions', () => {
    it('Should clear exists', () => {
      assertConversion('abc.exists()', 'abc');
    });

    it('Should clear toString', () => {
      assertConversion('abc.toString()', 'abc');
    });
  });

  describe('Where / exists', () => {
    it('should convert standard where/exists', () => {
      assertConversion('abc.where(def)', 'abc[def]');
      assertConversion('abc.exists(def)', 'abc[def]');
    });

    it('should chain', () => {
      assertConversion('abc.where(def).exists(ghi)', 'abc[def][ghi]');
    });
  });

  describe('Implies', () => {
    it('should convert standard implies', () => {
      assertConversion('abc implies def', 'not(abc) or def');
    });

    it('should convert each side of the implies', () => {
      assertConversion('abc.exists() implies def.exists()', 'not(abc) or def');
    });
  });

  describe('Function conversions', () => {
    it('should convert count', () => {
      assertConversion('abc.count() = 3', 'count(abc) = 3');
    });

    it('should convert length', () => {
      assertConversion('abc.length() = 3', 'string-length(abc) = 3');
    });

    it('should convert empty', () => {
      assertConversion('abc.empty()', 'not(abc)');
    });

    it('should convert empty along with other statements', () => {
      assertConversion('abc.where(def).empty()', 'not(abc[def])');
    });

    it('should convert descendants', () => {
      assertConversion('abc.descendants()', 'abc//*');
    });

    it('should convert not', () => {
      assertConversion('abc.not()', 'not(abc)');
    });

    it('should convert FIRST!!!!1one', () => {
      assertConversion('abc.first()', 'abc[1]');
    });
  });

  describe('Complex functions', () => {
    afterEach(() => vi.restoreAllMocks());

    it('should convert hasTemplateIdOf', () => {
      assertConversion("abc.hasTemplateIdOf('test')", "abc[cda:templateId[@root='1.2.3' and @extension='test']]");
    });

    it('should convert ofType', () => {
      assertConversion('abc.ofType(CDA.PQ)', "abc[@xsi:type='PQ']");
    });

    it('should convert startsWith', () => {
      assertConversion("abc.startsWith('elementary')", "abc[starts-with(., 'elementary')]");
    });

    it('should convert memberOf', () => {
      // TODO
    });

    describe('matches', () => {
      it('should convert matches', () => {
        assertConversion("abc.matches('[0-9]{5}(-[0-9]{4})?')", "abc[(string-length(normalize-space()) = 5 and translate(., '0123456789', '0000000000') = '00000') or (string-length(normalize-space()) = 10 and translate(., '0123456789', '0000000000') = '00000-0000')]")
      });

      it('should throw for unsupported matches', () => {
        assertFailure("abc.matches('wut')", 'Unsupported matches pattern');
      });
    });
  });

  describe('Basic operators', () => {
    it('should convert standard and/or', () => {
      assertConversion('abc and def', 'abc and def');
      assertConversion('abc or def', 'abc or def');
    });

    it('should convert each side of the operator', () => {
      assertConversion('abc.exists() and def.exists()', 'abc and def');
      assertConversion('abc.exists() or def.exists()', 'abc or def');
    });

    it('should convert xor', () => {
      assertConversion('abc xor def', 'abc and not(def) or def and not(abc)');
    });

    it('should convert each side of xor', () => {
      assertConversion('abc.exists() xor def.exists()', 'abc and not(def) or def and not(abc)');
    });
  });

  describe('Comparison', () => {
    it('should convert both sides of the expression normally', () => {
      assertConversion('abc.exists() = def.exists()', 'abc = def');
    });

    it('should normalize spaces', () => {
      assertConversion('abc=def', 'abc = def');
      assertConversion('abc= def', 'abc = def');
      assertConversion('abc =def', 'abc = def');
    });

    it('should throw if multiple comparators encountered', () => {
      assertFailure('abc = def = ghi', 'More than two operands');
    });
  });

  describe('Equivalence', () => {
    it('should support ~', () => {
      assertConversion('abc ~ def', '(not(abc) and not(def)) or abc = def');
    });

    it('should throw for !~', () => {
      assertFailure('abc !~ def', 'operator not supported');
    });
  });

  describe('Unsupported functions', () => {
    it('should throw for unsupported functions', () => {
      assertFailure('abc.def()', 'Unsupported function');
    });
  });
});

describe('Invariant helpers', () => {
  
  describe('unwrapParens', () => {
    const testStrings = [
      '',
      'abc.def',
      'abc(def)',
      'abc(def(ghi))',
      '(abc).def'
    ];
    for (const testString of testStrings) {
      it(`should leave normal strings alone from input: ${testString}`, () => {
        expect(unwrapParens(testString)).to.eql(testString);
      })
    };
    for (const testString of testStrings) {
      it(`should unwrap one set of parens from input: ${testString}`, () => {
        expect(unwrapParens(`(${testString})`)).to.eql(testString);
      });
    };
  });

  describe('removeDoubleBrackets', () => {
    it('should remove double-brackets around a string', () => {
      expect(removeDoubleBrackets('[[double]]')).to.eql('[double]');
    });

    it('should remove double brackets in the middle of a string', () => {
      expect(removeDoubleBrackets('something[[double]]')).to.eql('something[double]');
    });

    it('should remove double-brackets in complex strings', () => {
      expect(removeDoubleBrackets('something[[double[test]]]')).to.eql('something[double[test]]');
    });

    it('should remove multiple copies of double-brackets', () => {
      expect(removeDoubleBrackets('something[[double[test and [[even]] more [[nesting]]]]]')).to.eql('something[double[test and [even] more [nesting]]]');
    });

    it('should throw if bracket end is not a double-bracket', () => {
      expect(() => removeDoubleBrackets('[[mismatched] xpath]')).to.throw();
    });

    it('should throw if brackets do not match', () => {
      expect(() => removeDoubleBrackets('something[[is not right]')).to.throw();
    });
  });

  describe('deunionizeContains', () => {
    it('should leave normal expressions alone', () => {
      for (const expression of [
        'wut',
        'contains(a, b)',
        "not(((cda:delimiter | cda:family | cda:given | cda:prefix | cda:suffix))[@qualifier[self::node() = 'LS']])"
      ]) expect(deunionizeContains(expression)).to.eql(expression);
    });

    it('should deunionize two elements, regardless of number of parens or spacing', () => {
      expect(deunionizeContains("contains('a' | 'b')")).to.eql("contains('a b')");
      expect(deunionizeContains("contains(('a' | 'b'))")).to.eql("contains(('a b'))");
      expect(deunionizeContains("contains((('a' | 'b')))")).to.eql("contains((('a b')))");
      expect(deunionizeContains("contains((('a' |  'b')))")).to.eql("contains((('a b')))");
      expect(deunionizeContains("contains((('a'  | 'b')))")).to.eql("contains((('a b')))");
    });

    it('should deunionize three elements, regardless of number of parens or spacing', () => {
      expect(deunionizeContains("contains('a' | 'b' | 'c')")).to.eql("contains('a b c')");
      expect(deunionizeContains("contains(('a' | 'b' | 'c'))")).to.eql("contains(('a b c'))");
      expect(deunionizeContains("contains((('a' | 'b' | 'c')))")).to.eql("contains((('a b c')))");
      expect(deunionizeContains("contains((('a'  | 'b' |  'c')))")).to.eql("contains((('a b c')))");
      expect(deunionizeContains("contains((('a'    |   'b' |  'c')))")).to.eql("contains((('a b c')))");
    });

    it('should deunionize an actual output from C-CDA', () => {
      const input = "not((contains((('8287-5' | '8302-2' | '8306-3' | '9843-4')), cda:code/@code))) or cda:value/@unit = 'cm'";
      const output = "not((contains((('8287-5 8302-2 8306-3 9843-4')), cda:code/@code))) or cda:value/@unit = 'cm'";
      expect(deunionizeContains(input)).to.eql(output);
    });
  });

  describe('adjustLengths', () => {
    it('should convert > 10', () => {
      expect(adjustLengths('not(@value) or string-length(@value) &gt; 10'))
        .to.eql('not(@value) or string-length(@value) &gt; 8');
      expect(adjustLengths('not(@value) or string-length(@value) > 10'))
        .to.eql('not(@value) or string-length(@value) > 8');
    });

    it('should convert >= 10', () => {
      expect(adjustLengths('not(@value) or string-length(@value) &gt;= 10'))
        .to.eql('not(@value) or string-length(@value) &gt;= 8');
      expect(adjustLengths('not(@value) or string-length(@value) >= 10'))
        .to.eql('not(@value) or string-length(@value) >= 8');
    });

    it('should convert = 10', () => {
      expect(adjustLengths('not(@value) or string-length(@value) = 10'))
        .to.eql('not(@value) or string-length(@value) = 8');
    });

    it('should not convert other string-lengths', () => {
      for (const expression of [
        'string-length(@code &gt; 10)',
        'string-length(@value &gt; 4)',
        'string-length(normalize-space()) = 10'
      ]) {
        expect(adjustLengths(expression)).to.eql(expression);
      }
    });
  });

});