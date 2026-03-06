import { unlink } from "node:fs/promises";
import { relative } from "node:path";
import { DiffCollector } from "../diff-collector.ts";
import { streamingEdit } from "../streaming-edit.ts";
import { type EditInput, validateEdits, validateEncoding, validatePath } from "./shared.ts";
import { errorResult, type ToolResult, textResult } from "./types.ts";

interface DiffParams {
  file_path: string;
  encoding?: string;
  edits: EditInput[];
  projectDir?: string;
  allowedDirs?: string[];
}

export async function handleDiff(params: DiffParams): Promise<ToolResult> {
  const { file_path, edits, projectDir, allowedDirs } = params;

  // Diff uses Read deny patterns (not Edit) because diff is a read-only preview
  // operation — if you cannot read a file, you should not be able to diff it either.
  // A file that is deny-listed for Edit but allowed for Read can still be diffed;
  // the deny only blocks the actual write in trueline_edit.
  const validated = await validatePath(file_path, "Read", projectDir, allowedDirs);
  if (!validated.ok) return validated.error;

  let enc: BufferEncoding;
  try {
    enc = validateEncoding(params.encoding);
  } catch (err: unknown) {
    return errorResult((err as Error).message);
  }

  const { resolvedPath, mtimeMs } = validated;

  const built = validateEdits(edits);
  if (!built.ok) return built.error;

  const collector = new DiffCollector();
  const result = await streamingEdit(resolvedPath, built.ops, built.checksumRefs, mtimeMs, true, enc, collector);

  if (!result.ok) {
    return errorResult(result.error);
  }

  if (!result.changed) {
    return textResult("(no changes)");
  }

  // Use the resolved path relative to the project root so diff headers
  // show a meaningful path rather than just the basename.
  const relPath = file_path.startsWith("/") ? relative(projectDir ?? process.cwd(), resolvedPath) : file_path;

  const diff = collector.format(`a/${relPath}`, `b/${relPath}`);

  // Clean up the temp file from the dry-run
  if (result.tmpPath) {
    try {
      await unlink(result.tmpPath);
    } catch {
      /* best-effort */
    }
  }

  return textResult(diff);
}
