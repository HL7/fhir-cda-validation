import { describe, expect, it, vi } from 'vitest';
import { voc } from '../src/processing/terminology';

describe('Terminology Tests', () => {
  describe('primitiveExpand', () => {
    it('should return false for already expanded ValueSet', () => {
      expect(voc.primitiveExpand({
        resourceType: 'ValueSet',
        expansion: {
          contains: []
        }
      })).toBe(false);
    });

    it('should return false if compose includes filters', () => {
      expect(voc.primitiveExpand({
        resourceType: 'ValueSet',
        compose: {
          include: [{
            filter: [{ property: 'code', op: 'equals', value: '123' }]
          }]
        }
      })).toBe(false);
    });

    it('should return false if compose excludes', () => {
      expect(voc.primitiveExpand({
        resourceType: 'ValueSet',
        compose: {
          exclude: [{ system: 'http://example.com', code: '123' }]
        }
      })).toBe(false);
    });

    it('should copy the include system and codes into expansion', () => {
      const vs = {
        resourceType: 'ValueSet',
        compose: {
          include: [{
            system: 'http://example.com',
            version: '1.0',
            concept: [
              { code: '123', display: 'first' }, 
              { code: '456', display: 'second' }
            ]
          }]
        }
      };

      const expanded = voc.primitiveExpand(vs);
      expect(expanded).toBe(true);
      expect(vs.expansion.contains).toEqual([
          { system: 'http://example.com', version: '1.0', code: '123', display: 'first' },
          { system: 'http://example.com', version: '1.0', code: '456', display: 'second' }
      ]);
    })
  });
});