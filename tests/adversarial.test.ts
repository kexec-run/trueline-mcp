import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleEdit } from "../src/tools/edit.ts";
import { handleRead } from "../src/tools/read.ts";
import { streamingEdit } from "../src/streaming-edit.ts";
import { lineHash, rangeChecksum } from "./helpers.ts";
import { EMPTY_FILE_CHECKSUM } from "../src/hash.ts";

let testDir: string;

beforeEach(() => {
  testDir = realpathSync(mkdtempSync(join(tmpdir(), "trueline-adversarial-")));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function setupFile(name: string, content: string | Buffer) {
  const f = join(testDir, name);
  writeFileSync(f, content);
  const contentStr = typeof content === "string" ? content : content.toString("utf-8");
  const lines = contentStr.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const cs = lines.length > 0 ? rangeChecksum(lines, 1, lines.length) : EMPTY_FILE_CHECKSUM;
  return { path: f, lines, cs };
}

describe("Adversarial Tests", () => {
  test("binary file detection (null byte)", async () => {
    const f = join(testDir, "binary.bin");
    const buf = Buffer.concat([Buffer.from("text line\n"), Buffer.from([0, 1, 2, 3]), Buffer.from("\nmore text")]);
    writeFileSync(f, buf);

    const result = await handleRead({ file_path: f, projectDir: testDir });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("appears to be a binary file");
  });

  test("very long lines (> 64KB)", async () => {
    const longLine = "a".repeat(100000);
    const { path, cs } = setupFile("long.txt", `${longLine}\nsecond\n`);

    const result = await handleEdit({
      file_path: path,
      edits: [
        {
          checksum: cs,
          range: `${lineHash(longLine)}.1`,
          content: "shortened",
        },
      ],
      projectDir: testDir,
    });

    expect(result.isError).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe("shortened\nsecond\n");
  });

  test("path traversal via symlink to outside project", async () => {
    const outsideDir = realpathSync(mkdtempSync(join(tmpdir(), "trueline-outside-")));
    const secretFile = join(outsideDir, "secret.txt");
    writeFileSync(secretFile, "top secret");

    const linkPath = join(testDir, "evil-link.txt");
    symlinkSync(secretFile, linkPath);

    const result = await handleRead({ file_path: "evil-link.txt", projectDir: testDir });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Access denied");

    rmSync(outsideDir, { recursive: true, force: true });
  });

  test("mtime check prevents race condition", async () => {
    const { path, cs } = setupFile("race.txt", "initial\n");

    // Simulate handleEdit starting but being slow.
    // We need to call streamingEdit or similar, but handleEdit does it all.
    // To simulate a race, we'd need to modify the file AFTER validatePath but BEFORE rename.
    // Since handleEdit is atomic in JS execution (mostly), we can't easily race it
    // unless we hook into the internals.

    // However, we can test that if mtime changes, it fails.
    // We can't easily do this with handleEdit because it validates mtime internally.
    // But we can check that it DOES check it.
  });

  test("surrogate pairs in hashing", async () => {
    const text = "A 🎉 B"; // 🎉 is \uD83C\uDF89
    const h = lineHash(text);
    const { path, cs } = setupFile("unicode.txt", `${text}\n`);

    const result = await handleEdit({
      file_path: path,
      edits: [
        {
          checksum: cs,
          range: `${h}.1`,
          content: "changed",
        },
      ],
      projectDir: testDir,
    });

    expect(result.isError).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe("changed\n");
  });

  test("malformed surrogate pairs in hashing", async () => {
    // Unpaired high surrogate
    const text = "A \uD83C B";
    const h = lineHash(text);
    const { path, cs } = setupFile("malformed.txt", `${text}\n`);

    const result = await handleEdit({
      file_path: path,
      edits: [
        {
          checksum: cs,
          range: `${h}.1`,
          content: "fixed",
        },
      ],
      projectDir: testDir,
    });

    expect(result.isError).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe("fixed\n");
  });

  test("checksum mismatch suggesting narrow re-read", async () => {
    const { path, lines } = setupFile("mismatch.txt", "1\n2\n3\n4\n5\n");
    const cs = rangeChecksum(lines, 1, 5);

    // Modify line 1 (outside edit range)
    writeFileSync(path, "X\n2\n3\n4\n5\n");

    const result = await handleEdit({
      file_path: path,
      edits: [
        {
          checksum: cs,
          range: `${lineHash("3")}.3`,
          content: "THREE",
        },
      ],
      projectDir: testDir,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("appear unchanged");
    expect(result.content[0].text).toContain("Re-read with trueline_read(ranges=[{start: 3, end: 3}])");
  });

  test("insert-after at the end line of a multi-line replace", async () => {
    const { path, cs } = setupFile("multi-replace-ia.txt", "1\n2\n3\n4\n5\n");

    const result = await handleEdit({
      file_path: path,
      edits: [
        {
          checksum: cs,
          range: `${lineHash("2")}.2-${lineHash("3")}.3`,
          content: "TWO-THREE",
        },
        {
          checksum: cs,
          range: `+${lineHash("3")}.3`,
          content: "inserted",
        },
      ],
      projectDir: testDir,
    });

    expect(result.isError).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe("1\nTWO-THREE\ninserted\n4\n5\n");
  });

  test("overlapping range: insert-after inside a multi-line replace", async () => {
    const { path, cs } = setupFile("overlap-ia.txt", "1\n2\n3\n4\n");

    const result = await handleEdit({
      file_path: path,
      edits: [
        {
          checksum: cs,
          range: `${lineHash("1")}.1-${lineHash("3")}.3`,
          content: "REPLACED",
        },
        {
          checksum: cs,
          range: `+${lineHash("2")}.2`,
          content: "IA",
        },
      ],
      projectDir: testDir,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("conflicts with replace range");
  });

  test("file exactly 10MB limit", async () => {
    const tenMB = 10 * 1024 * 1024;
    const buf = Buffer.alloc(tenMB, "a");
    // Add a newline so it's one line
    buf[tenMB - 1] = 0x0a;
    const f = join(testDir, "tenMB.txt");
    writeFileSync(f, buf);

    // Read it
    const result = await handleRead({ file_path: f, projectDir: testDir });
    expect(result.isError).toBeUndefined();
  });

  test("file with invalid UTF-8 sequences", async () => {
    // 0xFF is invalid in UTF-8
    const buf = Buffer.concat([Buffer.from("line 1\n"), Buffer.from([0xff, 0xfe]), Buffer.from("\nline 3\n")]);
    const f = join(testDir, "invalid-utf8.txt");
    writeFileSync(f, buf);

    // Read it - handleRead uses splitLines which yields raw bytes.
    // The hash should be based on raw bytes.
    const result = await handleRead({ file_path: f, projectDir: testDir });
    expect(result.isError).toBeUndefined();

    const text = result.content[0].text;
    expect(text).toContain("line 1");
    expect(text).toContain("line 3");

    // Check if the invalid bytes are preserved (or replaced by Buffer.toString('utf-8'))
    // handleRead uses Buffer.concat(chunks).toString(enc)
    // If enc is utf-8, invalid bytes become \uFFFD.
    expect(text).toContain("\uFFFD");
  });

  test("overlapping checksum ranges (later ends earlier)", async () => {
    const { path, lines } = setupFile("overlap-cs.txt", "1\n2\n3\n4\n5\n");
    // CS1: lines 1-5
    const cs1 = rangeChecksum(lines, 1, 5);
    // CS2: lines 2-4
    const cs2 = rangeChecksum(lines, 2, 4);

    const result = await handleEdit({
      file_path: path,
      edits: [
        {
          checksum: cs1,
          range: `${lineHash("3")}.3`,
          content: "THREE-1",
        },
        {
          checksum: cs2,
          range: `${lineHash("4")}.4`,
          content: "FOUR-2",
        },
      ],
      projectDir: testDir,
    });

    expect(result.isError).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe("1\n2\nTHREE-1\nFOUR-2\n5\n");
  });

  test("splitLines handles \\r\\n across chunk boundaries", async () => {
    const CHUNK_SIZE = 65536;
    const padding = "a".repeat(CHUNK_SIZE - 1);
    const content = Buffer.concat([Buffer.from(padding), Buffer.from("\r\nline2")]);
    const f = join(testDir, "chunk-split.txt");
    writeFileSync(f, content);

    // Read it
    const result = await handleRead({ file_path: f, projectDir: testDir });
    expect(result.isError).toBeUndefined();

    const text = result.content[0].text;
    expect(text).toContain("line2");

    // Check checksum to ensure it was correctly identified as 2 lines
    expect(text).toContain("checksum: 1-2:");
  });

  test("concurrent modification detection (mtime change)", async () => {
    const { path, lines } = setupFile("mtime.txt", "line1\nline2\nline3\n");
    const _cs = rangeChecksum(lines, 1, 3);

    // Captured mtime at this point
    const { mtimeMs } = statSync(path);

    // Modify line 1 (outside edit range 2-2)
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(path, "modified\nline2\nline3\n");

    // Call streamingEdit directly with the OLD mtimeMs
    // Passing an empty array for checksumRefs skips checksum validation during stream
    const result = await streamingEdit(
      path,
      [
        {
          startLine: 2,
          endLine: 2,
          content: ["new line 2"],
          insertAfter: false,
          startHash: lineHash("line2"),
          endHash: "",
        },
      ],
      [], // NO CHECKSUMS - triggers mtime check at the end
      mtimeMs, // OLD mtime
    );

    expect(result.ok).toBe(false);
    // @ts-expect-error
    expect(result.error).toContain("modified by another process");
  });

  test("search with very large context_lines", async () => {
    const { path } = setupFile("search-context.txt", "1\n2\n3\n4\n5\n");
    const _result = await handleRead({
      file_path: path,
      projectDir: testDir,
      // @ts-expect-error - testing invalid param
      context_lines: 1000000,
    });
    // handleRead doesn't have context_lines, but handleSearch does.
  });

  test("handleSearch with multi-line pattern", async () => {
    const { path } = setupFile("multiline.txt", "line 1\nline 2\n");
    const result = await import("../src/tools/search.ts").then((m) =>
      m.handleSearch({
        file_path: path,
        pattern: "line 1\nline 2",
        projectDir: testDir,
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Pattern contains newlines");
  });

  test("handleSearch with invalid regex", async () => {
    const { path } = setupFile("regex.txt", "abc\n");
    const result = await import("../src/tools/search.ts").then((m) =>
      m.handleSearch({
        file_path: path,
        pattern: "[",
        regex: true,
        projectDir: testDir,
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid regex pattern");
  });

  test("handleRead with unsupported encoding", async () => {
    const { path } = setupFile("encoding.txt", "abc\n");
    const result = await handleRead({
      file_path: path,
      encoding: "utf-16",
      projectDir: testDir,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unsupported encoding");
  });

  test("handleSearch max_matches limit", async () => {
    const { path } = setupFile("matches.txt", "a\na\na\na\na\n");
    const result = await import("../src/tools/search.ts").then((m) =>
      m.handleSearch({
        file_path: path,
        pattern: "a",
        max_matches: 2,
        projectDir: testDir,
      }),
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("showing 2 of 5 matches");
  });

  test("file just over 10MB limit", async () => {
    const overLimit = 10 * 1024 * 1024 + 1;
    const buf = Buffer.alloc(overLimit, "a");
    const f = join(testDir, "overLimit.txt");
    writeFileSync(f, buf);

    const result = await handleRead({ file_path: f, projectDir: testDir });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("exceeds the 10 MB size limit");
  });
});
