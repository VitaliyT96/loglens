import { expect, test, beforeAll, afterAll, spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Loglens } from "../index.js";

let tempDir: string;
let logFilePath: string;
let fetchMock: Mock<typeof globalThis.fetch>;

const ENTRY_COUNT = 20;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loglens-e2e-"));
  logFilePath = path.join(tempDir, "test.jsonl");

  const lines: string[] = [];
  
  // 5 error/payment-service
  for (let i = 0; i < 5; i++) {
    lines.push(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "payment-service",
        message: `Payment processing failed for user ${i}`,
      })
    );
  }

  // 5 info/api-gateway
  for (let i = 0; i < 5; i++) {
    lines.push(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "api-gateway",
        message: `Request received and routed ${i}`,
      })
    );
  }

  // 10 debug/mixed
  for (let i = 0; i < 10; i++) {
    lines.push(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "debug",
        service: "worker",
        message: `Background task heartbeat ${i}`,
      })
    );
  }

  fs.writeFileSync(logFilePath, lines.join("\n"));

  const originalFetch = globalThis.fetch;
  fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();

    if (url.endsWith("/v1/embeddings")) {
      const body = JSON.parse(init?.body as string);
      const inputs = body.input as string[];
      
      const data = inputs.map((text) => {
        const vec = new Array(384).fill(0);
        if (text.includes("Payment processing failed") || text.includes("payment-service") || text.includes("error")) {
          vec[0] = 1.0;
        } else if (text.includes("Request received")) {
          vec[1] = 1.0;
        } else {
          vec[2] = 1.0;
        }
        return { embedding: vec };
      });

      return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.endsWith("/v1/chat/completions")) {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"The "}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"payment "}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"failed."}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }

    return originalFetch(input, init);
  }) as any);
});

afterAll(() => {
  fetchMock.mockRestore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("Loglens SDK E2E pipeline", async () => {
  const sdk = new Loglens({
    storageDir: tempDir,
    ollamaBaseUrl: "http://mock-llm.local",
    embeddingModel: "mock-embed",
    chatModel: "mock-chat",
  });

  const ingestRes = await sdk.ingest(logFilePath);
  expect(ingestRes.ok).toBe(true);
  if (ingestRes.ok) {
    expect(ingestRes.value.ingested).toBe(ENTRY_COUNT);
  }

  const queryRes = await sdk.query("Why did the payment fail?");
  expect(queryRes.ok).toBe(true);
  if (queryRes.ok) {
    expect(queryRes.value.answer).toContain("The payment failed.");
    expect(queryRes.value.sources.length).toBeGreaterThan(0);
  }
});
