/**
 * Detailed static Android resource model (v1.10.0 Batch 3).
 *
 * Discovers resource directories via `discoverAndroidResourceDirectories`
 * (reusing v1.9.0 module/source-set detection and Batch 1 Gradle
 * resource-directory evidence), indexes every file in them, and assembles
 * the deterministic `android-resources.json` contract. Never simulates
 * resource merging/overlay precedence, never selects a runtime winner, and
 * never links to Batch 2 manifest resource references or Kotlin/Java source
 * (that cross-artifact relationship work is Batch 5's).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { toForwardSlash } from '../io/pathUtils.js'
import type { AndroidProjectArtifact } from './androidProjectTypes.js'
import type { AndroidGradleArtifact } from './androidGradleTypes.js'
import { discoverAndroidResourceDirectories } from './discoverAndroidResourceDirectories.js'
import { parseAndroidValuesResource } from './parseAndroidValuesResource.js'
import { parseAndroidResourceXmlFile } from './parseAndroidResourceFile.js'
import { parseXml } from './xml/parseXml.js'
import {
  ANDROID_RESOURCES_ARTIFACT_KIND,
  ANDROID_RESOURCES_SCHEMA_VERSION,
  type AndroidNetworkSecurityRecord,
  type AndroidResourceDefinition,
  type AndroidResourceDirectory,
  type AndroidResourceFile,
  type AndroidResourceFileDefinition,
  type AndroidResourceFileKind,
  type AndroidResourceFileProviderPathEntry,
  type AndroidResourceIdDefinition,
  type AndroidResourceLayout,
  type AndroidResourceReference,
  type AndroidResourcesArtifact,
  type BuildAndroidResourceProjectResult,
} from './androidResourceTypes.js'

export interface BuildAndroidResourceProjectOptions {
  projectRoot: string
  androidProject: AndroidProjectArtifact
  androidGradle: AndroidGradleArtifact
  /** Defaults to the current time, mirroring the other Android builders' self-contained timestamp convention. */
  createdAt?: string
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc'])

export function buildAndroidResourceProject(options: BuildAndroidResourceProjectOptions): BuildAndroidResourceProjectResult {
  const { projectRoot, androidProject, androidGradle, createdAt = new Date().toISOString() } = options

  const discovery = discoverAndroidResourceDirectories(projectRoot, androidProject, androidGradle)
  const warnings: string[] = [...discovery.warnings]
  const filesExamined = new Set<string>()

  // Content hashes are not part of the public artifact shape (binary bytes
  // aren't meaningful evidence to persist), but they must still feed the
  // evidence fingerprint — otherwise editing a binary drawable/mipmap/font/raw
  // file's bytes without touching its path would never invalidate the
  // incremental cache, since nothing else about that file's record changes.
  const fileContentHashes: Record<string, string> = {}

  const resourceFiles: AndroidResourceFile[] = []
  const valueDefinitions: AndroidResourceDefinition[] = []
  const fileDefinitions: AndroidResourceFileDefinition[] = []
  const layouts: AndroidResourceLayout[] = []
  const idDefinitions: AndroidResourceIdDefinition[] = []
  const references: AndroidResourceReference[] = []
  const fileProviderPaths: AndroidResourceFileProviderPathEntry[] = []
  const networkSecurityRecords: AndroidNetworkSecurityRecord[] = []

  for (const dir of discovery.directories) {
    for (const filename of listFiles(projectRoot, dir.path)) {
      const relPath = toForwardSlash(`${dir.path}/${filename}`)
      filesExamined.add(relPath)
      const extension = extname(filename)
      const resourceName = filename.replace(/\.[^.]+$/, '')
      const fileId = `android-resource-file:${relPath}`

      const fileKind = classifyFileKind(dir.baseType, extension)
      let parsingStatus: 'parsed' | 'malformed' | 'not-applicable' = 'not-applicable'
      let xmlRootElement: string | null = null
      const fileWarnings: string[] = []
      const definitionIds: string[] = []
      const idDefinitionIds: string[] = []
      const referenceIds: string[] = []
      const fileProviderPathIds: string[] = []
      const networkSecurityRecordIds: string[] = []

      if (fileKind === 'xml') {
        const xmlText = readFile(projectRoot, relPath)
        if (xmlText === null) {
          fileWarnings.push(`Resource file "${relPath}" could not be read.`)
          parsingStatus = 'malformed'
        } else if (dir.baseType === 'values') {
          const { root, error } = parseXml(xmlText)
          if (!root || error) {
            parsingStatus = 'malformed'
            fileWarnings.push(error ?? 'Malformed XML: no root element found.')
          } else {
            parsingStatus = 'parsed'
            xmlRootElement = root.name
            const result = parseAndroidValuesResource(root, {
              fileId,
              filePath: relPath,
              moduleId: dir.moduleId,
              sourceSet: dir.sourceSet,
              qualifiers: dir.qualifiers,
            })
            valueDefinitions.push(...result.definitions)
            references.push(...result.references)
            definitionIds.push(...result.definitions.map((d) => d.id))
            referenceIds.push(...result.references.map((r) => r.id))
          }
        } else {
          const result = parseAndroidResourceXmlFile(xmlText, {
            fileId,
            filePath: relPath,
            moduleId: dir.moduleId,
            sourceSet: dir.sourceSet,
            qualifiers: dir.qualifiers,
            baseType: dir.baseType,
            resourceName,
          })
          parsingStatus = result.parsingStatus
          xmlRootElement = result.xmlRootElement
          fileWarnings.push(...result.warnings)
          references.push(...result.references)
          referenceIds.push(...result.references.map((r) => r.id))
          idDefinitions.push(...result.idDefinitions)
          idDefinitionIds.push(...result.idDefinitions.map((d) => d.id))
          if (result.layout) {
            layouts.push(result.layout)
            definitionIds.push(result.layout.id)
          }
          if (result.fileDefinition) {
            const fd = { ...result.fileDefinition, extension }
            fileDefinitions.push(fd)
            definitionIds.push(fd.id)
          }
          fileProviderPaths.push(...result.fileProviderPaths)
          fileProviderPathIds.push(...result.fileProviderPaths.map((p) => p.id))
          networkSecurityRecords.push(...result.networkSecurityRecords)
          networkSecurityRecordIds.push(...result.networkSecurityRecords.map((r) => r.id))
        }
      } else if (dir.baseType !== 'values') {
        // Binary/non-XML file-based resource (bitmap, font, raw): still a
        // real resource definition, just with no parseable XML evidence.
        const fd: AndroidResourceFileDefinition = {
          id: `${fileId}#file-definition`,
          key: { packageScope: null, type: baseTypeToResourceType(dir.baseType), name: resourceName },
          type: baseTypeToResourceType(dir.baseType),
          name: resourceName,
          moduleId: dir.moduleId,
          sourceSet: dir.sourceSet,
          qualifiers: dir.qualifiers,
          fileId,
          file: relPath,
          extension,
          xmlRootElement: null,
          referenceIds: [],
          declaredIdIds: [],
          source: { file: relPath, line: 1, column: 1 },
          warnings: [],
        }
        fileDefinitions.push(fd)
        definitionIds.push(fd.id)
      }
      if (fileKind !== 'xml') {
        fileContentHashes[relPath] = hashFileContent(projectRoot, relPath)
      }

      resourceFiles.push({
        id: fileId,
        path: relPath,
        moduleId: dir.moduleId,
        gradlePath: dir.gradlePath,
        sourceSet: dir.sourceSet,
        resourceDirectoryId: dir.id,
        baseType: dir.baseType,
        rawDirectoryName: dir.rawDirectoryName,
        qualifiers: dir.qualifiers,
        filename,
        extension,
        resourceName: dir.baseType === 'values' ? null : resourceName,
        fileKind,
        xmlRootElement,
        source: { file: relPath, line: 1, column: 1 },
        parsingStatus,
        warnings: fileWarnings,
        definitionIds: [...new Set(definitionIds)].sort(),
        idDefinitionIds: [...new Set(idDefinitionIds)].sort(),
        referenceIds: [...new Set(referenceIds)].sort(),
        fileProviderPathIds: [...new Set(fileProviderPathIds)].sort(),
        networkSecurityRecordIds: [...new Set(networkSecurityRecordIds)].sort(),
      })
      warnings.push(...fileWarnings.map((w) => `${relPath}: ${w}`))
    }
  }

  // Candidate-target enumeration: match each reference/id-reference against
  // every statically-known local definition sharing its logical resource
  // key. Never selects a single winner — all matches are preserved.
  const definitionIdsByKey = buildDefinitionIndex(valueDefinitions, fileDefinitions, layouts, idDefinitions)
  for (const reference of references) {
    if (!reference.resourceType || !reference.resourceName) continue
    if (reference.kind === 'framework-resource' || reference.kind === 'null-or-empty' || reference.kind === 'unresolved') continue
    const candidates = definitionIdsByKey.get(`${reference.resourceType}/${reference.resourceName}`)
    if (candidates) reference.candidateTargetIds = [...candidates].sort()
  }

  const detected = resourceFiles.length > 0

  const artifact: AndroidResourcesArtifact = {
    artifactKind: ANDROID_RESOURCES_ARTIFACT_KIND,
    schemaVersion: ANDROID_RESOURCES_SCHEMA_VERSION,
    createdAt,
    projectRoot: toForwardSlash(projectRoot),
    detected,
    filesExamined: [...filesExamined].sort(),
    resourceDirectories: sortById(discovery.directories),
    resourceFiles: sortById(resourceFiles),
    valueDefinitions: sortById(valueDefinitions),
    fileDefinitions: sortById(fileDefinitions),
    layouts: sortById(layouts),
    idDefinitions: sortById(idDefinitions),
    references: sortById(references),
    fileProviderPaths: sortById(fileProviderPaths),
    networkSecurityRecords: sortById(networkSecurityRecords),
    warnings: [...new Set(warnings)].sort(),
    summary: {
      moduleCount: new Set(discovery.directories.map((d) => d.moduleId)).size,
      sourceSetCount: new Set(discovery.directories.map((d) => `${d.moduleId}#${d.sourceSet}`)).size,
      resourceDirectoryCount: discovery.directories.length,
      resourceFileCount: resourceFiles.length,
      valueResourceCount: valueDefinitions.length,
      fileResourceCount: fileDefinitions.length,
      layoutCount: layouts.length,
      viewIdCount: idDefinitions.length,
      referenceCount: references.length,
      specializedConfigCount: fileProviderPaths.length + networkSecurityRecords.length,
      warningCount: [...new Set(warnings)].length,
    },
  }

  return { artifact, evidenceFingerprint: computeEvidenceFingerprint(artifact, fileContentHashes) }
}

function buildDefinitionIndex(
  valueDefinitions: AndroidResourceDefinition[],
  fileDefinitions: AndroidResourceFileDefinition[],
  layouts: AndroidResourceLayout[],
  idDefinitions: AndroidResourceIdDefinition[]
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const add = (type: string, name: string, id: string) => {
    const key = `${type}/${name}`
    const set = index.get(key) ?? new Set<string>()
    set.add(id)
    index.set(key, set)
  }
  for (const def of valueDefinitions) add(def.type, def.name, def.id)
  for (const def of fileDefinitions) add(def.type, def.name, def.id)
  for (const layout of layouts) add('layout', layout.key.name, layout.id)
  for (const idDef of idDefinitions) add('id', idDef.key.name, idDef.id)
  return index
}

function baseTypeToResourceType(baseType: AndroidResourceFile['baseType']): AndroidResourceDefinition['type'] {
  switch (baseType) {
    case 'drawable':
      return 'drawable'
    case 'mipmap':
      return 'mipmap'
    case 'xml':
      return 'xml'
    case 'raw':
      return 'raw'
    case 'menu':
      return 'menu'
    case 'anim':
      return 'anim'
    case 'animator':
      return 'animator'
    case 'color':
      return 'color'
    case 'font':
      return 'font'
    case 'navigation':
      return 'navigation'
    case 'layout':
      return 'layout'
    default:
      return 'unknown'
  }
}

function classifyFileKind(baseType: string, extension: string): AndroidResourceFileKind {
  if (extension === '.xml') return 'xml'
  if (IMAGE_EXTENSIONS.has(extension)) return 'bitmap'
  if (FONT_EXTENSIONS.has(extension)) return 'font'
  if (baseType === 'raw') return 'raw'
  return 'unknown'
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function computeEvidenceFingerprint(artifact: AndroidResourcesArtifact, fileContentHashes: Record<string, string>): string {
  const stable = { ...artifact, createdAt: '', projectRoot: '' }
  const sortedHashes = Object.fromEntries(Object.entries(fileContentHashes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return createHash('sha256').update(JSON.stringify({ stable, sortedHashes })).digest('hex')
}

function hashFileContent(projectRoot: string, relPath: string): string {
  try {
    const buffer = fs.readFileSync(path.join(projectRoot, ...relPath.split('/')))
    return createHash('sha256').update(buffer).digest('hex')
  } catch {
    return 'unreadable'
  }
}

function extname(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx === -1 ? '' : filename.slice(idx).toLowerCase()
}

function listFiles(projectRoot: string, relDir: string): string[] {
  try {
    return fs
      .readdirSync(path.join(projectRoot, ...relDir.split('/')), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function readFile(projectRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(projectRoot, ...relPath.split('/')), 'utf8')
  } catch {
    return null
  }
}

