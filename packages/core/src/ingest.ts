import { ok, err } from "./types.js";
import type { Result, LogEntry, IngestOptions, IngestResult } from "./types.js";
import type { IVectorStore } from "./store/interface.js";
import type { LlmConfig, LlmError } from "./llm/client.js";
import { fetchEmbeddings } from "./llm/client.js";

// ---------------------------------------------------------------------------
// IngestError — typed error union for the ingest pipeline
// ---------------------------------------------------------------------------

export interface IngestParseError {
  readonly code: "PARSE_ERROR";
  readonly message: string;
}

export interface IngestEmbedError {
  readonly code: "EMBED_ERROR";
  readonly message: string;
  readonly cause: LlmError;
}

export interface IngestStoreError {
  readonly code: "STORE_ERROR";
  readonly message: string;
}

export type IngestError = IngestParseError | IngestEmbedError | IngestStoreError;

// ---------------------------------------------------------------------------
// IngestProgress — progress events emitted during ingest
// ---------------------------------------------------------------------------

export interface IngestProgress {
  readonly phase: "parsing" | "embedding" | "saving";
  readonly current: number;
  readonly total: number;
}

// ---------------------------------------------------------------------------
// ParseOutput — shape expected from any parser (matches @loglens/parsers)
// ---------------------------------------------------------------------------

/** Minimal parser output contract. Mirrors ParseSuccess from @loglens/parsers. */
export interface ParseOutput {
  readonly entries: LogEntry[];
}

/** Minimal parse error contract. Mirrors ParseError from @loglens/parsers. */
export interface ParseFailure {
  readonly code: string;
  readonly path: string;
  readonly cause: string;
}

// ---------------------------------------------------------------------------
// IngestDeps — dependency injection container (A1, A2, A3)
// ---------------------------------------------------------------------------

export interface IngestDeps {
  /**
   * Parse a file at the given path into log entries.
   * Injected so core has no dependency on @loglens/parsers.
   */
  readonly parse: (
    filePath: string,
  ) => Promise<Result<ParseOutput, ParseFailure>>;

  /** Vector store instance — any IVectorStore implementation. */
  readonly store: IVectorStore;

  /** Optional progress callback, called after each phase/batch. */
  readonly onProgress?: (event: IngestProgress) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// ingest — main pipeline function
// ---------------------------------------------------------------------------

/**
 * Ingest a log file: parse → embed in batches → store → save.
 *
 * All I/O dependencies are injected via `deps` to keep core free of circular
 * imports (A1), allow swapping store implementations (A2), and report
 * progress to callers (A3).
 */
export async function ingest(
  options: IngestOptions,
  deps: IngestDeps,
): Promise<Result<IngestResult, IngestError>> {
  const start = performance.now();
  const { parse, store, onProgress } = deps;

  // ── 1. Parse ────────────────────────────────────────────────────────────
  onProgress?.({ phase: "parsing", current: 0, total: 1 });

  const parseResult = await parse(options.filePath);
  if (!parseResult.ok) {
    return err({
      code: "PARSE_ERROR",
      message: `Failed to parse ${options.filePath}: ${parseResult.error.cause}`,
    });
  }

  onProgress?.({ phase: "parsing", current: 1, total: 1 });

  let entries = parseResult.value.entries;

  // Apply service filter if provided
  if (options.serviceFilter !== undefined) {
    entries = entries.filter((e) => e.service === options.serviceFilter);
  }

  if (entries.length === 0) {
    return ok({
      ingested: 0,
      skipped: 0,
      durationMs: performance.now() - start,
    });
  }

  // ── 2. Embed in batches ─────────────────────────────────────────────────
  const llmConfig: LlmConfig = {
    baseUrl: options.ollamaBaseUrl ?? DEFAULT_BASE_URL,
    model: options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
  };

  const totalBatches = Math.ceil(entries.length / BATCH_SIZE);
  const allEmbeddings: number[][] = [];

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = batchIdx * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, entries.length);
    const batch = entries.slice(batchStart, batchEnd);

    onProgress?.({
      phase: "embedding",
      current: batchIdx + 1,
      total: totalBatches,
    });

    const texts = batch.map((e) => e.message);
    const embedResult = await fetchEmbeddings(texts, llmConfig);

    if (!embedResult.ok) {
      return err({
        code: "EMBED_ERROR",
        message: `Embedding batch ${String(batchIdx + 1)}/${String(totalBatches)} failed: ${embedResult.error.message}`,
        cause: embedResult.error,
      });
    }

    allEmbeddings.push(...embedResult.value);
  }

  // ── 3. Store ────────────────────────────────────────────────────────────
  onProgress?.({ phase: "saving", current: 0, total: 2 });

  // Load existing index so dedup works across runs
  try {
    await store.load(options.storageDir);
  } catch {
    // No existing index — start fresh (store.load handles missing files)
  }

  const countBefore = allEmbeddings.length;
  await store.add(entries, allEmbeddings);

  onProgress?.({ phase: "saving", current: 1, total: 2 });

  try {
    await store.save(options.storageDir);
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Unknown store error";
    return err({
      code: "STORE_ERROR",
      message: `Failed to save index to ${options.storageDir}: ${message}`,
    });
  }

  onProgress?.({ phase: "saving", current: 2, total: 2 });

  // ── 4. Result ───────────────────────────────────────────────────────────
  const durationMs = performance.now() - start;
  return ok({
    ingested: countBefore,
    skipped: parseResult.value.entries.length - entries.length,
    durationMs,
  });
}
