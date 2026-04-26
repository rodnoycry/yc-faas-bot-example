import { Bot } from "grammy"
import { BOT_TOKEN } from "./env.js"

export const bot = new Bot(BOT_TOKEN)

bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."))
bot.on("message", (ctx) => ctx.reply("Got another message!"))
