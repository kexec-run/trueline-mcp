#!/usr/bin/env node
// ==============================================================================
// Gemini CLI — Session Start Hook
// ==============================================================================
//
// Outputs trueline instructions tailored for Gemini CLI tool names.

import { getInstructions } from "../core/instructions.js";

process.stdout.write(getInstructions("gemini-cli"));
