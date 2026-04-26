// This script is used to set the webhook for the bot.
// It is called by Vercel during the build process.

import { bot } from "../src/bot.js"
import { DEV_DOMAIN } from "../src/env.js"
import { logger } from "../src/utils/logger.js"

async function setWebhook() {
    // Check for a command-line argument for the URL.
    const localUrl = DEV_DOMAIN
    // Fallback to Vercel's system environment variable.
    const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL

    const url = localUrl || vercelUrl

    if (!url) {
        if (process.env.NODE_ENV === "production") {
            throw new Error(
                "Webhook URL is not set (checked local arg and VERCEL_URL).",
            )
        }
        logger.info("Webhook URL not found, skipping setup.")
        return
    }

    // Use the URL constructor for robust parsing
    let host: string | null = null
    if (url.startsWith("http")) {
        host = new URL(url).host
        logger.info("Detected full URL, host is: ", host)
    } else {
        host = new URL(`https://${url}`).host
        logger.info("Detected domain, host is: ", host)
    }

    const webhookUrl = `https://${host}/api/webhook`
    await bot.api.setWebhook(webhookUrl)
    logger.info(`Webhook set to ${webhookUrl}`)
}

setWebhook().catch((err) => {
    logger.error("Failed to set webhook:", err)
    process.exit(1)
})
