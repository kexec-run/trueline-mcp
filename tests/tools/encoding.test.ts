import { describe, expect, test } from "bun:test";
import { validateEncoding } from "../../src/tools/shared.ts";

describe("validateEncoding", () => {
  test("defaults to utf-8 when undefined", () => {
    expect(validateEncoding(undefined)).toBe("utf-8");
  });

  test("accepts utf-8", () => {
    expect(validateEncoding("utf-8")).toBe("utf-8");
  });

  test("accepts utf8 (alias)", () => {
    expect(validateEncoding("utf8")).toBe("utf-8");
  });

  test("accepts ascii", () => {
    expect(validateEncoding("ascii")).toBe("ascii");
  });

  test("accepts latin1", () => {
    expect(validateEncoding("latin1")).toBe("latin1");
  });

  test("is case-insensitive", () => {
    expect(validateEncoding("UTF-8")).toBe("utf-8");
    expect(validateEncoding("Latin1")).toBe("latin1");
    expect(validateEncoding("ASCII")).toBe("ascii");
  });

  test("rejects unsupported encoding", () => {
    expect(() => validateEncoding("utf-16le")).toThrow("Unsupported encoding");
    expect(() => validateEncoding("binary")).toThrow("Unsupported encoding");
    expect(() => validateEncoding("shift_jis")).toThrow("Unsupported encoding");
  });
});
