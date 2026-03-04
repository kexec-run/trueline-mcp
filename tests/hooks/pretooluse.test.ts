import { describe, expect, test } from "bun:test";
import { processHookEvent } from "../../hooks/pretooluse.js";

describe("PreToolUse hook", () => {
  test("blocks Edit and redirects to trueline_edit", () => {
    const result = processHookEvent({
      tool_name: "Edit",
      tool_input: { file_path: "app.ts", old_string: "x", new_string: "y" },
    });
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("trueline_edit");
  });

  test("blocks MultiEdit and redirects to trueline_edit", () => {
    const result = processHookEvent({
      tool_name: "MultiEdit",
      tool_input: { file_path: "app.ts", edits: [] },
    });
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("trueline_edit");
  });

  test("nudges Read toward trueline_read", () => {
    const result = processHookEvent({ tool_name: "Read", tool_input: {} });
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("trueline_read");
  });

  test("approves other tools without a nudge", () => {
    for (const tool of ["Write", "Bash", "Glob"]) {
      const result = processHookEvent({ tool_name: tool, tool_input: {} });
      expect(result.decision).toBe("approve");
      expect(result.reason).toBeUndefined();
    }
  });
});
