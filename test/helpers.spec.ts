import { describe, expect, it } from "vitest";
import { flattenConcepts } from "../src/utils/helpers";

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
});