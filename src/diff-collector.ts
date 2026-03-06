// ==============================================================================
// DiffCollector — builds unified diff output incrementally during streaming.
//
// The streaming edit engine calls context() / delete() / insert() as it
// processes each line.  After streaming completes, format() produces a
// standard unified diff string without ever holding both file versions in
// memory.
// ==============================================================================

type DiffEntry = { type: "ctx" | "del" | "ins"; text: string };

export class DiffCollector {
  private entries: DiffEntry[] = [];

  context(text: string): void {
    this.entries.push({ type: "ctx", text });
  }

  delete(text: string): void {
    this.entries.push({ type: "del", text });
  }

  insert(text: string): void {
    this.entries.push({ type: "ins", text });
  }

  /**
   * Format collected entries as a unified diff string.
   * Returns an empty string when there are no changes.
   */
  format(oldPath: string, newPath: string, contextLines = 3): string {
    const entries = this.entries;
    if (entries.length === 0) return "";

    // Find indices of all change (non-context) entries
    const changeIndices: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].type !== "ctx") changeIndices.push(i);
    }
    if (changeIndices.length === 0) return "";

    // Group changes, merging when the context gap between groups ≤ 2*contextLines
    const groups: Array<[number, number]> = [];
    let gStart = changeIndices[0];
    let gEnd = changeIndices[0];

    for (let ci = 1; ci < changeIndices.length; ci++) {
      const gap = changeIndices[ci] - gEnd - 1;
      if (gap <= 2 * contextLines) {
        gEnd = changeIndices[ci];
      } else {
        groups.push([gStart, gEnd]);
        gStart = changeIndices[ci];
        gEnd = changeIndices[ci];
      }
    }
    groups.push([gStart, gEnd]);

    // Build hunks
    const parts: string[] = [`--- ${oldPath}`, `+++ ${newPath}`];

    for (const [gs, ge] of groups) {
      const hStart = Math.max(0, gs - contextLines);
      const hEnd = Math.min(entries.length - 1, ge + contextLines);

      // Compute 1-based line numbers at hStart by counting preceding entries
      let oldLine = 1;
      let newLine = 1;
      for (let i = 0; i < hStart; i++) {
        if (entries[i].type !== "ins") oldLine++;
        if (entries[i].type !== "del") newLine++;
      }

      let oldCount = 0;
      let newCount = 0;
      const lines: string[] = [];

      for (let i = hStart; i <= hEnd; i++) {
        const e = entries[i];
        switch (e.type) {
          case "ctx":
            lines.push(` ${e.text}`);
            oldCount++;
            newCount++;
            break;
          case "del":
            lines.push(`-${e.text}`);
            oldCount++;
            break;
          case "ins":
            lines.push(`+${e.text}`);
            newCount++;
            break;
        }
      }

      const oldRange = oldCount === 1 ? `${oldLine}` : `${oldLine},${oldCount}`;
      const newRange = newCount === 1 ? `${newLine}` : `${newLine},${newCount}`;
      parts.push(`@@ -${oldRange} +${newRange} @@`);
      parts.push(...lines);
    }

    return `${parts.join("\n")}\n`;
  }
}
