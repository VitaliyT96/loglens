#!/usr/bin/env bun
// @loglens/cli — CLI entry point (bunx loglens)

import { defineCommand, runMain } from "citty";
import ingestCommand from "./commands/ingest.js";
import queryCommand from "./commands/query.js";

const main = defineCommand({
  meta: {
    name: "loglens",
    version: "0.0.0",
    description: "Local-first log analysis with RAG — zero cloud, zero SaaS",
  },
  subCommands: {
    ingest: ingestCommand,
    query: queryCommand,
  },
});

runMain(main);
