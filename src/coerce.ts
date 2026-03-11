// Parameter aliases: common alternative names → canonical schema names.
// Only alias-map when the canonical key was NOT explicitly provided,
// so an agent that sends both `paths` and `file_paths` keeps the canonical one.
const PARAM_ALIASES: Record<string, string> = {
  // file_paths is canonical everywhere; singular forms are aliases
  file_path: "file_paths",
  path: "file_paths",
  filePath: "file_paths",
  file: "file_paths",
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

  // Normalize file_paths: bare string → single-element array
  if (typeof result.file_paths === "string") {
    result.file_paths = [result.file_paths];
  }

  // Push top-level checksum into edits that are missing one.
  // Models sometimes pass {checksum: "...", edits: [{range, content}]}
  // instead of {edits: [{range, content, checksum: "..."}]}.
  if (typeof result.checksum === "string" && Array.isArray(result.edits)) {
    for (const edit of result.edits) {
      if (typeof edit === "object" && edit !== null && !("checksum" in edit)) {
        (edit as Record<string, unknown>).checksum = result.checksum;
      }
    }
    delete result.checksum;
  }

  return result;
}
