import type { LogEntry } from "@asklog/core";

/** The file could not be read from the filesystem. */
export interface FileReadError {
  readonly code: "FILE_READ_ERROR";
  readonly path: string;
  readonly cause: string;
}

/** A log line was either not valid for its format or failed the LogEntry shape check. */
export interface LineParseWarning {
  readonly code: "LINE_PARSE_WARNING";
  readonly line: number;
  readonly raw: string;
  readonly reason: string;
}

export type ParseError = FileReadError;

export interface ParseSuccess {
  readonly entries: LogEntry[];
  readonly warnings: LineParseWarning[];
}
