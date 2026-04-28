import { parseJsonlFile } from "./jsonl.js";
import { parsePlaintextFile } from "./plaintext.js";
import type { ParseError, ParseSuccess } from "./types.js";
import type { Result } from "@asklog/core";
import { err } from "@asklog/core";
import type { FileReadError } from "./types.js";

export async function autoDetectParser(
  path: string
): Promise<Result<ParseSuccess, ParseError>> {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".jsonl") || lowerPath.endsWith(".ndjson")) {
    return parseJsonlFile(path);
  }

  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Unknown filesystem error";
    return err<FileReadError>({
      code: "FILE_READ_ERROR",
      path,
      cause: message,
    });
  }

  const lines = text.split("\n");
  let isJsonl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (line && line.length > 0) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          isJsonl = true;
        }
      } catch {
        // Not a valid JSON object
      }
      break;
    }
  }

  if (isJsonl) {
    return parseJsonlFile(path);
  }

  return parsePlaintextFile(path);
}
