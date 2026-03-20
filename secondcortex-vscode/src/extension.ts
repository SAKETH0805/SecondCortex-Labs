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

let eventCapture: EventCapture | undefined;
let snapshotCache: SnapshotCache | undefined;

function resolveConfiguredUrl(
    config: vscode.WorkspaceConfiguration,
    key: 'backendUrl' | 'frontendUrl',
    fallback: string,
    output: vscode.OutputChannel
): string {
    const rawValue = (config.get<string>(key, fallback) || '').trim();
    try {
        const parsed = new URL(rawValue);
        if (!/^https?:$/.test(parsed.protocol)) {
            throw new Error('Protocol must be http or https');
        }
        if (parsed.hostname.includes('_')) {
            throw new Error('Hostname cannot include underscore');
        }
        return parsed.toString().replace(/\/$/, '');
    } catch {
        output.appendLine(`[SecondCortex] Invalid secondcortex.${key} value: "${rawValue}". Falling back to default: ${fallback}`);
        return fallback;
    }
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('SecondCortex');
    outputChannel.appendLine('[SecondCortex] Extension activating...');

    // **AZURE OPENAI MIGRATION FIX**: Clear old cached state to force fresh backend fetch
    // This ensures users see current data instead of snapshots from before migration
    try {
        const storageFile = context.globalStorageUri.fsPath;
        const fs = require('fs');
        const path = require('path');
        const cacheFile = path.join(storageFile, 'offline-snapshots.json');
        if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
            outputChannel.appendLine('[SecondCortex] Cleared old offline snapshot cache on activation.');
        }
    } catch (err) {
        outputChannel.appendLine(`[SecondCortex] Warning: Could not clear snapshot cache: ${err}`);
    }

    // Configuration
    const config = vscode.workspace.getConfiguration('secondcortex');
    const backendUrl = resolveConfiguredUrl(
        config,
        'backendUrl',
        'https://sc-backend-suhaan.azurewebsites.net',
        outputChannel
    );
    const frontendUrl = resolveConfiguredUrl(
        config,
        'frontendUrl',
        'https://sc-frontend-suhaan.azurewebsites.net',
        outputChannel
    );
    const debouncerDelayMs = config.get<number>('debouncerDelayMs', 30000);
    const noiseThresholdMs = config.get<number>('noiseThresholdMs', 10000);
    outputChannel.appendLine(`[SecondCortex] Using backend URL: ${backendUrl}`);
    outputChannel.appendLine(`[SecondCortex] Using frontend URL: ${frontendUrl}`);

    // Auth
    const authService = new AuthService(context.secrets, outputChannel, backendUrl);

    // Services
    const backendClient = new BackendClient(backendUrl, outputChannel);
    backendClient.setAuthService(authService);

    const firewall = new SemanticFirewall(outputChannel);
    const debouncer = new Debouncer(debouncerDelayMs, noiseThresholdMs);
    snapshotCache = new SnapshotCache(context.globalStorageUri.fsPath, outputChannel);

    const resurrector = new WorkspaceResurrector(outputChannel);
    const shadowGraphPanel = new ShadowGraphPanel(backendClient, resurrector, outputChannel, frontendUrl);

    // Data Capture
    eventCapture = new EventCapture(debouncer, firewall, snapshotCache, backendClient, outputChannel);
    eventCapture.register(context);

    // Webview Sidebar
    const sidebarProvider = new SidebarProvider(context.extensionUri, backendClient, authService, outputChannel);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('secondcortex.chatView', sidebarProvider)
    );

    // Decision Archaeology Hover
    registerDecisionArchaeology(context, backendClient);
    outputChannel.appendLine('[SecondCortex] Decision Archaeology hover provider registered.');

    // Commands
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

    // Offline sync
    snapshotCache.flushToBackend(backendClient).catch((err) => {
        outputChannel.appendLine(`[SecondCortex] Offline sync error: ${err}`);
    });

    outputChannel.appendLine('[SecondCortex] Extension activated successfully.');
}

export function deactivate() {
    eventCapture?.dispose();
    snapshotCache?.close();
}
