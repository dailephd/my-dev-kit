import { describe, expect, it } from 'vitest'
import { validateSliceInputs } from '../../src/graph/sliceGraph.js'
import { validateDepth } from '../../src/lookup/lookupNode.js'
import { validateLineRange } from '../../src/lookup/getSourceSlice.js'

describe('traversal and range limit enforcement', () => {
  describe('slice depth limits', () => {
    it('accepts depth 0', () => {
      expect(() => validateSliceInputs(0, 'both')).not.toThrow()
    })

    it('accepts depth 3', () => {
      expect(() => validateSliceInputs(3, 'both')).not.toThrow()
    })

    it('rejects depth 4', () => {
      expect(() => validateSliceInputs(4, 'both')).toThrow('3')
    })

    it('rejects negative depth', () => {
      expect(() => validateSliceInputs(-1, 'both')).toThrow()
    })

    it('rejects non-integer depth', () => {
      expect(() => validateSliceInputs(1.5, 'both')).toThrow()
    })

    it('rejects invalid direction', () => {
      expect(() => validateSliceInputs(1, 'sideways' as never)).toThrow('Direction')
    })

    it('accepts all valid directions', () => {
      for (const dir of ['both', 'incoming', 'outgoing'] as const) {
        expect(() => validateSliceInputs(1, dir)).not.toThrow()
      }
    })
  })

  describe('lookup depth limits', () => {
    it('accepts depth 0', () => {
      expect(() => validateDepth(0)).not.toThrow()
    })

    it('accepts depth 3', () => {
      expect(() => validateDepth(3)).not.toThrow()
    })

    it('rejects depth 4', () => {
      expect(() => validateDepth(4)).toThrow('3')
    })

    it('rejects negative depth', () => {
      expect(() => validateDepth(-1)).toThrow()
    })

    it('rejects non-integer depth', () => {
      expect(() => validateDepth(2.5)).toThrow()
    })
  })

  describe('source line range limits', () => {
    it('accepts a valid range within max-lines', () => {
      expect(() => validateLineRange(1, 10, 160)).not.toThrow()
    })

    it('accepts a single-line range', () => {
      expect(() => validateLineRange(5, 5, 160)).not.toThrow()
    })

    it('rejects start greater than end', () => {
      expect(() => validateLineRange(10, 5, 160)).toThrow()
    })

    it('rejects start line 0', () => {
      expect(() => validateLineRange(0, 5, 160)).toThrow()
    })

    it('rejects negative start line', () => {
      expect(() => validateLineRange(-1, 5, 160)).toThrow()
    })

    it('rejects range exceeding max-lines', () => {
      expect(() => validateLineRange(1, 161, 160)).toThrow('exceeds --max-lines')
    })

    it('accepts range exactly equal to max-lines', () => {
      expect(() => validateLineRange(1, 160, 160)).not.toThrow()
    })

    it('rejects non-integer start', () => {
      expect(() => validateLineRange(1.5, 5, 160)).toThrow()
    })

    it('rejects non-integer end', () => {
      expect(() => validateLineRange(1, 5.5, 160)).toThrow()
    })

    it('rejects max-lines of 0', () => {
      expect(() => validateLineRange(1, 1, 0)).toThrow()
    })
  })
})
