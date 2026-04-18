// @loglens/core — ingest, embed, vector store, query engine
export type {
  Ok,
  Err,
  Result,
  LogLevel,
  LogEntry,
  IngestOptions,
  IngestResult,
  QueryOptions,
  QueryResult,
} from "./types.js";

export { ok, err } from "./types.js";

export type { IVectorStore, VectorStoreEntry } from "./store/interface.js";
export { MemoryVectorStore } from "./store/memory.js";

export type { LlmConfig, ChatMessage, LlmError } from "./llm/client.js";
export { fetchEmbeddings, streamChat } from "./llm/client.js";

export type {
  IngestError,
  IngestParseError,
  IngestEmbedError,
  IngestStoreError,
  IngestProgress,
  IngestDeps,
  ParseOutput,
  ParseFailure,
} from "./ingest.js";
export { ingest } from "./ingest.js";
