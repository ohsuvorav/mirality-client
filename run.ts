// Mirality thin agent — the one piece that runs on YOUR machine.
//
// It polls your Mirality server for a finished prompt, runs it through your own
// local `claude` login, and posts the text back. It holds no prompt logic, no
// context, no brand voice, no database — those live on the server. Prompt string
// in, completion text out.
//
// Setup (one time):
//   1. Install + log in to Claude Code (uses YOUR Claude subscription):
//        run `claude` once and sign in.
//   2. npm install
//
// Run (leave it going while you use Mirality in the browser):
//   MIRALITY_SERVER_URL=https://your-instance-url \
//   MIRALITY_AGENT_TOKEN=your-token \
//   npm start
import { execute } from "./execute";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

// Load .env (KEY=VALUE lines) into process.env if present. No dependency, so it
// runs on any Node. Real environment variables take precedence over the file.
function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env file — rely on real env vars */
  }
}
loadEnv();

const SERVER = (process.env.MIRALITY_SERVER_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.MIRALITY_AGENT_TOKEN || "";
const POLL_MS = Number(process.env.MIRALITY_POLL_MS || 1500);

// Open the Mirality web app in the default browser once on startup, so the
// user's "run one command" also lands them in the UI. Set
// MIRALITY_OPEN_BROWSER=false to skip.
function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* non-fatal — user can open the URL manually */
  }
}

// One claimable job as the server hands it over. options is the SDK options the
// server assembled — opaque to the agent, passed straight to execute().
type ClaimedJob = {
  id: string;
  promptText: string;
  images?: { data: string; mediaType: string }[];
  options: Parameters<typeof execute>[0]["options"];
  resumeId?: string;
};

const auth = { authorization: `Bearer ${TOKEN}` };

async function claim(): Promise<ClaimedJob | null> {
  const r = await fetch(`${SERVER}/api/agent/claim`, { method: "POST", headers: auth });
  if (!r.ok) throw new Error(`claim ${r.status}`);
  const d = (await r.json()) as { job: ClaimedJob | null };
  return d.job;
}

async function report(jobId: string, body: { text?: string; sessionId?: string; error?: string }) {
  await fetch(`${SERVER}/api/agent/result`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ jobId, ...body }),
  });
}

async function runOne(job: ClaimedJob) {
  try {
    const { assistantText, resultText, sessionId } = await execute({
      prompt: job.promptText,
      images: job.images ?? [],
      options: job.options,
      resumeId: job.resumeId,
    });
    const text = (resultText || assistantText).trim();
    await report(job.id, { text, sessionId });
  } catch (err) {
    await report(job.id, { error: err instanceof Error ? err.message : "agent failed" });
  }
}

async function loop() {
  if (!TOKEN) {
    console.error("[agent] MIRALITY_AGENT_TOKEN is required");
    process.exit(1);
  }
  console.log(`[agent] polling ${SERVER} every ${POLL_MS}ms`);
  if (process.env.MIRALITY_OPEN_BROWSER !== "false") openBrowser(SERVER);
  for (;;) {
    try {
      const job = await claim();
      if (job) {
        console.log(`[agent] claimed ${job.id}`);
        await runOne(job);
        console.log(`[agent] finished ${job.id}`);
        continue; // pull the next one immediately — don't sleep while there's work
      }
    } catch (err) {
      console.error(`[agent] ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

void loop();
