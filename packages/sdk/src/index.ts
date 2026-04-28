import { MemoryVectorStore, ingest, query } from "@asklog/core";
import type {
  Result,
  IngestOptions,
  IngestResult,
  QueryOptions,
  QueryResult,
  IngestError,
  QueryError,
  IngestProgress,
  QueryEvent,
} from "@asklog/core";
import { autoDetectParser } from "@asklog/parsers";

// ---------------------------------------------------------------------------
// Re-export only what SDK consumers need — no wildcard re-exports
// ---------------------------------------------------------------------------

export type {
  Result,
  Ok,
  Err,
  LogEntry,
  LogLevel,
  IngestResult,
  IngestOptions,
  QueryResult,
  QueryOptions,
  IngestError,
  IngestParseError,
  IngestEmbedError,
  IngestStoreError,
  QueryError,
  QueryEmbedError,
  QueryStoreError,
  QueryChatError,
  IngestProgress,
  QueryEvent,
  IVectorStore,
  VectorStoreEntry,
  LlmConfig,
  ChatMessage,
  ChatRole,
  LlmError,
} from "@asklog/core";

export { ok, err, MemoryVectorStore } from "@asklog/core";

// ---------------------------------------------------------------------------
// SDK-specific types
// ---------------------------------------------------------------------------

export interface AsklogConfig {
  readonly storageDir: string;
  readonly ollamaBaseUrl?: string;
  readonly embeddingModel?: string;
  readonly chatModel?: string;
}

export interface AsklogIngestOptions {
  readonly serviceFilter?: string;
  readonly onProgress?: (event: IngestProgress) => void;
}

export interface AsklogQueryOptions {
  readonly topN?: number;
  readonly serviceFilter?: string;
}

// ---------------------------------------------------------------------------
// Asklog — high-level SDK class
// ---------------------------------------------------------------------------

export class Asklog {
  private readonly config: AsklogConfig;
  private readonly store: MemoryVectorStore;

  constructor(config: AsklogConfig) {
    // Validate baseUrl eagerly so invalid config fails at construction, not mid-pipeline
    if (config.ollamaBaseUrl !== undefined) {
      try {
        new URL(config.ollamaBaseUrl);
      } catch {
        throw new Error(
          `Invalid ollamaBaseUrl: "${config.ollamaBaseUrl}" — expected a valid URL like http://localhost:11434`,
        );
      }
    }

    this.config = config;
    this.store = new MemoryVectorStore();
  }

  async ingest(
    filePath: string,
    options?: AsklogIngestOptions,
  ): Promise<Result<IngestResult, IngestError>> {
    const ingestOpts: IngestOptions = {
      filePath,
      storageDir: this.config.storageDir,
      ...(this.config.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: this.config.ollamaBaseUrl } : {}),
      ...(this.config.embeddingModel !== undefined ? { embeddingModel: this.config.embeddingModel } : {}),
      ...(options?.serviceFilter !== undefined ? { serviceFilter: options.serviceFilter } : {}),
    };

    return ingest(
      ingestOpts,
      {
        parse: autoDetectParser,
        store: this.store,
        ...(options?.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      },
    );
  }

  async query(
    question: string,
    options?: AsklogQueryOptions,
  ): Promise<Result<QueryResult, QueryError>> {
    const queryOpts: QueryOptions = {
      question,
      storageDir: this.config.storageDir,
      ...(this.config.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: this.config.ollamaBaseUrl } : {}),
      ...(this.config.embeddingModel !== undefined ? { embeddingModel: this.config.embeddingModel } : {}),
      ...(this.config.chatModel !== undefined ? { chatModel: this.config.chatModel } : {}),
      ...(options?.topN !== undefined ? { topN: options.topN } : {}),
      ...(options?.serviceFilter !== undefined ? { serviceFilter: options.serviceFilter } : {}),
    };

    return query(
      queryOpts,
      {
        store: this.store,
      },
    );
  }

  async queryStream(
    question: string,
    options?: AsklogQueryOptions,
    onEvent?: (event: QueryEvent) => void,
  ): Promise<Result<QueryResult, QueryError>> {
    const queryOpts: QueryOptions = {
      question,
      storageDir: this.config.storageDir,
      ...(this.config.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: this.config.ollamaBaseUrl } : {}),
      ...(this.config.embeddingModel !== undefined ? { embeddingModel: this.config.embeddingModel } : {}),
      ...(this.config.chatModel !== undefined ? { chatModel: this.config.chatModel } : {}),
      ...(options?.topN !== undefined ? { topN: options.topN } : {}),
      ...(options?.serviceFilter !== undefined ? { serviceFilter: options.serviceFilter } : {}),
    };

    return query(
      queryOpts,
      {
        store: this.store,
        ...(onEvent !== undefined ? { onEvent } : {}),
      },
    );
  }
}
