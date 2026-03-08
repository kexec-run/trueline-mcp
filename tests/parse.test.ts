import { describe, expect, test } from "bun:test";
import { parseRanges } from "../src/parse.ts";

describe("parseRanges", () => {
  test("returns whole-file sentinel for undefined input", () => {
    const result = parseRanges(undefined);
    expect(result).toEqual([{ start: 1, end: Infinity }]);
  });

  test("returns whole-file sentinel for empty array", () => {
    const result = parseRanges([]);
    expect(result).toEqual([{ start: 1, end: Infinity }]);
  });

  test("parses a single range", () => {
    const result = parseRanges([{ start: 10, end: 20 }]);
    expect(result).toEqual([{ start: 10, end: 20 }]);
  });

  test("sorts ranges by start", () => {
    const result = parseRanges([
      { start: 50, end: 60 },
      { start: 10, end: 20 },
    ]);
    expect(result).toEqual([
      { start: 10, end: 20 },
      { start: 50, end: 60 },
    ]);
  });

  test("defaults start to 1 and end to Infinity", () => {
    const result = parseRanges([{}]);
    expect(result).toEqual([{ start: 1, end: Infinity }]);
  });

  test("defaults end to Infinity when only start given", () => {
    const result = parseRanges([{ start: 10 }]);
    expect(result).toEqual([{ start: 10, end: Infinity }]);
  });

  test("merges overlapping ranges", () => {
    const result = parseRanges([
      { start: 1, end: 20 },
      { start: 15, end: 30 },
    ]);
    expect(result).toEqual([{ start: 1, end: 30 }]);
  });

  test("merges adjacent ranges", () => {
    const result = parseRanges([
      { start: 1, end: 20 },
      { start: 21, end: 30 },
    ]);
    expect(result).toEqual([{ start: 1, end: 30 }]);
  });

  test("throws on start < 1", () => {
    expect(() => parseRanges([{ start: 0, end: 10 }])).toThrow(/start/i);
  });

  test("throws on start > end", () => {
    expect(() => parseRanges([{ start: 20, end: 10 }])).toThrow(/start.*end/i);
  });

  test("allows non-adjacent ranges", () => {
    const result = parseRanges([
      { start: 1, end: 10 },
      { start: 20, end: 30 },
    ]);
    expect(result).toEqual([
      { start: 1, end: 10 },
      { start: 20, end: 30 },
    ]);
  });
});
