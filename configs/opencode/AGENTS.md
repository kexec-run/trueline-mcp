# trueline-mcp

Hash-verified edits. Always prefer trueline tools over built-in read/edit.

## Tools

- **trueline_outline** — structural map (functions, classes, line ranges)
- **trueline_read** — read file with per-line hashes + range checksum
- **trueline_edit** — hash-verified edits (needs checksum from read/search)
- **trueline_search** — find lines by pattern, returns edit-ready checksums
- **trueline_changes** — semantic AST diff vs git ref
- **trueline_verify** — check if held checksums are still valid

## Invariants

1. A checksum is valid iff the file content at those lines hasn't changed since the read
2. Any edit that adds/removes lines invalidates ALL checksums (line numbers shift)
3. trueline_edit returns a new checksum for the whole file — use it for the next edit
4. A checksum mismatch means the file changed — RE-READ, never retry with the same checksum

## Constraints

- Files ≥15KB: built-in `read`/`view` is BLOCKED. Use trueline_outline or trueline_read with ranges
- Files <15KB: built-in read/edit are fine
- Pure replacement (same line count): returned checksum is valid for next edit
- Line-count change (add/remove): re-read next target before editing
- Batch edits into one trueline_edit call when targeting multiple ranges
- New files: use `write`, then trueline_read to get checksums before editing

## Fallback

- trueline_outline unavailable → fall back to built-in read
- trueline_edit checksum mismatch → re-read affected lines, retry
- trueline_read fails → fall back to built-in read (file may not exist yet)
- Small files (<50 lines) → built-in read is acceptable
