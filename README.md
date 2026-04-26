# Yandex Cloud Functions AI Telegram ChatBot with YDB Example

Basically a lot of steps are described in official Grammy library instructions: https://grammy.dev/hosting/cloudflare-workers-nodejs

1. Create Telegram bot at https://t.me/BotFather

2. Get telegram token, put it into `.env.production` under `BOT_TOKEN` variable like in `.env.example`

3. Go by https://api.telegram.org/bot<BOT_TOKEN>/getMe, you will get answer like this:
```json
{
    "id": 1234567890,
    "is_bot": true,
    "first_name": "mybot",
    "username": "MyBot",
    "can_join_groups": true,
    "can_read_all_group_messages": false,
    "supports_inline_queries": true,
    "can_connect_to_business": false
}
```

Copy and paste it into `.env.production` under `BOT_INFO` like this (important to put it in single quotes!):
```sh
BOT_INFO='{
    "id": 1234567890,
    "is_bot": true,
    "first_name": "mybot",
    "username": "MyBot",
    "can_join_groups": true,
    "can_read_all_group_messages": false,
    "supports_inline_queries": true,
    "can_connect_to_business": false
}'
```

4. [Optionally] Set `.env.dev` for development profile for local tests (will probably require setting up `ngrok` for valid https webhook set up)

5. Deploy in order to get the deployment URL:
```sh
pnpm run deploy
```

And follow the instructions from `wrangler`

6. After the deployment you will see something like:
```txt
Deployed ai-korobka-bot triggers (2.08 sec)
  https://ai-korobka-bot.<username>.workers.dev
```

Put the link into `.env.production` like this:
```sh
DEPLOYMENT_URL="https://ai-korobka-bot.<username>.workers.dev/"
```

Notice the `/` at the end

7. Now run webhook to connect deployed version to the telegram:
```sh
pnpm run webhook
```

8. Go and check it out, should work, great job!

9. Similar set up can be done for dev environment too

10. Set up LLM endpoints in `.env.*` files:
```sh
# OpenAI-compatible LLM endpoint
LLM_API_BASE_URL="https://your-api-endpoint.com/v1"
LLM_API_KEY="xxxxxxxxxxxxxxxxxxxxxxxx"
LLM_MODEL="your-model-name"
```

11. Create a D1 database for conversation history:
```sh
npx wrangler d1 create ai-korobka-bot-db
```

You will get output like this:
```
database_name = "ai-korobka-bot-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Make sure the `database_id` in `wrangler.jsonc` under `d1_databases` matches the one you got.

12. Apply the database schema to remote (production):
```sh
pnpm run db:generate
pnpm run db:migrate
```

Run both again whenever the schema in `src/db/schema.ts` changes.

13. For local development, create the tables in the local D1 instance:
```sh
npx wrangler d1 execute ai-korobka-bot-db --local --command="CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);"
```

The local D1 database is stored under `.wrangler/state/` and is separate from the remote one. `pnpm run db:migrate` only applies to remote — locally you need to create tables manually.