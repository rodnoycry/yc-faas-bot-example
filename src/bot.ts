import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { autoRetry } from "@grammyjs/auto-retry"
import { streamApi } from "@grammyjs/stream"
import type { Http } from "@yandex-cloud/function-types/dist/src/http"
import { type LanguageModel, streamText } from "ai"
import { Bot } from "grammy"
import type { Update } from "grammy/types"
import {
    clearChatHistory,
    createDriver,
    createSql,
    getChatHistory,
    saveMessage,
    type Sql,
} from "./db"
import type { Env } from "./index"

// We don't use grammy's `webhookCallback` adapter (e.g. "aws-lambda") here, as we already have the YCF
// `Http.Event` in our hands and need full control over the response shape AND
// the sync/async dispatch, so we go one layer down with `bot.handleUpdate`
// directly.
// See: https://grammy.dev/guide/deployment-types#web-framework-adapters

export function createBot(env: Env): Bot {
    const bot = new Bot(env.BOT_TOKEN, {
        botInfo: JSON.parse(env.BOT_INFO),
    })
    bot.api.config.use(autoRetry())
    return bot
}

function createProvider(env: Env) {
    return createOpenAICompatible({
        name: env.AI_PROVIDER_NAME,
        baseURL: env.AI_PROVIDER_BASE_URL,
        apiKey: env.AI_PROVIDER_API_KEY,
    })
}

async function handleLLMResponse({
    sql,
    model,
    chatId,
    userText,
    api,
    draftIdOffset,
    systemPrompt,
}: {
    sql: Sql
    model: LanguageModel
    chatId: number
    userText: string
    api: Bot["api"]
    draftIdOffset: number
    systemPrompt: string
}): Promise<void> {
    const [history] = await Promise.all([
        getChatHistory(sql, chatId),
        saveMessage(sql, chatId, "user", userText),
    ])

    const { textStream, text: textPromise } = streamText({
        model,
        system: systemPrompt,
        messages: [...history, { role: "user", content: userText }],
    })

    await api.sendChatAction(chatId, "typing")
    const { streamMessage } = streamApi(api.raw)
    await streamMessage(chatId, draftIdOffset, textStream)

    const fullText = await textPromise
    await saveMessage(sql, chatId, "assistant", fullText)
}

function registerSyncHandlers({
    bot,
    env,
    accessToken,
}: {
    bot: Bot
    env: Env
    accessToken: string
}): void {
    bot.command("start", (ctx) =>
        ctx.reply(
            "Привет, отправь мне сообщение и я постараюсь принести пользу",
        ),
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

function registerAsyncHandlers({
    bot,
    sql,
    env,
    systemPrompt,
}: {
    bot: Bot
    sql: Sql
    env: Env
    systemPrompt: string
}): void {
    bot.command("new", async (ctx) => {
        await clearChatHistory(sql, ctx.chat.id)
        await ctx.reply("Контекст очищен")
    })

    bot.on("message:text", async (ctx) => {
        const provider = createProvider(env)
        await handleLLMResponse({
            sql,
            model: provider.chatModel(env.AI_PROVIDER_MODEL),
            chatId: ctx.chat.id,
            userText: ctx.message.text,
            api: ctx.api,
            draftIdOffset: 256 * ctx.update.update_id,
            systemPrompt,
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

export function isHttpEvent(event: unknown): event is Http.Event {
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

export async function handleSync({
    event,
    env,
    accessToken,
}: {
    event: Http.Event
    env: Env
    accessToken: string
}): Promise<Http.Result> {
    const body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf-8")
        : event.body
    const update = JSON.parse(body) as Update
    const bot = createBot(env)
    registerSyncHandlers({ bot, env, accessToken })
    await bot.handleUpdate(update)
    return { statusCode: 200, body: "" }
}

export async function handleAsync({
    event,
    env,
    systemPrompt,
}: {
    event: unknown
    env: Env
    systemPrompt: string
}): Promise<void> {
    const update = parseAsyncBody(event)
    const driver = createDriver()
    try {
        await driver.ready()
        const sql = createSql(driver)
        const bot = createBot(env)
        registerAsyncHandlers({ bot, sql, env, systemPrompt })
        await bot.handleUpdate(update)
    } finally {
        driver.close()
    }
}
