// NOT COMPILED IN SANDBOX: depends on @modelcontextprotocol/sdk.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { GuardService } from '../core/service.ts';
import { toToolResult } from './results.ts';
import { STATUS_TOOL, STATUS_TOOL_DEF, TOOL_TABLE } from './tools.ts';

export interface McpDeps {
  service: GuardService;
  /** Upstream tool names currently advertised, used for discovery (FR-01). */
  discoveredTools: () => Promise<ReadonlySet<string>>;
}

/**
 * Builds the agent-facing MCP server. Exposed tools: namespaced demo_store.* and the read-only
 * guard.get_action_status. There is deliberately no approve or reject tool.
 */
export function createMcpServer(deps: McpDeps): Server {
  const server = new Server(
    { name: 'mcp-guard', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const found = await deps.discoveredTools().catch(() => new Set<string>());
    const tools = TOOL_TABLE.filter((t) => found.has(t.tool)).map((t) => ({
      name: t.publicName,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return { tools: [...tools, { ...STATUS_TOOL_DEF }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const outcome =
      name === STATUS_TOOL
        ? await deps.service.getActionStatus(
            (args as { requestId?: unknown } | undefined)?.requestId,
          )
        : await deps.service.handleToolCall(name, args ?? {});
    return toToolResult(outcome);
  });

  return server;
}
