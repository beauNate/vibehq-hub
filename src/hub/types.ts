// ============================================================
// Hub-specific Types
// ============================================================

import { WebSocket } from 'ws';
import type { Agent } from '../shared/types.js';

/**
 * An agent with its associated WebSocket connection.
 * Used internally by the Hub server.
 */
export interface ConnectedAgent extends Agent {
    ws: WebSocket;
    team: string;
    /** Timestamp of the last message received from this agent */
    lastActivity?: number;
}

/**
 * A viewer (e.g. VibeHQ frontend) connection.
 */
export interface ConnectedViewer {
    ws: WebSocket;
}
