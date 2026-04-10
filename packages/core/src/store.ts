import { promises as fs } from "node:fs";
import path from "node:path";
import type { IVectorStore, VectorStoreEntry } from "./store/interface.js";
import type { LogEntry } from "./types.js";

function cosineSimilarity(a: number[], b: number[]): number {
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

export class VectorStore implements IVectorStore {
  private entries: VectorStoreEntry[] = [];

  async add(entries: LogEntry[], embeddings: number[][]): Promise<void> {
    if (entries.length !== embeddings.length) {
      throw new Error("Entries and embeddings length mismatch");
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const embedding = embeddings[i];
      if (entry === undefined || embedding === undefined) {
        throw new Error("Missing entry or embedding at index");
      }
      this.entries.push({
        ...entry,
        embedding,
      });
    }
  }

  async search(
    queryEmbedding: number[],
    topN: number,
    serviceFilter?: string
  ): Promise<LogEntry[]> {
    const scored = this.entries
      .filter((e) => serviceFilter === undefined || e.service === serviceFilter)
      .map((entry) => ({
        entry,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
      }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topN).map(({ entry }) => {
      const { embedding, ...logEntry } = entry;
      return logEntry as LogEntry;
    });
  }

  async save(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    const content = JSON.stringify(this.entries);
    await fs.writeFile(path.join(dir, "index.json"), content, "utf-8");
  }

  async load(dir: string): Promise<void> {
    try {
      const content = await fs.readFile(path.join(dir, "index.json"), "utf-8");
      this.entries = JSON.parse(content, (key, value) => {
        if (key === "timestamp" && typeof value === "string") {
          return new Date(value);
        }
        return value;
      });
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "ENOENT"
      ) {
        this.entries = [];
      } else {
        throw e;
      }
    }
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}
