import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { ingest } from "../ingest.js";
import { MemoryVectorStore } from "../store/memory.js";
import { ok, err } from "../types.js";
import type { LogEntry, IngestOptions, Result } from "../types.js";
import type { IngestDeps, ParseOutput, ParseFailure, IngestProgress } from "../ingest.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRY_1: LogEntry = {
  id: "log-1",
  timestamp: new Date("2024-01-01T00:00:00Z"),
  level: "info",
  message: "Server started on port 3000",
  raw: '{"timestamp":"2024-01-01T00:00:00Z","level":"info","message":"Server started on port 3000"}',
  service: "api",
};

const ENTRY_2: LogEntry = {
  id: "log-2",
  timestamp: new Date("2024-01-01T00:01:00Z"),
  level: "error",
  message: "Database connection timeout",
  raw: '{"timestamp":"2024-01-01T00:01:00Z","level":"error","message":"Database connection timeout"}',
  service: "db",
};

const ENTRY_3: LogEntry = {
  id: "log-3",
  timestamp: new Date("2024-01-01T00:02:00Z"),
  level: "warn",
  message: "Cache miss rate above threshold",
  raw: '{"timestamp":"2024-01-01T00:02:00Z","level":"warn","message":"Cache miss rate above threshold"}',
  service: "api",
};

/** Deterministic fake embeddings — returns a unit vector at index position */
function fakeEmbedding(index: number): number[] {
  const vec = [0, 0, 0, 0];
  if (vec[index % 4] !== undefined) {
    vec[index % 4] = 1;
  }
  return vec;
}

/** Creates a mock fetch that returns the correct number of embeddings based on the request body */
function createEmbeddingFetch(): typeof globalThis.fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
    const count = body.input?.length ?? 0;
    return new Response(
      JSON.stringify({
        data: Array.from({ length: count }, (_, i) => ({
          embedding: fakeEmbedding(i),
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
}

const BASE_OPTIONS: IngestOptions = {
  filePath: "/tmp/logs/app.jsonl",
  storageDir: "/tmp/asklog-test-index",
  ollamaBaseUrl: "http://localhost:11434",
  embeddingModel: "nomic-embed-text",
  maxRetries: 0,
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockParse(
  entries: LogEntry[],
): (filePath: string) => Promise<Result<ParseOutput, ParseFailure>> {
  return async (_filePath: string) => ok({ entries });
}

function createFailingParse(
  errorCause: string,
): (filePath: string) => Promise<Result<ParseOutput, ParseFailure>> {
  return async (_filePath: string) =>
    err({ code: "FILE_READ_ERROR", path: _filePath, cause: errorCause });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ingest", () => {
  let store: MemoryVectorStore;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    store = new MemoryVectorStore();
    // Use spyOn so afterEach can restore the original globalThis.fetch
    fetchSpy = spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(createEmbeddingFetch());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("ingests entries successfully through the full pipeline", async () => {
    const deps: IngestDeps = {
      parse: createMockParse([ENTRY_1, ENTRY_2]),
      store,
    };

    const result = await ingest(BASE_OPTIONS, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ingested).toBe(2);
    expect(result.value.durationMs).toBeGreaterThan(0);
  });

  it("returns PARSE_ERROR when parser fails", async () => {
    const deps: IngestDeps = {
      parse: createFailingParse("File not found"),
      store,
    };

    const result = await ingest(BASE_OPTIONS, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARSE_ERROR");
    expect(result.error.message).toContain("File not found");
  });

  it("returns early with zero counts when no entries parsed", async () => {
    const deps: IngestDeps = {
      parse: createMockParse([]),
      store,
    };

    const result = await ingest(BASE_OPTIONS, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ingested).toBe(0);
    expect(result.value.skipped).toBe(0);
  });

  it("applies serviceFilter to exclude non-matching entries", async () => {
    const deps: IngestDeps = {
      parse: createMockParse([ENTRY_1, ENTRY_2, ENTRY_3]),
      store,
    };

    const options: IngestOptions = {
      ...BASE_OPTIONS,
      serviceFilter: "api", // only ENTRY_1 and ENTRY_3
    };

    const result = await ingest(options, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ingested).toBe(2);
    expect(result.value.skipped).toBe(1); // ENTRY_2 (db service) skipped
  });

  it("returns EMBED_ERROR when embedding call fails", async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(JSON.stringify({ error: { message: "Model not loaded" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });

    const deps: IngestDeps = {
      parse: createMockParse([ENTRY_1]),
      store,
    };

    const result = await ingest(BASE_OPTIONS, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EMBED_ERROR");
    expect(result.error.message).toContain("failed");
  });

  it("calls onProgress through all phases", async () => {
    const events: IngestProgress[] = [];

    const deps: IngestDeps = {
      parse: createMockParse([ENTRY_1]),
      store,
      onProgress: (event) => events.push(event),
    };

    const result = await ingest(BASE_OPTIONS, deps);
    expect(result.ok).toBe(true);

    // Should have parsing, embedding, and saving phases
    const phases = events.map((e) => e.phase);
    expect(phases).toContain("parsing");
    expect(phases).toContain("embedding");
    expect(phases).toContain("saving");
  });
});
