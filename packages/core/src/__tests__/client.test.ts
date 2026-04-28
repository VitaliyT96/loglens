import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { fetchEmbeddings, streamChat } from "../llm/client.js";
import type { ChatMessage, LlmConfig } from "../llm/client.js";

describe("llm client", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // Use maxRetries: 0 in tests to avoid retry delays unless testing retries
  const config: LlmConfig = {
    baseUrl: "http://localhost:1234",
    model: "test-model",
    maxRetries: 0,
  };

  describe("fetchEmbeddings", () => {
    test("success: sends request and parses response", async () => {
      fetchSpy.mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              { embedding: [0.1, 0.2] },
              { embedding: [0.3, 0.4] },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await fetchEmbeddings(["hello", "world"], config);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const reqUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(reqUrl).toBe("http://localhost:1234/v1/embeddings");

      const reqBodyStr = (fetchSpy.mock.calls[0]![1] as RequestInit).body as string;
      const reqBody = JSON.parse(reqBodyStr);
      expect(reqBody).toEqual({
        model: "test-model",
        input: ["hello", "world"],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          [0.1, 0.2],
          [0.3, 0.4],
        ]);
      }
    });

    test("error: network failure", async () => {
      fetchSpy.mockImplementation(async () => {
        throw new Error("ECONNREFUSED");
      });

      const result = await fetchEmbeddings(["test"], config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FETCH_FAILED");
        expect(result.error.message).toBe("ECONNREFUSED");
      }
    });

    test("error: HTTP status code", async () => {
      fetchSpy.mockImplementation(async () => {
        return new Response(
          JSON.stringify({ error: { message: "Model not found" } }),
          { status: 404 }
        );
      });

      const result = await fetchEmbeddings(["test"], config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("HTTP_ERROR");
        expect(result.error.message).toBe("Model not found");
      }
    });

    test("error: invalid JSON response", async () => {
      fetchSpy.mockImplementation(async () => {
        return new Response("Not JSON", { status: 200 });
      });

      const result = await fetchEmbeddings(["test"], config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_RESPONSE");
      }
    });

    test("error: valid JSON but wrong shape", async () => {
      fetchSpy.mockImplementation(async () => {
        return new Response(JSON.stringify({ someField: "missing data" }), { status: 200 });
      });

      const result = await fetchEmbeddings(["test"], config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_RESPONSE");
      }
    });
  });

  describe("streamChat", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

    function createStreamResponse(chunks: string[]): Response {
      let i = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (i < chunks.length) {
            controller.enqueue(new TextEncoder().encode(chunks[i]));
            i++;
          } else {
            controller.close();
          }
        },
      });
      return new Response(stream, { status: 200 });
    }

    test("success: parses SSE content chunks and [DONE]", async () => {
      fetchSpy.mockImplementation(async () => {
        return createStreamResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      });

      const generator = streamChat(messages, config);
      const output: string[] = [];
      for await (const chunk of generator) {
        output.push(chunk);
      }

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const reqUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(reqUrl).toBe("http://localhost:1234/v1/chat/completions");

      const reqBodyStr = (fetchSpy.mock.calls[0]![1] as RequestInit).body as string;
      const reqBody = JSON.parse(reqBodyStr);
      expect(reqBody).toEqual({
        model: "test-model",
        messages,
        stream: true,
      });

      expect(output).toEqual(["Hel", "lo"]);
    });

    test("error: network failure throws", async () => {
      fetchSpy.mockImplementation(async () => {
        throw new Error("Network offline");
      });

      let err: Error | undefined;
      try {
        const generator = streamChat(messages, config);
        for await (const _ of generator) {}
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toContain("[FETCH_FAILED]");
      expect(err!.message).toContain("Network offline");
    });

    test("error: HTTP status code throws", async () => {
      fetchSpy.mockImplementation(async () => {
        return new Response(
          JSON.stringify({ error: { message: "Internal Error" } }),
          { status: 500 }
        );
      });

      let err: Error | undefined;
      try {
        const generator = streamChat(messages, config);
        for await (const _ of generator) {}
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toContain("[HTTP_ERROR]");
      expect(err!.message).toContain("Internal Error");
    });

    test("error: invalid JSON in SSE chunk throws", async () => {
      fetchSpy.mockImplementation(async () => {
        return createStreamResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {BAD_JSON!!!}\n\n',
        ]);
      });

      let err: Error | undefined;
      const output: string[] = [];
      try {
        const generator = streamChat(messages, config);
        for await (const chunk of generator) {
          output.push(chunk);
        }
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toContain("[INVALID_RESPONSE]");
      expect(output).toEqual(["Hel"]);
    });

    test("error: malformed SSE chunk shape throws", async () => {
      fetchSpy.mockImplementation(async () => {
        return createStreamResponse([
          'data: {"choices":[{}]}\n\n', // MISSING delta property!
        ]);
      });

      let err: Error | undefined;
      try {
        const generator = streamChat(messages, config);
        for await (const _ of generator) {}
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toContain("[INVALID_RESPONSE]");
    });
  });

  // ---------------------------------------------------------------------------
  // Retry behavior
  // ---------------------------------------------------------------------------

  describe("retry", () => {
    test("fetchEmbeddings retries on 503 and succeeds", async () => {
      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return new Response(
            JSON.stringify({ error: { message: "Model loading" } }),
            { status: 503 }
          );
        }
        return new Response(
          JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const retryConfig: LlmConfig = {
        ...config,
        maxRetries: 3,
      };

      const result = await fetchEmbeddings(["test"], retryConfig);
      expect(result.ok).toBe(true);
      expect(callCount).toBe(3); // 2 retries + 1 success
    });

    test("fetchEmbeddings does NOT retry on 404", async () => {
      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        return new Response(
          JSON.stringify({ error: { message: "Not Found" } }),
          { status: 404 }
        );
      });

      const retryConfig: LlmConfig = {
        ...config,
        maxRetries: 3,
      };

      const result = await fetchEmbeddings(["test"], retryConfig);
      expect(result.ok).toBe(false);
      expect(callCount).toBe(1); // No retries for 4xx (except 429)
    });

    test("fetchEmbeddings retries on 429", async () => {
      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          return new Response(
            JSON.stringify({ error: { message: "Rate limited" } }),
            { status: 429 }
          );
        }
        return new Response(
          JSON.stringify({ data: [{ embedding: [0.5] }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const retryConfig: LlmConfig = {
        ...config,
        maxRetries: 3,
      };

      const result = await fetchEmbeddings(["test"], retryConfig);
      expect(result.ok).toBe(true);
      expect(callCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // baseUrl normalization
  // ---------------------------------------------------------------------------

  describe("baseUrl normalization", () => {
    test("trailing slash is stripped", async () => {
      fetchSpy.mockImplementation(async () => {
        return new Response(
          JSON.stringify({ data: [{ embedding: [0.1] }] }),
          { status: 200 }
        );
      });

      const trailingConfig: LlmConfig = {
        baseUrl: "http://localhost:11434/",
        model: "test",
        maxRetries: 0,
      };

      await fetchEmbeddings(["hi"], trailingConfig);
      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toBe("http://localhost:11434/v1/embeddings");
    });

    test("multiple trailing slashes are stripped", async () => {
      fetchSpy.mockImplementation(async () => {
        return new Response(
          JSON.stringify({ data: [{ embedding: [0.1] }] }),
          { status: 200 }
        );
      });

      const trailingConfig: LlmConfig = {
        baseUrl: "http://localhost:11434///",
        model: "test",
        maxRetries: 0,
      };

      await fetchEmbeddings(["hi"], trailingConfig);
      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toBe("http://localhost:11434/v1/embeddings");
    });
  });
});
