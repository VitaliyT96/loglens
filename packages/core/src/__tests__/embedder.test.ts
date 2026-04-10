import { describe, expect, test } from "bun:test";
import { embedTexts } from "../embedder.js";
import type { EmbedderConfig, EmbedError, FetchFn } from "../embedder.js";

// ---------------------------------------------------------------------------
// Helpers — mock fetch factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock fetch that returns pre-defined embedding vectors.
 * Each call captures the request body for assertions.
 */
function createMockFetch(
  responses: Array<{
    readonly status: number;
    readonly body: unknown;
  }>,
): {
  fetchFn: FetchFn;
  calls: Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  let callIndex = 0;

  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const rawBody =
      typeof init?.body === "string" ? init.body : "";
    const body: unknown = JSON.parse(rawBody);
    calls.push({ url, body });

    const entry = responses[callIndex];
    if (!entry) {
      return new Response(JSON.stringify({ error: "no more mock responses" }), {
        status: 500,
      });
    }
    callIndex++;

    return new Response(JSON.stringify(entry.body), {
      status: entry.status,
      headers: { "Content-Type": "application/json" },
    });
  }) satisfies FetchFn;

  return { fetchFn, calls };
}

/** Generate a fake embedding vector of given dimension. */
function fakeVector(dim: number, seed: number): number[] {
  return Array.from({ length: dim }, (_, i) => seed * 0.01 + i * 0.001);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("embedTexts", () => {
  test("embeds a single batch of texts", async () => {
    const texts = ["hello world", "foo bar baz"];
    const expectedEmbeddings = [fakeVector(384, 1), fakeVector(384, 2)];

    const { fetchFn, calls } = createMockFetch([
      {
        status: 200,
        body: { model: "nomic-embed-text", embeddings: expectedEmbeddings },
      },
    ]);

    const batches: number[][][] = [];
    for await (const batch of embedTexts(
      texts,
      "http://localhost:11434",
      "nomic-embed-text",
      { fetchFn },
    )) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]![0]).toEqual(expectedEmbeddings[0]);
    expect(batches[0]![1]).toEqual(expectedEmbeddings[1]);

    // Verify request shape
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://localhost:11434/api/embed");
    const reqBody = calls[0]!.body as { model: string; input: string[] };
    expect(reqBody.model).toBe("nomic-embed-text");
    expect(reqBody.input).toEqual(texts);
  });

  test("splits texts into batches of batchSize", async () => {
    const batchSize = 3;
    const texts = ["a", "b", "c", "d", "e", "f", "g"];
    // 3 batches: [a,b,c], [d,e,f], [g]

    const { fetchFn, calls } = createMockFetch([
      {
        status: 200,
        body: {
          model: "m",
          embeddings: [fakeVector(4, 1), fakeVector(4, 2), fakeVector(4, 3)],
        },
      },
      {
        status: 200,
        body: {
          model: "m",
          embeddings: [fakeVector(4, 4), fakeVector(4, 5), fakeVector(4, 6)],
        },
      },
      {
        status: 200,
        body: {
          model: "m",
          embeddings: [fakeVector(4, 7)],
        },
      },
    ]);

    const allEmbeddings: number[][] = [];
    for await (const batch of embedTexts(texts, "http://localhost:11434", "m", {
      batchSize,
      fetchFn,
    })) {
      allEmbeddings.push(...batch);
    }

    expect(calls).toHaveLength(3);
    expect(allEmbeddings).toHaveLength(7);

    // Verify batch boundaries in requests
    const batch1Body = calls[0]!.body as { input: string[] };
    expect(batch1Body.input).toEqual(["a", "b", "c"]);
    const batch2Body = calls[1]!.body as { input: string[] };
    expect(batch2Body.input).toEqual(["d", "e", "f"]);
    const batch3Body = calls[2]!.body as { input: string[] };
    expect(batch3Body.input).toEqual(["g"]);
  });

  test("yields nothing for empty input", async () => {
    const { fetchFn, calls } = createMockFetch([]);

    const batches: number[][][] = [];
    for await (const batch of embedTexts(
      [],
      "http://localhost:11434",
      "nomic-embed-text",
      { fetchFn },
    )) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("throws EmbedError on HTTP error", async () => {
    const { fetchFn } = createMockFetch([
      {
        status: 404,
        body: { error: "model 'bad-model' not found" },
      },
    ]);

    let caughtError: EmbedError | undefined;
    try {
      for await (const _batch of embedTexts(
        ["test"],
        "http://localhost:11434",
        "bad-model",
        { fetchFn },
      )) {
        // should not reach
      }
    } catch (e) {
      caughtError = e as EmbedError;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.code).toBe("HTTP_ERROR");
    expect(caughtError!.message).toBe("model 'bad-model' not found");
    expect(caughtError!.batchIndex).toBe(0);
  });

  test("throws EmbedError on network failure", async () => {
    const fetchFn: FetchFn = () => {
      return Promise.reject(new Error("ECONNREFUSED"));
    };

    let caughtError: EmbedError | undefined;
    try {
      for await (const _batch of embedTexts(
        ["test"],
        "http://localhost:11434",
        "nomic-embed-text",
        { fetchFn },
      )) {
        // should not reach
      }
    } catch (e) {
      caughtError = e as EmbedError;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.code).toBe("FETCH_FAILED");
    expect(caughtError!.message).toBe("ECONNREFUSED");
    expect(caughtError!.batchIndex).toBe(0);
  });

  test("throws EmbedError on malformed response", async () => {
    const { fetchFn } = createMockFetch([
      {
        status: 200,
        body: { model: "m", unexpected: "shape" },
      },
    ]);

    let caughtError: EmbedError | undefined;
    try {
      for await (const _batch of embedTexts(
        ["test"],
        "http://localhost:11434",
        "m",
        { fetchFn },
      )) {
        // should not reach
      }
    } catch (e) {
      caughtError = e as EmbedError;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.code).toBe("INVALID_RESPONSE");
    expect(caughtError!.message).toBe("Response missing 'embeddings' array");
  });

  test("strips trailing slash from ollamaUrl", async () => {
    const { fetchFn, calls } = createMockFetch([
      {
        status: 200,
        body: { model: "m", embeddings: [[0.1, 0.2]] },
      },
    ]);

    for await (const _batch of embedTexts(
      ["test"],
      "http://localhost:11434///",
      "m",
      { fetchFn },
    )) {
      // consume
    }

    expect(calls[0]!.url).toBe("http://localhost:11434/api/embed");
  });

  test("fail-fast: stops at first failed batch", async () => {
    const { fetchFn, calls } = createMockFetch([
      {
        status: 200,
        body: { model: "m", embeddings: [[0.1], [0.2]] },
      },
      {
        status: 500,
        body: { error: "internal server error" },
      },
      {
        status: 200,
        body: { model: "m", embeddings: [[0.5], [0.6]] },
      },
    ]);

    const collected: number[][][] = [];
    let caughtError: EmbedError | undefined;
    try {
      for await (const batch of embedTexts(
        ["a", "b", "c", "d", "e", "f"],
        "http://localhost:11434",
        "m",
        { batchSize: 2, fetchFn },
      )) {
        collected.push(batch);
      }
    } catch (e) {
      caughtError = e as EmbedError;
    }

    // First batch succeeded
    expect(collected).toHaveLength(1);
    // Second batch failed — third was never sent
    expect(calls).toHaveLength(2);
    expect(caughtError).toBeDefined();
    expect(caughtError!.code).toBe("HTTP_ERROR");
    expect(caughtError!.batchIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// EmbedderConfig — compile-time structural check
// ---------------------------------------------------------------------------

describe("EmbedderConfig", () => {
  test("shape is correct with required fields", () => {
    const config: EmbedderConfig = {
      ollamaUrl: "http://localhost:11434",
      model: "nomic-embed-text",
    };
    expect(config.ollamaUrl).toBe("http://localhost:11434");
    expect(config.batchSize).toBeUndefined();
  });

  test("shape is correct with all fields", () => {
    const config: EmbedderConfig = {
      ollamaUrl: "http://gpu-box:11434",
      model: "mxbai-embed-large",
      batchSize: 100,
    };
    expect(config.batchSize).toBe(100);
  });
});
