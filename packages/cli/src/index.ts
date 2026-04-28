#!/usr/bin/env bun
// @loglens/cli — CLI entry point (bunx loglens)

import { defineCommand, runMain } from "citty";
import ingestCommand from "./commands/ingest.js";
import queryCommand from "./commands/query.js";

const main = defineCommand({
  meta: {
    name: "loglens",
    version: "0.0.0",
    description:
      "Local-first log analysis with RAG — zero cloud, zero SaaS\n\n" +
      "Examples:\n" +
      "  loglens ingest ./app.log                    Ingest a log file\n" +
      "  loglens ingest ./app.log --service api       Ingest only 'api' service\n" +
      "  loglens query \"why did the server crash?\"    Ask a question about your logs\n" +
      "  loglens query \"errors today\" --top-n 20      Retrieve more context",
  },
  subCommands: {
    ingest: ingestCommand,
    query: queryCommand,
  },
});

runMain(main);
