// ---------------------------------------------------------------------------
// Result<T, E> — typed error handling without exceptions
// ---------------------------------------------------------------------------

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Discriminated union for typed error handling. Narrow via `result.ok`. */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/** Construct an Ok result. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Construct an Err result. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// LogLevel
// ---------------------------------------------------------------------------

export type LogLevel =
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "unknown";

// ---------------------------------------------------------------------------
// LogEntry
// ---------------------------------------------------------------------------

export interface LogEntry {
  /** Unique identifier (e.g. UUID or hash of raw line). */
  readonly id: string;
  /** Parsed timestamp of the log line. */
  readonly timestamp: Date;
  /** Severity level. */
  readonly level: LogLevel;
  /** Human-readable message extracted from the log line. */
  readonly message: string;
  /** Originating service / container / module name, if available. */
  readonly service?: string;
  /** The original, unmodified log line. */
  readonly raw: string;
  /** Arbitrary structured metadata extracted during parsing. */
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ingest pipeline
// ---------------------------------------------------------------------------

export interface IngestOptions {
  /** Path to the log file or directory to ingest. */
  readonly filePath: string;
  /** Directory where the vector index is persisted. */
  readonly storageDir: string;
  /** Base URL of an OpenAI-compatible embedding server. */
  readonly ollamaBaseUrl?: string; // default: "http://localhost:11434"
  /** Embedding model name. */
  readonly embeddingModel?: string; // default: "nomic-embed-text"
  /** If set, only ingest entries whose `service` matches this value. */
  readonly serviceFilter?: string;
}

export interface IngestResult {
  /** Number of log entries successfully embedded and stored. */
  readonly ingested: number;
  /** Number of log entries skipped (duplicates, filtered out, etc.). */
  readonly skipped: number;
  /** Wall-clock duration of the ingest pipeline in milliseconds. */
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Query pipeline
// ---------------------------------------------------------------------------

export interface QueryOptions {
  /** Natural-language question about the logs. */
  readonly question: string;
  /** Directory where the vector index is persisted. */
  readonly storageDir: string;
  /** Base URL of an OpenAI-compatible chat server. */
  readonly ollamaBaseUrl?: string; // default: "http://localhost:11434"
  /** Chat / completion model name. */
  readonly chatModel?: string; // default: "llama3.2"
  /** Number of nearest-neighbor log entries to retrieve. */
  readonly topN?: number; // default: 10
  /** If set, only query entries whose `service` matches this value. */
  readonly serviceFilter?: string;
}

export interface QueryResult {
  /** LLM-generated answer grounded in the retrieved log entries. */
  readonly answer: string;
  /** Log entries used as context for the answer. */
  readonly sources: readonly LogEntry[];
  /** Wall-clock duration of the query pipeline in milliseconds. */
  readonly durationMs: number;
}
