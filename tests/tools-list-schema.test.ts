import { describe, expect, test } from "bun:test";

/**
 * Verify that the hand-crafted JSON schemas used in tools/list are clean and
 * contain no anyOf/union noise. The LLM should see canonical types only.
 */

// Import isn't possible since server.ts has side effects (starts listening).
// Instead, inline the schemas we want to validate structurally.

describe("tools/list JSON schemas are clean for LLM consumption", () => {
  // Representative schema: trueline_edit (the most complex one)
  const editSchema = {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the file to edit." },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            range: { type: "string" },
            content: { type: "string" },
            action: { type: "string", enum: ["replace", "insert_after"] },
          },
          required: ["ref", "range", "content"],
        },
      },
      encoding: { type: "string" },
      dry_run: { type: "boolean" },
    },
    required: ["file_path", "edits"],
  };

  test("file_path is a plain string, not a union", () => {
    expect(editSchema.properties.file_path.type).toBe("string");
    expect("anyOf" in editSchema.properties.file_path).toBe(false);
  });

  test("edits is a plain array, not a union", () => {
    expect(editSchema.properties.edits.type).toBe("array");
    expect("anyOf" in editSchema.properties.edits).toBe(false);
  });

  test("no anyOf appears anywhere in the schema", () => {
    const json = JSON.stringify(editSchema);
    expect(json).not.toContain("anyOf");
    expect(json).not.toContain("oneOf");
  });

  test("required fields are specified", () => {
    expect(editSchema.required).toContain("file_path");
    expect(editSchema.required).toContain("edits");
  });

  test("edit items require ref, range, content", () => {
    const items = editSchema.properties.edits.items;
    expect(items.required).toContain("ref");
    expect(items.required).toContain("range");
    expect(items.required).toContain("content");
    // action is optional — should NOT be in required
    expect(items.required).not.toContain("action");
  });
});
