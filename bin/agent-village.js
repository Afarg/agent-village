#!/usr/bin/env node
// CLI entry point (docs/design/04-multi-project-integration.md §6.2).
//
// The bare `node server/src/index.js` entry point defaults an unset target to
// this checkout's own directory (for the self-demo workflow). That default is
// wrong for this CLI: running `agent-village` (or `npx agent-village`) is
// meant to visualize whichever project the user is currently in, so here we
// default the target to process.cwd() instead, unless the user already
// passed --target or TARGET_PROJECT_ROOT explicitly.
const path = require("path");

if (!process.env.TARGET_PROJECT_ROOT && process.argv.indexOf("--target") === -1) {
  process.env.TARGET_PROJECT_ROOT = process.cwd();
}
process.env.AGENT_VILLAGE_AUTO_OPEN = process.env.AGENT_VILLAGE_AUTO_OPEN || "1";

require(path.join(__dirname, "..", "server", "src", "index.js"));
