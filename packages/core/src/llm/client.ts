import { err, ok } from "../types.js";
import type { Result } from "../types.js";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

export interface LlmConfig {
  readonly baseUrl: string;
  readonly model: string;
  /** Timeout in milliseconds for embedding requests. Default: 30_000 */
  readonly embeddingTimeoutMs?: number;
  /** Timeout in milliseconds for chat completion requests. Default: 120_000 */
  readonly chatTimeoutMs?: number;
  /** Maximum number of retry attempts for retryable errors (429, 5xx). Default: 3 */
  readonly maxRetries?: number;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface LlmError {
  readonly code: "FETCH_FAILED" | "HTTP_ERROR" | "INVALID_RESPONSE" | "STREAM_ERROR" | "TIMEOUT";
  readonly message: string;
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible Request / Response Shapes
// ---------------------------------------------------------------------------

/** Request body for /v1/embeddings */
interface EmbeddingsRequest {
  readonly model: string;
  readonly input: readonly string[];
}

/** Successful response from /v1/embeddings */
interface EmbeddingsResponse {
  readonly data: readonly {
    readonly embedding: readonly number[];
  }[];
}

/** Request body for /v1/chat/completions */
interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly stream: boolean;
}

/** SSE chunk data from /v1/chat/completions */
interface ChatChunk {
  readonly choices: readonly {
    readonly delta: {
      readonly content?: string;
    };
  }[];
}

interface ErrorResponse {
  readonly error?: {
    readonly message?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EMBED_TIMEOUT_MS = 30_000;
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 10_000;

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

function isEmbeddingsResponse(value: unknown): value is EmbeddingsResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj["data"])) return false;

  for (const item of obj["data"]) {
    if (typeof item !== "object" || item === null) return false;
    const itemObj = item as Record<string, unknown>;
    if (!Array.isArray(itemObj["embedding"])) return false;
    for (const num of itemObj["embedding"]) {
      if (typeof num !== "number") return false;
    }
  }

  return true;
}

function isChatChunk(value: unknown): value is ChatChunk {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj["choices"])) return false;

  for (const choice of obj["choices"]) {
    if (typeof choice !== "object" || choice === null) return false;
    const choiceObj = choice as Record<string, unknown>;
    if (typeof choiceObj["delta"] !== "object" || choiceObj["delta"] === null)
      return false;
    const deltaObj = choiceObj["delta"] as Record<string, unknown>;
    if (
      "content" in deltaObj &&
      typeof deltaObj["content"] !== "string" &&
      deltaObj["content"] !== undefined &&
      deltaObj["content"] !== null
    ) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helper: format HTTP error
// ---------------------------------------------------------------------------

async function getHttpErrorMessage(response: Response): Promise<string> {
  const status = `HTTP ${String(response.status)}`;
  try {
    const errorBody = (await response.json()) as ErrorResponse;
    if (typeof errorBody.error?.message === "string") {
      return errorBody.error.message;
    }
  } catch {
    // Ignored, fallback to status
  }
  return status;
}

// ---------------------------------------------------------------------------
// Helper: normalize baseUrl
// ---------------------------------------------------------------------------

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

// ---------------------------------------------------------------------------
// Helper: check if HTTP status is retryable
// ---------------------------------------------------------------------------

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// Helper: create AbortSignal with timeout
// ---------------------------------------------------------------------------

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

// ---------------------------------------------------------------------------
// Helper: fetch with retry and timeout
// ---------------------------------------------------------------------------

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries: number,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { signal, clear } = createTimeoutSignal(timeoutMs);
    try {
      const response = await globalThis.fetch(url, { ...init, signal });

      // Don't retry non-retryable errors
      if (!response.ok && isRetryableStatus(response.status) && attempt < maxRetries) {
        const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (cause: unknown) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new Error(`Request timed out after ${String(timeoutMs)}ms`);
      }

      lastError = cause instanceof Error ? cause : new Error(String(cause));

      // Retry on network errors (e.g. ECONNREFUSED during model load)
      if (attempt < maxRetries) {
        const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    } finally {
      clear();
    }
  }

  throw lastError ?? new Error("Max retries exceeded");
}

// ---------------------------------------------------------------------------
// fetchEmbeddings API
// ---------------------------------------------------------------------------

export async function fetchEmbeddings(
  texts: string[],
  config: LlmConfig,
): Promise<Result<number[][], LlmError>> {
  const url = buildUrl(config.baseUrl, "/v1/embeddings");
  const body: EmbeddingsRequest = {
    model: config.model,
    input: texts,
  };

  const timeoutMs = config.embeddingTimeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs,
      maxRetries,
    );
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Unknown network error";
    if (message.includes("timed out")) {
      return err({ code: "TIMEOUT", message });
    }
    return err({ code: "FETCH_FAILED", message });
  }

  if (!response.ok) {
    const msg = await getHttpErrorMessage(response);
    return err({ code: "HTTP_ERROR", message: msg });
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return err({
      code: "INVALID_RESPONSE",
      message: "Response is not valid JSON",
    });
  }

  if (!isEmbeddingsResponse(parsed)) {
    return err({
      code: "INVALID_RESPONSE",
      message: "Response missing 'data' array with valid embeddings",
    });
  }

  const vectors: number[][] = parsed.data.map((item) => [...item.embedding]);
  return ok(vectors);
}

// ---------------------------------------------------------------------------
// streamChat API
// ---------------------------------------------------------------------------

/**
 * Stream chat completions from an OpenAI-compatible endpoint.
 *
 * **Error strategy:** This function throws on errors (not Result) because
 * AsyncGenerator doesn't support Result return semantics for mid-stream
 * failures. Callers should use try-catch (see query.ts for an example).
 */
export async function* streamChat(
  messages: ChatMessage[],
  config: LlmConfig,
): AsyncGenerator<string, void, unknown> {
  const url = buildUrl(config.baseUrl, "/v1/chat/completions");
  const body: ChatRequest = {
    model: config.model,
    messages,
    stream: true,
  };

  const timeoutMs = config.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs,
      maxRetries,
    );
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Unknown network error";
    if (message.includes("timed out")) {
      throw new Error(`[TIMEOUT] ${message}`);
    }
    throw new Error(`[FETCH_FAILED] ${message}`);
  }

  if (!response.ok) {
    let detail = `HTTP ${String(response.status)}`;
    try {
      const text = await response.text();
      const errorBody = JSON.parse(text) as ErrorResponse;
      if (typeof errorBody.error?.message === "string") {
        detail = errorBody.error.message;
      }
    } catch {
      // Ignored
    }
    throw new Error(`[HTTP_ERROR] ${detail}`);
  }

  if (!response.body) {
    throw new Error("[STREAM_ERROR] Response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice("data: ".length);
        if (data === "[DONE]") return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          throw new Error("[INVALID_RESPONSE] Invalid JSON in SSE chunk");
        }

        if (!isChatChunk(parsed)) {
          throw new Error("[INVALID_RESPONSE] Malformed SSE chunk shape");
        }

        for (const choice of parsed.choices) {
          if (choice.delta.content) {
            yield choice.delta.content;
          }
        }
      }
    }
    // process any remaining string in buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice("data: ".length);
        if (data !== "[DONE]") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
            if (isChatChunk(parsed)) {
              for (const choice of parsed.choices) {
                if (choice.delta.content) {
                  yield choice.delta.content;
                }
              }
            }
          } catch {
            // Ignore parse errors at the very end of stream for trailing debris
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
