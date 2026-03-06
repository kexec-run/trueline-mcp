import { fileURLToPath } from "node:url";
import { resolve, sep, delimiter } from "node:path";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { readToolDenyPatterns, evaluateFilePath } from "../src/security.js";

/**
 * Check if trueline can access a file for the given tool.
 * Mirrors the containment + deny-pattern checks in src/tools/shared.ts.
 * @param {string} filePath
 * @param {string} toolName - "Read" or "Edit"
 * @returns {Promise<boolean>}
 */
async function truelineCanAccess(filePath, toolName) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) return false;

  const resolvedPath = filePath.startsWith("/") ? filePath : resolve(projectDir, filePath);

  let realPath;
  try {
    realPath = await realpath(resolvedPath);
  } catch {
    return false;
  }

  let realBase;
  try {
    realBase = await realpath(projectDir);
  } catch {
    return false;
  }

  // Build allowed dirs list (same logic as server.ts).
  const allowedBases = [realBase];
  try {
    allowedBases.push(await realpath(resolve(homedir(), ".claude")));
  } catch {}

  const extraDirs = process.env.TRUELINE_ALLOWED_DIRS;
  if (extraDirs) {
    for (const raw of extraDirs.split(delimiter).filter(Boolean)) {
      try {
        allowedBases.push(await realpath(raw));
      } catch {}
    }
  }

  const isContained = allowedBases.some((base) => realPath === base || realPath.startsWith(base + sep));
  if (!isContained) return false;

  // Check deny patterns for this tool.
  const denyGlobs = await readToolDenyPatterns(toolName, projectDir);
  const { denied } = evaluateFilePath(realPath, denyGlobs);
  return !denied;
}

/**
 * @param {{ tool_name: string; tool_input: Record<string, unknown> }} event
 * @returns {Promise<{ decision: string; reason?: string }>}
 */
export async function processHookEvent(event) {
  if (event.tool_name === "Edit" || event.tool_name === "MultiEdit") {
    const filePath = event.tool_input?.file_path;
    if (typeof filePath === "string") {
      const [canRead, canWrite] = await Promise.all([
        truelineCanAccess(filePath, "Read"),
        truelineCanAccess(filePath, "Edit"),
      ]);
      if (canRead && canWrite) {
        return {
          decision: "block",
          reason:
            "<trueline_redirect>" + "Edit is blocked. Use trueline_read then trueline_edit." + "</trueline_redirect>",
        };
      }
    }
    return { decision: "approve" };
  }

  if (event.tool_name === "Read") {
    const filePath = event.tool_input?.file_path;
    if (typeof filePath === "string") {
      const canRead = await truelineCanAccess(filePath, "Read");
      if (canRead) {
        return {
          decision: "block",
          reason:
            "<trueline_redirect>" +
            "Read is blocked for this file. Use trueline_read instead. " +
            "trueline_read returns per-line hashes and a checksum needed for trueline_edit." +
            "</trueline_redirect>",
        };
      }
    }
    return { decision: "approve" };
  }

  return { decision: "approve" };
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
