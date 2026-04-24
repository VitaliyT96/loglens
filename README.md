# loglens
TypeScript-first local RAG CLI/SDK for developers to chat with their logs.

## Requirements
- Bun >= 1.0
- Ollama
- Models: `nomic-embed-text` and `llama3.2`

## Quick Start
```bash
# Pull the required models
ollama pull nomic-embed-text
ollama pull llama3.2

# Ingest a log file
bunx loglens ingest ./app.log

# Ask a question
bunx loglens query "Why did the database connection fail?"
```

## CLI Reference

### `ingest`
Ingest a log file into the local vector index.

```bash
bunx loglens ingest <file> [options]
```

**Options:**
- `--storage-dir`: Directory for the vector index (default: `.loglens`)
- `--base-url`: Base URL of the OpenAI-compatible embedding server (default: `http://localhost:11434`)
- `--model`: Embedding model name (default: `nomic-embed-text`)
- `--service`: Only ingest entries matching this service name

### `query`
Ask a natural-language question about your logs.

```bash
bunx loglens query "<question>" [options]
```

**Options:**
- `--storage-dir`: Directory for the vector index (default: `.loglens`)
- `--base-url`: Base URL of the OpenAI-compatible server (default: `http://localhost:11434`)
- `--chat-model`: Chat/completion model name (default: `llama3.2`)
- `--embedding-model`: Embedding model name (must match the model used during ingest) (default: `nomic-embed-text`)
- `--top-n`: Number of nearest log entries to retrieve (default: `10`)
- `--service`: Only query entries matching this service name

## SDK Usage

Use the `Loglens` class for programmatic access:

```typescript
import { Loglens } from "@loglens/sdk";

const loglens = new Loglens({
  storageDir: "./.loglens",
  ollamaBaseUrl: "http://localhost:11434",
  embeddingModel: "nomic-embed-text",
  chatModel: "llama3.2"
});

// Ingest a log file
const ingestResult = await loglens.ingest("./app.log", { service: "api" });
if (!ingestResult.ok) {
  console.error("Failed to ingest:", ingestResult.error.message);
} else {
  console.log(`Ingested ${ingestResult.value.ingested} logs.`);
}

// Query the logs
const queryResult = await loglens.query("Are there any database errors?", { topN: 5 });
if (!queryResult.ok) {
  console.error("Failed to query:", queryResult.error.message);
} else {
  // Streams tokens to console via default onEvent if not provided
  console.log("Sources used:", queryResult.value.sources.length);
}
```

## Supported Log Formats
Loglens automatically detects and parses the following log formats:
- **JSONL**
- **syslog**
- **nginx**

## Architecture
Loglens is built as a monorepo with zero external heavy orchestration framework dependencies (no LlamaIndex, no LangChain):
- `packages/core`: Ingestion pipeline, embedding, vector store implementation, and query engine.
- `packages/cli`: CLI entry point (`bunx loglens`), providing the terminal interface and compiling to a single binary.
- `packages/sdk`: Public programmatic API exporting the `Loglens` class for Node 20 / Bun integration.
- `packages/parsers`: Pluggable log format parsers (jsonl, plaintext, syslog, nginx) with auto-detection capabilities.

## Local Development
```bash
bun install
bun test --recursive
bun run typecheck
cd packages/cli && bun run build:binary
```
