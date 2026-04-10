import { err, ok } from "./types.js";
import type { Result } from "./types.js";

// ---------------------------------------------------------------------------
// FetchFn — narrow callable type for injectable fetch
// ---------------------------------------------------------------------------

/** Callable subset of the global `fetch` — no static properties required. */
export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

// ---------------------------------------------------------------------------
// EmbedderConfig — configuration for the embedding client
// ---------------------------------------------------------------------------

export interface EmbedderConfig {
  /** Base URL of an Ollama-compatible embedding server. */
  readonly ollamaUrl: string;
  /** Embedding model name (e.g. "nomic-embed-text"). */
  readonly model: string;
  /** Number of texts to send per batch request. @default 50 */
  readonly batchSize?: number;
}

// ---------------------------------------------------------------------------
// Ollama /api/embed — typed request / response shapes
// ---------------------------------------------------------------------------

/** Request body for Ollama POST /api/embeddings. */
interface OllamaEmbedRequest {
  readonly model: string;
  readonly prompt: string;
}

/** Successful response from Ollama POST /api/embeddings. */
interface OllamaEmbedResponse {
  readonly embedding: readonly number[];
}

/** Error body returned by Ollama on failure. */
interface OllamaErrorResponse {
  readonly error: string;
}

// ---------------------------------------------------------------------------
// EmbedError — typed error for embedding failures
// ---------------------------------------------------------------------------

export interface EmbedError {
  readonly code: "FETCH_FAILED" | "HTTP_ERROR" | "INVALID_RESPONSE";
  readonly message: string;
  /** Zero-based batch index that caused the error. */
  readonly batchIndex: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 50;

/**
 * Send a single batch of texts to the Ollama /api/embeddings endpoint concurrently.
 * Returns a typed Result — never throws.
 */
async function fetchBatch(
  texts: readonly string[],
  ollamaUrl: string,
  model: string,
  batchIndex: number,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<Result<readonly (readonly number[])[], EmbedError>> {
  const url = `${ollamaUrl.replace(/\/+$/, "")}/api/embeddings`;

  const promises = texts.map(async (text) => {
    const body: OllamaEmbedRequest = { model, prompt: text };
    let response: Response;

    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Unknown network error";
      throw err({ code: "FETCH_FAILED", message, batchIndex });
    }

    if (!response.ok) {
      let detail = `HTTP ${String(response.status)}`;
      try {
        const errorBody = (await response.json()) as OllamaErrorResponse;
        if (typeof errorBody.error === "string") {
          detail = errorBody.error;
        }
      } catch {
        // body wasn't JSON — keep the status code detail
      }
      throw err({ code: "HTTP_ERROR", message: detail, batchIndex });
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw err({
        code: "INVALID_RESPONSE",
        message: "Response is not valid JSON",
        batchIndex,
      });
    }

    if (!isOllamaEmbedResponse(parsed)) {
      throw err({
        code: "INVALID_RESPONSE",
        message: "Response missing 'embedding' array",
        batchIndex,
      });
    }

    return parsed.embedding;
  });

  try {
    const embeddings = await Promise.all(promises);
    return ok(embeddings);
  } catch (error) {
    return error as ReturnType<typeof err<EmbedError>>;
  }
}

/** Runtime type guard for OllamaEmbedResponse. */
function isOllamaEmbedResponse(value: unknown): value is OllamaEmbedResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj["embedding"])) return false;
  const embedding = obj["embedding"] as unknown[];
  return embedding.every((n) => typeof n === "number");
}

// ---------------------------------------------------------------------------
// embedTexts — public API
// ---------------------------------------------------------------------------

/**
 * Embed an array of texts via Ollama `/api/embed`, yielding results in
 * batches of `batchSize` (default 50).
 *
 * Each yielded `number[][]` contains the embeddings for that batch,
 * preserving the input order. Callers can concat all yielded batches to
 * get the full embedding matrix.
 *
 * @example
 * ```ts
 * for await (const batch of embedTexts(lines, "http://localhost:11434", "nomic-embed-text")) {
 *   allEmbeddings.push(...batch);
 * }
 * ```
 *
 * Throws an `EmbedError` if any batch fails (fail-fast).
 */
export async function* embedTexts(
  texts: readonly string[],
  ollamaUrl: string,
  model: string,
  options?: {
    readonly batchSize?: number;
    /** Injectable fetch for testing. */
    readonly fetchFn?: FetchFn;
  },
): AsyncGenerator<number[][]> {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const fetchFn = options?.fetchFn ?? globalThis.fetch;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize);

    const result = await fetchBatch(batch, ollamaUrl, model, batchIndex, fetchFn);

    if (!result.ok) {
      throw result.error;
    }

    // readonly number[][] → mutable for public API convenience
    yield result.value.map((row) => [...row]);
  }
}
