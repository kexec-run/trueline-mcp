// ==============================================================================
// Shared byte-level line splitter
//
// Single source of truth for CR/LF/CRLF line splitting.  Streams the file
// from disk as raw bytes, yielding one RawLine per line.  Both trueline_read
// and the streaming edit engine wrap this generator with their specific needs.
//
// Binary detection (null-byte scan) is essentially free during the byte scan
// for line terminators, so it's offered as an opt-in flag rather than forcing
// each caller to implement it separately.
// ==============================================================================

import { createReadStream } from "node:fs";

// ==============================================================================
// Public types and constants
// ==============================================================================

export interface RawLine {
  lineBytes: Buffer; // line content without EOL
  eolBytes: Buffer; // LF_BUF | CRLF_BUF | CR_BUF | EMPTY_BUF
  lineNumber: number; // 1-based
}

export const LF_BUF = Buffer.from("\n");
export const CRLF_BUF = Buffer.from("\r\n");
export const CR_BUF = Buffer.from("\r");
export const EMPTY_BUF = Buffer.alloc(0);

// ==============================================================================
// Core line-splitting generator
// ==============================================================================

/**
 * Stream lines from a file as raw Buffers without decoding to JS strings.
 *
 * Yields one `RawLine` per line: the raw line bytes (no EOL), the EOL
 * bytes (LF / CRLF / CR / empty for last line without trailing newline),
 * and the 1-based line number.  Handles `\r\n` pairs split across chunk
 * boundaries correctly.
 *
 * When `detectBinary` is true, throws if a null byte (0x00) is encountered.
 * This check is essentially free during the byte scan for line terminators.
 */
export async function* splitLines(filePath: string, opts?: { detectBinary?: boolean }): AsyncGenerator<RawLine> {
  const detectBinary = opts?.detectBinary ?? false;
  const stream = createReadStream(filePath);
  let partials: Buffer[] = [];
  let partialsLen = 0;
  let lineNumber = 0;
  let prevChunkEndedWithCR = false;

  for await (const rawChunk of stream) {
    const buf: Buffer = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    let lineStart = 0;

    // If the previous chunk ended with \r, resolve whether it's \r\n or bare \r.
    if (prevChunkEndedWithCR) {
      prevChunkEndedWithCR = false;
      const eol = buf.length > 0 && buf[0] === 0x0a ? CRLF_BUF : CR_BUF;
      if (eol === CRLF_BUF) lineStart = 1;
      lineNumber++;
      yield {
        lineBytes: flushPartials(partials, partialsLen),
        eolBytes: eol,
        lineNumber,
      };
      partials = [];
      partialsLen = 0;
    }

    for (let i = lineStart; i < buf.length; i++) {
      const byte = buf[i];

      // Binary detection: null bytes have no place in a text file.
      if (detectBinary && byte === 0x00) {
        stream.destroy();
        throw new Error("File appears to be binary (contains null bytes)");
      }

      const isCR = byte === 0x0d;
      const isLF = byte === 0x0a;

      if (!isCR && !isLF) continue;

      // ============================================================
      // Found a line terminator — accumulate content and emit.
      // ============================================================
      const slice = buf.subarray(lineStart, i);

      // Determine EOL type.
      let eol: Buffer;
      if (isCR) {
        const nextIndex = i + 1;
        if (nextIndex < buf.length) {
          // \r\n within the same chunk — skip the \n.
          if (buf[nextIndex] === 0x0a) {
            eol = CRLF_BUF;
            i++;
          } else {
            eol = CR_BUF;
          }
        } else {
          // \r at chunk boundary — defer until next chunk.
          partials.push(slice);
          partialsLen += slice.length;
          prevChunkEndedWithCR = true;
          lineStart = i + 1;
          continue;
        }
      } else {
        eol = LF_BUF;
      }

      // Emit the line.
      lineNumber++;
      if (partialsLen > 0) {
        partials.push(slice);
        yield {
          lineBytes: flushPartials(partials, partialsLen + slice.length),
          eolBytes: eol,
          lineNumber,
        };
        partials = [];
        partialsLen = 0;
      } else {
        yield { lineBytes: slice, eolBytes: eol, lineNumber };
      }

      lineStart = i + 1;
    }

    // Remaining bytes from this chunk become partial.
    if (lineStart < buf.length) {
      partials.push(buf.subarray(lineStart));
      partialsLen += buf.length - lineStart;
    }
  }

  // Final content: pending CR at EOF or leftover partials (no trailing newline).
  if (prevChunkEndedWithCR || partialsLen > 0) {
    lineNumber++;
    yield {
      lineBytes: flushPartials(partials, partialsLen),
      eolBytes: prevChunkEndedWithCR ? CR_BUF : EMPTY_BUF,
      lineNumber,
    };
  }
}

function flushPartials(partials: Buffer[], totalLen: number): Buffer {
  if (partials.length === 0) return EMPTY_BUF;
  if (partials.length === 1) return partials[0];
  return Buffer.concat(partials, totalLen);
}
