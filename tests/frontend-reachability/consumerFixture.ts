import { buildEmptyFrontendReachabilityArtifact } from '../../src/frontend-reachability/index.js'
import type { FrontendReachabilityArtifact } from '../../src/frontend-reachability/index.js'

/**
 * A small but cross-domain reachability artifact used by the command-consumer
 * and graph-view tests. It links:
 *   route /dashboard  -> component DashboardNav
 *   component         -> storage key auth_token
 *   component         -> ui marker dashboard-panel
 *   storage auth_token-> gates ui marker dashboard-panel
 *   route /dashboard  -> reaches ui marker dashboard-panel (transitive)
 *   test block        -> covers ui marker dashboard-panel
 */
export function buildConsumerFixture(): FrontendReachabilityArtifact {
  const artifact = buildEmptyFrontendReachabilityArtifact('2026-01-01T00:00:00.000Z', '/repo')
  const componentId = 'component:src/DashboardNav.tsx:DashboardNav'
  const routeId = 'route:/dashboard'
  const storageId = 'storage:localStorage:auth_token'
  const uiId = 'ui:data-testid:dashboard-panel'

  artifact.routes = [
    {
      id: routeId,
      path: '/dashboard',
      kind: 'link-target',
      componentIds: [componentId],
      sourceRefs: [{ filePath: 'src/DashboardNav.tsx', line: 5 }],
      confidence: 'high',
      warnings: [],
    },
    {
      id: 'route:/settings',
      path: '/settings',
      kind: 'link-target',
      componentIds: [componentId],
      sourceRefs: [{ filePath: 'src/DashboardNav.tsx', line: 4 }],
      confidence: 'high',
      warnings: [],
    },
  ]

  artifact.storageKeys = [
    {
      id: storageId,
      key: 'auth_token',
      storageKind: 'localStorage',
      componentIds: [componentId],
      stateVarNames: ['isLoggedIn'],
      sourceRefs: [{ filePath: 'src/DashboardNav.tsx', line: 17 }],
      confidence: 'high',
      warnings: [],
    },
  ]

  artifact.uiReachability = [
    {
      id: uiId,
      markerKind: 'data-testid',
      value: 'dashboard-panel',
      componentId,
      jsxRegionKind: 'logical-branch',
      conditionText: 'isLoggedIn',
      gateStorageKeyIds: [storageId],
      gateRouteIds: [routeId],
      testEvidenceRefs: [
        {
          filePath: 'src/dashboard.spec.ts',
          line: 4,
          locatorKind: 'getByTestId',
          locatorValue: 'dashboard-panel',
          testBlockId: 'test:1',
          testBlockTitle: 'shows dashboard panel',
          testFramework: 'playwright',
        },
      ],
      sourceRef: { filePath: 'src/DashboardNav.tsx', line: 38 },
      confidence: 'medium',
      warnings: [],
    },
  ]

  artifact.edges = [
    {
      id: `${routeId}--route-serves-component-->${componentId}`,
      kind: 'route-serves-component',
      source: routeId,
      target: componentId,
      confidence: 'high',
      evidenceRefs: [],
    },
    {
      id: `${componentId}--component-uses-storage-->${storageId}`,
      kind: 'component-uses-storage',
      source: componentId,
      target: storageId,
      confidence: 'high',
      evidenceRefs: [],
    },
    {
      id: `${componentId}--component-renders-ui-->${uiId}`,
      kind: 'component-renders-ui',
      source: componentId,
      target: uiId,
      confidence: 'medium',
      evidenceRefs: [],
    },
    {
      id: `${storageId}--storage-gates-ui-->${uiId}`,
      kind: 'storage-gates-ui',
      source: storageId,
      target: uiId,
      confidence: 'medium',
      evidenceRefs: [],
    },
    {
      id: `${routeId}--route-reaches-ui-->${uiId}`,
      kind: 'route-reaches-ui',
      source: routeId,
      target: uiId,
      confidence: 'medium',
      evidenceRefs: [],
    },
    {
      id: `test:1--test-covers-ui-->${uiId}`,
      kind: 'test-covers-ui',
      source: 'test:1',
      target: uiId,
      confidence: 'high',
      evidenceRefs: [],
    },
  ]

  artifact.stats = {
    routeCount: artifact.routes.length,
    storageKeyCount: artifact.storageKeys.length,
    uiReachabilityCount: artifact.uiReachability.length,
    edgeCount: artifact.edges.length,
    warningCount: 0,
  }

  return artifact
}
