# Yandex Cloud Functions AI Telegram ChatBot with YDB Example

A minimal Telegram chatbot deployed to [Yandex Cloud Functions](https://yandex.cloud/en/services/functions) with [Yandex Database (YDB)](https://ydb.tech/) for conversation history. The bot streams responses from any OpenAI-compatible LLM endpoint via the [Vercel AI SDK](https://ai-sdk.dev/) and [grammY](https://grammy.dev/).

## Architecture: synchronous webhook + async self-invocation

Telegram requires a webhook to respond with **HTTP 200 quickly**, otherwise it
retries the same update. LLM calls take seconds — too long to do inline.

Reference:
https://grammy.dev/guide/deployment-types#how-to-use-webhooks

Yandex Cloud Functions has a built-in **asynchronous invocation** mode that's
perfect for this: append `?integration=async` to the function URL and the
function returns **HTTP 202 immediately** while the actual handler runs in the
background.

- [Async function invocation](https://yandex.cloud/en/docs/functions/concepts/function-invoke-async)

So the function dispatches between two paths:

1. **Sync path (Telegram webhook hits the public URL):**
   - Parse the Telegram update.
   - POST it back to *itself* at `?integration=async`, authenticated with the
     IAM token from `context.token` (the SA attached to the function).
   - Return 200 to Telegram.
2. **Async path (self-invocation):**
   - Open a YDB driver, run the LLM call, stream the reply to Telegram via
     `bot.api`, save the exchange to YDB, close the driver.

One function, no extra queues to manage. Failures on the async path could be
routed to a YMQ DLQ later if you need retry/observability.

References:
- [Invoking a function (overview)](https://yandex.cloud/en/docs/functions/concepts/function-invoke)

## YDB driver lifecycle

The YDB SDK uses HTTP/2 connections that **must not be reused across
serverless invocations** — a cached driver causes hangs and intermittent
errors. The handler creates a `Driver` inside the request scope and closes it
in `finally`. See `src/index.ts:handleAsync`.
Reference:
- https://github.com/ydb-platform/ydb-js-sdk/tree/main/examples/sls#readme

## Prerequisites

- [Yandex Cloud CLI](https://yandex.cloud/en/docs/cli/quickstart) (`yc`)
- Node.js 22+, pnpm
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An OpenAI-compatible LLM endpoint (URL + API key + model name)

## 1. Configure env vars

```sh
cp .env.example .env.production
```

Fill in `.env.production`:

- `BOT_TOKEN` — from BotFather.
- `BOT_INFO` — paste the full JSON from `https://api.telegram.org/bot<BOT_TOKEN>/getMe`
  (single-quoted). See "Why BOT_INFO" below.
- `AI_PROVIDER_NAME`, `AI_PROVIDER_BASE_URL`, `AI_PROVIDER_API_KEY`,
  `AI_PROVIDER_MODEL` — any OpenAI-compatible chat endpoint, for example [Yandex AI Studio](https://aistudio.yandex.ru/)

The remaining values (`YC_*`, `YDB_*`, `DEPLOYMENT_URL`) are filled in during
the steps below.

### Why BOT_INFO?

If `botInfo` is not passed to grammy's `new Bot(...)`, the library lazily
calls Telegram's `getMe` on the first update — once per process. In a
long-running bot that's a one-time cost; in serverless every cold container
pays it on the first webhook hit, slowing down the sync path. Pasting the
`getMe` response into `BOT_INFO` skips that round-trip entirely.

## 2. Create a YDB serverless database

In the [YDB console](https://console.yandex.cloud/) → "Create database" →
"Serverless". Once it's `RUNNING`, copy the **gRPC connection string** from
the overview page into `YDB_CONNECTION_STRING`.

## 3. Create a service account and grant YDB access

```sh
# Service account that the function will run as.
yc iam service-account create --name=yc-faas-ai-bot-sa
```

You will see output like that:
```
id: xxxxxxxxxxxxxxxxxx
folder_id: xxxxxxxxxxxxxxxxxxx
created_at: "20XX-XX-XXTXX:XX:XXZ"
name: yc-faas-ai-bot-sa
```

Copy the `id` field and put it into `.env.production` as `YC_SERVICE_ACCOUNT_ID` value

Then take `folder_id` field and run this command to allow editing of YDB database inside of the folder:

```sh
yc resource-manager folder add-access-binding <folder-id> \
    --role=ydb.editor \
    --subject="serviceAccount:<service-account-id>"

# Also grant the function permission to invoke itself asynchronously.
yc resource-manager folder add-access-binding <folder-id> \
    --role=serverless.functions.invoker \
    --subject="serviceAccount:<service-account-id>"
```

## 4. Initialize the DB schema

For local invocation of the init script, get a short-lived IAM token and put
it into `.env.production` as `YDB_ACCESS_TOKEN_CREDENTIALS`:

```sh
yc iam create-token
```

Then create the `messages` table:

```sh
pnpm install
pnpm run db:init
```

`scripts/init-db/init.sql` defines the schema. Re-run `pnpm run db:init`
whenever you change the SQL.

## 5. Create the Cloud Function

```sh
yc serverless function create --name=yc-faas-ai-bot-example
yc serverless function allow-unauthenticated-invoke yc-faas-ai-bot-example
```

`YC_FUNCTION_NAME` in `.env.production` must match the name above.

The first deploy needs `DEPLOYMENT_URL` to be set — but you don't have it
yet. Put a placeholder for now (e.g. `https://placeholder/`) and update it
after the first deploy.

## 6. First deploy

Bundle `src/index.ts` with esbuild:

```sh
pnpm run build
```

Load the env vars from `.env.production` into your shell, then create a new
function version:

```sh
set -a
. ./.env.production
set +a

yc serverless function version create \
    --function-name=$YC_FUNCTION_NAME \
    --runtime=nodejs22 \
    --entrypoint=index.handler \
    --memory=256m \
    --execution-timeout=60s \
    --service-account-id=$YC_SERVICE_ACCOUNT_ID \
    --source-path=./dist \
    --environment=YDB_CONNECTION_STRING=$YDB_CONNECTION_STRING \
    --environment=BOT_TOKEN=$BOT_TOKEN \
    --environment=BOT_INFO=$BOT_INFO \
    --environment=AI_PROVIDER_NAME=$AI_PROVIDER_NAME \
    --environment=AI_PROVIDER_BASE_URL=$AI_PROVIDER_BASE_URL \
    --environment=AI_PROVIDER_API_KEY=$AI_PROVIDER_API_KEY \
    --environment=AI_PROVIDER_MODEL=$AI_PROVIDER_MODEL \
    --environment=DEPLOYMENT_URL=$DEPLOYMENT_URL
```

After it finishes, the function gets a stable invoke URL of the form:

```
https://functions.yandexcloud.net/<function-id>
```

You can also fetch it via:

```sh
yc serverless function get --name=yc-faas-ai-bot-example --format=json | jq -r .http_invoke_url
```

Put that URL into `.env.production` as `DEPLOYMENT_URL` (trailing slash is
fine but not required).

## 7. Second deploy with the real URL

Re-run the `pnpm run build` + `yc serverless function version create` commands
from step 6. The function now knows its own URL and can self-invoke async.

## 8. Register the Telegram webhook

```sh
pnpm run webhook
```

`scripts/set-webhook.ts` calls Telegram's `setWebhook` with `DEPLOYMENT_URL`.
Telegram should respond with `{"ok":true,"result":true,"description":"Webhook
was set"}`.

## 9. Test

Send any message to your bot. Run:

```sh
yc serverless function logs yc-faas-ai-bot-example --since=10m
```

…to see the sync→async hand-off. The bot should reply with a streamed message.

Use `/new` to clear conversation history for the current chat.

## Project layout

```
src/
  index.ts        — handler with sync/async dispatch
  db.ts           — YDB driver factory + history queries (zod-validated)
  logger.ts
scripts/
  init-db/
    init-db.ts    — runs init.sql against your YDB
    init.sql      — schema
  set-webhook.ts  — registers the Telegram webhook
  dev.ts          — placeholder (local dev not implemented)
```

## Local development

Not implemented. `pnpm run dev` prints a placeholder message and exits.

## License

MIT — see `LICENSE`.
