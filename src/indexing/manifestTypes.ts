export interface IndexManifest {
  artifactKind: 'my-dev-kit-v1-manifest'
  version: '1.0.0'
  createdAt: string
  projectRoot: string
  sourceRoots: string[]
  languages: string[]
  callGraphEnabled: boolean
  artifacts: {
    symbolIndex: string
    codeGraph: string
    callGraph: string | null
  }
  summary: {
    fileCount: number
    symbolCount: number
    edgeCount: number
    warningCount: number
    errorCount: number
  }
  warnings: string[]
  errors: string[]
}
