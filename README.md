<div align="center">
  <h1>🔦 asklog</h1>
  <p><b>TypeScript-first local RAG CLI/SDK for developers to chat with their logs.</b></p>
  
  <p>
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Bun-%23000000.svg?style=flat-square&logo=bun&logoColor=white" alt="Bun" />
    <img src="https://img.shields.io/badge/Ollama-%23000000.svg?style=flat-square&logo=ollama&logoColor=white" alt="Ollama" />
    <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License" />
  </p>
</div>

---

> Imagine your service crashes at 3 AM. You open the terminal, navigate to your project folder, and type a single command:
> 
> ```bash
> asklog query "why did payment-service crash this morning?"
> ```
> 
> Within seconds, you get an answer like: *"payment-service started returning timeouts at 08:14 after the deployment of version 2.3.1. The root cause is an exhausted database connection pool, evident from 47 repeated `pool exhausted` errors between 08:14 and 08:31 in the `db-client` traces."*

**This is asklog.** Not a dashboard. Not a cloud service. Not another SaaS for $300 a month. Just a blazing fast tool in your terminal that reads your local logs and answers your questions in plain human language.

---

## 💡 How it works

First, you run `ingest` once. Asklog reads your log files—whether they're **JSONL**, **Nginx format**, or **plain text**. It turns each log line into a vector of numbers using a local embedding model in **Ollama**. This vector is a mathematical representation of the string's meaning. *"connection refused"* and *"cannot connect to the database"* will yield similar vectors even if they share no common words. All these vectors are saved locally to disk next to your original logs.

Then, when you ask a question, Asklog turns your question into a similar vector, finds the 10 log lines in the index whose vectors are closest to your question, and passes those lines as context to a local LLM. The LLM receives a system prompt like: *"You are a Senior SRE. Here are relevant logs, find the root cause with exact timestamps."* It then streams the answer directly to your terminal.

🔒 **All of this happens entirely on your machine. Not a single byte of your logs ever goes to the internet.**

## ✨ Why this is better than what you already have

- 🔍 **`grep` and `awk`**: You have to know exactly what you're looking for. Asklog lets you not know, and just ask.
- 💸 **Datadog, Elastic, Loki**: Require infrastructure, budget, and shipping your logs somewhere else. Asklog works with the files you already have on your disk or server.
- 🤖 **ChatGPT with copy-pasted logs**: You manually copy chunks, lose context, send potentially sensitive data to the cloud, and the model doesn't know which lines out of thousands are actually relevant.

## 🎯 Who is this for?

- A **developer** who spun up microservices locally and wants to understand why one is acting up.
- A **DevOps engineer** on a postmortem who needs to quickly reconstruct an incident timeline from raw logs.
- A **team with zero budget** for enterprise observability tools.
- **Anyone** who wants to interrogate their logs without leaving the terminal.

## 🚀 Two modes of use

1. 💻 **CLI**: For humans. Install via npm, run two commands, get your answer.
2. 📦 **SDK**: For tools. Install Asklog as a library and embed it into your own tool, deployment script, or CI pipeline. *(e.g., automatically analyze logs from a failed test and add a summary directly to the pull request.)*

---

## ⚙️ Requirements
- [Bun](https://bun.sh/) >= 1.0
- [Ollama](https://ollama.com/)
- Models: `nomic-embed-text` and `llama3.2`

## 🏃 Quick Start

```bash
# Pull the required local models
ollama pull nomic-embed-text
ollama pull llama3.2

# Ingest a log file
bunx asklog ingest ./app.log

# Ask a question
bunx asklog query "Why did the database connection fail?"
```

## 🛠️ CLI Reference

### `ingest`
Ingest a log file into the local vector index.

```bash
bunx asklog ingest <file> [options]
```

**Options:**
- `--storage-dir`: Directory for the vector index (default: `.asklog`)
- `--base-url`: Base URL of the OpenAI-compatible embedding server (default: `http://localhost:11434`)
- `--model`: Embedding model name (default: `nomic-embed-text`)
- `--service`: Only ingest entries matching this service name

### `query`
Ask a natural-language question about your logs.

```bash
bunx asklog query "<question>" [options]
```

**Options:**
- `--storage-dir`: Directory for the vector index (default: `.asklog`)
- `--base-url`: Base URL of the OpenAI-compatible server (default: `http://localhost:11434`)
- `--chat-model`: Chat/completion model name (default: `llama3.2`)
- `--embedding-model`: Embedding model name (must match the model used during ingest) (default: `nomic-embed-text`)
- `--top-n`: Number of nearest log entries to retrieve (default: `10`)
- `--service`: Only query entries matching this service name

## 📦 SDK Usage

Use the `Asklog` class for programmatic access:

```typescript
import { Asklog } from "@asklog/sdk";

const asklog = new Asklog({
  storageDir: "./.asklog",
  ollamaBaseUrl: "http://localhost:11434",
  embeddingModel: "nomic-embed-text",
  chatModel: "llama3.2"
});

// Ingest a log file
const ingestResult = await asklog.ingest("./app.log", { service: "api" });
if (!ingestResult.ok) {
  console.error("Failed to ingest:", ingestResult.error.message);
} else {
  console.log(`Ingested ${ingestResult.value.ingested} logs.`);
}

// Query the logs
const queryResult = await asklog.query("Are there any database errors?", { topN: 5 });
if (!queryResult.ok) {
  console.error("Failed to query:", queryResult.error.message);
} else {
  // Streams tokens to console via default onEvent if not provided
  console.log("Sources used:", queryResult.value.sources.length);
}
```

## 📂 Supported Log Formats
Asklog automatically detects and parses the following log formats:
- 📝 **JSONL**
- 🐧 **syslog**
- 🌐 **nginx**

## 🏗️ Architecture
Asklog is built as a **monorepo** with zero external heavy orchestration framework dependencies (no LlamaIndex, no LangChain):
- `packages/core`: Ingestion pipeline, embedding, vector store implementation, and query engine.
- `packages/cli`: CLI entry point (`bunx asklog`), providing the terminal interface and compiling to a single binary.
- `packages/sdk`: Public programmatic API exporting the `Asklog` class for Node 20 / Bun integration.
- `packages/parsers`: Pluggable log format parsers (jsonl, plaintext, syslog, nginx) with auto-detection capabilities.

## 💻 Local Development
```bash
bun install
bun test --recursive
bun run typecheck
cd packages/cli && bun run build:binary
```
