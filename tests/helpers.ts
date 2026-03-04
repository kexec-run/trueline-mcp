import {
  FNV_OFFSET_BASIS,
  foldHash,
  fnv1aHash,
  formatChecksum,
} from "../src/trueline.ts";

/**
 * Compute a read-range checksum over a slice of file lines.
 *
 * Test-only helper — production code computes checksums inline during
 * streaming reads. Tests need a standalone version to fabricate valid
 * checksum strings for `handleEdit` / `handleDiff` inputs.
 */
export function rangeChecksum(
  lines: string[],
  startLine: number,
  endLine: number,
): string {
  let hash = FNV_OFFSET_BASIS;
  const effectiveEnd = Math.min(endLine, lines.length);
  for (let i = startLine - 1; i < effectiveEnd; i++) {
    hash = foldHash(hash, fnv1aHash(lines[i]));
  }
  return formatChecksum(startLine, effectiveEnd, hash);
}
