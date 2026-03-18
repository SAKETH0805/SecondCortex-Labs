#!/usr/bin/env node

/**
 * cortex CLI Wrapper
 * 
 * This CLI delegates commands to the SecondCortex VS Code extension
 * using URL handlers.
 */

const { exec } = require('child_process');

// Command line arguments (skip node and script path)
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log(`
🧠 SecondCortex CLI

Commands:
  resurrect [target]   Resurrects a workspace state (latest by default).
    ingest [repoPath]    Retroactively ingests git history for cold-start memory.

Examples:
  cortex resurrect
  cortex resurrect feature/auth-fix
    cortex ingest
    cortex ingest C:/code/my-repo
`);
    process.exit(0);
}

const command = args[0];

function openVsCodeUri(uri) {
    let openCmd;
    if (process.platform === 'win32') {
        openCmd = `start "" "${uri}"`;
    } else if (process.platform === 'darwin') {
        openCmd = `open "${uri}"`;
    } else {
        openCmd = `xdg-open "${uri}"`;
    }

    exec(openCmd, (error) => {
        if (error) {
            console.error('\n❌ Failed to send command to VS Code.');
            console.error('Ensure VS Code is installed and the SecondCortex extension is active.');
            console.error(error.message);
            process.exit(1);
        }
        console.log('✅ Command sent to VS Code successfully.');
    });
}

if (command === 'resurrect') {
    const target = args[1] || 'latest';
    console.log(`[SecondCortex] Requesting workspace resurrection for: ${target}`);

    // URI Format: vscode://<publisher>.<extension-name>/<path>?<query>
    const uri = `vscode://secondcortex-labs.secondcortex/resurrect?target=${encodeURIComponent(target)}`;
    openVsCodeUri(uri);
} else if (command === 'ingest') {
    const repoPath = args[1] || '';
    console.log(`[SecondCortex] Requesting retroactive git ingest${repoPath ? ` for: ${repoPath}` : ''}`);

    const query = repoPath
        ? `repoPath=${encodeURIComponent(repoPath)}`
        : '';
    const uri = `vscode://secondcortex-labs.secondcortex/ingest${query ? `?${query}` : ''}`;
    openVsCodeUri(uri);
} else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
