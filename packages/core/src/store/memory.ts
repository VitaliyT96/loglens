import path from "node:path";
import type { IVectorStore, VectorStoreEntry } from "./interface.js";
import type { LogEntry } from "../types.js";

function cosineSimilarity(a: number[], b: number[]): number {
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
        throw new Error("Missing entry or embedding at index");
      }
      
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
    const scored = this.entries
      .filter((e) => serviceFilter === undefined || e.service === serviceFilter)
      .map((entry) => ({
        entry,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
      }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topN).map(({ entry }) => {
      const { embedding: _embed, ...logEntry } = entry;
      return logEntry;
    });
  }

  async save(dir: string): Promise<void> {
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
    
    try {
      const content = await file.text();
      this.entries = JSON.parse(content, (key, value) => {
        if (key === "timestamp" && typeof value === "string") {
          return new Date(value);
        }
        return value;
      });
    } catch (e: unknown) {
      throw e;
    }
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}
