#!/usr/bin/env node
// ==============================================================================
// Gemini CLI — BeforeTool Hook
// ==============================================================================
//
// Thin wrapper: parses Gemini CLI stdin, routes through core logic, formats
// Gemini-specific JSON output.
//
// Register in ~/.gemini/settings.json:
//   { "hooks": { "BeforeTool": [{ "command": "trueline hook gemini-cli beforetool" }] } }

import { createAccessChecker } from "../core/access.js";
import { routePreToolUse } from "../core/routing.js";
import { formatDecision } from "../core/formatters.js";
import { getProjectDir } from "../core/platform.js";

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  let event;
  try {
    event = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "hook: failed to parse stdin" }));
    return;
  }

  const projectDir = getProjectDir("gemini-cli");
  const canAccess = await createAccessChecker(projectDir);
  const routing = await routePreToolUse(event.tool_name, event.tool_input, canAccess);
  const result = formatDecision("gemini-cli", routing);

  if (result !== null) {
    process.stdout.write(JSON.stringify(result));
  }
});
