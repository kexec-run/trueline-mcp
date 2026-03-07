/**
 * Token benchmark harness.
 *
 * Measures output bytes (÷4 ≈ tokens) across realistic agent workflows.
 * Run: bun run benchmark
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleRead } from "../src/tools/read.ts";
import { handleOutline } from "../src/tools/outline.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ScenarioResult {
  name: string;
  steps: { tool: string; outputBytes: number }[];
  totalBytes: number;
  totalTokens: number;
}

function outputBytes(result: { content: Array<{ text: string }> }): number {
  return result.content.reduce((sum, c) => sum + Buffer.byteLength(c.text, "utf-8"), 0);
}

function printTable(results: ScenarioResult[]): void {
  const header = `${"Scenario".padEnd(40)} | ${"Bytes".padStart(8)} | ${"~Tokens".padStart(8)}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    console.log(`${r.name.padEnd(40)} | ${String(r.totalBytes).padStart(8)} | ${String(r.totalTokens).padStart(8)}`);
    for (const step of r.steps) {
      console.log(`  ${step.tool.padEnd(38)} | ${String(step.outputBytes).padStart(8)} |`);
    }
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

// Use this project's own source files as realistic fixtures.
const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_DIRS = [PROJECT_DIR];
const SAMPLE_FILE = `${PROJECT_DIR}/src/streaming-edit.ts`;

async function scenarioNavigateAndUnderstand(): Promise<ScenarioResult> {
  const steps: ScenarioResult["steps"] = [];

  // Step 1: outline
  const outline = await handleOutline({ file_path: SAMPLE_FILE, projectDir: PROJECT_DIR, allowedDirs: ALLOWED_DIRS });
  steps.push({ tool: "outline", outputBytes: outputBytes(outline) });

  // Step 2: read a function (lines 74-150 — a chunk of streamingEdit)
  const read = await handleRead({
    file_path: SAMPLE_FILE,
    ranges: [{ start: 74, end: 150 }],
    projectDir: PROJECT_DIR,
    allowedDirs: ALLOWED_DIRS,
  });
  steps.push({ tool: "read (with hashes)", outputBytes: outputBytes(read) });

  const totalBytes = steps.reduce((s, x) => s + x.outputBytes, 0);
  return { name: "Navigate and understand", steps, totalBytes, totalTokens: Math.round(totalBytes / 4) };
}

async function scenarioExploreAndEdit(): Promise<ScenarioResult> {
  const steps: ScenarioResult["steps"] = [];

  // Step 1: outline
  const outline = await handleOutline({ file_path: SAMPLE_FILE, projectDir: PROJECT_DIR, allowedDirs: ALLOWED_DIRS });
  steps.push({ tool: "outline", outputBytes: outputBytes(outline) });

  // Step 2: exploratory read (large range)
  const explore = await handleRead({
    file_path: SAMPLE_FILE,
    ranges: [{ start: 74, end: 250 }],
    projectDir: PROJECT_DIR,
    allowedDirs: ALLOWED_DIRS,
  });
  steps.push({ tool: "read (exploratory)", outputBytes: outputBytes(explore) });

  // Step 3: targeted re-read for edit (narrow range)
  const targeted = await handleRead({
    file_path: SAMPLE_FILE,
    ranges: [{ start: 100, end: 115 }],
    projectDir: PROJECT_DIR,
    allowedDirs: ALLOWED_DIRS,
  });
  steps.push({ tool: "read (edit target)", outputBytes: outputBytes(targeted) });

  const totalBytes = steps.reduce((s, x) => s + x.outputBytes, 0);
  return { name: "Explore then edit", steps, totalBytes, totalTokens: Math.round(totalBytes / 4) };
}

async function scenarioBroadExploration(): Promise<ScenarioResult> {
  const steps: ScenarioResult["steps"] = [];

  // Step 1: outline
  const outline = await handleOutline({ file_path: SAMPLE_FILE, projectDir: PROJECT_DIR, allowedDirs: ALLOWED_DIRS });
  steps.push({ tool: "outline", outputBytes: outputBytes(outline) });

  // Step 2-4: multiple reads across the file
  for (const range of [
    { start: 42, end: 70 },
    { start: 200, end: 280 },
    { start: 400, end: 470 },
  ]) {
    const read = await handleRead({
      file_path: SAMPLE_FILE,
      ranges: [range],
      projectDir: PROJECT_DIR,
      allowedDirs: ALLOWED_DIRS,
    });
    steps.push({ tool: `read ${range.start}-${range.end}`, outputBytes: outputBytes(read) });
  }

  const totalBytes = steps.reduce((s, x) => s + x.outputBytes, 0);
  return { name: "Broad exploration", steps, totalBytes, totalTokens: Math.round(totalBytes / 4) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Token Benchmark — trueline-mcp\n");
  console.log(`Sample file: ${SAMPLE_FILE}\n`);

  const results = await Promise.all([
    scenarioNavigateAndUnderstand(),
    scenarioExploreAndEdit(),
    scenarioBroadExploration(),
  ]);

  printTable(results);

  const grandTotal = results.reduce((s, r) => s + r.totalBytes, 0);
  console.log(`\nGrand total: ${grandTotal} bytes (~${Math.round(grandTotal / 4)} tokens)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
