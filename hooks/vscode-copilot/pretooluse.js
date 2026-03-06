#!/usr/bin/env node
// ==============================================================================
// VS Code Copilot — PreToolUse Hook
// ==============================================================================
//
// Thin wrapper: parses VS Code Copilot stdin, routes through core logic,
// formats VS Code Copilot-specific JSON output.
//
// Register in .vscode/settings.json or copilot agent config.

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
    process.stdout.write(JSON.stringify({ permissionDecision: "deny", reason: "hook: failed to parse stdin" }));
    return;
  }

  const projectDir = getProjectDir("vscode-copilot");
  const canAccess = await createAccessChecker(projectDir);
  const routing = await routePreToolUse(event.tool_name, event.tool_input, canAccess);
  const result = formatDecision("vscode-copilot", routing);

  if (result !== null) {
    process.stdout.write(JSON.stringify(result));
  }
});
