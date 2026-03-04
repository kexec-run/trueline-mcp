
// ==============================================================================
// FNV-1a Hash
// ==============================================================================

export const FNV_OFFSET_BASIS = 2166136261;
export const FNV_PRIME = 16777619;

/** Sentinel checksum representing an empty file (zero lines). */
export const EMPTY_FILE_CHECKSUM = "0-0:00000000";

/**
 * Compute FNV-1a 32-bit hash of a string's UTF-8 bytes.
 *
 * FNV-1a is a fast, non-cryptographic hash with good distribution.
 * We use it because the vscode-hashline-edit-tool spec chose
 * it, and matching the spec means interoperability with other tools.
 *
 * Encodes UTF-8 inline to avoid per-call Buffer allocation.
 */
export function fnv1aHash(line: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < line.length; i++) {
    let cp = line.charCodeAt(i);

    // Handle surrogate pairs (codepoints > 0xFFFF)
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < line.length) {
      const lo = line.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = ((cp - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
        i++;
      }
    }

    // Encode codepoint as UTF-8 bytes, feeding each to FNV-1a
    if (cp < 0x80) {
      hash = Math.imul(hash ^ cp, FNV_PRIME) >>> 0;
    } else if (cp < 0x800) {
      hash = Math.imul(hash ^ (0xc0 | (cp >> 6)), FNV_PRIME) >>> 0;
      hash = Math.imul(hash ^ (0x80 | (cp & 0x3f)), FNV_PRIME) >>> 0;
    } else if (cp < 0x10000) {
      hash = Math.imul(hash ^ (0xe0 | (cp >> 12)), FNV_PRIME) >>> 0;
      hash = Math.imul(hash ^ (0x80 | ((cp >> 6) & 0x3f)), FNV_PRIME) >>> 0;
      hash = Math.imul(hash ^ (0x80 | (cp & 0x3f)), FNV_PRIME) >>> 0;
    } else {
      hash = Math.imul(hash ^ (0xf0 | (cp >> 18)), FNV_PRIME) >>> 0;
      hash = Math.imul(hash ^ (0x80 | ((cp >> 12) & 0x3f)), FNV_PRIME) >>> 0;
      hash = Math.imul(hash ^ (0x80 | ((cp >> 6) & 0x3f)), FNV_PRIME) >>> 0;
      hash = Math.imul(hash ^ (0x80 | (cp & 0x3f)), FNV_PRIME) >>> 0;
    }
  }

  return hash >>> 0;
}

/**
 * Fold a 32-bit line hash into a running checksum accumulator.
 *
 * Feeds all 4 bytes of `h` (little-endian) into the FNV-1a accumulator.
 * This is the core building block for streaming checksum computation
 * in `handleRead`.
 */
export function foldHash(accumulator: number, h: number): number {
  accumulator = Math.imul(accumulator ^ (h & 0xff),          FNV_PRIME) >>> 0;
  accumulator = Math.imul(accumulator ^ ((h >>> 8) & 0xff),  FNV_PRIME) >>> 0;
  accumulator = Math.imul(accumulator ^ ((h >>> 16) & 0xff), FNV_PRIME) >>> 0;
  accumulator = Math.imul(accumulator ^ ((h >>> 24) & 0xff), FNV_PRIME) >>> 0;
  return accumulator;
}

/** Format a checksum as `"<start>-<end>:<8hex>"`. */
export function formatChecksum(startLine: number, endLine: number, hash: number): string {
  return `${startLine}-${endLine}:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Compute 2-letter content hash for a line.
 *
 * Maps FNV-1a output to two lowercase ASCII letters (676 possible values).
 * Matches the vscode-hashline-edit-tool spec:
 *   letter1 = (hash_value % 26) → 'a'..'z'
 *   letter2 = ((hash_value >> 8) % 26) → 'a'..'z'
 */
export function lineHash(line: string): string {
  const h = fnv1aHash(line);
  const c1 = String.fromCharCode(97 + (h % 26));
  const c2 = String.fromCharCode(97 + ((h >>> 8) % 26));
  return c1 + c2;
}

// ==============================================================================
// Parsing
// ==============================================================================

export interface LineRef {
  line: number;
  hash: string;
}

/**
 * Parse a `line:hash` reference string like "4:mp".
 *
 * Special case: "0:" is valid (insert at file start, empty hash).
 * Throws on invalid format.
 */
export function parseLineHash(ref: string): LineRef {
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

export interface RangeRef {
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

// ==============================================================================
// Edit Application
// ==============================================================================

export interface EditOp {
  startLine: number; // 1-based (0 for insertAfter at file start)
  endLine: number; // 1-based, inclusive
  content: string[]; // array of lines, no EOL chars
  insertAfter: boolean;
}

/**
 * Apply a batch of edits to a single file.
 *
 * Edits are sorted by line number descending so that earlier line
 * numbers remain valid as later lines are modified. Returns the
 * new lines array — callers join with the appropriate EOL for their
 * context (file write vs diff preview).
 *
 * Uses `slice().concat()` instead of `splice(...spread)` to avoid
 * V8's ~65 536 function-argument limit when inserting large blocks.
 *
 * @param fileLines - Current file lines (0-indexed array)
 * @param ops - Parsed and verified edit operations
 * @returns New file lines array
 */
export function applyEdits(fileLines: string[], ops: EditOp[]): string[] {
  // Sort descending by start line so edits don't shift earlier positions.
  // For insertAfter ops at the same anchor, reverse their sub-order so that
  // when applied back-to-front each new block lands after the anchor but
  // before the previously inserted block — preserving input order in the
  // final file.
  //
  // The comparator is stable because we break ties with the original input
  // index, avoiding undefined behavior from a non-transitive comparator.
  const indexed = ops.map((op, i) => ({ op, i }));
  indexed.sort((a, b) => {
    const aLine = a.op.startLine;
    const bLine = b.op.startLine;
    if (bLine !== aLine) return bLine - aLine;
    // Same anchor: insertAfter ops go before replace ops in back-to-front pass
    if (a.op.insertAfter !== b.op.insertAfter) return a.op.insertAfter ? -1 : 1;
    // Both insertAfter: reverse input order so they appear in input order after insertion
    if (a.op.insertAfter) return b.i - a.i;
    return a.i - b.i;
  });
  const sorted = indexed.map((x) => x.op);

  let result = fileLines.slice();

  for (const op of sorted) {
    // Copy to avoid mutating the input when the dedup logic trims trailing blanks.
    const newLines = [...op.content];

    if (op.insertAfter) {
      const afterLine = op.startLine; // 0-based insert index
      // Avoid double blank lines: if inserted content ends with an empty
      // line and the next existing line is also empty, drop the trailing
      // empty element to prevent a doubled gap.
      if (
        newLines.length > 1 &&
        newLines[newLines.length - 1] === "" &&
        afterLine < result.length &&
        result[afterLine] === ""
      ) {
        newLines.pop();
      }
      // Use concat instead of splice(...spread) to avoid V8 argument limit
      result = result.slice(0, afterLine).concat(newLines, result.slice(afterLine));
    } else {
      const firstIdx = op.startLine - 1;
      const span = op.endLine - op.startLine + 1;
      result = result.slice(0, firstIdx).concat(newLines, result.slice(firstIdx + span));
    }
  }

  return result;
}
