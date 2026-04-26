import { randomUUID } from "node:crypto"
import { EnvironCredentialsProvider } from "@ydbjs/auth/environ"
import { Driver } from "@ydbjs/core"
import { type QueryClient, query } from "@ydbjs/query"
import { Int64, Text, Timestamp } from "@ydbjs/value/primitive"
import { z } from "zod"

export type Sql = QueryClient

// Per YDB FaaS guidance: HTTP/2 connections must not be reused across
// invocations. Always create a Driver inside the handler and close it in
// `finally`.
export function createDriver(): Driver {
    const connectionString = process.env.YDB_CONNECTION_STRING
    if (!connectionString) {
        throw new Error("YDB_CONNECTION_STRING is not set")
    }
    return new Driver(connectionString, {
        credentialsProvider: new EnvironCredentialsProvider(),
    })
}

export function createSql(driver: Driver): Sql {
    return query(driver)
}

const RoleSchema = z.enum(["user", "assistant"])
export type Role = z.infer<typeof RoleSchema>

const HistoryRowSchema = z.object({
    role: RoleSchema,
    content: z.string(),
})
export type HistoryRow = z.infer<typeof HistoryRowSchema>

export async function getChatHistory(
    sql: Sql,
    chatId: number,
): Promise<HistoryRow[]> {
    const [rows] = await sql<Array<{ role: string; content: string }>>`
        SELECT role, content
        FROM messages
        WHERE chat_id = ${new Int64(BigInt(chatId))}
        ORDER BY created_at ASC
    `
    return z.array(HistoryRowSchema).parse(rows)
}

export async function saveMessage(
    sql: Sql,
    chatId: number,
    role: Role,
    content: string,
): Promise<void> {
    await sql`
        UPSERT INTO messages (chat_id, created_at, id, role, content)
        VALUES (
            ${new Int64(BigInt(chatId))},
            ${new Timestamp(new Date())},
            ${new Text(randomUUID())},
            ${new Text(role)},
            ${new Text(content)}
        )
    `
}

export async function clearChatHistory(
    sql: Sql,
    chatId: number,
): Promise<void> {
    await sql`
        DELETE FROM messages
        WHERE chat_id = ${new Int64(BigInt(chatId))}
    `
}
