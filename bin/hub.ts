// ============================================================
// CLI Entry: vibehq-hub
// ============================================================

import { startHub } from '../src/hub/server.js';

function parseArgs(): { port: number; verbose: boolean; team: string } {
    const args = process.argv.slice(2);
    let port = 3001;
    let verbose = false;
    let team = 'default';

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '-p':
            case '--port':
                port = parseInt(args[++i], 10);
                if (isNaN(port)) {
                    console.error('Error: --port requires a number');
                    process.exit(1);
                }
                break;
            case '-t':
            case '--team':
                team = args[++i];
                break;
            case '-v':
            case '--verbose':
                verbose = true;
                break;
            case '-h':
            case '--help':
                console.log(`
Usage: vibehq-hub [options]

Start the Agent Hub central server

Options:
  -p, --port <number>    Port number (default: 3001)
  -t, --team <name>      Team name (default: default)
  -v, --verbose          Enable verbose logging
  -h, --help             Show help
`);
                process.exit(0);
        }
    }

    return { port, verbose, team };
}

const { port, verbose, team } = parseArgs();
const hub = startHub({ port, verbose, team });

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[AgentHub] Shutting down...');
    hub.wss.close(() => {
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    hub.wss.close(() => {
        process.exit(0);
    });
});
