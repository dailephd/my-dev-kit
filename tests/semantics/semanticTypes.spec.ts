import { describe, expect, it } from 'vitest'
import type {
  SemanticArtifactRef,
  SemanticEvidenceRef,
  SemanticRole,
} from '../../src/semantics/index.js'

describe('semantic metadata contracts', () => {
  it('can construct a semantic role for a data entity', () => {
    const role: SemanticRole = {
      role: 'data-entity',
      subtype: 'canonical-type',
      confidence: 'explicit',
      source: 'typescript-model-analyzer',
      artifactRefs: [
        {
          artifact: 'data-model.json',
          artifactKind: 'data-model',
          id: 'entity:User',
          path: 'data-model.json',
        },
      ],
      evidenceRefs: [
        {
          filePath: 'src/models/user.ts',
          symbolId: 'symbol:src/models/user.ts#User',
          line: 12,
          analyzer: 'typescript-model-analyzer',
        },
      ],
    }

    expect(role.role).toBe('data-entity')
    expect(role.subtype).toBe('canonical-type')
    expect(role.artifactRefs?.[0].id).toBe('entity:User')
    expect(role.evidenceRefs?.[0].symbolId).toBe('symbol:src/models/user.ts#User')
  })

  it('can construct multiple semantic roles for one symbol', () => {
    const roles: SemanticRole[] = [
      {
        role: 'data-entity',
        subtype: 'canonical-type',
        confidence: 'explicit',
        source: 'typescript-model-analyzer',
      },
      {
        role: 'view-model',
        confidence: 'inferred-static',
        source: 'model-view-lineage-analyzer',
      },
    ]

    expect(roles.map((role) => role.role)).toEqual(['data-entity', 'view-model'])
  })

  it('can construct artifact refs', () => {
    const ref: SemanticArtifactRef = {
      artifact: 'data-model-graph.json',
      artifactKind: 'data-model-graph',
      id: 'data-model-entity:User',
      path: 'data-model-graph.json',
    }

    expect(ref.artifact).toBe('data-model-graph.json')
    expect(ref.id).toBe('data-model-entity:User')
  })

  it('can construct evidence refs', () => {
    const ref: SemanticEvidenceRef = {
      filePath: 'src/models/user.ts',
      symbolId: 'symbol:src/models/user.ts#User',
      line: 12,
      endLine: 18,
      source: 'symbol-index',
      analyzer: 'typescript-model-analyzer',
    }

    expect(ref.filePath).toBe('src/models/user.ts')
    expect(ref.line).toBe(12)
    expect(ref.endLine).toBe(18)
  })

  it('can represent unknown and partial confidence', () => {
    const roles: SemanticRole[] = [
      {
        role: 'unknown',
        confidence: 'unknown',
        source: 'unknown',
      },
      {
        role: 'data-field',
        confidence: 'partial',
        source: 'typescript-model-analyzer',
        warnings: [{ kind: 'partial-classification', message: 'Only field source evidence was available.' }],
      },
    ]

    expect(roles.map((role) => role.confidence)).toEqual(['unknown', 'partial'])
    expect(roles[1].warnings?.[0].kind).toBe('partial-classification')
  })

  it('does not require a code graph node shape', () => {
    const role: SemanticRole = {
      role: 'react-component',
      confidence: 'inferred-static',
      source: 'syntax-analyzer',
    }

    expect(role.role).toBe('react-component')
    expect('kind' in role).toBe(false)
  })

  it('does not require a data-model entity shape', () => {
    const role: SemanticRole = {
      role: 'data-entity',
      confidence: 'explicit',
      source: 'typescript-model-analyzer',
    }

    expect(role.role).toBe('data-entity')
    expect('fields' in role).toBe(false)
  })

  it('keeps structural node kind separate from semantic role metadata', () => {
    const graphLikeNode = {
      id: 'symbol:src/models/user.ts#User',
      kind: 'symbol' as const,
      semanticRoles: [
        {
          role: 'data-entity',
          confidence: 'explicit',
          source: 'typescript-model-analyzer',
        },
      ] satisfies SemanticRole[],
    }

    expect(graphLikeNode.kind).toBe('symbol')
    expect(graphLikeNode.semanticRoles[0].role).toBe('data-entity')
  })
})
