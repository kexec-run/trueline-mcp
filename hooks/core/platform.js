// ==============================================================================
// Platform Detection
// ==============================================================================
//
// Detects which AI coding agent is running based on environment variables.
// Used by hooks and the CLI dispatcher to select the right formatting and
// tool aliases.

const PLATFORM_ENV_VARS = {
  "gemini-cli": "GEMINI_PROJECT_DIR",
  // claude-code and vscode-copilot both use CLAUDE_PROJECT_DIR, so we can't
  // distinguish them by env var alone. VS Code Copilot detection would need
  // an additional signal (e.g. VSCODE_PID). For now, both default to
  // claude-code behavior which is correct since they share tool names.
  "claude-code": "CLAUDE_PROJECT_DIR",
};

/**
 * Detect the current platform from environment variables.
 * TRUELINE_PLATFORM env var overrides auto-detection.
 * @returns {string}
 */
export function detectPlatform() {
  if (process.env.TRUELINE_PLATFORM) return process.env.TRUELINE_PLATFORM;

  // Check unique env vars first, then fall back to shared ones.
  if (process.env.GEMINI_PROJECT_DIR) return "gemini-cli";
  if (process.env.CLAUDE_PROJECT_DIR) return "claude-code";

  return "claude-code";
}

/**
 * Get the project directory for a given platform.
 * @param {string} [platform]
 * @returns {string | undefined}
 */
export function getProjectDir(platform) {
  const p = platform ?? detectPlatform();
  const envVar = PLATFORM_ENV_VARS[p];
  return envVar ? process.env[envVar] : process.env.CLAUDE_PROJECT_DIR;
}
