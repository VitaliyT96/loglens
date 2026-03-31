import { describe, expect, test } from "bun:test";
import { ok, err } from "../types.js";
import type {
  Result,
  LogLevel,
  LogEntry,
  IngestOptions,
  IngestResult,
  QueryOptions,
  QueryResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Result<T, E>
// ---------------------------------------------------------------------------

describe("Result<T, E>", () => {
  test("ok() creates an Ok value", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
  });

  test("err() creates an Err value", () => {
    const result = err(new Error("boom"));
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe("boom");
  });

  test("discriminant narrows correctly", () => {
    const result: Result<number, string> = Math.random() > 0.5
      ? ok(1)
      : err("fail");

    if (result.ok) {
      // TS narrows to Ok<number>
      const _v: number = result.value;
      expect(typeof _v).toBe("number");
    } else {
      // TS narrows to Err<string>
      const _e: string = result.error;
      expect(typeof _e).toBe("string");
    }
  });

  test("ok() preserves complex types", () => {
    const data = { foo: [1, 2, 3], bar: "baz" } as const;
    const result = ok(data);
    expect(result.ok).toBe(true);
    expect(result.value.foo).toEqual([1, 2, 3]);
  });

  test("err() works with non-Error types", () => {
    const result = err({ code: 404, reason: "not found" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// LogLevel — compile-time exhaustiveness check
// ---------------------------------------------------------------------------

describe("LogLevel", () => {
  test("all variants are assignable", () => {
    const levels: LogLevel[] = [
      "debug",
      "info",
      "warn",
      "error",
      "fatal",
      "unknown",
    ];
    expect(levels).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// LogEntry — structural checks
// ---------------------------------------------------------------------------

describe("LogEntry", () => {
  test("required fields only", () => {
    const entry: LogEntry = {
      id: "abc-123",
      timestamp: new Date("2026-01-01T00:00:00Z"),
      level: "info",
      message: "server started",
      raw: '{"level":"info","msg":"server started"}',
    };
    expect(entry.id).toBe("abc-123");
    expect(entry.service).toBeUndefined();
    expect(entry.metadata).toBeUndefined();
  });

  test("all fields", () => {
    const entry: LogEntry = {
      id: "abc-456",
      timestamp: new Date("2026-01-01T00:00:00Z"),
      level: "error",
      message: "connection refused",
      service: "api-gateway",
      raw: "2026-01-01 ERROR connection refused",
      metadata: { host: "10.0.0.1", port: 5432 },
    };
    expect(entry.service).toBe("api-gateway");
    expect(entry.metadata?.host).toBe("10.0.0.1");
  });
});

// ---------------------------------------------------------------------------
// IngestOptions / IngestResult
// ---------------------------------------------------------------------------

describe("IngestOptions", () => {
  test("minimal required fields", () => {
    const opts: IngestOptions = {
      filePath: "/var/log/app.log",
      storageDir: "/tmp/loglens-data",
    };
    expect(opts.ollamaBaseUrl).toBeUndefined();
    expect(opts.embeddingModel).toBeUndefined();
    expect(opts.serviceFilter).toBeUndefined();
  });

  test("all fields", () => {
    const opts: IngestOptions = {
      filePath: "/var/log/app.log",
      storageDir: "/tmp/loglens-data",
      ollamaBaseUrl: "http://gpu-box:11434",
      embeddingModel: "mxbai-embed-large",
      serviceFilter: "api-gateway",
    };
    expect(opts.ollamaBaseUrl).toBe("http://gpu-box:11434");
  });
});

describe("IngestResult", () => {
  test("shape is correct", () => {
    const result: IngestResult = { ingested: 100, skipped: 3, durationMs: 1234 };
    expect(result.ingested + result.skipped).toBe(103);
  });
});

// ---------------------------------------------------------------------------
// QueryOptions / QueryResult
// ---------------------------------------------------------------------------

describe("QueryOptions", () => {
  test("minimal required fields", () => {
    const opts: QueryOptions = {
      question: "Why did the server crash?",
      storageDir: "/tmp/loglens-data",
    };
    expect(opts.chatModel).toBeUndefined();
    expect(opts.topN).toBeUndefined();
  });
});

describe("QueryResult", () => {
  test("shape with sources", () => {
    const entry: LogEntry = {
      id: "src-1",
      timestamp: new Date(),
      level: "fatal",
      message: "OOM killed",
      raw: "FATAL: OOM killed",
    };
    const result: QueryResult = {
      answer: "The server ran out of memory at 03:14 UTC.",
      sources: [entry],
      durationMs: 890,
    };
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.level).toBe("fatal");
  });
});
