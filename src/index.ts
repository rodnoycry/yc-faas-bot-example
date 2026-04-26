import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { autoRetry } from "@grammyjs/auto-retry"
import { streamApi } from "@grammyjs/stream"
import type { Http } from "@yandex-cloud/function-types/dist/src/http"
import type { Update } from "grammy/types"
import { type LanguageModel, streamText } from "ai"
import { Bot } from "grammy"
import {
    clearChatHistory,
    createDriver,
    createSql,
    getChatHistory,
    saveMessage,
    type Sql,
} from "./db"
import { logger } from "./logger"

interface Env {
    BOT_INFO: string
    BOT_TOKEN: string
    LLM_API_BASE_URL: string
    LLM_API_KEY: string
    LLM_MODEL: string
    DEPLOYMENT_URL: string
}

function readEnv(): Env {
    const required = [
        "BOT_INFO",
        "BOT_TOKEN",
        "LLM_API_BASE_URL",
        "LLM_API_KEY",
        "LLM_MODEL",
        "DEPLOYMENT_URL",
    ] as const
    for (const key of required) {
        if (!process.env[key]) {
            throw new Error(`${key} is not set`)
        }
    }
    return {
        BOT_INFO: process.env.BOT_INFO as string,
        BOT_TOKEN: process.env.BOT_TOKEN as string,
        LLM_API_BASE_URL: process.env.LLM_API_BASE_URL as string,
        LLM_API_KEY: process.env.LLM_API_KEY as string,
        LLM_MODEL: process.env.LLM_MODEL as string,
        DEPLOYMENT_URL: process.env.DEPLOYMENT_URL as string,
    }
}

const SYSTEM_PROMPT = [
    "Talk normally, without pressure, without complex construction - talk efficently and talk 'human' - you don't need to perform, you're just",
    "doing your work. Be efficient with your words, if you can say something in 2 words - don't make it into 10.",
    "You're LLM. You need to understand that you inherently unreliable. You need to be as thin as possible. You don't stand facts, ",
    "you provide user with links and references for facts, because facts that you",
    "think are facts - might not be facts at all and you will mislead the user. You need to be as thin layer between user and facts as possible.",
    "If you feel lack information - check tools to gather information. If not tools fit for this case - ask user to bring you facts,",
    'they have access to the internet. You don\'t need to be scared to be "annoying" for user, your job is to connect user with facts',
    "and reality, not trying to be source of it. Only state facts if you already have verified proof of that fact.",
    "",
    "Be aware, if it's a start of dialog and you clearly miss some important information - don't hesitate ask user for more information",
    "first. Imagine how it happens when you come to a professional of their craft - they don't give you solution right away, they need",
    "to gather enough context first. Be this professional.",
    "",
    "Don't forget that the dialog is continuous. You need to be strategic answering - imagine what context would be perfect to have at",
    "the moment, if there are some important pieces ask such question that next iteration of dialog you would have this information.",
    "Be strategic, because what you ask right now is new context for you in the future, current context is result of your previous decisions,",
    "be continuous",
    "",
    "Handle the dialog, not monologue, answer in steps if answer requires information. Use this algorithm - if you don't have enough context",
    "to answer with full authority - what's the most important piece of context required at the moment. Ask this piece of information first.",
    "Focus on one step at a time. Once you got enough context - then answer. Let user answer first, each your message should be 1 step",
    "Also - try to use markdown less, like - numbered and markered lists okay if you want, but without bold or italic text, code blocks should work though",
].join(" ")

interface FunctionContext {
    token?: { access_token: string; expires_in: number; token_type: string }
}

function createBot(env: Env): Bot {
    const bot = new Bot(env.BOT_TOKEN, {
        botInfo: JSON.parse(env.BOT_INFO),
    })
    bot.api.config.use(autoRetry())
    return bot
}

function createProvider(env: Env) {
    return createOpenAICompatible({
        name: "custom-llm",
        baseURL: env.LLM_API_BASE_URL,
        apiKey: env.LLM_API_KEY,
    })
}

async function handleLLMResponse({
    sql,
    model,
    chatId,
    userText,
    api,
    draftIdOffset,
}: {
    sql: Sql
    model: LanguageModel
    chatId: number
    userText: string
    api: Bot["api"]
    draftIdOffset: number
}): Promise<void> {
    const [history] = await Promise.all([
        getChatHistory(sql, chatId),
        saveMessage(sql, chatId, "user", userText),
    ])

    const { textStream, text: textPromise } = streamText({
        model,
        system: SYSTEM_PROMPT,
        messages: [...history, { role: "user", content: userText }],
    })

    await api.sendChatAction(chatId, "typing")
    const { streamMessage } = streamApi(api.raw)
    await streamMessage(chatId, draftIdOffset, textStream)

    const fullText = await textPromise
    await saveMessage(sql, chatId, "assistant", fullText)
}

function registerSyncHandlers(bot: Bot, env: Env, accessToken: string): void {
    bot.command("start", (ctx) =>
        ctx.reply("Hi! Send me a message and I will try to help you"),
    )

    bot.on("message:text", async (ctx) => {
        await ctx.api.sendChatAction(ctx.chat.id, "typing")
        await invokeAsync({
            deploymentUrl: env.DEPLOYMENT_URL,
            accessToken,
            update: ctx.update,
        })
    })
}

function registerAsyncHandlers(bot: Bot, sql: Sql, env: Env): void {
    bot.command("new", async (ctx) => {
        await clearChatHistory(sql, ctx.chat.id)
        await ctx.reply("Context cleared")
    })

    bot.on("message:text", async (ctx) => {
        const provider = createProvider(env)
        await handleLLMResponse({
            sql,
            model: provider.chatModel(env.LLM_MODEL),
            chatId: ctx.chat.id,
            userText: ctx.message.text,
            api: ctx.api,
            draftIdOffset: 256 * ctx.update.update_id,
        })
    })
}

async function invokeAsync({
    deploymentUrl,
    accessToken,
    update,
}: {
    deploymentUrl: string
    accessToken: string
    update: Update
}): Promise<void> {
    const url = `${deploymentUrl.replace(/\/$/, "")}?integration=async`
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(update),
    })
    if (res.status !== 202) {
        const text = await res.text()
        throw new Error(
            `Async self-invocation failed: ${res.status} ${res.statusText} ${text}`,
        )
    }
}

function isHttpEvent(event: unknown): event is Http.Event {
    return (
        typeof event === "object" &&
        event !== null &&
        "httpMethod" in event &&
        "headers" in event
    )
}

function parseAsyncBody(event: unknown): Update {
    if (typeof event === "string") {
        return JSON.parse(event) as Update
    }
    if (event instanceof Uint8Array) {
        return JSON.parse(Buffer.from(event).toString("utf-8")) as Update
    }
    if (typeof event === "object" && event !== null) {
        // Some runtimes deliver the body already as a parsed object.
        return event as Update
    }
    throw new Error("Unexpected async invocation event shape")
}

async function handleSync(
    event: Http.Event,
    accessToken: string,
): Promise<Http.Result> {
    const env = readEnv()
    const body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf-8")
        : event.body
    const update = JSON.parse(body) as Update
    const bot = createBot(env)
    registerSyncHandlers(bot, env, accessToken)
    await bot.handleUpdate(update)
    return { statusCode: 200, body: "" }
}

async function handleAsync(event: unknown): Promise<void> {
    const env = readEnv()
    const update = parseAsyncBody(event)
    const driver = createDriver()
    try {
        await driver.ready()
        const sql = createSql(driver)
        const bot = createBot(env)
        registerAsyncHandlers(bot, sql, env)
        await bot.handleUpdate(update)
    } finally {
        driver.close()
    }
}

export const handler = async (
    event: unknown,
    context: FunctionContext,
): Promise<unknown> => {
    try {
        if (isHttpEvent(event)) {
            const accessToken = context.token?.access_token
            if (!accessToken) {
                throw new Error(
                    "Function context has no IAM token — attach a service account",
                )
            }
            return await handleSync(event, accessToken)
        }
        await handleAsync(event)
        return { statusCode: 200, body: "" }
    } catch (err) {
        logger.error("Handler failed:", err)
        throw err
    }
}
