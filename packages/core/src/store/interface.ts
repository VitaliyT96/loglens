import type { LogEntry } from "../types.js";

// ---------------------------------------------------------------------------
// VectorStoreEntry — LogEntry enriched with its embedding vector
// ---------------------------------------------------------------------------

export type VectorStoreEntry = LogEntry & {
  /** Dense embedding vector produced by the embedding model. */
  readonly embedding: number[];
};

// ---------------------------------------------------------------------------
// IVectorStore — swappable I/O boundary for vector similarity search
// ---------------------------------------------------------------------------

export interface IVectorStore {
  /** Add log entries together with their pre-computed embeddings. */
  add(entries: LogEntry[], embeddings: number[][]): Promise<void>;

  /**
   * Return the `topN` nearest log entries by cosine distance.
   * When `serviceFilter` is provided, only entries whose `service` field
   * matches the filter value are considered.
   */
  search(
    queryEmbedding: number[],
    topN: number,
    serviceFilter?: string,
  ): Promise<LogEntry[]>;

  /** Persist the current index state to the given directory. */
  save(dir: string): Promise<void>;

  /** Load a previously persisted index from the given directory. */
  load(dir: string): Promise<void>;

  /** Remove all entries and reset internal state. */
  clear(): Promise<void>;
}
