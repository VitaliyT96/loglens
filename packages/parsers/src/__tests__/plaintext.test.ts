import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parsePlaintextFile } from "../plaintext.js";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("parsePlaintextFile", () => {
  test("parses syslog correctly", async () => {
    const path = join(fixturesDir, "syslog.log");
    const result = await parsePlaintextFile(path);
    
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { entries } = result.value;
    expect(entries.length).toBe(5);

    expect(entries[0]!.level).toBe("info");
    expect(entries[0]!.service).toBe("api-gateway");
    expect(entries[0]!.message).toBe("Started listening on port 8080");
    expect(entries[0]!.timestamp.toISOString()).toBe("2024-03-12T08:15:30.123Z");

    expect(entries[1]!.level).toBe("debug");
    expect(entries[1]!.service).toBeUndefined();

    expect(entries[2]!.level).toBe("warn"); // WARNING -> warn
    expect(entries[3]!.level).toBe("error");

    expect(entries[4]!.level).toBe("fatal"); // CRIT -> fatal
  });

  test("parses nginx correctly", async () => {
    const path = join(fixturesDir, "nginx.log");
    const result = await parsePlaintextFile(path);
    
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { entries } = result.value;
    expect(entries.length).toBe(4);

    expect(entries[0]!.level).toBe("info"); // 200
    expect(entries[0]!.message).toContain("127.0.0.1");
    expect(entries[0]!.timestamp.toISOString()).toBe("2000-10-10T20:55:36.000Z");

    expect(entries[1]!.level).toBe("info"); // 201
    expect(entries[2]!.level).toBe("warn"); // 404
    expect(entries[3]!.level).toBe("error"); // 500
  });

  test("unknown level for unknown strings", async () => {
    const path = join(import.meta.dir, "fixtures", "unknown.log");
    await Bun.write(path, "just some random text\nanother line");
    
    const result = await parsePlaintextFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { entries } = result.value;
    expect(entries.length).toBe(2);
    expect(entries[0]!.level).toBe("unknown");
    expect(entries[0]!.message).toBe("just some random text");
    
    // cleanup
    import("node:fs").then(fs => fs.unlinkSync(path));
  });

  test("custom pattern works", async () => {
    const path = join(import.meta.dir, "fixtures", "custom.log");
    await Bun.write(path, "APP-LOG|2023-01-01T00:00:00Z|INFO|Hello world");
    
    // Pattern captures groups
    const pattern = /^APP-LOG\|(?<timestamp>[^|]+)\|(?<level>[^|]+)\|(?<message>.*)$/;
    const result = await parsePlaintextFile(path, pattern);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { entries } = result.value;
    expect(entries.length).toBe(1);
    expect(entries[0]!.level).toBe("info");
    expect(entries[0]!.message).toBe("Hello world");
    expect(entries[0]!.timestamp.toISOString()).toBe("2023-01-01T00:00:00.000Z");

    import("node:fs").then(fs => fs.unlinkSync(path));
  });
});
