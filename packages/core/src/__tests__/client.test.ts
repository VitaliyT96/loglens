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

  const config: LlmConfig = {
    baseUrl: "http://localhost:1234",
    model: "test-model",
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
});
