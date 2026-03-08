#!/usr/bin/env node
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const pluginRoot = path.join(__dirname, "..");

// ==============================================================================
// Runtime Selection
// ==============================================================================

// Prefer bun: it runs the TypeScript source directly with no build step.
// Then try deno, then fall back to node — both use the pre-bundled JS file.
function hasBun() {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasDeno() {
  try {
    execFileSync("deno", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ==============================================================================
// Dependency Installation
// ==============================================================================

// When installed as a Claude Code plugin, tree-sitter WASM files are needed
// by trueline_outline but aren't bundled. Install them globally so they don't
// bloat the plugin dir (Claude Code copies the entire plugin directory to a
// versioned cache, and node_modules causes ENAMETOOLONG).
const WASM_PKGS = ["web-tree-sitter@0.24.7", "tree-sitter-wasms@0.1.13"];

function globalModulesDir() {
  try {
    return execFileSync("npm", ["root", "-g"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function ensureDeps() {
  const globalDir = globalModulesDir();
  if (!globalDir) return;

  for (const spec of WASM_PKGS) {
    const pkg = spec.split("@")[0];
    if (existsSync(path.join(globalDir, pkg))) continue;
    try {
      execFileSync("npm", ["install", "-g", spec, "--silent"], {
        stdio: "pipe",
        timeout: 60_000,
      });
    } catch {
      // Non-fatal: outline won't work, but read/edit/search/diff/verify will.
    }
  }
}

// ==============================================================================
// Launch
// ==============================================================================

ensureDeps();

let cmd, args;
if (hasBun()) {
  cmd = "bun";
  args = [path.join(pluginRoot, "src", "server.ts")];
} else if (hasDeno()) {
  cmd = "deno";
  args = ["run", "-A", path.join(pluginRoot, "dist", "server.js")];
} else {
  cmd = "node";
  args = [path.join(pluginRoot, "dist", "server.js")];
}

// Node doesn't search global node_modules by default — expose via NODE_PATH
const env = { ...process.env };
const globalDir = globalModulesDir();
if (globalDir) {
  env.NODE_PATH = env.NODE_PATH ? `${globalDir}${path.delimiter}${env.NODE_PATH}` : globalDir;
}

const child = spawn(cmd, [...args, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("error", (err) => {
  process.stderr.write(`trueline-mcp: failed to start server: ${err.message}\n`);
  process.exit(1);
});

child.on("exit", (code) => process.exit(code ?? 1));
