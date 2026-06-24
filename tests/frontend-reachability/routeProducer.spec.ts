import { afterEach, describe, expect, it } from 'vitest'
import { extractRouteFacts } from '../../src/frontend-reachability/index.js'
import { buildFrontendFixture, cleanupReachabilityTempDirs } from './reachabilityTestHelpers.js'

afterEach(() => cleanupReachabilityTempDirs())

describe('extractRouteFacts', () => {
  it('extracts static JSX route attributes with high confidence', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/Nav.tsx',
        content: `export function Nav() {
  return (
    <div>
      <a href="/dashboard">Dash</a>
      <a to="/settings">Settings</a>
    </div>
  )
}
`,
      },
    ])
    const routes = extractRouteFacts({ frontendArtifact: artifact, repoRoot })
    const paths = routes.map((r) => r.path)
    expect(paths).toContain('/dashboard')
    expect(paths).toContain('/settings')
    const dash = routes.find((r) => r.path === '/dashboard')
    expect(dash?.confidence).toBe('high')
    expect(dash?.sourceRefs[0].filePath).toBe('src/Nav.tsx')
    expect(dash?.sourceRefs[0].line).toBe(4)
  })

  it('returns routes sorted by path', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/Nav.tsx',
        content: `export function Nav() {
  return <div><a href="/zeta">z</a><a href="/alpha">a</a></div>
}
`,
      },
    ])
    const routes = extractRouteFacts({ frontendArtifact: artifact, repoRoot })
    expect(routes.map((r) => r.path)).toEqual(['/alpha', '/zeta'])
  })

  it('emits low confidence + dynamic-route warning for template-literal route', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/Nav.tsx',
        content: `export function Nav() {
  const id = '1'
  return <a href={\`/user/\${id}\`}>user</a>
}
`,
      },
    ])
    const routes = extractRouteFacts({ frontendArtifact: artifact, repoRoot })
    const dynamic = routes.find((r) => r.path.includes('/user/'))
    expect(dynamic).toBeDefined()
    expect(dynamic?.confidence).toBe('low')
    expect(dynamic?.warnings.some((w) => w.kind === 'dynamic-route')).toBe(true)
  })

  it('infers a route from the Next.js pages convention with medium confidence', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'pages/dashboard/index.tsx',
        content: `export default function DashboardPage() { return <div>dash</div> }
`,
      },
    ])
    const routes = extractRouteFacts({ frontendArtifact: artifact, repoRoot })
    const page = routes.find((r) => r.path === '/dashboard')
    expect(page).toBeDefined()
    expect(page?.kind).toBe('page')
    expect(page?.confidence).toBe('medium')
  })

  it('includes test-mentioned routes from RouteStringCandidate with medium confidence', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/login.test.ts',
        content: `import { test } from '@playwright/test'
test('login', async ({ page }) => {
  await page.goto('/login')
})
`,
      },
    ])
    const routes = extractRouteFacts({ frontendArtifact: artifact, repoRoot })
    const login = routes.find((r) => r.path === '/login')
    expect(login).toBeDefined()
    expect(login?.confidence).toBe('medium')
    expect(login?.kind).toBe('test-mentioned-route')
  })

  it('merges duplicate routes from multiple components into one fact', () => {
    const { repoRoot, artifact } = buildFrontendFixture([
      {
        path: 'src/A.tsx',
        content: `export function A() { return <a href="/shared">a</a> }
`,
      },
      {
        path: 'src/B.tsx',
        content: `export function B() { return <a href="/shared">b</a> }
`,
      },
    ])
    const routes = extractRouteFacts({ frontendArtifact: artifact, repoRoot })
    const shared = routes.filter((r) => r.path === '/shared')
    expect(shared).toHaveLength(1)
    expect(shared[0].componentIds.length).toBeGreaterThanOrEqual(2)
    expect(shared[0].sourceRefs.length).toBeGreaterThanOrEqual(2)
  })
})
