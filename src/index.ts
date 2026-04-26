import { Bot, webhookCallback } from "grammy"
import { autoRetry } from "@grammyjs/auto-retry"
import { streamApi } from "@grammyjs/stream"
import { streamText, type LanguageModel } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { eq, asc } from "drizzle-orm"
import { createDb, type Database } from "./db"
import { messages } from "./db/schema"
import { logger } from "./logger"

export interface Env {
    BOT_INFO: string
    BOT_TOKEN: string
    LLM_API_BASE_URL: string
    LLM_API_KEY: string
    LLM_MODEL: string
    DB: D1Database
    MESSAGE_QUEUE: Queue<QueueMessage>
}

interface QueueMessage {
    chatId: number
    text: string
    updateId: number
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

async function getChatHistory(db: Database, chatId: number) {
    const rows = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt))

    return rows.map((row) => ({
        role: row.role as "user" | "assistant",
        content: row.content,
    }))
}

async function saveMessage(
    db: Database,
    chatId: number,
    role: "user" | "assistant",
    content: string,
) {
    await db.insert(messages).values({ chatId, role, content })
}

async function clearChatHistory(db: Database, chatId: number) {
    await db.delete(messages).where(eq(messages.chatId, chatId))
}

async function handleLLMResponse(
    db: Database,
    model: LanguageModel,
    chatId: number,
    userText: string,
    api: Bot["api"],
    draftIdOffset: number,
) {
    const [history] = await Promise.all([
        getChatHistory(db, chatId),
        saveMessage(db, chatId, "user", userText),
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
    await saveMessage(db, chatId, "assistant", fullText)
}

function createBot(env: Env) {
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

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const bot = createBot(env)
        const db = createDb(env.DB)

        bot.command("start", (ctx) =>
            ctx.reply(
                "Привет! Отправь мне текстовое сообщение, и я постараюсь быть полезным",
            ),
        )

        bot.command("new", async (ctx) => {
            await clearChatHistory(db, ctx.chat.id)
            await ctx.reply("Контекст очищен")
        })

        bot.on("message:text", async (ctx) => {
            await ctx.api.sendChatAction(ctx.chat.id, "typing")
            await env.MESSAGE_QUEUE.send({
                chatId: ctx.chat.id,
                text: ctx.message.text,
                updateId: ctx.update.update_id,
            })
        })

        return webhookCallback(bot, "cloudflare-mod")(request)
    },

    async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
        const bot = createBot(env)
        const db = createDb(env.DB)
        const provider = createProvider(env)

        for (const msg of batch.messages) {
            const { chatId, text, updateId } = msg.body
            try {
                await handleLLMResponse(
                    db,
                    provider.chatModel(env.LLM_MODEL),
                    chatId,
                    text,
                    bot.api,
                    256 * updateId,
                )
                msg.ack()
            } catch (err) {
                logger.error("Queue message failed:", err)
                msg.retry()
            }
        }
    },
}
