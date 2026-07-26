// NOTE: exact mirror of the server's apps/mirality/lib/execute.ts. Kept as a
// copy on purpose so this agent folder is fully standalone (a user clones only
// this folder, no monorepo). If you change one, change both — diff them.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// A one-shot streaming prompt: a single user turn carrying the text plus image
// blocks. Yielding once and returning closes the input stream, so the SDK runs
// exactly one turn and the result loop ends.
async function* imagePrompt(
  text: string,
  images: { data: string; mediaType: string }[],
): AsyncGenerator<SDKUserMessage> {
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((im) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: im.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
            data: im.data,
          },
        })),
      ],
    },
  };
}

type QueryArg = Parameters<typeof query>[0];

export type ExecuteInput = {
  prompt: string;
  images?: { data: string; mediaType: string }[];
  options: QueryArg["options"];
  resumeId?: string;
  // Streaming side-effects (agent mode persists tool calls + assistant text as
  // they arrive). execute() stays ignorant of what these do — it just calls
  // them, so the split can route them back over the wire later.
  onToolUse?: (name: string, args: unknown) => void;
  onAssistantText?: (text: string) => void;
};

export type ExecuteResult = { assistantText: string; resultText: string; sessionId?: string };

// The entire claude-calling surface: the one piece that runs on the USER's
// machine in the server/thin-client split. Run a finished prompt through the
// local claude session and collect output. Everything that builds `prompt` and
// `options` stays on the server (the moat) and hands the finished string here.
export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
  const { prompt, images = [], options, resumeId } = input;

  // One streamed turn. `rid` continues a prior SDK session; undefined starts
  // fresh. Collects the text so the caller can retry without resume if the
  // session log is gone.
  const consume = async (rid: string | undefined): Promise<ExecuteResult> => {
    let assistantText = "";
    let resultText = "";
    let sessionId: string | undefined;
    const response = query({
      prompt: images.length ? imagePrompt(prompt, images) : prompt,
      options: { ...options, ...(rid ? { resume: rid } : {}) },
    });
    for await (const message of response) {
      if (message.type === "system") {
        sessionId = message.session_id;
      } else if (message.type === "assistant") {
        let blockText = "";
        for (const block of message.message.content) {
          if (block.type === "text") {
            blockText += block.text;
          } else if (block.type === "tool_use") {
            input.onToolUse?.(block.name, block.input);
          }
        }
        if (blockText) {
          assistantText += blockText;
          input.onAssistantText?.(blockText);
        }
      } else if (message.type === "result") {
        sessionId = message.session_id;
        if (message.subtype === "success") resultText = message.result;
      }
    }
    return { assistantText, resultText, sessionId };
  };

  try {
    return await consume(resumeId);
  } catch (err) {
    // The SDK's on-disk session log is ephemeral — pruned after 30 days, and
    // never present if the session was started on another machine. When resume
    // targets a log that's gone the CLI throws "No conversation found with
    // session ID". Fall back to a fresh session so the chat keeps working; the
    // new session id replaces the dead one for next turn.
    if (resumeId && err instanceof Error && /No conversation found with session ID/i.test(err.message)) {
      return await consume(undefined);
    }
    throw err;
  }
}
