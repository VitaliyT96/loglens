import { ok, err } from "./types.js";
import type { Result, LogEntry, QueryOptions, QueryResult } from "./types.js";
import type { IVectorStore } from "./store/interface.js";
import type { LlmConfig, LlmError, ChatMessage } from "./llm/client.js";
import { fetchEmbeddings, streamChat } from "./llm/client.js";

// ---------------------------------------------------------------------------
// QueryError — typed error union for the query pipeline
// ---------------------------------------------------------------------------

export interface QueryEmbedError {
  readonly code: "EMBED_ERROR";
  readonly message: string;
  readonly cause: LlmError;
}

export interface QueryStoreError {
  readonly code: "STORE_ERROR";
  readonly message: string;
}

export interface QueryChatError {
  readonly code: "CHAT_ERROR";
  readonly message: string;
}

export type QueryError = QueryEmbedError | QueryStoreError | QueryChatError;

// ---------------------------------------------------------------------------
// QueryEvent — progress events emitted during query
// ---------------------------------------------------------------------------

export interface QueryEvent {
  readonly phase: "loading" | "embedding" | "searching" | "generating";
  /** For "generating" phase, contains the latest token chunk. */
  readonly token?: string;
}

// ---------------------------------------------------------------------------
// QueryDeps — dependency injection container
// ---------------------------------------------------------------------------

export interface QueryDeps {
  /** Vector store instance — any IVectorStore implementation. */
  readonly store: IVectorStore;

  /** Optional progress/event callback, called at each phase and per token. */
  readonly onEvent?: (event: QueryEvent) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_CHAT_MODEL = "llama3.2";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
const DEFAULT_TOP_N = 10;

// ---------------------------------------------------------------------------
// buildSystemPrompt — construct the RAG system message
// ---------------------------------------------------------------------------

function buildSystemPrompt(sources: readonly LogEntry[]): string {
  const header =
    "You are a log analysis assistant. Answer the user's question based ONLY on the log entries below. " +
    "If the answer cannot be determined from the logs, say so. " +
    "Reference specific log entries (by timestamp, service, or content) when relevant.\n\n" +
    "--- LOG ENTRIES ---\n";

  const body = sources
    .map((entry, i) => {
      const ts = entry.timestamp.toISOString();
      const svc = entry.service ?? "unknown";
      return `[${String(i + 1)}] ${ts} [${entry.level.toUpperCase()}] [${svc}] ${entry.message}`;
    })
    .join("\n");

  return header + body;
}

// ---------------------------------------------------------------------------
// query — main pipeline function
// ---------------------------------------------------------------------------

/**
 * Query the log index: load store → embed question → search → build prompt →
 * stream LLM → collect answer.
 *
 * All I/O dependencies are injected via `deps` to keep core testable and
 * free of circular imports. The `onEvent` callback streams tokens to callers
 * in real-time.
 */
export async function query(
  options: QueryOptions,
  deps: QueryDeps,
): Promise<Result<QueryResult, QueryError>> {
  const start = performance.now();
  const { store, onEvent } = deps;

  const topN = options.topN ?? DEFAULT_TOP_N;
  const embeddingBaseUrl = options.ollamaBaseUrl ?? DEFAULT_BASE_URL;
  const chatModel = options.chatModel ?? DEFAULT_CHAT_MODEL;

  // ── 1. Load store ───────────────────────────────────────────────────────
  onEvent?.({ phase: "loading" });

  try {
    await store.load(options.storageDir);
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Unknown store error";
    return err({
      code: "STORE_ERROR",
      message: `Failed to load index from ${options.storageDir}: ${message}`,
    });
  }

  // ── 2. Embed the question ──────────────────────────────────────────────
  onEvent?.({ phase: "embedding" });

  const embeddingConfig: LlmConfig = {
    baseUrl: embeddingBaseUrl,
    model: options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
    ...(options.embeddingTimeoutMs !== undefined ? { embeddingTimeoutMs: options.embeddingTimeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  };

  const embedResult = await fetchEmbeddings([options.question], embeddingConfig);
  if (!embedResult.ok) {
    return err({
      code: "EMBED_ERROR",
      message: `Failed to embed question: ${embedResult.error.message}`,
      cause: embedResult.error,
    });
  }

  const questionEmbedding = embedResult.value[0];
  if (questionEmbedding === undefined) {
    return err({
      code: "EMBED_ERROR",
      message: "Embedding response returned no vectors",
      cause: { code: "INVALID_RESPONSE", message: "Empty embedding array" },
    });
  }

  // ── 3. Search ──────────────────────────────────────────────────────────
  onEvent?.({ phase: "searching" });

  const sources = await store.search(
    questionEmbedding,
    topN,
    options.serviceFilter,
  );

  if (sources.length === 0) {
    return ok({
      answer: "No relevant log entries found for your question.",
      sources: [],
      durationMs: performance.now() - start,
    });
  }

  // ── 4. Generate answer ─────────────────────────────────────────────────
  onEvent?.({ phase: "generating" });

  const chatConfig: LlmConfig = {
    baseUrl: embeddingBaseUrl,
    model: chatModel,
    ...(options.chatTimeoutMs !== undefined ? { chatTimeoutMs: options.chatTimeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(sources) },
    { role: "user", content: options.question },
  ];

  let answer = "";

  try {
    for await (const token of streamChat(messages, chatConfig)) {
      answer += token;
      onEvent?.({ phase: "generating", token });
    }
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Unknown chat error";
    return err({
      code: "CHAT_ERROR",
      message: `LLM streaming failed: ${message}`,
    });
  }

  // ── 5. Result ──────────────────────────────────────────────────────────
  const durationMs = performance.now() - start;
  return ok({
    answer: answer.trim(),
    sources,
    durationMs,
  });
}
