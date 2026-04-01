// ==============================================================================
// Platform-Agnostic Hook Routing
// ==============================================================================
//
// Normalizes tool names across platforms via TOOL_ALIASES, then makes
// advise/approve decisions based on file size and edit token cost.
// Returns normalized {action, reason} objects that platform-specific
// formatters translate to the right JSON shape.

import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { OUTLINEABLE_EXTENSIONS } from "../../src/outline/supported-extensions.js";

// Maps platform-specific built-in tool names to canonical names.
const TOOL_ALIASES = {
  // Gemini CLI
  read_file: "Read",
  read_many_files: "Read",
  edit_file: "Edit",
  write_file: "Write",
  run_shell_command: "Bash",
  // VS Code Copilot
  replace_string_in_file: "Edit",
  multi_replace_string_in_file: "MultiEdit",
  // OpenCode
  view: "Read",
  bash: "Bash",
  // Codex CLI
  shell: "Bash",
};

// Different platforms use different field names for file paths in tool input.
const FILE_PATH_FIELDS = ["file_path", "path", "target_file"];

// Fields that indicate a partial/ranged read across platforms:
//   Claude Code / OpenCode: offset, limit
//   Gemini CLI: start_line, end_line
const PARTIAL_READ_FIELDS = ["offset", "limit", "start_line", "end_line"];

// Files below this threshold are small enough for built-in tools.
const LARGE_FILE_THRESHOLD = 15360; // 15KB

/**
 * @param {string} toolName
 * @returns {string}
 */
export function canonicalToolName(toolName) {
  return TOOL_ALIASES[toolName] ?? toolName;
}

/**
 * Extract a file path from tool input, trying known field names.
 * @param {Record<string, unknown> | undefined} toolInput
 * @returns {string | null}
 */
export function extractFilePath(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return null;
  for (const field of FILE_PATH_FIELDS) {
    const val = toolInput[field];
    if (typeof val === "string") return val;
  }
  return null;
}

/**
 * Check whether a Read tool call is requesting a partial/ranged read.
 *
 * Partial reads already limit context consumption, which is what trueline_read
 * with targeted ranges accomplishes. Passing them through avoids blocking
 * reads that are already well-scoped.
 *
 * Platform conventions:
 *   Claude Code / OpenCode: offset (line number), limit (line count)
 *   Gemini CLI: start_line, end_line (1-based, inclusive)
 *
 * @param {Record<string, unknown> | undefined} toolInput
 * @returns {boolean}
 */
export function isPartialRead(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return false;
  for (const field of PARTIAL_READ_FIELDS) {
    const val = toolInput[field];
    if (typeof val === "number" && val > 0) return true;
  }
  return false;
}

/**
 * Format a human-readable file size.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(0)}KB`;
}

/**
 * Route a pre-tool-use event.
 *
 * Routing logic by tool, file size, and edit token cost:
 *
 * - Read, large file (>= LARGE_FILE_THRESHOLD): **block** and redirect
 *   to trueline_read. Full reads of large files waste context; the agent
 *   should use trueline_outline or targeted trueline_read ranges instead.
 *
 * - Read, small file: **advise** trueline_outline but allow through.
 *   The MCP overhead of trueline_read isn't worth it on small files,
 *   but outline is still a better first step.
 *
 * - Edit/MultiEdit: **block** and redirect to trueline_search ->
 *   trueline_edit. Hash-verified edits prevent stale-content mismatches
 *   that built-in Edit can't detect.
 *
 * Returns null for silent approve, or { action, reason } for advise/block.
 *
 * @param {string} toolName - Raw tool name from the platform
 * @param {Record<string, unknown> | undefined} toolInput
 * @param {(filePath: string, toolName: string) => Promise<boolean>} canAccessFn
 * @returns {Promise<{ action: "advise" | "block"; reason: string } | null>}
 */
export async function routePreToolUse(toolName, toolInput, canAccessFn) {
  const canonical = canonicalToolName(toolName);

  // Only intercept file read/edit tools.
  if (canonical !== "Read" && canonical !== "Edit" && canonical !== "MultiEdit") {
    return null;
  }

  const filePath = extractFilePath(toolInput);
  if (typeof filePath !== "string") return null;

  // Check file size. If stat fails (file doesn't exist), pass through.
  let fileSize;
  try {
    const st = await stat(filePath);
    fileSize = st.size;
  } catch {
    return null;
  }

  if (canonical === "Read") {
    // Partial reads (offset/limit, start_line/end_line) already limit context
    // consumption, which is the same goal as trueline_read with ranges. Let
    // them through unconditionally.
    if (isPartialRead(toolInput)) return null;

    const canRead = await canAccessFn(filePath, "Read");
    if (!canRead) return null;

    const size = formatSize(fileSize);

    const canOutline = OUTLINEABLE_EXTENSIONS.has(extname(filePath).toLowerCase());

    // Large files: block and redirect to trueline.
    if (fileSize >= LARGE_FILE_THRESHOLD) {
      const outlineHint = canOutline
        ? "Use trueline_outline for structure or trueline_search to find specific content, then "
        : "Use trueline_search to find specific content, then ";
      return {
        action: "block",
        reason:
          `<trueline_redirect>This file is ${size}. ` +
          outlineHint +
          "trueline_read with targeted line ranges to read only what you need. " +
          "If you do need the whole file, use a single trueline_read call with no range " +
          "rather than multiple ranged calls.</trueline_redirect>",
      };
    }

    // Small files: advise outline/search but let the read through.
    // Only mention outline when the file type supports it (tree-sitter or custom parser).
    if (canOutline) {
      return {
        action: "advise",
        reason:
          "<trueline_advisory>trueline_outline gives a compact structural map " +
          "and is often enough on its own. If you plan to edit, " +
          "trueline_search returns matches with checksums ready for trueline_edit.</trueline_advisory>",
      };
    }

    // Non-outlineable small files: advise search for edit prep only.
    return {
      action: "advise",
      reason:
        "<trueline_advisory>If you plan to edit this file, " +
        "trueline_search returns matches with checksums ready for trueline_edit.</trueline_advisory>",
    };
  }

  // Edit or MultiEdit: block and redirect to trueline_search -> trueline_edit.
  // Hash verification is the core value; always prefer it over built-in Edit.
  const [canRead, canWrite] = await Promise.all([canAccessFn(filePath, "Read"), canAccessFn(filePath, "Edit")]);
  if (!canRead || !canWrite) return null;

  return {
    action: "block",
    reason:
      "<trueline_redirect>Use trueline_search to find the target content, then trueline_edit to apply " +
      "hash-verified changes. trueline_edit confirms content hasn't changed since you last read it, " +
      "preventing stale-content mismatches that built-in Edit can't detect.</trueline_redirect>",
  };
}
