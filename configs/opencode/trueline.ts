import type { Plugin } from "@kilocode/plugin"

// ==============================================================================
// Import from trueline-mcp hooks/core (source of truth)
// ==============================================================================

import {
  routePreToolUse,
  estimateEditTokenSavings,
  isPartialRead,
  canonicalToolName,
} from "../trueline-mcp/hooks/core/routing.js"

import { getInstructions } from "../trueline-mcp/hooks/core/instructions.js"

import { formatDecision } from "../trueline-mcp/hooks/core/formatters.js"

// ==============================================================================
// Kilo adaptations — patch routing.js for Kilo tool names
// ==============================================================================

// routing.js TOOL_ALIASES has "view" (OpenCode) but not "read" (Kilo).
// We patch the module's canonicalToolName to handle Kilo's "read" tool.
const KILO_ALIASES: Record<string, string> = { read: "Read", edit: "Edit" }

// Patch extractFilePath for Kilo — routing.js checks file_path, path, target_file
// but Kilo's view/read tool uses filePath (camelCase).
// We intercept the toolInput before passing to routePreToolUse.
function patchToolInput(toolName: string, args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!args) return args
  // If Kilo tool uses filePath but routing.js expects file_path, normalize it
  if (toolName === "read" && typeof args.filePath === "string" && typeof args.file_path !== "string") {
    return { ...args, file_path: args.filePath }
  }
  return args
}

// ==============================================================================
// Simple access checker — mirrors hooks/core/access.js without deny patterns
// ==============================================================================

import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve, sep, delimiter } from "node:path"

async function createAccessChecker(projectDir: string | undefined) {
  if (!projectDir) return async (_p: string, _t: string) => false
  let realBase: string
  try { realBase = await realpath(projectDir) } catch { return async () => false }

  const allowedBases = [realBase]
  if (process.env.CLAUDE_PROJECT_DIR) {
    try { allowedBases.push(await realpath(resolve(homedir(), ".claude"))) } catch {}
  }
  // Kilo/OpenCode config dirs
  for (const d of [resolve(homedir(), ".kilo"), resolve(homedir(), ".config", "kilo"),
                   resolve(homedir(), ".opencode"), resolve(homedir(), ".config", "opencode")]) {
    try { allowedBases.push(await realpath(d)) } catch {}
  }
  const extra = process.env.TRUELINE_ALLOWED_DIRS
  if (extra) {
    for (const raw of extra.split(delimiter).filter(Boolean)) {
      try { allowedBases.push(await realpath(raw)) } catch {}
    }
  }

  return async (filePath: string, _toolName: string): Promise<boolean> => {
    const resolved = filePath.startsWith("/") ? filePath : resolve(projectDir!, filePath)
    let realPath: string
    try { realPath = await realpath(resolved) } catch { return false }
    return allowedBases.some((base) => realPath === base || realPath.startsWith(base + sep))
  }
}

// ==============================================================================
// Plugin
// ==============================================================================

export const TruelinePlugin: Plugin = async (ctx) => {
  const canAccess = await createAccessChecker(ctx.directory)

  return {
    // Inject trueline instructions (from hooks/core/instructions.js)
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(getInstructions("opencode"))
    },

    // Append trueline hints to built-in tool descriptions
    "tool.definition": async (input, output) => {
      if (input.toolID === "read" || input.toolID === "view") {
        output.description +=
          "\n[PREFER trueline_outline for structure exploration, " +
          "trueline_read for reading with checksums for editing. " +
          "Only use this tool for files under ~50 lines.]"
      }
      if (input.toolID === "edit") {
        output.description +=
          "\n[PREFER trueline_edit for hash-verified edits. " +
          "Use trueline_search to find edit targets with checksums first. " +
          "Only use this tool for small files under ~200 lines.]"
      }
    },

    // Intercept built-in read/edit (mirrors Claude Code PreToolUse hook)
    "tool.execute.before": async (input, output) => {
      // Normalize Kilo tool names to canonical
      const toolName = KILO_ALIASES[input.tool] ?? input.tool
      const args = patchToolInput(input.tool, output.args)

      // Use trueline-mcp's routing logic
      const routing = await routePreToolUse(toolName, args, canAccess)
      if (!routing) return

      // Use trueline-mcp's formatter for opencode platform
      const decision = formatDecision("opencode", routing)
      if (!decision) return

      if (routing.action === "block") {
        throw new Error(routing.reason)
      }
    },
  }
}
