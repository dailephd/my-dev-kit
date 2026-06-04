export class AuditLog {
  id!: string
  actor?: string | null
  entries!: string[]
}
