import { defineCommand } from "citty";
import type { ArgsDef } from "citty";
import { query, MemoryVectorStore } from "@asklog/core";
import type { QueryDeps, QueryEvent } from "@asklog/core";
import {
  logSuccess,
  logInfo,
  logError,
  formatDuration,
  bold,
  dim,
} from "../format.js";

// ---------------------------------------------------------------------------
// Arg definition — exported for unit testing via citty's parseArgs
// ---------------------------------------------------------------------------

export const queryArgs = {
  question: {
    type: "positional" as const,
    description: "Natural language question about the logs",
    required: true as const,
  },
  "storage-dir": {
    type: "string" as const,
    description: "Directory for the vector index",
    default: ".asklog",
  },
  "base-url": {
    type: "string" as const,
    description: "Base URL of the OpenAI-compatible server",
    default: "http://localhost:11434",
  },
  "chat-model": {
    type: "string" as const,
    description: "Chat/completion model name",
    default: "llama3.2",
  },
  "embedding-model": {
    type: "string" as const,
    description: "Embedding model name (must match the model used during ingest)",
    default: "nomic-embed-text",
  },
  "top-n": {
    type: "string" as const,
    description: "Number of nearest log entries to retrieve",
    default: "10",
  },
  service: {
    type: "string" as const,
    description: "Only query entries matching this service name",
  },
} satisfies ArgsDef;

// ---------------------------------------------------------------------------
// Event renderer — translates QueryEvent to CLI output + streaming tokens
// ---------------------------------------------------------------------------

function renderEvent(event: QueryEvent): void {
  switch (event.phase) {
    case "loading":
      logInfo("Loading index...");
      break;
    case "embedding":
      logInfo("Embedding question...");
      break;
    case "searching":
      logInfo("Searching for relevant entries...");
      break;
    case "generating":
      if (event.token !== undefined) {
        process.stdout.write(event.token);
      } else {
        logSuccess("Generating answer...");
        console.log(); // blank line before streamed answer
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "query",
    description: "Ask a natural-language question about your logs",
  },
  args: queryArgs,
  async run({ args }) {
    const question = args.question;
    const storageDir = args["storage-dir"];
    const baseUrl = args["base-url"];
    const chatModel = args["chat-model"];
    const embeddingModel = args["embedding-model"];
    const topNRaw = args["top-n"];
    const service = args.service;

    const topN = parseInt(topNRaw, 10);
    if (isNaN(topN) || topN < 1) {
      logError(
        `Invalid --top-n value: "${topNRaw}". Must be a positive integer.`,
      );
      process.exit(1);
    }

    // Validate config eagerly — fail fast on bad URL
    try {
      new URL(baseUrl);
    } catch {
      logError(`Invalid --base-url: "${baseUrl}" — expected a valid URL like http://localhost:11434`);
      process.exit(1);
    }

    logInfo(`Querying: ${bold(question)}`);

    const store = new MemoryVectorStore();
    const deps: QueryDeps = {
      store,
      onEvent: renderEvent,
    };

    const result = await query(
      {
        question,
        storageDir,
        ollamaBaseUrl: baseUrl,
        chatModel,
        embeddingModel,
        topN,
        ...(service !== undefined ? { serviceFilter: service } : {}),
      },
      deps,
    );

    if (!result.ok) {
      console.log(); // newline after any partial streamed output
      if (result.error.message.includes("ECONNREFUSED")) {
        logError("Ollama is not running. Start it with: ollama serve");
      } else {
        logError(`Query failed: ${result.error.message}`);
      }
      process.exit(1);
    }

    const { sources, durationMs } = result.value;
    console.log(); // newline after streamed answer
    console.log();
    logSuccess(
      `${bold(String(sources.length))} sources used ${dim(`(${formatDuration(durationMs)})`)}`,
    );
  },
});
