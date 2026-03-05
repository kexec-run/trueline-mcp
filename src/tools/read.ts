// ==============================================================================
// trueline_read handler
//
// Streams the file line-by-line via `splitLines` — the file is never loaded
// into memory as a whole.  Lines before `start_line` are counted and skipped;
// lines after `end_line` stop the stream early.  Each line is decoded to a JS
// string (required for the trueline output format), hashed with `fnv1aHash`,
// and formatted as `lineNumber:hash|content`.
// ==============================================================================

import { splitLines } from "../line-splitter.ts";
import { EMPTY_FILE_CHECKSUM, FNV_OFFSET_BASIS, fnv1aHash, foldHash, formatChecksum, hashToLetters } from "../hash.ts";
import { validatePath } from "./shared.ts";
import { errorResult, type ToolResult, textResult } from "./types.ts";

interface ReadParams {
  file_path: string;
  start_line?: number;
  end_line?: number;
  projectDir?: string;
  allowedDirs?: string[];
}

export async function handleRead(params: ReadParams): Promise<ToolResult> {
  const { file_path, start_line, end_line, projectDir, allowedDirs } = params;

  const validated = await validatePath(file_path, "Read", projectDir, allowedDirs);
  if (!validated.ok) return validated.error;

  const { resolvedPath } = validated;

  const start = start_line ?? 1;
  if (start < 1) {
    return errorResult(`start_line ${start} must be >= 1`);
  }
  if (end_line !== undefined && end_line < start) {
    return errorResult(`end_line ${end_line} must be >= start_line ${start}`);
  }

  const end = end_line ?? Infinity;
  const outputParts: string[] = [];
  let checksumHash = FNV_OFFSET_BASIS;
  let lastLineNo = 0;
  let totalLines = 0;

  try {
    for await (const { lineBytes, lineNumber } of splitLines(resolvedPath, { detectBinary: true })) {
      totalLines = lineNumber;

      if (lineNumber < start) continue;
      if (lineNumber > end) break;

      lastLineNo = lineNumber;
      const line = lineBytes.toString("utf-8");
      const h = fnv1aHash(line);
      checksumHash = foldHash(checksumHash, h);

      outputParts.push(`${lineNumber}:${hashToLetters(h)}|${line}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("binary")) {
      return errorResult(`"${file_path}" appears to be a binary file`);
    }
    throw err;
  }

  // Empty file
  if (totalLines === 0) {
    return textResult(`(empty file)\n\nchecksum: ${EMPTY_FILE_CHECKSUM}`);
  }

  // start_line out of range
  if (start > totalLines) {
    return errorResult(`start_line ${start} out of range (file has ${totalLines} lines)`);
  }

  const checksum = formatChecksum(start, lastLineNo, checksumHash);
  return textResult(`${outputParts.join("\n")}\n\nchecksum: ${checksum}`);
}
