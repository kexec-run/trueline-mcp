// Parameter aliases: common alternative names → canonical schema names.
// Only alias-map when the canonical key was NOT explicitly provided,
// so an agent that sends both `paths` and `file_paths` keeps the canonical one.
const PARAM_ALIASES: Record<string, string> = {
  // file_path (singular)
  path: "file_path",
  filePath: "file_path",
  file: "file_path",

  // file_paths (plural)
  paths: "file_paths",
  filePaths: "file_paths",
  files: "file_paths",

  // compare_against (trueline_diff)
  ref: "compare_against",
};

/**
 * Preprocess MCP tool parameters to be more permissive about what agents send:
 *
 * 1. **Alias mapping** — `paths` → `file_paths`, `path` → `file_path`, etc.
 * 2. **Stringified JSON** — `"[1,2]"` → `[1,2]` (arrays and objects)
 * 3. **Stringified booleans** — `"true"` → `true`, `"false"` → `false`
 *
 * Runs as a `z.preprocess` step before Zod validation.
 */
export function coerceParams(val: unknown): unknown {
  if (typeof val !== "object" || val === null) return val;
  const raw = val as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const canonicalKey = PARAM_ALIASES[key] ?? key;

    // Don't overwrite a canonical key that was explicitly provided
    if (canonicalKey !== key && canonicalKey in raw) continue;

    // Coerce stringified JSON arrays/objects
    if (typeof value === "string" && (value.startsWith("[") || value.startsWith("{"))) {
      try {
        result[canonicalKey] = JSON.parse(value);
        continue;
      } catch {
        // not valid JSON, fall through
      }
    }

    // Coerce stringified booleans
    if (value === "true") {
      result[canonicalKey] = true;
      continue;
    }
    if (value === "false") {
      result[canonicalKey] = false;
      continue;
    }

    result[canonicalKey] = value;
  }

  return result;
}
