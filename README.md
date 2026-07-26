# Mirality agent

The small program that connects **your** Claude to Mirality. You write posts in
the Mirality web app; this agent runs the generation on your own Claude
subscription, on your own machine, and sends the result back.

It contains no prompt logic — it just runs whatever the server hands it and
returns the text.

## Before you start

- **Node 18+**
- **Claude Code, logged in** — this is what does the writing, on your own
  subscription (no API key, no extra bill). Run `claude` once and sign in.
- **Your instance URL + token** — sent to you when your Mirality was set up.

## Setup — 3 steps

```bash
# 1. Get the agent
git clone https://github.com/ohsuvorav/mirality-client.git && cd mirality-client

# 2. Set your variables — copy the example, then paste your URL + token into .env
cp .env.example .env

# 3. Install + open Mirality + start the agent
npm run go
```

`npm run go` installs dependencies, opens the Mirality web app in your browser,
and starts the agent (you'll see `[agent] polling …`). Leave it running while
you use Mirality — write a post in the browser and it appears. If the agent
isn't running, generations just wait.

Next time, you only need `npm start` (dependencies are already installed).

## Troubleshooting

- **`claim 401`** — wrong or missing `MIRALITY_AGENT_TOKEN` in `.env`.
- **Generations never finish** — the agent isn't running, or `MIRALITY_SERVER_URL`
  is wrong. Confirm you see `[agent] polling …`.
- **"No output. Are you logged into Claude Code?"** — run `claude` once and sign
  in, then restart the agent.
- **Browser didn't open** — open your `MIRALITY_SERVER_URL` manually.
