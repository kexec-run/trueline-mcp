// ==============================================================================
// Protocol-format parsing
// ==============================================================================

interface LineRef {
  line: number;
  hash: string;
}

/**
 * Parse a `line:hash` reference string like "4:mp".
 *
 * Special case: "0:" is valid (insert at file start, empty hash).
 * Throws on invalid format.
 */
function parseLineHash(ref: string): LineRef {
  const colonIdx = ref.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(`Invalid line:hash reference "${ref}" — missing colon`);
  }

  const lineStr = ref.slice(0, colonIdx);
  const hash = ref.slice(colonIdx + 1);

  // Reject non-decimal strings before Number() conversion. Without this,
  // Number("") === 0 and Number(" ") === 0 would silently parse as line 0.
  if (!/^\d+$/.test(lineStr)) {
    throw new Error(
      `Invalid line number in "${ref}" — must be a non-negative integer`,
    );
  }

  const line = Number(lineStr);

  if (!Number.isInteger(line) || line < 0) {
    throw new Error(
      `Invalid line number in "${ref}" — must be a non-negative integer`,
    );
  }

  // "0:" is allowed (insert at start) and must have an empty hash.
  if (line === 0 && hash !== "") {
    throw new Error(
      `Invalid line:hash reference "${ref}" — line 0 must have empty hash`,
    );
  }
  if (line > 0 && !/^[a-z]{2}$/.test(hash)) {
    throw new Error(
      `Invalid hash in "${ref}" — must be exactly 2 lowercase letters`,
    );
  }

  return { line, hash };
}

interface RangeRef {
  start: LineRef;
  end: LineRef;
}

/**
 * Parse a range string into start/end LineRefs.
 *
 * Accepts two forms:
 *   - "12:gh..21:yz"  — explicit start..end range
 *   - "5:ab"          — single-line shorthand, equivalent to "5:ab..5:ab"
 *
 * Throws on invalid format or if start line > end line.
 */
export function parseRange(range: string): RangeRef {
  const dotIdx = range.indexOf("..");
  if (dotIdx === -1) {
    // Single line:hash — treat as a self-range (start == end)
    const ref = parseLineHash(range);
    return { start: ref, end: { ...ref } };
  }

  const startStr = range.slice(0, dotIdx);
  const endStr = range.slice(dotIdx + 2);

  const start = parseLineHash(startStr);
  const end = parseLineHash(endStr);

  if (start.line > end.line) {
    throw new Error(
      `Invalid range "${range}" — start line ${start.line} must be ≤ end line ${end.line}`,
    );
  }

  return { start, end };
}

export interface ChecksumRef {
  startLine: number;
  endLine: number;
  hash: string;
}

/**
 * Parse a checksum string like "10-25:f7e2" from trueline_read.
 *
 * Format: "<startLine>-<endLine>:<8hex>"
 * Throws on invalid format.
 */
export function parseChecksum(checksum: string): ChecksumRef {
  const dashIdx = checksum.indexOf("-");
  if (dashIdx === -1) {
    throw new Error(
      `Invalid checksum "${checksum}" — expected format "startLine-endLine:hex"`,
    );
  }

  const colonIdx = checksum.indexOf(":", dashIdx);
  if (colonIdx === -1) {
    throw new Error(
      `Invalid checksum "${checksum}" — expected format "startLine-endLine:hex"`,
    );
  }

  // Validate that start/end are plain decimal integers before converting to
  // Number. Without this, "1e2-3:..." would parse as startLine=100 because
  // Number("1e2") === 100, silently accepting scientific notation.
  if (!/^\d+$/.test(checksum.slice(0, dashIdx))) {
    throw new Error(`Invalid checksum "${checksum}" — start line must be a decimal integer`);
  }
  if (!/^\d+$/.test(checksum.slice(dashIdx + 1, colonIdx))) {
    throw new Error(`Invalid checksum "${checksum}" — end line must be a decimal integer`);
  }

  const startLine = Number(checksum.slice(0, dashIdx));
  const endLine = Number(checksum.slice(dashIdx + 1, colonIdx));
  const hash = checksum.slice(colonIdx + 1);

  // "0-0:..." is the empty-file sentinel; validate it specially.
  const isEmpty = startLine === 0 && endLine === 0;
  if (startLine === 0 && endLine !== 0) {
    throw new Error(
      `Invalid checksum "${checksum}" — startLine 0 requires endLine 0`,
    );
  }
  if (!isEmpty) {
    if (!Number.isInteger(startLine) || startLine < 1) {
      throw new Error(`Invalid checksum "${checksum}" — bad start line`);
    }
    if (!Number.isInteger(endLine) || endLine < 1) {
      throw new Error(`Invalid checksum "${checksum}" — bad end line`);
    }
    if (startLine > endLine) {
      throw new Error(
        `Invalid checksum "${checksum}" — start ${startLine} must be ≤ end ${endLine}`,
      );
    }
  }
  if (!/^[0-9a-f]{8}$/.test(hash)) {
    throw new Error(
      `Invalid checksum "${checksum}" — hash must be 8 hex chars, got "${hash}"`,
    );
  }

  return { startLine, endLine, hash };
}
