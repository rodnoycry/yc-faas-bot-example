import { handleAsync, handleSync, isHttpEvent } from "./bot"
import { logger } from "./logger"

export interface Env {
    BOT_INFO: string
    BOT_TOKEN: string
    AI_PROVIDER_NAME: string
    AI_PROVIDER_BASE_URL: string
    AI_PROVIDER_API_KEY: string
    AI_PROVIDER_MODEL: string
    DEPLOYMENT_URL: string
}

function readEnv(): Env {
    const required = [
        "BOT_INFO",
        "BOT_TOKEN",
        "AI_PROVIDER_NAME",
        "AI_PROVIDER_BASE_URL",
        "AI_PROVIDER_API_KEY",
        "AI_PROVIDER_MODEL",
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
        AI_PROVIDER_NAME: process.env.AI_PROVIDER_NAME as string,
        AI_PROVIDER_BASE_URL: process.env.AI_PROVIDER_BASE_URL as string,
        AI_PROVIDER_API_KEY: process.env.AI_PROVIDER_API_KEY as string,
        AI_PROVIDER_MODEL: process.env.AI_PROVIDER_MODEL as string,
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

export const handler = async (
    event: unknown,
    context: FunctionContext,
): Promise<unknown> => {
    try {
        const env = readEnv()
        if (isHttpEvent(event)) {
            const accessToken = context.token?.access_token
            if (!accessToken) {
                throw new Error(
                    "Function context has no IAM token — attach a service account",
                )
            }
            return await handleSync({ event, env, accessToken })
        }
        await handleAsync({ event, env, systemPrompt: SYSTEM_PROMPT })
        return { statusCode: 200, body: "" }
    } catch (err) {
        logger.error("Handler failed:", err)
        throw err
    }
}
