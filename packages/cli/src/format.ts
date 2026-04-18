// ---------------------------------------------------------------------------
// ANSI formatting helpers — zero dependencies, respects NO_COLOR
// https://no-color.org/
// ---------------------------------------------------------------------------

const enabled = process.env["NO_COLOR"] === undefined;

function wrap(code: string, text: string): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function bold(text: string): string {
  return wrap("1", text);
}

export function dim(text: string): string {
  return wrap("2", text);
}

export function green(text: string): string {
  return wrap("32", text);
}

export function red(text: string): string {
  return wrap("31", text);
}

export function cyan(text: string): string {
  return wrap("36", text);
}

export function logSuccess(message: string): void {
  console.log(`${green("✓")} ${message}`);
}

export function logInfo(message: string): void {
  console.log(`${cyan("ℹ")} ${message}`);
}

export function logError(message: string): void {
  console.error(`${red("✗")} ${message}`);
}

export function formatDuration(ms: number): string {
  return ms >= 1000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${String(Math.round(ms))}ms`;
}
