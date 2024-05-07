import { describe, expect, it } from "vitest";
import { flattenConcepts, removeDoubleBrackets, unwrapParens } from "../src/utils/helpers";

describe('Helper tests', () => {
  describe('flattenConcepts', () => {
    it('should return input when nothing contains ... uh... contains', () => {
      const concepts = [{
        code: 'abc',
        system: '123'
      }];
      expect(flattenConcepts(concepts)).to.eql(concepts);
    });

    it('should flatten one level of contains', () => {
      const concepts = [{
        code: 'abc',
        system: '123'
      }, {
        code: 'def',
        system: '123',
        contains: [{
          code: 'ghi',
          system: '123'
        }]
      }];
      
      expect(flattenConcepts(concepts)).to.eql([{
        code: 'abc',
        system: '123'
      }, {
        code: 'def',
        system: '123',
      }, {
        code: 'ghi',
        system: '123'
      }]);
    });

    it('should flatten multiple levels of contains', () => {
      const concepts = [{
        code: 'abc',
        system: '123'
      }, {
        code: 'def',
        system: '123',
        contains: [{
          code: 'ghi',
          system: '123',
          contains: [{
            code: 'jkl',
            system: '123',
          }]
        }]
      }];
      expect(flattenConcepts(concepts)).to.eql([{
        code: 'abc',
        system: '123'
      }, {
        code: 'def',
        system: '123',
      }, {
        code: 'ghi',
        system: '123'
        }, {
        code: 'jkl',
        system: '123',
      }]);
    })
  });
  
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
});