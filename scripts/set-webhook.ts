import { logger } from "../src/logger"

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL
if (!DEPLOYMENT_URL) {
    throw new Error(
        "Please set DEPLOYMENT_URL env variable before running the script",
    )
}

const BOT_TOKEN = process.env.BOT_TOKEN
if (!BOT_TOKEN) {
    throw new Error(
        "Please set BOT_TOKEN env variable before running the script",
    )
}

const telegramApi = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${DEPLOYMENT_URL}`

async function setWebhook() {
    const response = await fetch(telegramApi)
    const result = await response.json()

    logger.log("Telegram response:", JSON.stringify(result, null, 2))

    if (!response.ok) {
        process.exit(1)
    }
}

setWebhook().catch((err) => {
    logger.error("Failed to set webhook:", err)
    process.exit(1)
})
