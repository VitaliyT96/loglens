import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { autoDetectParser } from "../detect.js";
import { unlinkSync } from "node:fs";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("autoDetectParser", () => {
  test(".jsonl is detected as JSONL", async () => {
    const path = join(fixturesDir, "happy.jsonl");
    const result = await autoDetectParser(path);
    
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { entries } = result.value;
    expect(entries.length).toBeGreaterThan(0);
    // Since it's JSONL, we can check for some properties
    expect(typeof entries[0]!.message).toBe("string");
  });

  test(".log with JSON content is detected as JSONL", async () => {
    const path = join(fixturesDir, "json_in.log");
    await Bun.write(path, `{"level":"info","message":"Hello jsonl","timestamp":"2023-01-01T00:00:00Z"}`);
    
    const result = await autoDetectParser(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { entries } = result.value;
    expect(entries.length).toBe(1);
    expect(entries[0]!.message).toBe("Hello jsonl");
    
    unlinkSync(path);
  });

  test(".log with syslog content is detected as plaintext", async () => {
    const path = join(fixturesDir, "syslog.log");
    const result = await autoDetectParser(path);
    
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { entries } = result.value;
    expect(entries.length).toBe(5);
    expect(entries[0]!.level).toBe("info");
  });

  test("missing file returns FileReadError", async () => {
    const result = await autoDetectParser(join(fixturesDir, "nonexistent.log"));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("FILE_READ_ERROR");
  });
});
