import * as vscode from 'vscode';
import { BackendClient } from '../backendClient';
import { WorkspaceResurrector } from '../executor/workspace';

interface SnapshotBridgeMessage {
    source?: string;
    type?: string;
    snapshotId?: string;
    target?: string;
}

/**
 * ShadowGraphPanel - hosts the live dashboard in a WebviewPanel and bridges
 * timeline events (preview / restore) back into VS Code extension APIs.
 */
export class ShadowGraphPanel {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly backend: BackendClient,
        private readonly resurrector: WorkspaceResurrector,
        private readonly output: vscode.OutputChannel,
        private readonly frontendUrl: string
    ) { }

    show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'secondcortex.shadowGraph',
            'SecondCortex Shadow Graph',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        this.panel.webview.html = this.getHtml(this.panel.webview);

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        this.panel.webview.onDidReceiveMessage(async (message: SnapshotBridgeMessage) => {
            await this.handleMessage(message);
        });
    }

    private async handleMessage(message: SnapshotBridgeMessage): Promise<void> {
        const type = message.type;
        if (!type) {
            return;
        }

        if (type === 'previewSnapshot' && message.snapshotId) {
            await this.previewSnapshot(message.snapshotId);
            return;
        }

        if (type === 'restoreSnapshot') {
            const target = message.target || message.snapshotId;
            if (!target) {
                return;
            }

            // Get current active workspace folder if available
            const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            await this.resurrector.executeFromQuery(target, this.backend, currentWorkspace);
        }
    }

    private async previewSnapshot(snapshotId: string): Promise<void> {
        const snapshot = await this.backend.getSnapshotById(snapshotId);
        if (!snapshot) {
            vscode.window.showWarningMessage('SecondCortex: Snapshot not found for preview.');
            return;
        }

        this.output.appendLine(`[ShadowGraph] Preview snapshot ${snapshotId} @ ${snapshot.timestamp}`);
        this.output.appendLine(`[ShadowGraph] Summary: ${snapshot.summary || 'No summary available.'}`);

        if (!snapshot.active_file) {
            return;
        }

        try {
            const doc = await vscode.workspace.openTextDocument(snapshot.active_file);
            await vscode.window.showTextDocument(doc, {
                preserveFocus: true,
                preview: true,
                viewColumn: vscode.ViewColumn.Active,
            });
        } catch {
            // Snapshot paths may reference stale/deleted files; keep preview non-fatal.
            this.output.appendLine(`[ShadowGraph] Unable to open file from snapshot: ${snapshot.active_file}`);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = this.getNonce();
        const liveUrl = `${this.frontendUrl.replace(/\/$/, '')}/live`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https: http:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SecondCortex Shadow Graph</title>
    <style>
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background: #050814;
            color: #f8fafc;
            font-family: var(--vscode-font-family);
        }
        .frame {
            width: 100%;
            height: 100vh;
            border: 0;
        }
    </style>
</head>
<body>
    <iframe id="shadow-frame" class="frame" src="${liveUrl}?embed=vscode" title="SecondCortex Shadow Graph"></iframe>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object') {
                return;
            }

            if (data.source === 'secondcortex-shadow-graph') {
                vscode.postMessage(data);
            }
        });
    </script>
</body>
</html>`;
    }

    private getNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let text = '';
        for (let i = 0; i < 32; i++) {
            text += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return text;
    }
}
