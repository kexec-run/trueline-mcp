import { fileURLToPath } from "node:url";
import { createAccessChecker } from "./core/access.js";
import { routePreToolUse } from "./core/routing.js";
import { formatDecision } from "./core/formatters.js";
import { getProjectDir } from "./core/platform.js";

/**
 * @param {{ tool_name: string; tool_input: Record<string, unknown> }} event
 * @returns {Promise<{ decision: string; reason?: string }>}
 */
export async function processHookEvent(event) {
  const projectDir = getProjectDir("claude-code");
  const canAccess = await createAccessChecker(projectDir);
  const routing = await routePreToolUse(event.tool_name, event.tool_input, canAccess);
  return formatDecision("claude-code", routing);
}

// Main: read hook event from stdin, write result to stdout.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", async () => {
    let event;
    try {
      event = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      process.stdout.write(JSON.stringify({ decision: "block", reason: "hook: failed to parse stdin" }));
      return;
    }
    const result = await processHookEvent(event);
    process.stdout.write(JSON.stringify(result));
  });
}
