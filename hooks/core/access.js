// ==============================================================================
// File Access Checking
// ==============================================================================
//
// Generalized version of truelineCanAccess — determines whether trueline can
// serve a given file path. Mirrors the containment + deny-pattern checks in
// src/tools/shared.ts. Platform-agnostic: caller passes the project directory.

import { resolve, sep, delimiter } from "node:path";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { readToolDenyPatterns, evaluateFilePath } from "../../src/security.js";

/**
 * Create an access-checker function bound to a project directory.
 * Pre-resolves allowed directories once, then returns a fast async checker.
 *
 * @param {string | undefined} projectDir
 * @returns {Promise<(filePath: string, toolName: string) => Promise<boolean>>}
 */
export async function createAccessChecker(projectDir) {
  if (!projectDir) return async () => false;

  let realBase;
  try {
    realBase = await realpath(projectDir);
  } catch {
    return async () => false;
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

  /**
   * @param {string} filePath
   * @param {string} toolName - "Read" or "Edit"
   * @returns {Promise<boolean>}
   */
  return async function canAccess(filePath, toolName) {
    const resolvedPath = filePath.startsWith("/") ? filePath : resolve(projectDir, filePath);

    let realPath;
    try {
      realPath = await realpath(resolvedPath);
    } catch {
      return false;
    }

    const isContained = allowedBases.some((base) => realPath === base || realPath.startsWith(base + sep));
    if (!isContained) return false;

    // Check deny patterns for this tool.
    const denyGlobs = await readToolDenyPatterns(toolName, projectDir);
    const { denied } = evaluateFilePath(realPath, denyGlobs);
    return !denied;
  };
}
