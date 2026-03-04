import { fileURLToPath } from "node:url";

export function processHookEvent(event) {
  if (event.tool_name === "Edit" || event.tool_name === "MultiEdit") {
    return {
      decision: "block",
      reason:
        "<trueline_redirect>" +
        "Edit is blocked. Use trueline_read then trueline_edit." +
        "</trueline_redirect>",
    };
  }

  if (event.tool_name === "Read") {
    return {
      decision: "approve",
      reason:
        "<trueline_nudge>" +
        "Prefer trueline_read over Read. " +
        "trueline_read returns per-line hashes and a checksum needed for trueline_edit. " +
        "Use Read only when you need raw file content in context and will not be editing." +
        "</trueline_nudge>",
    };
  }

  return { decision: "approve" };
}

// Main: read hook event from stdin, write result to stdout.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    let event;
    try {
      event = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      process.stdout.write(JSON.stringify({ decision: "block", reason: "hook: failed to parse stdin" }));
      return;
    }
    process.stdout.write(JSON.stringify(processHookEvent(event)));
  });
}
