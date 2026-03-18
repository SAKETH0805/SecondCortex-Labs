import * as vscode from 'vscode';
import { EventCapture } from './capture/eventCapture';
import { Debouncer } from './capture/debouncer';
import { SnapshotCache } from './capture/snapshotCache';
import { SemanticFirewall } from './security/firewall';
import { WorkspaceResurrector } from './executor/workspace';
import { SidebarProvider } from './webview/sidebar';
import { ShadowGraphPanel } from './webview/shadowGraphPanel';
import { BackendClient } from './backendClient';
import { AuthService } from './auth/authService';
import { registerDecisionArchaeology } from './decision/decisionHover';
import { PowerSyncClient, SyncStatus } from './sync/powerSyncClient';

let eventCapture: EventCapture | undefined;
let snapshotCache: SnapshotCache | undefined;
let powerSyncClient: PowerSyncClient | undefined;
let syncStatusBar: vscode.StatusBarItem | undefined;

class CortexCliUriHandler implements vscode.UriHandler {
    constructor(
        private readonly backendClient: BackendClient,
        private readonly resurrector: WorkspaceResurrector,
        private readonly output: vscode.OutputChannel,
    ) { }

    async handleUri(uri: vscode.Uri): Promise<void> {
        const route = uri.path.replace(/^\/+/, '').trim().toLowerCase();
        const params = new URLSearchParams(uri.query || '');
        const rawQuery = (uri.query || '').trim();
        const positional = rawQuery && !rawQuery.includes('=') ? decodeURIComponent(rawQuery) : '';

        this.output.appendLine(`[SecondCortex] URI command received route='${route}' query='${uri.query}'`);

        if (route === 'resurrect') {
            const target = params.get('target') || positional || 'latest';
            const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            await this.resurrector.executeFromQuery(target, this.backendClient, currentWorkspace);
            return;
        }

        if (route === 'ingest') {
            const repoPath = params.get('repoPath') || params.get('repo') || positional || undefined;
            const maxCommits = Number.parseInt(params.get('maxCommits') || '120', 10);
            const maxPullRequests = Number.parseInt(params.get('maxPullRequests') || '30', 10);
            const includePullRequests = (params.get('includePullRequests') || 'true').toLowerCase() !== 'false';

            await vscode.commands.executeCommand('secondcortex.ingestGitHistory', {
                repoPath,
                maxCommits,
                maxPullRequests,
                includePullRequests,
                silent: true,
            });
            return;
        }

        vscode.window.showWarningMessage(`SecondCortex: Unknown URI command '${route}'.`);
    }
}

function renderSyncStatus(status: SyncStatus): void {
    if (!syncStatusBar) {
        return;
    }

    if (status.state === 'synced') {
        syncStatusBar.text = '$(check) SecondCortex: Synced';
        syncStatusBar.color = new vscode.ThemeColor('charts.green');
        syncStatusBar.tooltip = 'SecondCortex sync is up to date';
        return;
    }

    if (status.state === 'syncing') {
        syncStatusBar.text = `$(sync~spin) SecondCortex: Syncing... (${status.pending} pending)`;
        syncStatusBar.color = new vscode.ThemeColor('charts.yellow');
        syncStatusBar.tooltip = 'SecondCortex is syncing pending snapshots';
        return;
    }

    syncStatusBar.text = `$(cloud-offline) SecondCortex: Offline — ${status.pending} queued`;
    syncStatusBar.color = new vscode.ThemeColor('disabledForeground');
    syncStatusBar.tooltip = 'SecondCortex is offline. Local queue will sync when connectivity resumes';
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('SecondCortex');
    outputChannel.appendLine('[SecondCortex] Extension activating...');

    // ── Configuration ──────────────────────────────────────────────
    const config = vscode.workspace.getConfiguration('secondcortex');
    const backendUrl = config.get<string>('backendUrl', 'https://sc-backend-suhaan.azurewebsites.net');
    const frontendUrl = config.get<string>('frontendUrl', 'https://sc-frontend-suhaan.azurewebsites.net');
    const debouncerDelayMs = config.get<number>('debouncerDelayMs', 30000);
    const noiseThresholdMs = config.get<number>('noiseThresholdMs', 10000);

    // ── Auth ───────────────────────────────────────────────────────
    const authService = new AuthService(context.secrets, outputChannel, backendUrl);

    // ── Services ───────────────────────────────────────────────────
    const backendClient = new BackendClient(backendUrl, outputChannel);
    backendClient.setAuthService(authService);

    syncStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    syncStatusBar.name = 'SecondCortex Sync';
    syncStatusBar.show();
    context.subscriptions.push(syncStatusBar);

    const firewall = new SemanticFirewall(outputChannel);
    const debouncer = new Debouncer(debouncerDelayMs, noiseThresholdMs);
    snapshotCache = new SnapshotCache(context.globalStorageUri.fsPath, outputChannel);
    powerSyncClient = new PowerSyncClient(context.globalStorageUri.fsPath, backendClient, outputChannel, renderSyncStatus);
    const resurrector = new WorkspaceResurrector(outputChannel);
    const shadowGraphPanel = new ShadowGraphPanel(backendClient, resurrector, outputChannel, frontendUrl);
    const cliUriHandler = new CortexCliUriHandler(backendClient, resurrector, outputChannel);

    // ── Data Capture ───────────────────────────────────────────────
    eventCapture = new EventCapture(debouncer, firewall, snapshotCache, powerSyncClient, backendClient, authService, outputChannel);
    eventCapture.register(context);

    // ── Webview Sidebar ────────────────────────────────────────────
    const sidebarProvider = new SidebarProvider(context.extensionUri, backendClient, authService, outputChannel);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('secondcortex.chatView', sidebarProvider)
    );

    // ── Decision Archaeology Hover ───────────────────────────────
    registerDecisionArchaeology(context, backendClient);
    outputChannel.appendLine('[SecondCortex] Decision Archaeology hover provider registered.');

    // ── Commands ───────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('secondcortex.login', async () => {
            // The sidebar will handle the actual login UI
            vscode.commands.executeCommand('secondcortex.chatView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('secondcortex.logout', async () => {
            await authService.logout();
            sidebarProvider.refreshView();
            vscode.window.showInformationMessage('SecondCortex: Logged out successfully.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('secondcortex.resurrectWorkspace', async () => {
            const answer = await vscode.window.showInputBox({
                prompt: 'Enter the branch or snapshot ID to resurrect',
                placeHolder: 'e.g., feature/auth-fix or snapshot-abc123',
            });
            if (answer) {
                const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                await resurrector.executeFromQuery(answer, backendClient, currentWorkspace);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('secondcortex.ingestGitHistory', async (options?: {
            repoPath?: string;
            maxCommits?: number;
            maxPullRequests?: number;
            includePullRequests?: boolean;
            silent?: boolean;
        }) => {
            const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const resolvedRepo = options?.repoPath ?? await vscode.window.showInputBox({
                prompt: 'Repository path to retroactively ingest (leave empty for current workspace)',
                placeHolder: defaultWorkspace || 'C:/path/to/repo',
                value: defaultWorkspace || '',
            });

            if (resolvedRepo === undefined) {
                return;
            }

            const payload = {
                repoPath: resolvedRepo || defaultWorkspace,
                maxCommits: options?.maxCommits ?? 120,
                maxPullRequests: options?.maxPullRequests ?? 30,
                includePullRequests: options?.includePullRequests ?? true,
            };

            const result = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'SecondCortex: Retroactively ingesting git history...',
                    cancellable: false,
                },
                async () => backendClient.ingestGitHistory(payload),
            );

            if (!result) {
                vscode.window.showErrorMessage('SecondCortex: Git ingest failed. Check output logs for details.');
                return;
            }

            const warningText = result.warnings?.length ? ` Warnings: ${result.warnings.join(' | ')}` : '';
            const summary = `Ingested ${result.ingestedCount} records (${result.commitCount} commits, ${result.prCount} PRs, ${result.commentCount} comments) from ${result.repo}.`;
            outputChannel.appendLine(`[SecondCortex] ${summary}${warningText}`);

            if (!options?.silent) {
                vscode.window.showInformationMessage(`SecondCortex: ${summary}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('secondcortex.askQuestion', async () => {
            const question = await vscode.window.showInputBox({
                prompt: 'Ask SecondCortex a question about your project history',
                placeHolder: 'e.g., Why did we roll back the payment module?',
            });
            if (question) {
                const response = await backendClient.askQuestion(question);
                outputChannel.appendLine(`[SecondCortex] Answer: ${JSON.stringify(response)}`);
                vscode.window.showInformationMessage(`SecondCortex: ${response?.summary || 'No answer available.'}`);
            }
        })
    );

    context.subscriptions.push(vscode.window.registerUriHandler(cliUriHandler));

    context.subscriptions.push(
        vscode.commands.registerCommand('secondcortex.openShadowGraph', async () => {
            shadowGraphPanel.show();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('secondcortex.toggleCapture', () => {
            const current = vscode.workspace.getConfiguration('secondcortex').get<boolean>('captureEnabled', true);
            vscode.workspace.getConfiguration('secondcortex').update('captureEnabled', !current, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`SecondCortex capture ${!current ? 'enabled' : 'disabled'}.`);
        })
    );

    // ── Offline Sync ───────────────────────────────────────────────
    snapshotCache.flushToBackend(backendClient).catch((err) => {
        outputChannel.appendLine(`[SecondCortex] Offline sync error: ${err}`);
    });
    powerSyncClient.syncPending().catch((err) => {
        outputChannel.appendLine(`[SecondCortex] PowerSync bootstrap error: ${err}`);
    });

    outputChannel.appendLine('[SecondCortex] Extension activated successfully.');
}

export function deactivate() {
    eventCapture?.dispose();
    snapshotCache?.close();
    powerSyncClient?.close();
}
