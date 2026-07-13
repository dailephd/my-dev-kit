export interface PreservationManifest {
  roadmap: {
    path: string
    requiredVersionHeadings: string[]
    requiredOrder: string[]
    forbiddenVersionRangeSubstitutions: string[]
    requiredStructuralSections: string[]
    androidVersionScopeKeywords: Record<string, string[]>
  }
  readme: {
    path: string
    requiredPillarKeywords: string[]
  }
  projectOverview: {
    path: string
    requiredSections: string[]
  }
  architecture: {
    paths: string[]
    requiredDomainKeywords: string[]
  }
  commands: {
    path: string
    requiredCommandFamilies: string[]
  }
  workflows: {
    path: string
    requiredWorkflowFamilies: string[]
  }
  release: {
    path: string
    requiredSections: string[]
    requiredSafetyPhrase: string
  }
  changelog: {
    path: string
    requiredVersionHeadings: string[]
  }
  security: {
    path: string
    requiredBoundaryKeywords: string[]
  }
}

export interface PreservationViolation {
  document: string
  rule: string
  expected: string
  actual: string
  recommendation: string
}

export type DocumentContents = Record<string, string>

function missingKeywordViolations(
  document: string,
  content: string | undefined,
  rule: string,
  requiredKeywords: string[],
  recommendationPrefix: string,
): PreservationViolation[] {
  if (content === undefined) {
    return [
      {
        document,
        rule,
        expected: `document to exist`,
        actual: `document not found`,
        recommendation: `Restore ${document} — it is required by the documentation-preservation manifest.`,
      },
    ]
  }
  const violations: PreservationViolation[] = []
  for (const keyword of requiredKeywords) {
    if (!content.includes(keyword)) {
      violations.push({
        document,
        rule,
        expected: `content containing "${keyword}"`,
        actual: `"${keyword}" not found`,
        recommendation: `${recommendationPrefix} "${keyword}" appears to have been removed. Restore it or record an explicit, evidence-backed reassignment in the recovery decision ledger.`,
      })
    }
  }
  return violations
}

export function checkDocumentationPreservation(
  manifest: PreservationManifest,
  documents: DocumentContents,
): PreservationViolation[] {
  const violations: PreservationViolation[] = []

  // Roadmap: version headings present
  violations.push(
    ...missingKeywordViolations(
      manifest.roadmap.path,
      documents[manifest.roadmap.path],
      'roadmap-version-present',
      manifest.roadmap.requiredVersionHeadings,
      'A required roadmap version heading is missing.',
    ),
  )

  const roadmapContent = documents[manifest.roadmap.path]
  if (roadmapContent !== undefined) {
    // Roadmap: version order preserved
    const foundOrder: string[] = []
    for (const heading of manifest.roadmap.requiredVersionHeadings) {
      const idx = roadmapContent.indexOf(heading)
      if (idx >= 0) foundOrder.push(heading)
    }
    const sortedByPosition = [...foundOrder].sort(
      (a, b) => roadmapContent.indexOf(a) - roadmapContent.indexOf(b),
    )
    for (let i = 0; i < foundOrder.length; i++) {
      if (foundOrder[i] !== sortedByPosition[i]) {
        violations.push({
          document: manifest.roadmap.path,
          rule: 'roadmap-version-order',
          expected: `version headings in semantic order: ${manifest.roadmap.requiredVersionHeadings.join(', ')}`,
          actual: `order was disturbed at "${foundOrder[i]}"`,
          recommendation:
            'Do not reorder roadmap version sections. Restore the established semantic/historical order.',
        })
        break
      }
    }

    // Roadmap: forbidden range substitutions
    for (const forbidden of manifest.roadmap.forbiddenVersionRangeSubstitutions) {
      if (roadmapContent.includes(forbidden)) {
        violations.push({
          document: manifest.roadmap.path,
          rule: 'roadmap-no-version-ranges',
          expected: `individual version sections, not a merged range`,
          actual: `found forbidden range substitution "${forbidden}"`,
          recommendation:
            'Individually planned versions must not be collapsed into a version range. Split the range back into separate version sections.',
        })
      }
    }

    // Roadmap: required structural sections
    violations.push(
      ...missingKeywordViolations(
        manifest.roadmap.path,
        roadmapContent,
        'roadmap-structural-section',
        manifest.roadmap.requiredStructuralSections,
        'A required roadmap structural section is missing.',
      ),
    )

    // Roadmap: Android version scope keywords stay in their assigned version
    for (const [version, keywords] of Object.entries(manifest.roadmap.androidVersionScopeKeywords)) {
      const heading = `## Version ${version}`
      const startIdx = roadmapContent.indexOf(heading)
      if (startIdx === -1) continue
      const nextHeadingIdx = roadmapContent.indexOf('\n## Version ', startIdx + heading.length)
      const sectionEnd = nextHeadingIdx === -1 ? roadmapContent.length : nextHeadingIdx
      const section = roadmapContent.slice(startIdx, sectionEnd)
      for (const keyword of keywords) {
        if (!section.includes(keyword)) {
          violations.push({
            document: manifest.roadmap.path,
            rule: 'roadmap-android-scope',
            expected: `Version ${version} section to mention "${keyword}"`,
            actual: `"${keyword}" not found in the Version ${version} section`,
            recommendation: `Android roadmap scope for v${version} appears to have drifted. Confirm the feature was not silently moved to a different version without evidence.`,
          })
        }
      }
    }
  }

  // README pillars
  violations.push(
    ...missingKeywordViolations(
      manifest.readme.path,
      documents[manifest.readme.path],
      'readme-pillar-present',
      manifest.readme.requiredPillarKeywords,
      'A required README pillar is missing.',
    ),
  )

  // Project overview sections
  violations.push(
    ...missingKeywordViolations(
      manifest.projectOverview.path,
      documents[manifest.projectOverview.path],
      'project-overview-section-present',
      manifest.projectOverview.requiredSections,
      'A required PROJECT_OVERVIEW section is missing.',
    ),
  )

  // Architecture domains: at least one of the architecture-owning documents must mention each keyword
  for (const keyword of manifest.architecture.requiredDomainKeywords) {
    const foundInAny = manifest.architecture.paths.some((path) => documents[path]?.includes(keyword))
    if (!foundInAny) {
      violations.push({
        document: manifest.architecture.paths.join(' | '),
        rule: 'architecture-domain-present',
        expected: `at least one architecture document containing "${keyword}"`,
        actual: `"${keyword}" not found in any of: ${manifest.architecture.paths.join(', ')}`,
        recommendation: `Architecture domain "${keyword}" appears undocumented. Restore coverage in docs/ARCHITECTURE.md or docs/GRAPH_SCHEMA.md.`,
      })
    }
  }

  // Command families
  violations.push(
    ...missingKeywordViolations(
      manifest.commands.path,
      documents[manifest.commands.path],
      'command-family-present',
      manifest.commands.requiredCommandFamilies.map((c) => `\`${c}\``),
      'A required implemented command family is missing from the command reference.',
    ),
  )

  // Workflow families
  violations.push(
    ...missingKeywordViolations(
      manifest.workflows.path,
      documents[manifest.workflows.path],
      'workflow-family-present',
      manifest.workflows.requiredWorkflowFamilies,
      'A required workflow family is missing.',
    ),
  )

  // Release sections and safety gate
  violations.push(
    ...missingKeywordViolations(
      manifest.release.path,
      documents[manifest.release.path],
      'release-section-present',
      manifest.release.requiredSections,
      'A required RELEASE.md section is missing.',
    ),
  )
  const releaseContent = documents[manifest.release.path]
  if (releaseContent !== undefined && !releaseContent.includes(manifest.release.requiredSafetyPhrase)) {
    violations.push({
      document: manifest.release.path,
      rule: 'release-safety-gate-present',
      expected: `content containing "${manifest.release.requiredSafetyPhrase}"`,
      actual: 'safety-gate phrase not found',
      recommendation:
        'The human-authorization safety gate before npm publish is missing. Restore an explicit "do not publish without human authorization" statement.',
    })
  }

  // Changelog version headings
  violations.push(
    ...missingKeywordViolations(
      manifest.changelog.path,
      documents[manifest.changelog.path],
      'changelog-version-present',
      manifest.changelog.requiredVersionHeadings,
      'A published CHANGELOG version entry is missing.',
    ),
  )

  // Security boundary keywords
  violations.push(
    ...missingKeywordViolations(
      manifest.security.path,
      documents[manifest.security.path],
      'security-boundary-present',
      manifest.security.requiredBoundaryKeywords,
      'A required security-boundary note is missing.',
    ),
  )

  return violations
}
