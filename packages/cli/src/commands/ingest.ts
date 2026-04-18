import { defineCommand } from "citty";
import type { ArgsDef } from "citty";
import { ingest, MemoryVectorStore } from "@loglens/core";
import type { IngestDeps, IngestProgress } from "@loglens/core";
import { parseJsonlFile } from "@loglens/parsers";
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

export const ingestArgs = {
  file: {
    type: "positional" as const,
    description: "Path to the log file to ingest",
    required: true as const,
  },
  "storage-dir": {
    type: "string" as const,
    description: "Directory for the vector index",
    default: ".loglens",
  },
  "base-url": {
    type: "string" as const,
    description: "Base URL of the OpenAI-compatible embedding server",
    default: "http://localhost:11434",
  },
  model: {
    type: "string" as const,
    description: "Embedding model name",
    default: "nomic-embed-text",
  },
  service: {
    type: "string" as const,
    description: "Only ingest entries matching this service name",
  },
} satisfies ArgsDef;

// ---------------------------------------------------------------------------
// Progress renderer — translates IngestProgress events to CLI output
// ---------------------------------------------------------------------------

function renderProgress(event: IngestProgress): void {
  switch (event.phase) {
    case "parsing":
      if (event.current === 0) logInfo("Parsing log file...");
      else logSuccess("Parsed log file");
      break;
    case "embedding":
      logInfo(
        `Embedding batch ${String(event.current)}/${String(event.total)}...`,
      );
      break;
    case "saving":
      if (event.current === 0) logInfo("Saving index...");
      else if (event.current === event.total) logSuccess("Index saved");
      break;
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "ingest",
    description: "Ingest a log file into the local vector index",
  },
  args: ingestArgs,
  async run({ args }) {
    const filePath = args.file;
    const storageDir = args["storage-dir"];
    const baseUrl = args["base-url"];
    const model = args.model;
    const service = args.service;

    logInfo(`Ingesting ${bold(filePath)} → ${dim(storageDir)}`);

    const store = new MemoryVectorStore();
    const deps: IngestDeps = {
      parse: parseJsonlFile,
      store,
      onProgress: renderProgress,
    };

    const result = await ingest(
      {
        filePath,
        storageDir,
        ollamaBaseUrl: baseUrl,
        embeddingModel: model,
        ...(service !== undefined ? { serviceFilter: service } : {}),
      },
      deps,
    );

    if (!result.ok) {
      logError(`Ingest failed: ${result.error.message}`);
      process.exit(1);
    }

    const { ingested, skipped, durationMs } = result.value;
    logSuccess(
      `Done: ${bold(String(ingested))} ingested, ${String(skipped)} skipped ${dim(`(${formatDuration(durationMs)})`)}`,
    );
  },
});
