import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { MemoryVectorStore } from "../store/memory.js";
import type { LogEntry } from "../types.js";

describe("MemoryVectorStore", () => {
  const TEST_DIR = path.join(import.meta.dir, "__store_temp__");

  beforeEach(async () => {
    const dir = Bun.file(path.join(TEST_DIR, "index.json"));
    if (await dir.exists()) {
      const { rm } = await import("node:fs/promises");
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  const entry1: LogEntry = {
    id: "1",
    timestamp: new Date("2023-01-01T00:00:00.000Z"),
    level: "info",
    message: "App started",
    raw: "App started",
    service: "api",
  };
  const embed1 = [1, 0, 0];

  const entry2: LogEntry = {
    id: "2",
    timestamp: new Date("2023-01-01T00:01:00.000Z"),
    level: "error",
    message: "DB connection failed",
    raw: "DB connection failed",
    service: "db",
  };
  const embed2 = [0, 1, 0];

  it("adds, searches, and filters logically", async () => {
    const store = new MemoryVectorStore();
    await store.add([entry1, entry2], [embed1, embed2]);

    // Search near embed1
    let results = await store.search([0.9, 0.1, 0], 10);
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe("1"); // Should be closest

    // Search with service filter
    results = await store.search([0.9, 0.1, 0], 10, "db");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("2");

    // TopN applied
    results = await store.search([0.9, 0.1, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("1");
  });

  it("persists and loads successfully while reviving dates", async () => {
    const store1 = new MemoryVectorStore();
    await store1.add([entry1, entry2], [embed1, embed2]);
    await store1.save(TEST_DIR);

    const store2 = new MemoryVectorStore();
    await store2.load(TEST_DIR);

    const results = await store2.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("1");
    // Date validation
    expect(results[0]?.timestamp).toBeInstanceOf(Date);
    expect(results[0]?.timestamp.toISOString()).toBe(
      "2023-01-01T00:00:00.000Z",
    );
  });

  it("clears memory correctly", async () => {
    const store = new MemoryVectorStore();
    await store.add([entry1], [embed1]);
    await store.clear();
    const results = await store.search([1, 0, 0], 10);
    expect(results).toHaveLength(0);
  });

  it("deduplicates entries by id", async () => {
    const store = new MemoryVectorStore();
    await store.add([entry1], [embed1]);
    // Add same entry again — should be skipped
    await store.add([entry1], [embed1]);

    const results = await store.search([1, 0, 0], 10);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("1");
  });

  it("rejects empty embedding vectors", async () => {
    const store = new MemoryVectorStore();
    await expect(store.add([entry1], [[]])).rejects.toThrow(
      "Empty embedding vector",
    );
  });

  it("returns empty results for empty query embedding", async () => {
    const store = new MemoryVectorStore();
    await store.add([entry1], [embed1]);
    const results = await store.search([], 10);
    expect(results).toHaveLength(0);
  });

  it("loads gracefully when no index exists", async () => {
    const store = new MemoryVectorStore();
    await store.load(TEST_DIR); // directory doesn't exist yet
    const results = await store.search([1, 0, 0], 10);
    expect(results).toHaveLength(0);
  });

  it("search results do not contain embedding field", async () => {
    const store = new MemoryVectorStore();
    await store.add([entry1], [embed1]);
    const results = await store.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
    // Verify embedding is stripped — use `in` to avoid unsafe cast
    const result = results[0];
    expect(result).toBeDefined();
    expect("embedding" in result!).toBe(false);
  });
});
