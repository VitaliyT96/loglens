import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { IVectorStore, VectorStoreEntry } from "./interface.js";
import type { LogEntry } from "../types.js";

// ---------------------------------------------------------------------------
// cosineSimilarity — pure math, no side effects
// ---------------------------------------------------------------------------

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// stripEmbedding — explicit object construction, no `as` cast (C5)
// ---------------------------------------------------------------------------

function stripEmbedding(entry: VectorStoreEntry): LogEntry {
  const result: LogEntry = {
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    raw: entry.raw,
    ...(entry.service !== undefined ? { service: entry.service } : {}),
    ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
  };
  return result;
}

// ---------------------------------------------------------------------------
// MemoryVectorStore — in-memory IVectorStore backed by Bun file I/O
// ---------------------------------------------------------------------------

export class MemoryVectorStore implements IVectorStore {
  private entries: VectorStoreEntry[] = [];

  async add(entries: LogEntry[], embeddings: number[][]): Promise<void> {
    if (entries.length !== embeddings.length) {
      throw new Error("Entries and embeddings length mismatch");
    }

    const existingIds = new Set(this.entries.map((e) => e.id));

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const embedding = embeddings[i];
      if (entry === undefined || embedding === undefined) {
        throw new Error(`Missing entry or embedding at index ${String(i)}`);
      }

      // M2: guard against zero-length embeddings
      if (embedding.length === 0) {
        throw new Error(`Empty embedding vector at index ${String(i)}`);
      }

      // I3: skip duplicates by id
      if (!existingIds.has(entry.id)) {
        this.entries.push({
          ...entry,
          embedding,
        });
        existingIds.add(entry.id);
      }
    }
  }

  async search(
    queryEmbedding: number[],
    topN: number,
    serviceFilter?: string
  ): Promise<LogEntry[]> {
    // M2: guard against empty query embedding
    if (queryEmbedding.length === 0) {
      return [];
    }

    const scored = this.entries
      .filter((e) => serviceFilter === undefined || e.service === serviceFilter)
      .map((entry) => ({
        entry,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
      }));

    scored.sort((a, b) => b.score - a.score);

    // C5: explicit object construction via stripEmbedding, no `as` cast
    return scored.slice(0, topN).map(({ entry }) => stripEmbedding(entry));
  }

  async save(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    const indexPath = path.join(dir, "index.json");
    const content = JSON.stringify(this.entries);
    await Bun.write(indexPath, content);
  }

  async load(dir: string): Promise<void> {
    const indexPath = path.join(dir, "index.json");
    const file = Bun.file(indexPath);

    if (!(await file.exists())) {
      this.entries = [];
      return;
    }

    const content = await file.text();
    const parsed: unknown = JSON.parse(content, (_key, value: unknown) => {
      if (_key === "timestamp" && typeof value === "string") {
        return new Date(value);
      }
      return value;
    });

    if (!Array.isArray(parsed)) {
      this.entries = [];
      return;
    }

    const validEntries: VectorStoreEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        this.entries = [];
        return;
      }
      
      const obj = item as Record<string, unknown>;
      const hasId = typeof obj.id === "string";
      const hasEmbedding = Array.isArray(obj.embedding) && obj.embedding.every(n => typeof n === "number");
      const hasTimestamp = obj.timestamp instanceof Date;
      const hasLevel = typeof obj.level === "string";
      const hasMessage = typeof obj.message === "string";
      const hasRaw = typeof obj.raw === "string";

      if (!hasId || !hasEmbedding || !hasTimestamp || !hasLevel || !hasMessage || !hasRaw) {
        this.entries = [];
        return;
      }

      validEntries.push({
        id: obj.id as string,
        embedding: obj.embedding as number[],
        timestamp: obj.timestamp as Date,
        level: obj.level as "debug" | "info" | "warn" | "error" | "fatal",
        message: obj.message as string,
        raw: obj.raw as string,
        ...(typeof obj.service === "string" ? { service: obj.service } : {}),
        ...(typeof obj.metadata === "object" && obj.metadata !== null ? { metadata: obj.metadata as Record<string, unknown> } : {})
      });
    }

    this.entries = validEntries;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}
