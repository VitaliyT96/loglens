import { describe, test, expect } from "bun:test";
import { parseArgs } from "citty";
import { ingestArgs } from "../commands/ingest.js";
import { queryArgs } from "../commands/query.js";
import { formatDuration } from "../format.js";

// ---------------------------------------------------------------------------
// Ingest command arg parsing
// ---------------------------------------------------------------------------

describe("ingest command args", () => {
  test("parses positional file argument", () => {
    const parsed = parseArgs(["logs/app.jsonl"], ingestArgs);
    expect(parsed.file).toBe("logs/app.jsonl");
  });

  test("applies default storage-dir", () => {
    const parsed = parseArgs(["logs/app.jsonl"], ingestArgs);
    expect(parsed["storage-dir"]).toBe(".asklog");
  });

  test("overrides storage-dir with --storage-dir flag", () => {
    const parsed = parseArgs(
      ["logs/app.jsonl", "--storage-dir", "/data/index"],
      ingestArgs,
    );
    expect(parsed["storage-dir"]).toBe("/data/index");
  });

  test("applies default base-url", () => {
    const parsed = parseArgs(["logs/app.jsonl"], ingestArgs);
    expect(parsed["base-url"]).toBe("http://localhost:11434");
  });

  test("overrides base-url", () => {
    const parsed = parseArgs(
      ["logs/app.jsonl", "--base-url", "http://gpu:11434"],
      ingestArgs,
    );
    expect(parsed["base-url"]).toBe("http://gpu:11434");
  });

  test("applies default model", () => {
    const parsed = parseArgs(["logs/app.jsonl"], ingestArgs);
    expect(parsed.model).toBe("nomic-embed-text");
  });

  test("overrides model with --model flag", () => {
    const parsed = parseArgs(
      ["logs/app.jsonl", "--model", "all-minilm"],
      ingestArgs,
    );
    expect(parsed.model).toBe("all-minilm");
  });

  test("parses --service filter", () => {
    const parsed = parseArgs(
      ["logs/app.jsonl", "--service", "api-gateway"],
      ingestArgs,
    );
    expect(parsed.service).toBe("api-gateway");
  });

  test("service is undefined when not provided", () => {
    const parsed = parseArgs(["logs/app.jsonl"], ingestArgs);
    expect(parsed.service).toBeUndefined();
  });

  test("parses all flags together", () => {
    const parsed = parseArgs(
      [
        "logs/app.jsonl",
        "--storage-dir", "/tmp/idx",
        "--base-url", "http://remote:11434",
        "--model", "bge-small",
        "--service", "payments",
      ],
      ingestArgs,
    );
    expect(parsed.file).toBe("logs/app.jsonl");
    expect(parsed["storage-dir"]).toBe("/tmp/idx");
    expect(parsed["base-url"]).toBe("http://remote:11434");
    expect(parsed.model).toBe("bge-small");
    expect(parsed.service).toBe("payments");
  });
});

// ---------------------------------------------------------------------------
// Query command arg parsing
// ---------------------------------------------------------------------------

describe("query command args", () => {
  test("parses positional question", () => {
    const parsed = parseArgs(["why did the server crash?"], queryArgs);
    expect(parsed.question).toBe("why did the server crash?");
  });

  test("applies all default values", () => {
    const parsed = parseArgs(["what happened?"], queryArgs);
    expect(parsed["storage-dir"]).toBe(".asklog");
    expect(parsed["base-url"]).toBe("http://localhost:11434");
    expect(parsed["chat-model"]).toBe("llama3.2");
    expect(parsed["embedding-model"]).toBe("nomic-embed-text");
    expect(parsed["top-n"]).toBe("10");
  });

  test("overrides top-n", () => {
    const parsed = parseArgs(["what happened?", "--top-n", "5"], queryArgs);
    expect(parsed["top-n"]).toBe("5");
  });

  test("service is undefined when not provided", () => {
    const parsed = parseArgs(["what happened?"], queryArgs);
    expect(parsed.service).toBeUndefined();
  });

  test("parses all flags together", () => {
    const parsed = parseArgs(
      [
        "what happened?",
        "--storage-dir", "/data/index",
        "--base-url", "http://gpu:11434",
        "--chat-model", "mistral",
        "--embedding-model", "all-minilm",
        "--top-n", "20",
        "--service", "auth-service",
      ],
      queryArgs,
    );
    expect(parsed.question).toBe("what happened?");
    expect(parsed["storage-dir"]).toBe("/data/index");
    expect(parsed["base-url"]).toBe("http://gpu:11434");
    expect(parsed["chat-model"]).toBe("mistral");
    expect(parsed["embedding-model"]).toBe("all-minilm");
    expect(parsed["top-n"]).toBe("20");
    expect(parsed.service).toBe("auth-service");
  });
});

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

describe("formatDuration", () => {

  test("formats sub-second durations in ms", () => {
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  test("formats durations >= 1s in seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(12345)).toBe("12.3s");
  });

  test("rounds sub-second values to nearest ms", () => {
    expect(formatDuration(42.7)).toBe("43ms");
    expect(formatDuration(0.4)).toBe("0ms");
  });
});
