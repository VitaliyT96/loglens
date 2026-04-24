import { MemoryVectorStore, ingest, query } from "@loglens/core";
import type {
  Result,
  IngestResult,
  QueryResult,
  IngestError,
  QueryError,
  IngestProgress,
  QueryEvent,
} from "@loglens/core";
import { autoDetectParser } from "@loglens/parsers";

export * from "@loglens/core";

export interface LoglensConfig {
  storageDir: string;
  ollamaBaseUrl?: string;
  embeddingModel?: string;
  chatModel?: string;
}

export interface LoglensIngestOptions {
  serviceFilter?: string;
  onProgress?: (event: IngestProgress) => void;
}

export interface LoglensQueryOptions {
  topN?: number;
  serviceFilter?: string;
}

export class Loglens {
  private config: LoglensConfig;
  private store: MemoryVectorStore;

  constructor(config: LoglensConfig) {
    this.config = config;
    this.store = new MemoryVectorStore();
  }

  async ingest(
    filePath: string,
    options?: LoglensIngestOptions,
  ): Promise<Result<IngestResult, IngestError>> {
    const ingestOpts: LoglensIngestOptions & { filePath: string; storageDir: string; ollamaBaseUrl?: string; embeddingModel?: string } = {
      filePath,
      storageDir: this.config.storageDir,
      ...(this.config.ollamaBaseUrl !== undefined && { ollamaBaseUrl: this.config.ollamaBaseUrl }),
      ...(this.config.embeddingModel !== undefined && { embeddingModel: this.config.embeddingModel }),
      ...(options?.serviceFilter !== undefined && { serviceFilter: options.serviceFilter }),
    };

    return ingest(
      ingestOpts,
      {
        parse: autoDetectParser,
        store: this.store,
        ...(options?.onProgress && { onProgress: options.onProgress }),
      },
    );
  }

  async query(
    question: string,
    options?: LoglensQueryOptions,
  ): Promise<Result<QueryResult, QueryError>> {
    const queryOpts: LoglensQueryOptions & { question: string; storageDir: string; ollamaBaseUrl?: string; embeddingModel?: string; chatModel?: string } = {
      question,
      storageDir: this.config.storageDir,
      ...(this.config.ollamaBaseUrl !== undefined && { ollamaBaseUrl: this.config.ollamaBaseUrl }),
      ...(this.config.embeddingModel !== undefined && { embeddingModel: this.config.embeddingModel }),
      ...(this.config.chatModel !== undefined && { chatModel: this.config.chatModel }),
      ...(options?.topN !== undefined && { topN: options.topN }),
      ...(options?.serviceFilter !== undefined && { serviceFilter: options.serviceFilter }),
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
    options?: LoglensQueryOptions,
    onEvent?: (event: QueryEvent) => void,
  ): Promise<Result<QueryResult, QueryError>> {
    const queryOpts: LoglensQueryOptions & { question: string; storageDir: string; ollamaBaseUrl?: string; embeddingModel?: string; chatModel?: string } = {
      question,
      storageDir: this.config.storageDir,
      ...(this.config.ollamaBaseUrl !== undefined && { ollamaBaseUrl: this.config.ollamaBaseUrl }),
      ...(this.config.embeddingModel !== undefined && { embeddingModel: this.config.embeddingModel }),
      ...(this.config.chatModel !== undefined && { chatModel: this.config.chatModel }),
      ...(options?.topN !== undefined && { topN: options.topN }),
      ...(options?.serviceFilter !== undefined && { serviceFilter: options.serviceFilter }),
    };

    return query(
      queryOpts,
      {
        store: this.store,
        ...(onEvent && { onEvent }),
      },
    );
  }
}
