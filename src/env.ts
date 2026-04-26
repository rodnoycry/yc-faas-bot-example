// General
export const DEV_MODE = process.env.DEV_MODE === "true"
export const DISABLE_LOGS = process.env.DISABLE_LOGS === "true"
export const DEV_DOMAIN = process.env.DEV_DOMAIN

// Bot tokeb logic
const PROD_BOT_TOKEN = process.env.BOT_TOKEN
const DEV_BOT_TOKEN = process.env.DEV_BOT_TOKEN

if (!PROD_BOT_TOKEN) {
    throw new Error("BOT_TOKEN is required")
}

if (DEV_MODE && !DEV_BOT_TOKEN) {
    throw new Error("DEV_BOT_TOKEN is required when DEV_MODE is true")
}

export const BOT_TOKEN =
    DEV_MODE && DEV_BOT_TOKEN ? DEV_BOT_TOKEN : PROD_BOT_TOKEN
