import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { query } from "../query.js";
import { MemoryVectorStore } from "../store/memory.js";
import type { LogEntry, QueryOptions } from "../types.js";
import type { QueryDeps, QueryEvent } from "../query.js";

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
  message: "Database connection timeout after 30s",
  raw: '{"timestamp":"2024-01-01T00:01:00Z","level":"error","message":"Database connection timeout after 30s"}',
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

/** 4-dimensional embedding: unit vector at index position */
function fakeEmbedding(index: number): number[] {
  const vec = [0, 0, 0, 0];
  vec[index % 4] = 1;
  return vec;
}

const BASE_OPTIONS: QueryOptions = {
  question: "What errors happened?",
  storageDir: "/tmp/asklog-test-query",
  ollamaBaseUrl: "http://localhost:11434",
  chatModel: "llama3.2",
  topN: 10,
  maxRetries: 0,
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a pre-populated store with entries and embeddings already loaded.
 * This bypasses file I/O so tests remain fast and deterministic.
 */
async function createPopulatedStore(
  entries: LogEntry[],
): Promise<MemoryVectorStore> {
  const store = new MemoryVectorStore();
  const embeddings = entries.map((_, i) => fakeEmbedding(i));
  await store.add(entries, embeddings);
  // Override load to no-op — query() calls store.load() which would wipe
  // in-memory data since there's no file on disk. We're testing pipeline
  // logic, not file I/O.
  store.load = async () => {};
  return store;
}

/**
 * Creates a mock fetch that handles both embedding and chat completion requests.
 * Embedding: returns the same fake embedding for any input.
 * Chat: returns a SSE stream with a predefined answer.
 */
function createQueryFetch(chatAnswer: string): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // Embedding endpoint
    if (url.includes("/v1/embeddings")) {
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
    }

    // Chat completion endpoint — return SSE stream
    if (url.includes("/v1/chat/completions")) {
      // Split answer into word-level tokens for realistic streaming
      const tokens = chatAnswer.split(" ");
      const sseChunks = tokens.map((token, i) => {
        const content = i === 0 ? token : ` ${token}`;
        return `data: ${JSON.stringify({
          choices: [{ delta: { content } }],
        })}\n\n`;
      });
      sseChunks.push("data: [DONE]\n\n");

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof globalThis.fetch;
}

/** Creates a mock fetch that fails on the embedding endpoint */
function createFailingEmbedFetch(): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("/v1/embeddings")) {
      return new Response(
        JSON.stringify({ error: { message: "Model not loaded" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not found", { status: 404 });
  }) as typeof globalThis.fetch;
}

/** Creates a mock fetch that fails on the chat endpoint */
function createFailingChatFetch(): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("/v1/embeddings")) {
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
    }

    if (url.includes("/v1/chat/completions")) {
      return new Response(
        JSON.stringify({ error: { message: "Chat model offline" } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not found", { status: 404 });
  }) as typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("query", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns an answer grounded in retrieved log sources", async () => {
    const store = await createPopulatedStore([ENTRY_1, ENTRY_2, ENTRY_3]);
    fetchSpy.mockImplementation(
      createQueryFetch("There was a database connection timeout error."),
    );

    const deps: QueryDeps = { store };
    const result = await query(BASE_OPTIONS, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.answer).toBe(
      "There was a database connection timeout error.",
    );
    expect(result.value.sources.length).toBeGreaterThan(0);
    expect(result.value.durationMs).toBeGreaterThan(0);
  });

  it("returns EMBED_ERROR when question embedding fails", async () => {
    const store = await createPopulatedStore([ENTRY_1]);
    fetchSpy.mockImplementation(createFailingEmbedFetch());

    const deps: QueryDeps = { store };
    const result = await query(BASE_OPTIONS, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EMBED_ERROR");
    expect(result.error.message).toContain("Failed to embed question");
  });

  it("returns CHAT_ERROR when LLM streaming fails", async () => {
    const store = await createPopulatedStore([ENTRY_1]);
    fetchSpy.mockImplementation(createFailingChatFetch());

    const deps: QueryDeps = { store };
    const result = await query(BASE_OPTIONS, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CHAT_ERROR");
    expect(result.error.message).toContain("LLM streaming failed");
  });

  it("returns fallback message when store has no matching entries", async () => {
    // Empty store — search returns nothing
    const store = new MemoryVectorStore();
    fetchSpy.mockImplementation(
      createQueryFetch("Should not reach LLM"),
    );

    const deps: QueryDeps = { store };
    const result = await query(BASE_OPTIONS, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.answer).toBe(
      "No relevant log entries found for your question.",
    );
    expect(result.value.sources).toEqual([]);
  });

  it("applies serviceFilter to narrow search results", async () => {
    const store = await createPopulatedStore([ENTRY_1, ENTRY_2, ENTRY_3]);
    fetchSpy.mockImplementation(createQueryFetch("Only API service entries."));

    const deps: QueryDeps = { store };
    const options: QueryOptions = { ...BASE_OPTIONS, serviceFilter: "api" };
    const result = await query(options, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only ENTRY_1 and ENTRY_3 have service "api"
    for (const source of result.value.sources) {
      expect(source.service).toBe("api");
    }
  });

  it("emits QueryEvents through all phases including tokens", async () => {
    const store = await createPopulatedStore([ENTRY_1]);
    fetchSpy.mockImplementation(createQueryFetch("Answer here."));

    const events: QueryEvent[] = [];
    const deps: QueryDeps = {
      store,
      onEvent: (event) => events.push(event),
    };

    const result = await query(BASE_OPTIONS, deps);
    expect(result.ok).toBe(true);

    const phases = events.map((e) => e.phase);
    expect(phases).toContain("loading");
    expect(phases).toContain("embedding");
    expect(phases).toContain("searching");
    expect(phases).toContain("generating");

    // Token events should have content
    const tokenEvents = events.filter(
      (e) => e.phase === "generating" && e.token !== undefined,
    );
    expect(tokenEvents.length).toBeGreaterThan(0);

    // Concatenated tokens should form the answer
    const streamedAnswer = tokenEvents.map((e) => e.token).join("");
    expect(streamedAnswer).toBe("Answer here.");
  });

  it("returns STORE_ERROR when store.load throws", async () => {
    const store = new MemoryVectorStore();
    // Override load to throw
    store.load = async () => {
      throw new Error("Disk read failed");
    };
    fetchSpy.mockImplementation(createQueryFetch("unreachable"));

    const deps: QueryDeps = { store };
    const result = await query(BASE_OPTIONS, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
    expect(result.error.message).toContain("Disk read failed");
  });

  it("respects custom topN option", async () => {
    const store = await createPopulatedStore([ENTRY_1, ENTRY_2, ENTRY_3]);
    fetchSpy.mockImplementation(createQueryFetch("Limited results."));

    const deps: QueryDeps = { store };
    const options: QueryOptions = { ...BASE_OPTIONS, topN: 1 };
    const result = await query(options, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources.length).toBeLessThanOrEqual(1);
  });
});
