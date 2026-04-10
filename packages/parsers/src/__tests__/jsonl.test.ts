import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseJsonlFile } from "../jsonl.js";
// ---------------------------------------------------------------------------
// Fixture paths — resolved relative to this test file
// ---------------------------------------------------------------------------

const FIXTURES = join(import.meta.dir, "fixtures");
const HAPPY_PATH = join(FIXTURES, "happy.jsonl");
const EMPTY_PATH = join(FIXTURES, "empty.jsonl");
const BROKEN_PATH = join(FIXTURES, "broken.jsonl");

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("parseJsonlFile — happy path", () => {
  test("returns Ok with all 6 entries and zero warnings", async () => {
    const result = await parseJsonlFile(HAPPY_PATH);

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow for type safety

    expect(result.value.entries).toHaveLength(6);
    expect(result.value.warnings).toHaveLength(0);
  });

  test("parses standard 'timestamp' + 'level' + 'message' fields", async () => {
    const result = await parseJsonlFile(HAPPY_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    const first = result.value.entries[0]!;
    expect(typeof first.id).toBe("string");
    expect(first.level).toBe("info");
    expect(first.message).toBe("Server started");
    expect(first.service).toBe("api");
    expect(first.timestamp).toEqual(new Date("2024-01-15T10:00:00.000Z"));
    expect(first.raw).toContain("Server started");
  });

  test("resolves 'time' field alias for timestamp", async () => {
    const result = await parseJsonlFile(HAPPY_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    // Line 3 uses `time` + `msg` aliases
    const third = result.value.entries[2]!;
    expect(third.timestamp).toEqual(new Date("2024-01-15T10:00:10.456Z"));
    expect(third.message).toBe("High memory usage");
    expect(third.level).toBe("warn");
  });

  test("resolves '@timestamp' + 'severity' field aliases", async () => {
    const result = await parseJsonlFile(HAPPY_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    // Line 4 uses `@timestamp` and `severity`
    const fourth = result.value.entries[3]!;
    expect(fourth.timestamp).toEqual(new Date("2024-01-15T10:00:15.789Z"));
    expect(fourth.level).toBe("error");
  });

  test("parses unix-millisecond timestamp", async () => {
    const result = await parseJsonlFile(HAPPY_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    // Line 5 uses `timestamp` as a number (unix ms)
    const fifth = result.value.entries[4]!;
    expect(fifth.timestamp).toEqual(new Date(1705312820000));
    expect(fifth.level).toBe("fatal");
  });

  test("captures extra fields in metadata, excludes known keys", async () => {
    const result = await parseJsonlFile(HAPPY_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    // Line 1: service=api, port=3000 → port goes to metadata
    const first = result.value.entries[0]!;
    expect(first.metadata).toBeDefined();
    expect(first.metadata!["port"]).toBe(3000);

    // Line 6: traceId + userId land in metadata
    const sixth = result.value.entries[5]!;
    expect(sixth.metadata!["traceId"]).toBe("xyz-789");
    expect(sixth.metadata!["userId"]).toBe("u-42");
  });

  test("entries with no extra fields have no metadata property", async () => {
    const result = await parseJsonlFile(HAPPY_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    // Line 5 has only known keys
    const fifth = result.value.entries[4]!;
    expect(fifth.metadata).toBeUndefined();
  });

  test("auto-generates id when not provided in the row", async () => {
    const result = await parseJsonlFile(HAPPY_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    // Lines 2-6 have no explicit `id`
    const second = result.value.entries[1]!;
    expect(typeof second.id).toBe("string");
    expect(second.id.length).toBeGreaterThan(0);
    // Must not be empty string
    expect(second.id).not.toBe("");
  });

  test("unknown level string falls back to 'unknown'", async () => {
    // The fixture has only known levels, so test with inline content.
    // We write a temp file programmatically.
    const tmp = `${import.meta.dir}/fixtures/_tmp_level.jsonl`;
    await Bun.write(
      tmp,
      '{"timestamp":"2024-01-01T00:00:00Z","level":"verbose","message":"test"}\n',
    );
    try {
      const result = await parseJsonlFile(tmp);
      if (!result.ok) throw new Error("Expected Ok");
      expect(result.value.entries[0]!.level).toBe("unknown");
    } finally {
      const f = Bun.file(tmp);
      // Clean up only if it exists
      if (await f.exists()) {
        await Bun.file(tmp).delete?.();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Empty file
// ---------------------------------------------------------------------------

describe("parseJsonlFile — empty file", () => {
  test("returns Ok with zero entries and zero warnings", async () => {
    const result = await parseJsonlFile(EMPTY_PATH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.entries).toHaveLength(0);
    expect(result.value.warnings).toHaveLength(0);
  });

  test("returns Ok even when file is only whitespace/newlines", async () => {
    const tmp = `${import.meta.dir}/fixtures/_tmp_whitespace.jsonl`;
    await Bun.write(tmp, "   \n\n   \n");
    try {
      const result = await parseJsonlFile(tmp);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.entries).toHaveLength(0);
      expect(result.value.warnings).toHaveLength(0);
    } finally {
      const f = Bun.file(tmp);
      if (await f.exists()) {
        await Bun.file(tmp).delete?.();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Broken / mixed file
// ---------------------------------------------------------------------------

describe("parseJsonlFile — broken lines", () => {
  test("returns Ok (not Err) even when some lines are invalid", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    expect(result.ok).toBe(true);
  });

  test("parses the valid lines and skips broken ones", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    // Valid lines: 1, 3, 8  — 3 total (lines 5,6,7 are invalid)
    expect(result.value.entries).toHaveLength(3);
  });

  test("produces a warning for each invalid line", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    // Lines 2(not JSON), 4(array), 5(no timestamp), 6(bad timestamp), 7(no message)
    expect(result.value.warnings).toHaveLength(5);
    expect(result.value.warnings.every((w) => typeof w === 'string')).toBe(true);
  });

  test("warning for non-JSON line says 'Invalid JSON'", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    const w = result.value.warnings.find((x) => x.includes("Line 2"));
    expect(w).toBeDefined();
    expect(w).toContain("Invalid JSON");
  });

  test("warning for JSON array says 'Expected a JSON object, got array'", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    const w = result.value.warnings.find((x) => x.includes("Line 4"));
    expect(w).toBeDefined();
    expect(w).toContain("array");
  });

  test("warning for missing timestamp mentions expected fields", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    const w = result.value.warnings.find((x) => x.includes("Line 5"));
    expect(w).toBeDefined();
    expect(w).toContain("timestamp");
  });

  test("warning for missing message field mentions 'message'", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    const w = result.value.warnings.find((x) => x.includes("Line 7"));
    expect(w).toBeDefined();
    expect(w).toContain("message");
  });

  test("warnings carry the 1-indexed line number", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    const warningsStr = result.value.warnings.join(" ");
    expect(warningsStr).toContain("Line 2"); // non-JSON
    expect(warningsStr).toContain("Line 4"); // array
    expect(warningsStr).toContain("Line 5"); // no timestamp
  });

  test("valid entries preserve their order from the file", async () => {
    const result = await parseJsonlFile(BROKEN_PATH);
    if (!result.ok) throw new Error("Expected Ok");

    const messages = result.value.entries.map((e) => e.message);
    expect(messages).toEqual([
      "Valid line one",
      "Valid line three",
      "Valid last line",
    ]);
  });
});

// ---------------------------------------------------------------------------
// File read error
// ---------------------------------------------------------------------------

describe("parseJsonlFile — file read error", () => {
  test("returns Err with FILE_READ_ERROR when file does not exist", async () => {
    const result = await parseJsonlFile("/this/path/does/not/exist.jsonl");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.message).toContain("this/path/does/not/exist.jsonl");
  });
});
