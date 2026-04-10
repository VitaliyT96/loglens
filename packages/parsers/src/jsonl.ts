import { ok, err } from "@loglens/core";
import type { LogEntry, LogLevel, Result } from "@loglens/core";

// ---------------------------------------------------------------------------
// ParseError — typed errors for the JSONL parser
// ---------------------------------------------------------------------------

export type ParseError = Error;

// ---------------------------------------------------------------------------
// ParseResult — Ok carries entries + warnings; Err carries a FileReadError
// ---------------------------------------------------------------------------

export interface ParseSuccess {
  readonly entries: LogEntry[];
  readonly warnings: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers — runtime type guards
// ---------------------------------------------------------------------------

const VALID_LEVELS = new Set<string>([
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "unknown",
]);

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && VALID_LEVELS.has(value);
}

/**
 * A "raw JSONL row" is whatever JSON.parse hands back.
 * We accept any object-like value and extract known fields.
 */
interface RawRow {
  [key: string]: unknown;
}

function isRawRow(value: unknown): value is RawRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract a string field from an object, return `undefined` if missing/wrong type. */
function getString(row: RawRow, key: string): string | undefined {
  const v = row[key];
  return typeof v === "string" ? v : undefined;
}

/** Extract a numeric field from an object, return `undefined` if missing/wrong type. */
function getNumber(row: RawRow, key: string): number | undefined {
  const v = row[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Try to parse a timestamp from either a string (ISO-8601) or a unix-ms number.
 * Returns `undefined` when neither format is present or the resulting Date is invalid.
 */
function parseTimestamp(row: RawRow): Date | undefined {
  const str = getString(row, "timestamp") ?? getString(row, "time") ?? getString(row, "@timestamp");
  if (str !== undefined) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const ms = getNumber(row, "timestamp") ?? getNumber(row, "time");
  if (ms !== undefined) {
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/**
 * Resolve the log level — tries `level`, then `severity`, then falls back to
 * `"unknown"` so we never silently drop an otherwise-valid entry.
 */
function resolveLevel(row: RawRow): LogLevel {
  const raw =
    getString(row, "level") ??
    getString(row, "severity") ??
    getString(row, "lvl");
  if (raw !== undefined) {
    const normalised = raw.toLowerCase();
    if (isLogLevel(normalised)) return normalised;
  }
  return "unknown";
}

/**
 * Pull out any fields that are not part of the known LogEntry schema and put
 * them into the `metadata` bag. This preserves arbitrary structured data.
 */
const KNOWN_KEYS = new Set([
  "id",
  "timestamp",
  "time",
  "@timestamp",
  "level",
  "severity",
  "lvl",
  "message",
  "msg",
  "service",
]);

function extractMetadata(row: RawRow): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  let hasExtra = false;
  for (const [key, value] of Object.entries(row)) {
    if (!KNOWN_KEYS.has(key)) {
      extra[key] = value;
      hasExtra = true;
    }
  }
  return hasExtra ? extra : undefined;
}

// ---------------------------------------------------------------------------
// mapRowToLogEntry — pure transformation, returns a typed Result
// ---------------------------------------------------------------------------

function mapRowToLogEntry(
  row: RawRow,
  rawLine: string,
): Result<LogEntry, string> {
  const timestamp = parseTimestamp(row);
  if (timestamp === undefined) {
    return err("missing or invalid timestamp field (expected 'timestamp', 'time', or '@timestamp')");
  }

  const message =
    getString(row, "message") ?? getString(row, "msg");
  if (message === undefined) {
    return err("missing 'message' or 'msg' field");
  }

  const id = crypto.randomUUID();

  const level = resolveLevel(row);
  const service = getString(row, "service");
  const metadata = extractMetadata(row);

  const entry: LogEntry = {
    id,
    timestamp,
    level,
    message,
    raw: rawLine,
    ...(service !== undefined ? { service } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };

  return ok(entry);
}

// ---------------------------------------------------------------------------
// parseJsonlFile — public API
// ---------------------------------------------------------------------------

/**
 * Read a JSONL file at `path` and parse each line into a {@link LogEntry}.
 *
 * - Empty lines and lines containing only whitespace are silently skipped.
 * - Lines that are not valid JSON or do not satisfy the {@link LogEntry} shape
 *   are collected as {@link LineParseWarning} values and never thrown.
 * - If the file cannot be read, an {@link Err} with {@link FileReadError} is
 *   returned immediately — no partial results are produced.
 *
 * @example
 * ```ts
 * const result = await parseJsonlFile("./app.jsonl");
 * if (!result.ok) {
 *   console.error("Cannot read file:", result.error.cause);
 *   process.exit(1);
 * }
 * for (const w of result.value.warnings) {
 *   console.warn(`Line ${w.line}: ${w.reason}`);
 * }
 * process(result.value.entries);
 * ```
 */
export async function parseJsonlFile(
  path: string,
): Promise<Result<ParseSuccess, ParseError>> {
  // ── 1. Read the file ────────────────────────────────────────────────────
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Unknown filesystem error";
    return err(new Error(`FILE_READ_ERROR: ${path} - ${message}`));
  }

  // ── 2. Parse line-by-line ────────────────────────────────────────────────
  const lines = text.split("\n");
  const entries: LogEntry[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();

    // Skip blank lines — they are not errors
    if (trimmed.length === 0) continue;

    const lineNumber = i + 1; // 1-indexed for humans

    // ── 2a. Parse JSON ─────────────────────────────────────────────────────
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      warnings.push(`Line ${lineNumber}: Invalid JSON`);
      continue;
    }

    // ── 2b. Validate object shape ──────────────────────────────────────────
    if (!isRawRow(parsed)) {
      warnings.push(`Line ${lineNumber}: Expected a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`);
      continue;
    }

    // ── 2c. Map to LogEntry ────────────────────────────────────────────────
    const mapped = mapRowToLogEntry(parsed, trimmed);
    if (!mapped.ok) {
      warnings.push(`Line ${lineNumber}: ${mapped.error}`);
      continue;
    }

    entries.push(mapped.value);
  }

  return ok({ entries, warnings });
}
