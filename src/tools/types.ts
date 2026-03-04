/** Return type for all tool handlers, compatible with the MCP SDK's CallToolResult. */
export interface ToolResult {
  // Index signature required by MCP SDK's CallToolResult type
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
