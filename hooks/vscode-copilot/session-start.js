#!/usr/bin/env node
// ==============================================================================
// VS Code Copilot — Session Start Hook
// ==============================================================================
//
// Outputs trueline instructions tailored for VS Code Copilot tool names.

import { getInstructions } from "../core/instructions.js";

process.stdout.write(getInstructions("vscode-copilot"));
