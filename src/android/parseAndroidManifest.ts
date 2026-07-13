/**
 * Conservative static parser for a single `AndroidManifest.xml` file.
 *
 * Built on the bounded, non-executing XML parser in `xml/parseXml.ts`. Never
 * simulates Android manifest merging (each source-set manifest is parsed and
 * preserved independently), never resolves resource references, never
 * claims runtime intent/deep-link/permission behavior. Ambiguous component
 * names are left unresolved with a warning rather than guessed at.
 */

import {
  parseXml,
  findAndroidNamespacePrefix,
  getAndroidAttr,
  findChildren,
  type XmlElement,
} from './xml/parseXml.js'
import type {
  AndroidManifestActionEvidence,
  AndroidManifestApplicationEvidence,
  AndroidManifestAttributeValue,
  AndroidManifestCategoryEvidence,
  AndroidManifestComponentEvidence,
  AndroidManifestComponentKind,
  AndroidManifestDataEvidence,
  AndroidManifestDeclaredPermissionEvidence,
  AndroidManifestDeepLinkCandidate,
  AndroidManifestFileRecord,
  AndroidManifestGrantUriPermissionEvidence,
  AndroidManifestIntentFilterEvidence,
  AndroidManifestLauncherCandidate,
  AndroidManifestMetadataEvidence,
  AndroidManifestPathPermissionEvidence,
  AndroidManifestPermissionEvidence,
  AndroidManifestResourceReference,
  AndroidManifestSourceRef,
  AndroidManifestUsesFeatureEvidence,
  AndroidManifestUsesSdkEvidence,
  ManifestDiscoverySource,
  ResolvedComponentName,
} from './androidManifestTypes.js'

export interface ParseAndroidManifestContext {
  filePath: string
  moduleId: string
  gradlePath: string | null
  sourceSet: string
  discoverySource: ManifestDiscoverySource
  gradleNamespace: string | null
  applicationId: string | null
}

export interface ParseAndroidManifestResult {
  record: AndroidManifestFileRecord
  applications: AndroidManifestApplicationEvidence[]
  components: AndroidManifestComponentEvidence[]
  intentFilters: AndroidManifestIntentFilterEvidence[]
  launcherCandidates: AndroidManifestLauncherCandidate[]
  deepLinkCandidates: AndroidManifestDeepLinkCandidate[]
  permissions: AndroidManifestPermissionEvidence[]
  declaredPermissions: AndroidManifestDeclaredPermissionEvidence[]
  usesFeatures: AndroidManifestUsesFeatureEvidence[]
  metadata: AndroidManifestMetadataEvidence[]
}

const COMPONENT_TAGS: Record<string, AndroidManifestComponentKind> = {
  activity: 'activity',
  'activity-alias': 'activity-alias',
  service: 'service',
  receiver: 'receiver',
  provider: 'provider',
}

export function parseAndroidManifest(xmlText: string, context: ParseAndroidManifestContext): ParseAndroidManifestResult {
  const manifestFileId = `android-manifest-file:${context.filePath}`
  const { root, error } = parseXml(xmlText)

  if (!root || error) {
    return {
      record: {
        id: manifestFileId,
        path: context.filePath,
        moduleId: context.moduleId,
        gradlePath: context.gradlePath,
        sourceSet: context.sourceSet,
        discoverySource: context.discoverySource,
        packageAttr: null,
        gradleNamespace: context.gradleNamespace,
        applicationId: context.applicationId,
        versionCode: null,
        versionName: null,
        sharedUserId: null,
        installLocation: null,
        usesSdk: null,
        source: { file: context.filePath, line: 1, column: 1 },
        parsingStatus: 'malformed',
        warnings: [error ?? 'Malformed XML: no root element found.'],
        counts: { permissionCount: 0, declaredPermissionCount: 0, featureCount: 0, componentCount: 0, intentFilterCount: 0 },
      },
      applications: [],
      components: [],
      intentFilters: [],
      launcherCandidates: [],
      deepLinkCandidates: [],
      permissions: [],
      declaredPermissions: [],
      usesFeatures: [],
      metadata: [],
    }
  }

  const prefix = findAndroidNamespacePrefix(root)
  const warnings: string[] = []
  const sourceRefOf = (el: XmlElement): AndroidManifestSourceRef => ({ file: context.filePath, line: el.line, column: el.column })
  const attr = (el: XmlElement, name: string): string | undefined => getAndroidAttr(el, name, prefix)

  const packageAttr = root.attributes['package'] ?? null

  const usesSdkEl = findChildren(root, 'uses-sdk')[0] ?? null
  const usesSdk: AndroidManifestUsesSdkEvidence | null = usesSdkEl
    ? {
        minSdkVersion: attr(usesSdkEl, 'minSdkVersion') ?? null,
        targetSdkVersion: attr(usesSdkEl, 'targetSdkVersion') ?? null,
        maxSdkVersion: attr(usesSdkEl, 'maxSdkVersion') ?? null,
        source: sourceRefOf(usesSdkEl),
      }
    : null

  // -- Permissions ----------------------------------------------------------
  const permissions: AndroidManifestPermissionEvidence[] = []
  let permIndex = 0
  for (const kind of ['uses-permission', 'uses-permission-sdk-23'] as const) {
    for (const el of findChildren(root, kind)) {
      const rawName = attr(el, 'name') ?? null
      const maxSdkRaw = attr(el, 'maxSdkVersion')
      const maxSdk = maxSdkRaw !== undefined && /^\d+$/.test(maxSdkRaw) ? Number(maxSdkRaw) : null
      const permWarnings: string[] = []
      if (!rawName) permWarnings.push(`<${kind}> element has no android:name.`)
      permissions.push({
        id: `android-manifest-permission:${context.filePath}#${kind}:${rawName ?? 'unnamed'}:${permIndex}`,
        kind,
        rawName,
        resolvedName: rawName,
        maxSdkVersion: maxSdk,
        usesPermissionFlags: attr(el, 'usesPermissionFlags') ?? null,
        moduleId: context.moduleId,
        sourceSet: context.sourceSet,
        manifestFileId,
        source: sourceRefOf(el),
        warnings: permWarnings,
      })
      permIndex++
    }
  }

  // -- Declared (custom) permissions -----------------------------------------
  const declaredPermissions: AndroidManifestDeclaredPermissionEvidence[] = []
  let declaredIndex = 0
  for (const el of findChildren(root, 'permission')) {
    const name = attr(el, 'name') ?? null
    declaredPermissions.push({
      id: `android-manifest-declared-permission:${context.filePath}#${name ?? 'unnamed'}:${declaredIndex}`,
      name,
      protectionLevel: attr(el, 'protectionLevel') ?? null,
      permissionGroup: attr(el, 'permissionGroup') ?? null,
      label: classifyAttrValue(attr(el, 'label')),
      description: classifyAttrValue(attr(el, 'description')),
      icon: classifyAttrValue(attr(el, 'icon')),
      knownCerts: classifyAttrValue(attr(el, 'knownCerts')),
      moduleId: context.moduleId,
      sourceSet: context.sourceSet,
      manifestFileId,
      source: sourceRefOf(el),
      warnings: name ? [] : ['<permission> element has no android:name.'],
    })
    declaredIndex++
  }

  // -- uses-feature -----------------------------------------------------------
  const usesFeatures: AndroidManifestUsesFeatureEvidence[] = []
  let featureIndex = 0
  for (const el of findChildren(root, 'uses-feature')) {
    const name = attr(el, 'name') ?? null
    const glEsVersion = attr(el, 'glEsVersion') ?? null
    const requiredRaw = attr(el, 'required')
    const required = requiredRaw === 'true' ? 'true' : requiredRaw === 'false' ? 'false' : 'unspecified'
    const featureWarnings: string[] = []
    if (!name && !glEsVersion) featureWarnings.push('<uses-feature> element has neither android:name nor android:glEsVersion.')
    usesFeatures.push({
      id: `android-manifest-feature:${context.filePath}#${name ?? glEsVersion ?? 'unnamed'}:${featureIndex}`,
      name,
      glEsVersion,
      required,
      moduleId: context.moduleId,
      sourceSet: context.sourceSet,
      manifestFileId,
      source: sourceRefOf(el),
      warnings: featureWarnings,
    })
    featureIndex++
  }

  // -- Application ------------------------------------------------------------
  const applications: AndroidManifestApplicationEvidence[] = []
  const components: AndroidManifestComponentEvidence[] = []
  const intentFilters: AndroidManifestIntentFilterEvidence[] = []
  const launcherCandidates: AndroidManifestLauncherCandidate[] = []
  const deepLinkCandidates: AndroidManifestDeepLinkCandidate[] = []
  const metadata: AndroidManifestMetadataEvidence[] = []

  const applicationEl = findChildren(root, 'application')[0] ?? null
  if (applicationEl) {
    const applicationId = `android-manifest-application:${context.filePath}`
    const appMetadataIds: string[] = []
    let appMetaIndex = 0
    for (const metaEl of findChildren(applicationEl, 'meta-data')) {
      const id = `${applicationId}#meta-data:${appMetaIndex}`
      appMetadataIds.push(id)
      metadata.push(buildMetadataEvidence(id, 'application', applicationId, metaEl, attr, sourceRefOf))
      appMetaIndex++
    }

    applications.push({
      id: applicationId,
      name: classifyAttrValue(attr(applicationEl, 'name')),
      label: classifyAttrValue(attr(applicationEl, 'label')),
      icon: classifyAttrValue(attr(applicationEl, 'icon')),
      roundIcon: classifyAttrValue(attr(applicationEl, 'roundIcon')),
      theme: classifyAttrValue(attr(applicationEl, 'theme')),
      allowBackup: classifyAttrValue(attr(applicationEl, 'allowBackup')),
      debuggable: classifyAttrValue(attr(applicationEl, 'debuggable')),
      enabled: classifyAttrValue(attr(applicationEl, 'enabled')),
      extractNativeLibs: classifyAttrValue(attr(applicationEl, 'extractNativeLibs')),
      fullBackupContent: classifyAttrValue(attr(applicationEl, 'fullBackupContent')),
      dataExtractionRules: classifyAttrValue(attr(applicationEl, 'dataExtractionRules')),
      networkSecurityConfig: classifyAttrValue(attr(applicationEl, 'networkSecurityConfig')),
      usesCleartextTraffic: classifyAttrValue(attr(applicationEl, 'usesCleartextTraffic')),
      supportsRtl: classifyAttrValue(attr(applicationEl, 'supportsRtl')),
      hardwareAccelerated: classifyAttrValue(attr(applicationEl, 'hardwareAccelerated')),
      largeHeap: classifyAttrValue(attr(applicationEl, 'largeHeap')),
      process: classifyAttrValue(attr(applicationEl, 'process')),
      permission: classifyAttrValue(attr(applicationEl, 'permission')),
      requestLegacyExternalStorage: classifyAttrValue(attr(applicationEl, 'requestLegacyExternalStorage')),
      testOnly: classifyAttrValue(attr(applicationEl, 'testOnly')),
      manifestFileId,
      source: sourceRefOf(applicationEl),
      metadataIds: appMetadataIds,
      warnings: [],
    })

    const componentIndexByKind: Record<string, number> = {}
    for (const child of applicationEl.children) {
      const kind = COMPONENT_TAGS[child.name]
      if (!kind) continue
      const index = componentIndexByKind[kind] ?? 0
      componentIndexByKind[kind] = index + 1

      const componentResult = buildComponentEvidence({
        el: child,
        kind,
        index,
        context,
        manifestFileId,
        manifestPackage: packageAttr,
        attr,
        sourceRefOf,
        warnings,
      })
      components.push(componentResult.component)
      intentFilters.push(...componentResult.intentFilters)
      launcherCandidates.push(...componentResult.launcherCandidates)
      deepLinkCandidates.push(...componentResult.deepLinkCandidates)
      metadata.push(...componentResult.metadata)
    }
  }

  const record: AndroidManifestFileRecord = {
    id: manifestFileId,
    path: context.filePath,
    moduleId: context.moduleId,
    gradlePath: context.gradlePath,
    sourceSet: context.sourceSet,
    discoverySource: context.discoverySource,
    packageAttr,
    gradleNamespace: context.gradleNamespace,
    applicationId: context.applicationId,
    versionCode: root.attributes['android:versionCode'] ?? attr(root, 'versionCode') ?? null,
    versionName: root.attributes['android:versionName'] ?? attr(root, 'versionName') ?? null,
    sharedUserId: attr(root, 'sharedUserId') ?? null,
    installLocation: attr(root, 'installLocation') ?? null,
    usesSdk,
    source: sourceRefOf(root),
    parsingStatus: 'parsed',
    warnings: sortUnique(warnings),
    counts: {
      permissionCount: permissions.length,
      declaredPermissionCount: declaredPermissions.length,
      featureCount: usesFeatures.length,
      componentCount: components.length,
      intentFilterCount: intentFilters.length,
    },
  }

  return { record, applications, components, intentFilters, launcherCandidates, deepLinkCandidates, permissions, declaredPermissions, usesFeatures, metadata }
}

function buildMetadataEvidence(
  id: string,
  parentType: 'application' | 'component',
  parentId: string,
  el: XmlElement,
  attr: (el: XmlElement, name: string) => string | undefined,
  sourceRefOf: (el: XmlElement) => AndroidManifestSourceRef
): AndroidManifestMetadataEvidence {
  const name = attr(el, 'name') ?? null
  const warnings: string[] = []
  if (!name) warnings.push('<meta-data> element has no android:name.')
  return {
    id,
    parentType,
    parentId,
    name,
    value: classifyAttrValue(attr(el, 'value')),
    resource: classifyAttrValue(attr(el, 'resource')),
    source: sourceRefOf(el),
    warnings,
  }
}

interface BuildComponentParams {
  el: XmlElement
  kind: AndroidManifestComponentKind
  index: number
  context: ParseAndroidManifestContext
  manifestFileId: string
  manifestPackage: string | null
  attr: (el: XmlElement, name: string) => string | undefined
  sourceRefOf: (el: XmlElement) => AndroidManifestSourceRef
  warnings: string[]
}

function buildComponentEvidence(params: BuildComponentParams): {
  component: AndroidManifestComponentEvidence
  intentFilters: AndroidManifestIntentFilterEvidence[]
  launcherCandidates: AndroidManifestLauncherCandidate[]
  deepLinkCandidates: AndroidManifestDeepLinkCandidate[]
  metadata: AndroidManifestMetadataEvidence[]
} {
  const { el, kind, index, context, manifestFileId, manifestPackage, attr, sourceRefOf } = params
  const rawName = attr(el, 'name') ?? null
  const componentWarnings: string[] = []
  if (!rawName) componentWarnings.push(`<${el.name}> element has no android:name.`)

  const resolvedName = rawName ? resolveNameAgainstManifestPackage(rawName, manifestPackage, context.gradleNamespace) : null
  const targetActivityRaw = attr(el, 'targetActivity')
  const targetActivity = targetActivityRaw
    ? resolveNameAgainstManifestPackage(targetActivityRaw, manifestPackage, context.gradleNamespace)
    : null

  const componentId = `android-manifest-component:${context.filePath}#${kind}:${rawName ?? 'unnamed'}:${index}`

  const intentFilterEls = findChildren(el, 'intent-filter')
  const intentFilters: AndroidManifestIntentFilterEvidence[] = []
  const launcherCandidates: AndroidManifestLauncherCandidate[] = []
  const deepLinkCandidates: AndroidManifestDeepLinkCandidate[] = []

  intentFilterEls.forEach((ifEl, ifIndex) => {
    const intentFilterId = `${componentId}#intent-filter:${ifIndex}`
    const actions: AndroidManifestActionEvidence[] = findChildren(ifEl, 'action').map((actionEl, actionIndex) => ({
      id: `${intentFilterId}#action:${actionIndex}`,
      name: attr(actionEl, 'name') ?? '',
      source: sourceRefOf(actionEl),
    }))
    const categories: AndroidManifestCategoryEvidence[] = findChildren(ifEl, 'category').map((catEl, catIndex) => ({
      id: `${intentFilterId}#category:${catIndex}`,
      name: attr(catEl, 'name') ?? '',
      source: sourceRefOf(catEl),
    }))
    const dataEls = findChildren(ifEl, 'data')
    const data: AndroidManifestDataEvidence[] = dataEls.map((dataEl, dataIndex) => ({
      id: `${intentFilterId}#data:${dataIndex}`,
      scheme: attr(dataEl, 'scheme') ?? null,
      host: attr(dataEl, 'host') ?? null,
      port: attr(dataEl, 'port') ?? null,
      path: attr(dataEl, 'path') ?? null,
      pathPrefix: attr(dataEl, 'pathPrefix') ?? null,
      pathPattern: attr(dataEl, 'pathPattern') ?? null,
      pathAdvancedPattern: attr(dataEl, 'pathAdvancedPattern') ?? null,
      pathSuffix: attr(dataEl, 'pathSuffix') ?? null,
      mimeType: attr(dataEl, 'mimeType') ?? null,
      ssp: attr(dataEl, 'ssp') ?? null,
      sspPrefix: attr(dataEl, 'sspPrefix') ?? null,
      sspPattern: attr(dataEl, 'sspPattern') ?? null,
      source: sourceRefOf(dataEl),
    }))

    const autoVerifyRaw = attr(ifEl, 'autoVerify')
    const autoVerify = autoVerifyRaw === 'true' ? true : autoVerifyRaw === 'false' ? false : null
    const priorityRaw = attr(ifEl, 'priority')
    const orderRaw = attr(ifEl, 'order')

    const ifWarnings: string[] = []
    intentFilters.push({
      id: intentFilterId,
      parentComponentId: componentId,
      autoVerify,
      priority: priorityRaw !== undefined && /^-?\d+$/.test(priorityRaw) ? Number(priorityRaw) : null,
      order: orderRaw !== undefined && /^-?\d+$/.test(orderRaw) ? Number(orderRaw) : null,
      actions,
      categories,
      data,
      source: sourceRefOf(ifEl),
      warnings: ifWarnings,
    })

    const actionNames = new Set(actions.map((a) => a.name))
    const categoryNames = new Set(categories.map((c) => c.name))
    const isLauncher = actionNames.has('android.intent.action.MAIN') && categoryNames.has('android.intent.category.LAUNCHER')
    if (isLauncher) {
      launcherCandidates.push({
        id: `${componentId}#launcher:${intentFilterId}`,
        componentId,
        intentFilterId,
        manifestFileId,
        sourceSet: context.sourceSet,
        confidence: 'high',
        warnings: ['Manifest merging, aliases, enabled state, and build-variant selection are not evaluated.'],
      })
    }

    const isDeepLinkCandidate = actionNames.has('android.intent.action.VIEW') && categoryNames.has('android.intent.category.BROWSABLE')
    if (isDeepLinkCandidate) {
      if (data.length === 0) {
        deepLinkCandidates.push({
          id: `${intentFilterId}#deep-link:0`,
          componentId,
          intentFilterId,
          autoVerify,
          actions: [...actionNames].sort(),
          categories: [...categoryNames].sort(),
          scheme: null,
          host: null,
          port: null,
          path: null,
          pathPrefix: null,
          pathPattern: null,
          mimeType: null,
          manifestFileId,
          sourceSet: context.sourceSet,
          source: sourceRefOf(ifEl),
          warnings: ['Intent filter has VIEW/BROWSABLE evidence but no <data> element — incomplete deep-link evidence.'],
        })
      } else {
        data.forEach((d, dataIndex) => {
          const dlWarnings: string[] = []
          if (!d.scheme) dlWarnings.push('<data> element has no android:scheme.')
          if (data.length > 1) dlWarnings.push('Intent filter has multiple <data> elements; each is preserved as a separate candidate rather than combined.')
          deepLinkCandidates.push({
            id: `${intentFilterId}#deep-link:${dataIndex}`,
            componentId,
            intentFilterId,
            autoVerify,
            actions: [...actionNames].sort(),
            categories: [...categoryNames].sort(),
            scheme: d.scheme,
            host: d.host,
            port: d.port,
            path: d.path ?? d.pathPrefix ?? d.pathPattern,
            pathPrefix: d.pathPrefix,
            pathPattern: d.pathPattern,
            mimeType: d.mimeType,
            manifestFileId,
            sourceSet: context.sourceSet,
            source: sourceRefOf(dataEl(dataEls, dataIndex)),
            warnings: dlWarnings,
          })
        })
      }
    }
  })

  const metadataIds: string[] = []
  const metadataEvidence: AndroidManifestMetadataEvidence[] = []
  findChildren(el, 'meta-data').forEach((metaEl, metaIndex) => {
    const id = `${componentId}#meta-data:${metaIndex}`
    metadataIds.push(id)
    metadataEvidence.push(buildMetadataEvidence(id, 'component', componentId, metaEl, attr, sourceRefOf))
  })

  const grantUriPermissions: AndroidManifestGrantUriPermissionEvidence[] = findChildren(el, 'grant-uri-permission').map((guEl, guIndex) => ({
    id: `${componentId}#grant-uri-permission:${guIndex}`,
    path: attr(guEl, 'path') ?? null,
    pathPrefix: attr(guEl, 'pathPrefix') ?? null,
    pathPattern: attr(guEl, 'pathPattern') ?? null,
    source: sourceRefOf(guEl),
  }))
  const pathPermissions: AndroidManifestPathPermissionEvidence[] = findChildren(el, 'path-permission').map((ppEl, ppIndex) => ({
    id: `${componentId}#path-permission:${ppIndex}`,
    path: attr(ppEl, 'path') ?? null,
    pathPrefix: attr(ppEl, 'pathPrefix') ?? null,
    pathPattern: attr(ppEl, 'pathPattern') ?? null,
    permission: attr(ppEl, 'permission') ?? null,
    readPermission: attr(ppEl, 'readPermission') ?? null,
    writePermission: attr(ppEl, 'writePermission') ?? null,
    source: sourceRefOf(ppEl),
  }))

  const exportedRaw = attr(el, 'exported')
  const exported = exportedRaw === 'true' ? 'true' : exportedRaw === 'false' ? 'false' : 'unspecified'
  if (exported === 'unspecified') {
    componentWarnings.push(
      `android:exported is unspecified for <${el.name} android:name="${rawName ?? '?'}">; the effective value depends on Android version, manifest merging, and intent-filter presence, which are not evaluated here.`
    )
  }

  const component: AndroidManifestComponentEvidence = {
    id: componentId,
    kind,
    rawName,
    resolvedName,
    targetActivity,
    authorities: (attr(el, 'authorities') ?? '').split(';').map((s) => s.trim()).filter(Boolean),
    exported,
    exportedExplicit: exportedRaw !== undefined,
    hasIntentFilter: intentFilterEls.length > 0,
    enabled: classifyAttrValue(attr(el, 'enabled')),
    permission: classifyAttrValue(attr(el, 'permission')),
    readPermission: classifyAttrValue(attr(el, 'readPermission')),
    writePermission: classifyAttrValue(attr(el, 'writePermission')),
    process: classifyAttrValue(attr(el, 'process')),
    directBootAware: classifyAttrValue(attr(el, 'directBootAware')),
    isolatedProcess: classifyAttrValue(attr(el, 'isolatedProcess')),
    foregroundServiceType: classifyAttrValue(attr(el, 'foregroundServiceType')),
    grantUriPermissionsAttr: classifyAttrValue(attr(el, 'grantUriPermissions')),
    multiprocess: classifyAttrValue(attr(el, 'multiprocess')),
    taskAffinity: classifyAttrValue(attr(el, 'taskAffinity')),
    launchMode: classifyAttrValue(attr(el, 'launchMode')),
    screenOrientation: classifyAttrValue(attr(el, 'screenOrientation')),
    configChanges: classifyAttrValue(attr(el, 'configChanges')),
    parentActivityName: classifyAttrValue(attr(el, 'parentActivityName')),
    theme: classifyAttrValue(attr(el, 'theme')),
    label: classifyAttrValue(attr(el, 'label')),
    icon: classifyAttrValue(attr(el, 'icon')),
    syncable: classifyAttrValue(attr(el, 'syncable')),
    initOrder: classifyAttrValue(attr(el, 'initOrder')),
    moduleId: context.moduleId,
    sourceSet: context.sourceSet,
    manifestFileId,
    source: sourceRefOf(el),
    intentFilterIds: intentFilters.map((i) => i.id),
    metadataIds,
    grantUriPermissions,
    pathPermissions,
    warnings: sortUnique(componentWarnings),
  }

  return { component, intentFilters, launcherCandidates, deepLinkCandidates, metadata: metadataEvidence }
}

function dataEl(dataEls: XmlElement[], index: number): XmlElement {
  return dataEls[index]!
}

export function resolveNameAgainstManifestPackage(
  raw: string,
  manifestPackage: string | null,
  gradleNamespace: string | null
): ResolvedComponentName {
  if (!raw) return { raw, resolved: null, basis: 'unresolved', warning: 'Component name is empty.' }
  const isFullyQualified = raw.includes('.') && !raw.startsWith('.')
  if (isFullyQualified) {
    return { raw, resolved: raw, basis: 'fully-qualified', warning: null }
  }
  const base = manifestPackage ?? gradleNamespace
  const basis = manifestPackage ? 'manifest-package' : gradleNamespace ? 'gradle-namespace' : 'unresolved'
  if (!base) {
    return {
      raw,
      resolved: null,
      basis: 'unresolved',
      warning: `Component name "${raw}" could not be resolved: no manifest package attribute or Gradle namespace is available.`,
    }
  }
  const resolved = raw.startsWith('.') ? `${base}${raw}` : `${base}.${raw}`
  return { raw, resolved, basis, warning: null }
}

function classifyAttrValue(raw: string | undefined): AndroidManifestAttributeValue {
  if (raw === undefined) return { kind: 'absent' }
  if (raw.includes('${')) return { kind: 'placeholder', raw }
  if (raw.startsWith('@') || raw.startsWith('?')) return { kind: 'resource-reference', reference: parseResourceReference(raw) }
  return { kind: 'literal', value: raw }
}

function parseResourceReference(raw: string): AndroidManifestResourceReference {
  const referenceKind = raw.startsWith('?') ? 'attr' : 'resource'
  const body = raw.slice(1)
  const match = /^(?:([\w.]+):)?([\w.]+)\/([\w.]+)$/.exec(body)
  if (!match) {
    return {
      raw,
      referenceKind,
      resourceType: null,
      resourceName: null,
      packagePrefix: null,
      isFrameworkReference: false,
      warning: `Malformed resource reference "${raw}".`,
    }
  }
  const [, pkg, type, name] = match
  return {
    raw,
    referenceKind,
    resourceType: type ?? null,
    resourceName: name ?? null,
    packagePrefix: pkg ?? null,
    isFrameworkReference: pkg === 'android',
    warning: null,
  }
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort()
}
