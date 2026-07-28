export interface PreservationManifest {
  roadmap: {
    path: string
    requiredVersionHeadings: string[]
    requiredOrder: string[]
    forbiddenVersionRangeSubstitutions: string[]
    requiredStructuralSections: string[]
    publishedVersions: string[]
    implementedUnreleasedVersions: string[]
    futureVersionScopeKeywords: Record<string, string[]>
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
  artifacts: {
    paths: string[]
    requiredArtifactFamilies: string[]
  }
  commands: {
    path: string
    requiredCommandFamilies: string[]
  }
  workflows: {
    path: string
    requiredWorkflowFamilies: string[]
  }
  statusBoundaries: {
    documentKeywords: Record<string, string[]>
    requiredBoundaryKeywords: string[]
    boundaryPaths: string[]
  }
  release: {
    path: string
    requiredSections: string[]
    requiredSafetyPhrase: string
  }
  changelog: {
    path: string
    requiredVersionHeadings: string[]
    requiredUnreleasedVersionHeadings: string[]
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

function versionSection(content: string, version: string): string | undefined {
  const heading = `## Version ${version}`
  const start = content.indexOf(heading)
  if (start === -1) return undefined
  const next = content.indexOf('\n## Version ', start + heading.length)
  return content.slice(start, next === -1 ? content.length : next)
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

    // Published versions cannot drift back to planned status.
    for (const version of manifest.roadmap.publishedVersions) {
      const section = versionSection(roadmapContent, version)
      if (section !== undefined && /\*\*Status:\s*planned\b/i.test(section)) {
        violations.push({
          document: manifest.roadmap.path,
          rule: 'roadmap-published-status',
          expected: `Version ${version} not to be marked planned`,
          actual: `Version ${version} contains a planned status`,
          recommendation: `Restore the evidence-backed published status for v${version}; implementation and publication history must not be rewritten as future work.`,
        })
      }
    }

    // Implemented-but-unreleased versions cannot be marked published.
    for (const version of manifest.roadmap.implementedUnreleasedVersions) {
      const section = versionSection(roadmapContent, version)
      if (section !== undefined && /\*\*Status:\s*published\b/i.test(section)) {
        violations.push({
          document: manifest.roadmap.path,
          rule: 'roadmap-unreleased-not-published',
          expected: `Version ${version} to remain implemented but unreleased until external publication evidence exists`,
          actual: `Version ${version} is marked published`,
          recommendation: `Restore v${version}'s implemented-but-unreleased status. Do not infer publication from repository implementation.`,
        })
      }
    }

    // Future scopes stay in their assigned version sections.
    for (const [version, keywords] of Object.entries(manifest.roadmap.futureVersionScopeKeywords)) {
      const section = versionSection(roadmapContent, version)
      if (section === undefined) continue
      for (const keyword of keywords) {
        if (!section.includes(keyword)) {
          violations.push({
            document: manifest.roadmap.path,
            rule: 'roadmap-future-scope',
            expected: `Version ${version} section to contain "${keyword}"`,
            actual: `"${keyword}" not found in the Version ${version} section`,
            recommendation: `Restore the approved future scope for v${version}; do not delete or reassign planned work without explicit authorization.`,
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

  // Artifact families: at least one canonical owning document must retain each artifact.
  for (const artifact of manifest.artifacts.requiredArtifactFamilies) {
    const foundInAny = manifest.artifacts.paths.some((path) => documents[path]?.includes(artifact))
    if (!foundInAny) {
      violations.push({
        document: manifest.artifacts.paths.join(' | '),
        rule: 'artifact-family-present',
        expected: `at least one artifact-owning document containing "${artifact}"`,
        actual: `"${artifact}" not found in any of: ${manifest.artifacts.paths.join(', ')}`,
        recommendation: `Artifact family "${artifact}" appears undocumented. Restore it in the README, architecture, or graph-schema documentation.`,
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

  // Current, published, unreleased, and future distinctions in canonical documents.
  for (const [path, keywords] of Object.entries(manifest.statusBoundaries.documentKeywords)) {
    violations.push(
      ...missingKeywordViolations(
        path,
        documents[path],
        'current-future-status-boundary',
        keywords,
        'A required current, published, unreleased, or future status boundary is missing.',
      ),
    )
  }

  // Static-analysis and manual-workflow boundaries may be distributed across owning documents.
  for (const keyword of manifest.statusBoundaries.requiredBoundaryKeywords) {
    const foundInAny = manifest.statusBoundaries.boundaryPaths.some((path) =>
      documents[path]?.includes(keyword),
    )
    if (!foundInAny) {
      violations.push({
        document: manifest.statusBoundaries.boundaryPaths.join(' | '),
        rule: 'static-analysis-boundary-present',
        expected: `at least one boundary-owning document containing "${keyword}"`,
        actual: `"${keyword}" not found in any boundary-owning document`,
        recommendation: `Restore the "${keyword}" limitation or workflow boundary; do not overstate static evidence or automatic integration.`,
      })
    }
  }

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
  violations.push(
    ...missingKeywordViolations(
      manifest.changelog.path,
      documents[manifest.changelog.path],
      'changelog-unreleased-version-present',
      manifest.changelog.requiredUnreleasedVersionHeadings,
      'The implemented-but-unreleased CHANGELOG entry is missing.',
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
