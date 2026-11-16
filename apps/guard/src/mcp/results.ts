import type { AgentOutcome, McpContent } from '../core/service.ts';

export interface ToolResult {
  [key: string]: unknown;
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
}

const MAX_TEXT = 4000;

/** Upstream content is untrusted data: keep only bounded text items. */
export function textOnly(content: McpContent[]): Array<{ type: 'text'; text: string }> {
  return content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => ({ type: 'text' as const, text: (c.text as string).slice(0, MAX_TEXT) }));
}

/** Converts a Guard outcome into a valid MCP CallToolResult. Never includes arguments. */
export function toToolResult(o: AgentOutcome): ToolResult {
  if (!o.isError && o.status === 'executed' && o.content) {
    const items = textOnly(o.content);
    if (items.length > 0) return { isError: false, content: items };
  }
  const body: Record<string, unknown> = {
    status: o.status,
    requestId: o.requestId,
    message: o.message,
  };
  if (o.ruleId !== undefined) body.ruleId = o.ruleId;
  if (o.expiresAt !== undefined) body.expiresAt = o.expiresAt;
  return { isError: o.isError, content: [{ type: 'text', text: JSON.stringify(body) }] };
}
