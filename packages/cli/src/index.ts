#!/usr/bin/env bun
// @asklog/cli — CLI entry point (bunx asklog)

import { defineCommand, runMain } from "citty";
import ingestCommand from "./commands/ingest.js";
import queryCommand from "./commands/query.js";

const main = defineCommand({
  meta: {
    name: "asklog",
    version: "0.0.0",
    description:
      "Local-first log analysis with RAG — zero cloud, zero SaaS\n\n" +
      "Examples:\n" +
      "  asklog ingest ./app.log                    Ingest a log file\n" +
      "  asklog ingest ./app.log --service api       Ingest only 'api' service\n" +
      "  asklog query \"why did the server crash?\"    Ask a question about your logs\n" +
      "  asklog query \"errors today\" --top-n 20      Retrieve more context",
  },
  subCommands: {
    ingest: ingestCommand,
    query: queryCommand,
  },
});

runMain(main);
