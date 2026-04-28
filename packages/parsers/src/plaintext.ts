import { ok, err } from "@asklog/core";
import type { LogEntry, LogLevel, Result } from "@asklog/core";
import type { ParseError, ParseSuccess, FileReadError } from "./types.js";

const SYSLOG_REGEX = /^(\d{4}-\d{2}-\d{2}T\S+)\s+(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE|CRITICAL|CRIT|ERR)\s+(?:\[(.*?)\]\s+)?(.*)$/i;
const NGINX_REGEX = /^\S+\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"[^"]+"\s+(\d{3})\s+\S+/;

function normalizeLevel(raw: string): LogLevel {
  const upper = raw.toUpperCase();
  switch (upper) {
    case "WARNING":
    case "WARN":
      return "warn";
    case "ERR":
    case "ERROR":
      return "error";
    case "CRITICAL":
    case "CRIT":
    case "FATAL":
      return "fatal";
    case "TRACE":
    case "DEBUG":
      return "debug";
    case "INFO":
      return "info";
    default:
      return "unknown";
  }
}

export async function parsePlaintextFile(
  path: string,
  pattern?: RegExp
): Promise<Result<ParseSuccess, ParseError>> {
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
  const entries: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    const id = String(Bun.hash(rawLine));
    let entry: LogEntry | undefined;

    if (pattern) {
      const match = pattern.exec(trimmed);
      if (match) {
        const timestampStr = match.groups?.timestamp;
        const levelStr = match.groups?.level;
        const messageStr = match.groups?.message;
        const serviceStr = match.groups?.service;

        entry = {
          id,
          timestamp: timestampStr ? new Date(timestampStr) : new Date(),
          level: levelStr ? normalizeLevel(levelStr) : "unknown",
          message: messageStr ?? rawLine,
          raw: rawLine,
          ...(serviceStr ? { service: serviceStr } : {}),
        };
      }
    } else {
      const syslogMatch = SYSLOG_REGEX.exec(trimmed);
      if (syslogMatch) {
        entry = {
          id,
          timestamp: new Date(syslogMatch[1]!),
          level: normalizeLevel(syslogMatch[2]!),
          message: syslogMatch[4]!,
          raw: rawLine,
          ...(syslogMatch[3] ? { service: syslogMatch[3] } : {}),
        };
      } else {
        const nginxMatch = NGINX_REGEX.exec(trimmed);
        if (nginxMatch) {
          const dateStr = nginxMatch[1]!.replace(":", " ");
          const status = parseInt(nginxMatch[2]!, 10);
          let level: LogLevel = "info";
          if (status >= 500) {
            level = "error";
          } else if (status >= 400) {
            level = "warn";
          }

          entry = {
            id,
            timestamp: new Date(dateStr),
            level,
            message: rawLine,
            raw: rawLine,
          };
        }
      }
    }

    if (!entry) {
      entry = {
        id,
        timestamp: new Date(),
        level: "unknown",
        message: rawLine,
        raw: rawLine,
      };
    }

    entries.push(entry);
  }

  return ok({ entries, warnings: [] });
}
