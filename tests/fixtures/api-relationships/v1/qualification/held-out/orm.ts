import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
declare const table: string
export function load() { return db[table].findMany() }
