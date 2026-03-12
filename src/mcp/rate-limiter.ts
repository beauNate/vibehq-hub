// ============================================================
// MCP Rate Limiter — prevents excessive polling by caching responses
// ============================================================
//
// Problem: Orchestrator agents call list_tasks, check_status, get_team_updates
// 20-30+ times per session, each time getting the same data back. This bloats
// their context window (7-10x growth) and wastes turns.
//
// Solution: Track call frequency per tool. After exceeding a threshold within
// a time window, return the cached previous response + a warning message.
// The agent gets told "nothing changed, wait for hub notifications."

interface RateLimitEntry {
    callTimestamps: number[];
    lastResponse: string | null;
    lastResponseTime: number;
}

export class McpRateLimiter {
    private entries = new Map<string, RateLimitEntry>();
    private readonly maxCallsPerWindow: number;
    private readonly windowMs: number;
    private readonly cacheTtlMs: number;

    /**
     * @param maxCallsPerWindow Max calls allowed before rate limiting kicks in
     * @param windowMs Time window in ms (calls older than this are forgotten)
     * @param cacheTtlMs How long cached responses are valid (ms)
     */
    constructor(maxCallsPerWindow = 5, windowMs = 60_000, cacheTtlMs = 15_000) {
        this.maxCallsPerWindow = maxCallsPerWindow;
        this.windowMs = windowMs;
        this.cacheTtlMs = cacheTtlMs;
    }

    /**
     * Check if a tool call should be rate-limited.
     * Returns { limited: false } if the call should proceed normally.
     * Returns { limited: true, cachedResponse } if the call should use cached data.
     */
    check(toolName: string): { limited: false } | { limited: true; cachedResponse: string | null; callCount: number } {
        const now = Date.now();
        let entry = this.entries.get(toolName);
        if (!entry) {
            entry = { callTimestamps: [], lastResponse: null, lastResponseTime: 0 };
            this.entries.set(toolName, entry);
        }

        // Prune old timestamps outside the window
        entry.callTimestamps = entry.callTimestamps.filter(t => now - t < this.windowMs);

        // Record this call
        entry.callTimestamps.push(now);

        // Check if over limit
        if (entry.callTimestamps.length > this.maxCallsPerWindow) {
            // Check if we have a valid cached response
            const cacheAge = now - entry.lastResponseTime;
            if (entry.lastResponse && cacheAge < this.cacheTtlMs) {
                return { limited: true, cachedResponse: entry.lastResponse, callCount: entry.callTimestamps.length };
            }
            // Cache expired — allow this call through but warn
            return { limited: false };
        }

        return { limited: false };
    }

    /**
     * Store the response from a successful (non-rate-limited) call.
     */
    recordResponse(toolName: string, response: string): void {
        const entry = this.entries.get(toolName);
        if (entry) {
            entry.lastResponse = response;
            entry.lastResponseTime = Date.now();
        }
    }

    /**
     * Build a rate-limit warning message.
     */
    static buildWarning(toolName: string, callCount: number): string {
        return `⚠️ Rate limited: you've called ${toolName} ${callCount} times in the last minute. ` +
            `The hub sends proactive notifications — you don't need to poll. ` +
            `Wait for hub notifications instead of calling ${toolName} repeatedly. ` +
            `Here's the cached result from your last call:`;
    }
}
