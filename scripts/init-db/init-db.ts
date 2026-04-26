import { readFileSync } from "node:fs"
import { join } from "node:path"
import { EnvironCredentialsProvider } from "@ydbjs/auth/environ"
import { Driver } from "@ydbjs/core"
import { query } from "@ydbjs/query"
import { logger } from "../../src/logger"

async function initDb() {
    const connectionString = process.env.YDB_CONNECTION_STRING
    if (!connectionString) {
        throw new Error("YDB_CONNECTION_STRING is not set")
    }

    const driver = new Driver(connectionString, {
        credentialsProvider: new EnvironCredentialsProvider(),
    })

    try {
        await driver.ready()
        const sql = query(driver)
        const content = readFileSync(join(__dirname, "init.sql"), "utf-8")
        await sql(content)
        logger.log("DB initialized")
    } finally {
        logger.log("Closing connection")
        await driver.close()
    }
}

initDb().catch((err: unknown) => {
    logger.error(err)
    process.exit(1)
})
