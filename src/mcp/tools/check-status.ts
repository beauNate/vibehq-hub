// ============================================================
// MCP Tool: check_status
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';
import type { McpRateLimiter } from '../rate-limiter.js';

export function registerCheckStatus(server: McpServer, hub: HubClient, rateLimiter?: McpRateLimiter): void {
    server.tool(
        'check_status',
        'Check the current status of a specific teammate or all teammates. Hub sends proactive status notifications — avoid calling this repeatedly.',
        {
            teammate_name: z.string().optional().describe('Name of teammate. Omit to check all.'),
        },
        async (args) => {
            // Rate limit check (only for "check all" — specific teammate checks pass through)
            if (!args.teammate_name && rateLimiter) {
                const check = rateLimiter.check('check_status');
                if (check.limited && check.cachedResponse) {
                    const { McpRateLimiter: RL } = await import('../rate-limiter.js');
                    return {
                        content: [{
                            type: 'text' as const,
                            text: RL.buildWarning('check_status', check.callCount) + '\n' + check.cachedResponse,
                        }],
                    };
                }
            }

            if (args.teammate_name) {
                const teammate = hub.getTeammate(args.teammate_name);
                if (!teammate) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ error: `Teammate "${args.teammate_name}" not found` }),
                        }],
                        isError: true,
                    };
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: teammate.name,
                            role: teammate.role,
                            status: teammate.status,
                        }, null, 2),
                    }],
                };
            }

            // Return all teammates
            const teammates = hub.getTeammates();
            const responseText = JSON.stringify({
                teammates: teammates.map(t => ({
                    name: t.name,
                    role: t.role,
                    status: t.status,
                })),
            }, null, 2);

            rateLimiter?.recordResponse('check_status', responseText);

            return {
                content: [{
                    type: 'text' as const,
                    text: responseText,
                }],
            };
        }
    );
}
