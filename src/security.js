import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ==============================================================================
// Module-level caches
// ==============================================================================

// Settings cache: keyed by file path, stores the last-seen mtime and parsed
// globs. Avoids re-reading and re-parsing settings.json on every tool call.
/** @type {Map<string, { mtime: number; globs: string[] | null }>} */
const settingsCache = new Map();

// Regex cache: keyed by "glob:caseInsensitive", avoids re-compiling the same
// pattern on every evaluateFilePath call.
/** @type {Map<string, RegExp>} */
const regexCache = new Map();

/**
 * Clear internal caches. Exported for testing only.
 */
export function clearCaches() {
  settingsCache.clear();
  regexCache.clear();
}

// ==============================================================================
// Pattern Parsing
// ==============================================================================

/**
 * Parse any tool permission pattern like "ToolName(glob)".
 * Returns { tool, glob } or null if not a valid pattern.
 * @param {string} pattern
 * @returns {{ tool: string; glob: string } | null}
 */
export function parseToolPattern(pattern) {
  // .+ is greedy: for "Read(some(path))" it captures "some(path)"
  // because $ forces the final \) to match only the last paren.
  const match = pattern.match(/^(\w+)\((.+)\)$/);
  return match ? { tool: match[1], glob: match[2] } : null;
}

// ==============================================================================
// Glob-to-Regex Conversion
// ==============================================================================

/**
 * Convert a file path glob to a regex.
 *
 * - `**` matches any number of path segments (including zero)
 * - `*` matches anything except path separators
 * - `?` matches a single non-separator character
 * - Paths are matched with forward slashes (callers normalize first)
 *
 * @param {string} glob
 * @param {boolean} [caseInsensitive=false]
 * @returns {RegExp}
 */
export function fileGlobToRegex(glob, caseInsensitive = false) {
  const cacheKey = `${glob}:${caseInsensitive}`;
  const cached = regexCache.get(cacheKey);
  if (cached) return cached;

  // Collapse consecutive globstars ("**/**/**/") into a single "**/" to
  // prevent exponential backtracking — each `**/` becomes `(.*/)?` in the
  // regex, and multiple adjacent groups cause catastrophic backtracking.
  glob = glob.replace(/(\*\*\/)+/g, "**/");

  // Tokenize the glob: match globstar+slash, globstar, single-star, question
  // mark, or a run of literal characters — then map each token to its regex.
  const regexStr = glob.replace(/\*\*\/|\*\*|\*|\?|[^*?]+/g, (token, offset) => {
    const atBoundary = offset === 0 || glob[offset - 1] === "/";
    switch (token) {
      case "**/":
        return atBoundary ? "(.*/)?" : "[^/]*/";
      case "**":
        return atBoundary ? ".*" : "[^/]*";
      case "*":
        return "[^/]*";
      case "?":
        return "[^/]";
      default:
        return token.replace(/[.+^${}()|[\]\\/-]/g, "\\$&");
    }
  });

  const re = new RegExp(`^${regexStr}$`, caseInsensitive ? "i" : "");
  regexCache.set(cacheKey, re);
  return re;
}

// ==============================================================================
// Settings Reader
// ==============================================================================

/**
 * Read deny patterns for a specific tool from the 3-tier settings files.
 *
 * Returns an array of arrays (one per settings file found, in precedence
 * order). Each inner array contains the extracted glob strings.
 *
 * Precedence order (most local first):
 *   1. .claude/settings.local.json  (project-local)
 *   2. .claude/settings.json        (project-shared)
 *   3. ~/.claude/settings.json      (global)
 *
 * @param {string} toolName
 * @param {string} [projectDir]
 * @param {string} [globalSettingsPath]
 * @returns {Promise<string[][]>}
 */
export async function readToolDenyPatterns(toolName, projectDir, globalSettingsPath) {
  /** @param {string} path @returns {Promise<string[] | null>} */
  const extractGlobs = async (path) => {
    const cacheKey = `${path}:${toolName}`;
    // Check mtime — if unchanged since last call, return cached result.
    /** @type {number} */
    let mtime;
    try {
      mtime = (await stat(path)).mtimeMs;
    } catch {
      return null;
    }

    const cached = settingsCache.get(cacheKey);
    if (cached && cached.mtime === mtime) return cached.globs;

    // Read and parse in one step — both failures mean "no usable data".
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path, "utf-8"));
    } catch {
      settingsCache.set(cacheKey, { mtime, globs: null });
      return null;
    }

    // Extract globs for the target tool from permissions.deny.
    const obj =
      typeof parsed === "object" && parsed !== null ? /** @type {Record<string, unknown>} */ (parsed) : undefined;
    const perms =
      typeof obj?.permissions === "object" && obj.permissions !== null
        ? /** @type {Record<string, unknown>} */ (obj.permissions)
        : undefined;
    const denyArr = perms?.deny;
    /** @type {string[]} */
    const globs = [];
    if (Array.isArray(denyArr)) {
      for (const entry of denyArr) {
        if (typeof entry !== "string") continue;
        const tp = parseToolPattern(entry);
        if (tp?.tool === toolName) globs.push(tp.glob);
      }
    }
    settingsCache.set(cacheKey, { mtime, globs });
    return globs;
  };

  /** @type {string[]} */
  const paths = [];
  if (projectDir) {
    paths.push(resolve(projectDir, ".claude", "settings.local.json"));
    paths.push(resolve(projectDir, ".claude", "settings.json"));
  }
  paths.push(globalSettingsPath ?? resolve(homedir(), ".claude", "settings.json"));

  // Read all settings files in parallel — they're independent.
  const allGlobs = await Promise.all(paths.map(extractGlobs));
  return allGlobs.filter((g) => g !== null);
}

// ==============================================================================
// File Path Evaluation
// ==============================================================================

/**
 * Check if a file path should be denied based on deny globs.
 *
 * Normalizes backslashes to forward slashes before matching so that
 * Windows paths work with Unix-style glob patterns.
 *
 * @param {string} filePath
 * @param {string[][]} denyGlobs
 * @param {boolean} [caseInsensitive]
 * @returns {{ denied: boolean; matchedPattern?: string }}
 */
export function evaluateFilePath(filePath, denyGlobs, caseInsensitive = process.platform === "win32") {
  const normalized = filePath.replace(/\\/g, "/");
  // For globs without path separators, also test just the basename so that
  // a simple pattern like ".env" matches "/any/path/.env" — the same
  // gitignore-style semantics Claude Code settings use.
  const basename = normalized.split("/").pop() ?? normalized;

  /** @param {string} glob @returns {boolean} */
  const matches = (glob) => {
    const re = fileGlobToRegex(glob, caseInsensitive);
    if (re.test(normalized)) return true;

    // Glob without "/" — also test the basename (gitignore semantics).
    if (!glob.includes("/")) return re.test(basename);

    // Relative glob with "/" — treat as a suffix match via globstar prefix.
    // e.g. deny pattern "src/.env" should match "/project/src/.env".
    if (!glob.startsWith("/") && !glob.startsWith("*")) {
      return fileGlobToRegex(`**/${glob}`, caseInsensitive).test(normalized);
    }

    return false;
  };

  const matchedPattern = denyGlobs.flat().find(matches);
  return matchedPattern ? { denied: true, matchedPattern } : { denied: false };
}
