// NOT COMPILED IN SANDBOX: depends on @modelcontextprotocol/sdk.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpContent, UpstreamClient, UpstreamResult } from '../core/service.ts';

const CONNECT_TIMEOUT_MS = 5000;
const CALL_TIMEOUT_MS = 10000;

/** Talks to the single configured upstream. A fresh connection per call keeps state out of Guard. */
export class McpUpstreamClient implements UpstreamClient {
  private readonly url: URL;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = new URL(url);
    this.token = token;
  }

  private async withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const client = new Client({ name: 'mcp-guard', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(this.url, {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('upstream connect timeout')),
            CONNECT_TIMEOUT_MS,
          );
        }),
      ]);
      return await fn(client);
    } finally {
      if (timer) clearTimeout(timer);
      await client.close().catch(() => undefined);
    }
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<UpstreamResult> {
    return this.withClient(async (client) => {
      const r = await client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: CALL_TIMEOUT_MS,
      });
      const content = Array.isArray(r.content) ? (r.content as McpContent[]) : [];
      return { isError: r.isError === true, content };
    });
  }

  /** Tool names the upstream advertises. Descriptions and schemas are ignored (untrusted). */
  async listToolNames(): Promise<string[]> {
    return this.withClient(async (client) => {
      const r = await client.listTools();
      return r.tools.map((t) => t.name);
    });
  }

  async resetDemo(): Promise<void> {
    const reset = new URL('/reset', this.url);
    const res = await fetch(reset, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`reset failed (${res.status})`);
  }
}
