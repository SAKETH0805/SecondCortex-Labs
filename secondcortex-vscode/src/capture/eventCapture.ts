import * as vscode from 'vscode';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { Debouncer } from './debouncer';
import { SemanticFirewall } from '../security/firewall';
import { SnapshotCache } from './snapshotCache';
import { BackendClient } from '../backendClient';
import { AuthService } from '../auth/authService';
import { PowerSyncClient } from '../sync/powerSyncClient';

interface CommentCapture {
    type: 'inline' | 'block' | 'jsdoc' | 'todo' | 'fixme' | 'hack';
    content: string;
    line: number;
    functionContext: string;
    isNew: boolean;
}

interface TodoCapture {
    type: 'TODO' | 'FIXME' | 'HACK' | 'NOTE' | 'TEMP';
    content: string;
    file: string;
    functionContext: string;
    age: 'new' | 'existing';
}

interface RecentCommitCapture {
    hash: string;
    message: string;
    filesChanged: string[];
    timestamp: number;
    author: string;
}

interface DiffStatsCapture {
    filesModified: number;
    insertions: number;
    deletions: number;
    changedFiles: string[];
}

interface DiagnosticsCapture {
    errors: number;
    warnings: number;
    errorMessages: string[];
}

interface ExtensionSignals {
    debugSessionActive: boolean;
    debugAdapterType: string;
    breakpointCount: number;
    testRunnerActive: boolean;
    activeTerminalCount: number;
}

interface ImportCapture {
    added: string[];
    removed: string[];
}

interface FunctionSignaturesCapture {
    changed: string[];
    added: string[];
    removed: string[];
}

interface TestResultCapture {
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
}

interface EnrichedSnapshotComments {
    new: CommentCapture[];
    existing: CommentCapture[];
    todos: TodoCapture[];
}

interface SearchQueryCapture {
    query: string;
    results: number;
    fileTypes: string[];
}

interface DiffInsights {
    comments: EnrichedSnapshotComments;
    importChanges: ImportCapture;
    functionSignatures: FunctionSignaturesCapture;
}

/**
 * CapturedSnapshot – the sanitized data structure that leaves the laptop.
 */
export interface CapturedSnapshot {
    id: string;
    timestamp: string;
    summary: string;
    workspaceFolder: string;
    activeFile: string;
    languageId: string;
    /** Sanitized code context (secrets replaced with [CODE_REDACTED]) */
    shadowGraph: string;
    gitBranch: string | null;
    terminalCommands: string[];
    comments: EnrichedSnapshotComments;
    recentCommits: RecentCommitCapture[];
    diffStats: DiffStatsCapture;
    diagnostics: DiagnosticsCapture;
    extensionSignals: ExtensionSignals;
    searchQueries: SearchQueryCapture[];
    importChanges: ImportCapture;
    functionSignatures: FunctionSignaturesCapture;
    testResults?: TestResultCapture;
}

/**
 * EventCapture – listens to IDE events, feeds them through the Debouncer
 * and Semantic Firewall, then ships sanitized snapshots to the backend
 * (or caches them offline via SnapshotCache).
 */
export class EventCapture {
    private disposables: vscode.Disposable[] = [];
    private recentTerminalCommands: string[] = [];
    private recentSearchQueries: SearchQueryCapture[] = [];
    private testRunnerActive = false;
    private lastTestRun?: TestResultCapture;
    private lastSnapshotContentByFile = new Map<string, string>();

    constructor(
        private debouncer: Debouncer,
        private firewall: SemanticFirewall,
        private cache: SnapshotCache,
        private syncClient: PowerSyncClient,
        private backend: BackendClient,
        private auth: AuthService,
        private output: vscode.OutputChannel
    ) { }

    private pushTerminalCommand(command: string): void {
        const value = command.trim();
        if (!value) {
            return;
        }
        this.recentTerminalCommands.push(value);
        if (this.recentTerminalCommands.length > 30) {
            this.recentTerminalCommands = this.recentTerminalCommands.slice(-30);
        }
    }

    private pushSearchQuery(entry: SearchQueryCapture): void {
        if (!entry.query.trim()) {
            return;
        }
        this.recentSearchQueries.push({
            query: entry.query.trim(),
            results: Math.max(0, entry.results || 0),
            fileTypes: Array.from(new Set(entry.fileTypes || [])).slice(0, 10),
        });
        if (this.recentSearchQueries.length > 20) {
            this.recentSearchQueries = this.recentSearchQueries.slice(-20);
        }
    }

    register(context: vscode.ExtensionContext): void {
        // ── Active editor changes ──────────────────────────────────
        const editorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
            const enabled = vscode.workspace.getConfiguration('secondcortex').get<boolean>('captureEnabled', true);
            if (!enabled || !editor || editor.document.uri.scheme !== 'file') { return; }

            const filePath = editor.document.uri.fsPath;

            // Check .cortexignore BEFORE debouncing
            if (this.firewall.isIgnored(filePath)) {
                this.output.appendLine(`[EventCapture] Ignored by .cortexignore: ${filePath}`);
                return;
            }

            this.debouncer.touch(filePath, () => {
                this.captureDocumentAndShip(editor.document).catch((err) => {
                    this.output.appendLine(`[EventCapture] Error capturing snapshot: ${err}`);
                });
            });
        });
        this.disposables.push(editorSub);

        // ── Text document close (noise detection) ──────────────────
        const closeSub = vscode.workspace.onDidCloseTextDocument((doc) => {
            const wasMeaningful = this.debouncer.cancel(doc.uri.fsPath);
            if (!wasMeaningful) {
                this.output.appendLine(`[EventCapture] Noise filtered: ${doc.uri.fsPath}`);
            }
        });
        this.disposables.push(closeSub);

        // ── Terminal open tracking ─────────────────────────────────
        const termSub = vscode.window.onDidOpenTerminal((terminal) => {
            this.pushTerminalCommand(`[terminal opened] ${terminal.name}`);
        });
        this.disposables.push(termSub);

        const windowAny = vscode.window as unknown as {
            onDidStartTerminalShellExecution?: (listener: (event: any) => void) => vscode.Disposable;
            onDidEndTerminalShellExecution?: (listener: (event: any) => void) => vscode.Disposable;
        };

        if (typeof windowAny.onDidStartTerminalShellExecution === 'function') {
            const shellStartSub = windowAny.onDidStartTerminalShellExecution((event: any) => {
                const command = String(event?.execution?.commandLine?.value || event?.execution?.commandLine || '').trim();
                if (!command) {
                    return;
                }
                this.pushTerminalCommand(command);
                if (/\b(test|jest|vitest|pytest|mocha|go test|cargo test|dotnet test)\b/i.test(command)) {
                    this.testRunnerActive = true;
                }
            });
            this.disposables.push(shellStartSub);
        }

        if (typeof windowAny.onDidEndTerminalShellExecution === 'function') {
            const shellEndSub = windowAny.onDidEndTerminalShellExecution((event: any) => {
                const command = String(event?.execution?.commandLine?.value || event?.execution?.commandLine || '').trim();
                if (!command) {
                    return;
                }
                if (/\b(test|jest|vitest|pytest|mocha|go test|cargo test|dotnet test)\b/i.test(command)) {
                    this.testRunnerActive = false;
                    const startTimeMs = Number(event?.execution?.startTime || Date.now());
                    this.lastTestRun = {
                        passed: 0,
                        failed: Number(event?.exitCode ?? 0) === 0 ? 0 : 1,
                        skipped: 0,
                        duration: Math.max(0, Date.now() - startTimeMs),
                    };
                }
            });
            this.disposables.push(shellEndSub);
        }

        // ── Text edits (re-touch the debouncer on typing) ──────────
        const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.scheme === 'search-editor' || e.document.languageId === 'search-result') {
                this.captureSearchEditorQuery(e.document);
                return;
            }

            const enabled = vscode.workspace.getConfiguration('secondcortex').get<boolean>('captureEnabled', true);
            if (!enabled || e.document.uri.scheme !== 'file') { return; }

            const filePath = e.document.uri.fsPath;
            const docUri = e.document.uri.toString();
            if (this.firewall.isIgnored(filePath)) { return; }

            this.debouncer.touch(filePath, () => {
                const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === docUri);
                if (doc && !doc.isClosed) {
                    this.captureDocumentAndShip(doc).catch((err) => {
                        this.output.appendLine(`[EventCapture] Error capturing snapshot: ${err}`);
                    });
                }
            });
        });
        this.disposables.push(changeSub);

        // ── Save events (immediate capture) ───────────────────────
        const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
            const enabled = vscode.workspace.getConfiguration('secondcortex').get<boolean>('captureEnabled', true);
            if (!enabled || doc.uri.scheme !== 'file') { return; }

            const filePath = doc.uri.fsPath;
            if (this.firewall.isIgnored(filePath)) { return; }

            this.captureDocumentAndShip(doc).catch((err) => {
                this.output.appendLine(`[EventCapture] Error capturing saved snapshot: ${err}`);
            });
        });
        this.disposables.push(saveSub);

        // ── Background flush (works even when sidebar is closed) ──
        const flushInterval = setInterval(() => {
            this.cache.flushToBackend(this.backend).catch((err) => {
                this.output.appendLine(`[EventCapture] Background cache flush error: ${err}`);
            });
        }, 15000);
        this.disposables.push(new vscode.Disposable(() => clearInterval(flushInterval)));

        // Also flush whenever VS Code regains focus.
        const focusSub = vscode.window.onDidChangeWindowState((state) => {
            if (!state.focused) {
                return;
            }
            this.cache.flushToBackend(this.backend).catch((err) => {
                this.output.appendLine(`[EventCapture] Focus-triggered cache flush error: ${err}`);
            });
        });
        this.disposables.push(focusSub);

        context.subscriptions.push(...this.disposables);
    }

    private async captureDocumentAndShip(doc: vscode.TextDocument): Promise<void> {
        const rawContent = doc.getText();
        const previousContent = this.lastSnapshotContentByFile.get(doc.uri.toString()) || '';

        // ── Semantic Firewall: scrub secrets ──────────────────────
        const sanitized = this.firewall.scrub(rawContent);

        // ── Build the snapshot payload ────────────────────────────
        // Send workspace-relative path (never absolute — prevents leaking username/OS info)
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const relativePath = workspaceRoot
            ? path.relative(workspaceRoot, doc.uri.fsPath).replace(/\\/g, '/')
            : path.basename(doc.uri.fsPath);

        const diffInsights = this.buildDiffInsights(previousContent, rawContent, doc.languageId, relativePath);

        const [recentCommits, diffStats] = await Promise.all([
            this.getRecentCommits(5),
            this.getDiffStats(),
        ]);

        const diagnostics = this.getDiagnosticsCapture();
        const extensionSignals = this.getExtensionSignals();

        const summary = this.buildSnapshotSummary(relativePath, diagnostics, diffStats, diffInsights);

        const snapshotId = randomUUID();

        const snapshot: CapturedSnapshot = {
            id: snapshotId,
            timestamp: new Date().toISOString(),
            summary,
            workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.name ?? 'unknown',
            activeFile: relativePath,
            languageId: doc.languageId,
            shadowGraph: sanitized,
            gitBranch: await this.getCurrentGitBranch(),
            terminalCommands: [...this.recentTerminalCommands],
            comments: diffInsights.comments,
            recentCommits,
            diffStats,
            diagnostics,
            extensionSignals,
            searchQueries: [...this.recentSearchQueries],
            importChanges: diffInsights.importChanges,
            functionSignatures: diffInsights.functionSignatures,
            testResults: this.lastTestRun,
        };

        this.lastSnapshotContentByFile.set(doc.uri.toString(), rawContent);

        this.output.appendLine(`[EventCapture] Snapshot ready for: ${doc.uri.fsPath}`);

        const user = await this.auth.getUser();
        const userId = user?.userId ?? 'anonymous';
        const teamId = user?.teamId ?? null;

        const row = this.syncClient.buildRow({
            id: snapshotId,
            userId,
            teamId,
            workspace: snapshot.workspaceFolder,
            activeFile: snapshot.activeFile,
            gitBranch: snapshot.gitBranch,
            terminalCommands: snapshot.terminalCommands,
            summary: snapshot.summary,
            enrichedContext: {
                comments: snapshot.comments,
                recentCommits: snapshot.recentCommits,
                diffStats: snapshot.diffStats,
                diagnostics: snapshot.diagnostics,
                extensionSignals: snapshot.extensionSignals,
                searchQueries: snapshot.searchQueries,
                importChanges: snapshot.importChanges,
                functionSignatures: snapshot.functionSignatures,
                testResults: snapshot.testResults,
                activeFile: snapshot.activeFile,
                languageId: snapshot.languageId,
            },
            timestampMs: Date.now(),
        });

        // ── Local-first write ─────────────────────────────────────
        this.syncClient.storeSnapshot(row);

        // ── Primary transport: PowerSync-compatible upload ────────
        const syncOk = await this.syncClient.syncPending();

        // ── Fallback transport: existing snapshot HTTP POST ───────
        if (!syncOk) {
            this.output.appendLine('[EventCapture] Sync transport unavailable — using snapshot HTTP fallback.');
            const fallbackOk = await this.backend.sendSnapshot(snapshot as unknown as Record<string, unknown>);
            if (fallbackOk) {
                this.syncClient.markSynced([snapshotId]);
            } else {
                this.output.appendLine('[EventCapture] Backend unreachable — caching fallback snapshot locally.');
                this.cache.store(snapshot);
            }
        }

        // Clear terminal buffer after shipping
        this.recentTerminalCommands = [];
    }

    private captureSearchEditorQuery(doc: vscode.TextDocument): void {
        const text = doc.getText();
        const queryMatch = text.match(/(?:Query|Search)\s*:\s*(.+)$/im);
        const includeMatch = text.match(/(?:Files\s+to\s+include|Includes?)\s*:\s*(.+)$/im);
        const lineMatches = text.match(/:\d+:/g) || [];

        if (queryMatch?.[1]) {
            const includeRaw = includeMatch?.[1] || '';
            const fileTypes = Array.from(new Set((includeRaw.match(/\*\.[a-z0-9]+/gi) || []).map((v) => v.replace('*', ''))));
            this.pushSearchQuery({
                query: queryMatch[1].trim(),
                results: lineMatches.length,
                fileTypes,
            });
        }
    }

    private buildSnapshotSummary(
        activeFile: string,
        diagnostics: DiagnosticsCapture,
        diffStats: DiffStatsCapture,
        diffInsights: DiffInsights,
    ): string {
        const todoCount = diffInsights.comments.todos.length;
        const changedFnCount = diffInsights.functionSignatures.changed.length
            + diffInsights.functionSignatures.added.length
            + diffInsights.functionSignatures.removed.length;
        return [
            `Capture received: editing ${activeFile}`,
            `Diagnostics: ${diagnostics.errors} error(s), ${diagnostics.warnings} warning(s)`,
            `Diff: ${diffStats.filesModified} file(s), +${diffStats.insertions} -${diffStats.deletions}`,
            `Intent signals: ${diffInsights.comments.new.length} new comments, ${todoCount} TODO/FIXME/HACK markers, ${changedFnCount} function signature changes`,
        ].join(' | ');
    }

    private getDiagnosticsCapture(): DiagnosticsCapture {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        let errors = 0;
        let warnings = 0;
        const errorMessages: string[] = [];

        for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
            if (!workspaceRoot || uri.scheme !== 'file' || !uri.fsPath.startsWith(workspaceRoot)) {
                continue;
            }

            const relative = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/');
            for (const diagnostic of diagnostics) {
                if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
                    errors += 1;
                    if (errorMessages.length < 8) {
                        errorMessages.push(`${relative}:${diagnostic.range.start.line + 1} — ${diagnostic.message}`);
                    }
                } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
                    warnings += 1;
                }
            }
        }

        return { errors, warnings, errorMessages };
    }

    private getExtensionSignals(): ExtensionSignals {
        const activeDebug = vscode.debug.activeDebugSession;
        return {
            debugSessionActive: Boolean(activeDebug),
            debugAdapterType: activeDebug?.type || 'none',
            breakpointCount: vscode.debug.breakpoints.length,
            testRunnerActive: this.testRunnerActive,
            activeTerminalCount: vscode.window.terminals.length,
        };
    }

    private buildDiffInsights(previous: string, current: string, languageId: string, file: string): DiffInsights {
        const prevLines = previous.split(/\r?\n/);
        const currLines = current.split(/\r?\n/);
        const maxLines = Math.max(prevLines.length, currLines.length);

        const changedCurrentLines: number[] = [];
        const changedPreviousLines: number[] = [];

        for (let index = 0; index < maxLines; index += 1) {
            if ((prevLines[index] || '') !== (currLines[index] || '')) {
                if (index < currLines.length) {
                    changedCurrentLines.push(index + 1);
                }
                if (index < prevLines.length) {
                    changedPreviousLines.push(index + 1);
                }
            }
        }

        const newComments = this.extractCommentCaptures(currLines, changedCurrentLines, languageId, true);
        const existingComments = this.extractCommentCaptures(prevLines, changedPreviousLines, languageId, false);
        const todos = this.extractTodoCaptures(file, newComments, existingComments);

        const previousImports = this.extractImports(previous);
        const currentImports = this.extractImports(current);

        const importChanges: ImportCapture = {
            added: currentImports.filter((entry) => !previousImports.includes(entry)).slice(0, 40),
            removed: previousImports.filter((entry) => !currentImports.includes(entry)).slice(0, 40),
        };

        const functionSignatures = this.extractFunctionSignatureChanges(previous, current, languageId);

        return {
            comments: {
                new: newComments,
                existing: existingComments,
                todos,
            },
            importChanges,
            functionSignatures,
        };
    }

    private extractCommentCaptures(lines: string[], lineNumbers: number[], languageId: string, isNew: boolean): CommentCapture[] {
        const captures: CommentCapture[] = [];
        for (const lineNumber of lineNumbers) {
            const line = lines[lineNumber - 1] || '';
            const parsed = this.parseCommentLine(line);
            if (!parsed) {
                continue;
            }

            captures.push({
                type: parsed.type,
                content: parsed.content,
                line: lineNumber,
                functionContext: this.findFunctionContext(lines, lineNumber, languageId),
                isNew,
            });
        }
        return captures.slice(0, 100);
    }

    private parseCommentLine(line: string): { type: CommentCapture['type']; content: string } | null {
        const trimmed = line.trim();
        if (!trimmed) {
            return null;
        }

        const todoMatch = trimmed.match(/\b(TODO|FIXME|HACK)\b/i);
        if (todoMatch) {
            const marker = todoMatch[1].toLowerCase();
            const type = marker === 'todo'
                ? 'todo'
                : marker === 'fixme'
                    ? 'fixme'
                    : 'hack';
            return { type, content: this.cleanCommentText(trimmed) };
        }

        if (trimmed.startsWith('/**') || trimmed.startsWith('*')) {
            return { type: 'jsdoc', content: this.cleanCommentText(trimmed) };
        }

        if (trimmed.startsWith('/*') || trimmed.endsWith('*/')) {
            return { type: 'block', content: this.cleanCommentText(trimmed) };
        }

        if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
            return { type: 'inline', content: this.cleanCommentText(trimmed) };
        }

        return null;
    }

    private cleanCommentText(line: string): string {
        return line
            .replace(/^\s*(\/\/|#|\/\*+|\*+|\*\/)/, '')
            .replace(/\*\/$/, '')
            .trim();
    }

    private findFunctionContext(lines: string[], lineNumber: number, languageId: string): string {
        for (let index = lineNumber - 1; index >= 0; index -= 1) {
            const candidate = lines[index].trim();

            if (languageId === 'python') {
                const py = candidate.match(/^def\s+([A-Za-z_][\w]*)\s*\(/);
                if (py?.[1]) {
                    return py[1];
                }
            }

            const fnDecl = candidate.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/);
            if (fnDecl?.[1]) {
                return fnDecl[1];
            }

            const arrow = candidate.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>/);
            if (arrow?.[1]) {
                return arrow[1];
            }

            const method = candidate.match(/^(?:public\s+|private\s+|protected\s+|async\s+|static\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/);
            if (method?.[1]) {
                return method[1];
            }
        }

        return 'global';
    }

    private extractTodoCaptures(file: string, newComments: CommentCapture[], existingComments: CommentCapture[]): TodoCapture[] {
        const all = [...newComments, ...existingComments];
        const captures: TodoCapture[] = [];

        for (const comment of all) {
            const marker = comment.content.match(/\b(TODO|FIXME|HACK|NOTE|TEMP)\b/i)?.[1]?.toUpperCase();
            if (!marker) {
                continue;
            }

            captures.push({
                type: marker as TodoCapture['type'],
                content: comment.content,
                file,
                functionContext: comment.functionContext,
                age: comment.isNew ? 'new' : 'existing',
            });
        }

        return captures.slice(0, 80);
    }

    private extractImports(content: string): string[] {
        const modules = new Set<string>();
        const importFrom = /from\s+['"]([^'"\.][^'"\n]*)['"]/g;
        const importRequire = /require\(\s*['"]([^'"\.][^'"\n]*)['"]\s*\)/g;
        const pythonFrom = /^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm;
        const pythonImport = /^\s*import\s+([A-Za-z0-9_\.\s,]+)/gm;

        for (const regex of [importFrom, importRequire]) {
            let match = regex.exec(content);
            while (match) {
                const normalized = this.normalizePackageName(match[1]);
                if (normalized) {
                    modules.add(normalized);
                }
                match = regex.exec(content);
            }
        }

        let pyFromMatch = pythonFrom.exec(content);
        while (pyFromMatch) {
            const normalized = this.normalizePackageName(pyFromMatch[1]);
            if (normalized) {
                modules.add(normalized);
            }
            pyFromMatch = pythonFrom.exec(content);
        }

        let pyImportMatch = pythonImport.exec(content);
        while (pyImportMatch) {
            const names = pyImportMatch[1].split(',').map((v) => v.trim().split(' ')[0]);
            for (const name of names) {
                const normalized = this.normalizePackageName(name);
                if (normalized) {
                    modules.add(normalized);
                }
            }
            pyImportMatch = pythonImport.exec(content);
        }

        return Array.from(modules).sort();
    }

    private normalizePackageName(raw: string): string | null {
        const value = (raw || '').trim();
        if (!value || value.startsWith('.') || value.startsWith('/')) {
            return null;
        }

        if (value.startsWith('@')) {
            const scoped = value.split('/');
            return scoped.length >= 2 ? `${scoped[0]}/${scoped[1]}` : value;
        }

        return value.split('/')[0];
    }

    private extractFunctionSignatureChanges(previous: string, current: string, languageId: string): FunctionSignaturesCapture {
        const previousSignatures = this.extractFunctionSignatures(previous, languageId);
        const currentSignatures = this.extractFunctionSignatures(current, languageId);

        const previousValues = Array.from(previousSignatures.values());
        const currentValues = Array.from(currentSignatures.values());

        const addedValues = currentValues.filter((signature) => !previousValues.includes(signature));
        const removedValues = previousValues.filter((signature) => !currentValues.includes(signature));

        const changed: string[] = [];
        const added: string[] = [];
        const removedNames: string[] = [];

        for (const signature of addedValues) {
            const name = this.getFunctionName(signature);
            if (name && removedValues.some((item) => this.getFunctionName(item) === name)) {
                changed.push(signature);
            } else {
                added.push(signature);
            }
        }

        for (const signature of removedValues) {
            const name = this.getFunctionName(signature);
            if (!name) {
                continue;
            }
            if (!changed.some((item) => this.getFunctionName(item) === name)) {
                removedNames.push(name);
            }
        }

        return {
            changed: changed.slice(0, 50),
            added: added.slice(0, 50),
            removed: Array.from(new Set(removedNames)).slice(0, 50),
        };
    }

    private extractFunctionSignatures(content: string, languageId: string): Map<string, string> {
        const signatures = new Map<string, string>();
        const lines = content.split(/\r?\n/);

        const tsPatterns = [
            /^\s*function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^\{]+)?\s*\{?\s*$/,
            /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*\{?\s*$/,
            /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^\{]+)?\s*\{\s*$/,
        ];
        const pyPattern = /^\s*def\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*:\s*$/;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            if (languageId === 'python') {
                const py = trimmed.match(pyPattern);
                if (py?.[1]) {
                    signatures.set(py[1], trimmed);
                }
                continue;
            }

            for (const pattern of tsPatterns) {
                const match = trimmed.match(pattern);
                if (match?.[1]) {
                    signatures.set(match[1], trimmed);
                    break;
                }
            }
        }

        return signatures;
    }

    private getFunctionName(signature: string): string | null {
        return signature.match(/(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(/)?.[1] || null;
    }

    private async getRecentCommits(limit: number): Promise<RecentCommitCapture[]> {
        try {
            const logOutput = await this.runGitCommand([
                'log',
                `-${Math.max(1, limit)}`,
                '--pretty=format:%H%x1f%s%x1f%ct%x1f%an',
            ]);

            if (!logOutput.trim()) {
                return [];
            }

            const commits: RecentCommitCapture[] = [];
            const lines = logOutput.split(/\r?\n/).filter((line) => line.trim().length > 0);

            for (const line of lines) {
                const [hash, message, timestampRaw, author] = line.split('\u001f');
                const filesRaw = hash ? await this.runGitCommand(['show', '--name-only', '--pretty=format:', hash]) : '';
                const filesChanged = filesRaw
                    .split(/\r?\n/)
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0)
                    .slice(0, 60);

                commits.push({
                    hash: hash || '',
                    message: message || '',
                    filesChanged,
                    timestamp: Number(timestampRaw || 0) * 1000,
                    author: author || '',
                });
            }

            return commits;
        } catch {
            return [];
        }
    }

    private async getDiffStats(): Promise<DiffStatsCapture> {
        try {
            const shortStat = await this.runGitCommand(['diff', '--shortstat', 'HEAD']);
            const changedFilesRaw = await this.runGitCommand(['diff', '--name-only', 'HEAD']);

            const filesModified = Number(shortStat.match(/(\d+)\s+files?\s+changed/i)?.[1] || 0);
            const insertions = Number(shortStat.match(/(\d+)\s+insertions?\(\+\)/i)?.[1] || 0);
            const deletions = Number(shortStat.match(/(\d+)\s+deletions?\(-\)/i)?.[1] || 0);

            return {
                filesModified,
                insertions,
                deletions,
                changedFiles: changedFilesRaw
                    .split(/\r?\n/)
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0)
                    .slice(0, 200),
            };
        } catch {
            return {
                filesModified: 0,
                insertions: 0,
                deletions: 0,
                changedFiles: [],
            };
        }
    }

    private async runGitCommand(args: string[]): Promise<string> {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
            return '';
        }

        return await new Promise<string>((resolve, reject) => {
            execFile('git', args, { cwd }, (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout || '');
            });
        });
    }

    private async getCurrentGitBranch(): Promise<string | null> {
        try {
            const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
            const api = gitExt?.getAPI(1);
            const repo = api?.repositories[0];
            return repo?.state?.HEAD?.name ?? null;
        } catch {
            return null;
        }
    }

    dispose(): void {
        this.debouncer.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
