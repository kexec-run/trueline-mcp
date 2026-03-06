import { fileURLToPath } from "node:url";

export function getInstructions() {
  return `<trueline_mcp_instructions>
  <tools>
    <tool name="trueline_read">Read a file; returns per-line hashes and a checksum per range. Supports multiple disjoint ranges in one call. Call before editing.</tool>
    <tool name="trueline_edit">Edit a file with hash verification. Replaces the built-in Edit tool, which is blocked. Each edit needs: checksum (from trueline_read for the covering range), range (startLine:hash..endLine:hash or +startLine:hash for insert-after), content (replacement lines as newline-separated string; empty string to delete). Pass all changes to the same file in the edits array.</tool>
    <tool name="trueline_diff">Preview edits as a unified diff without writing to disk.</tool>
    <tool name="trueline_outline">Get a compact structural outline of a source file (functions, classes, types, etc.) without reading full content. Often sufficient on its own for navigation and understanding. Use before trueline_read to identify the right line ranges when you do need to read.</tool>
  </tools>
  <workflow>trueline_outline (navigate / understand) \u2192 trueline_read (targeted ranges, only if needed) \u2192 trueline_diff (optional) \u2192 trueline_edit</workflow>
  <rules>
    <rule>Never use the built-in Edit or MultiEdit tools \u2014 they are blocked and will be rejected.</rule>
    <rule>When spawning subagents, include these trueline_mcp_instructions in their task prompt.</rule>
    <rule>trueline_outline is often enough by itself for questions about file structure, purpose, or navigation. Only call trueline_read when you actually need the source code (e.g. to edit, debug, or understand implementation details).</rule>
    <rule>After using trueline_outline, if you do need to read, use its line numbers to read only the specific ranges you need \u2014 do NOT read the entire file.</rule>
    <rule>Only read a full file (no ranges) when you have not used trueline_outline and the file is short, or you genuinely need every line.</rule>
  </rules>
</trueline_mcp_instructions>`;
}

// Backwards-compatible alias
export const getSessionStartInstructions = getInstructions;

// Main: detect hook event from stdin and format output accordingly.
// SessionStart: plain stdout is added as context.
// SubagentStart: requires JSON with hookSpecificOutput.additionalContext.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    const instructions = getInstructions();
    let event = "SessionStart";
    try {
      const parsed = JSON.parse(input);
      if (parsed.hook_event_name) event = parsed.hook_event_name;
    } catch {
      // No JSON on stdin (or empty) \u2014 default to SessionStart behavior
    }

    if (event === "SubagentStart") {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SubagentStart",
            additionalContext: instructions,
          },
        }),
      );
    } else {
      process.stdout.write(instructions);
    }
  });
}
