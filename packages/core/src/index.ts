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
export { VectorStore } from "./store.js";

export type { EmbedderConfig, EmbedError, FetchFn } from "./embedder.js";
export { embedTexts } from "./embedder.js";
