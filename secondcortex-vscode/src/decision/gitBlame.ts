import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BlameResult } from './types';

const execFileAsync = promisify(execFile);

export async function runGitBlame(
    filePath: string,
    range: vscode.Range
): Promise<BlameResult | null> {
    const workspaceRoot = getWorkspaceRoot(filePath);
    if (!workspaceRoot) {
        return null;
    }

    try {
        const startLine = range.start.line + 1;
        const endLine = Math.min(range.end.line + 5, startLine + 20);

        const { stdout } = await execFileAsync(
            'git',
            ['blame', '-L', `${startLine},${endLine}`, '--porcelain', '--', filePath],
            { cwd: workspaceRoot, timeout: 2000 }
        );

        return parseBlameOutput(stdout);
    } catch {
        return null;
    }
}

function getWorkspaceRoot(filePath: string): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.find((folder) => {
        const normalizedFolder = folder.uri.fsPath.toLowerCase();
        const normalizedFile = filePath.toLowerCase();
        return normalizedFile.startsWith(normalizedFolder);
    });

    return workspaceFolder?.uri.fsPath ?? null;
}

function parseBlameOutput(raw: string): BlameResult {
    const lines = raw.split('\n');
    const commitHash = (lines[0]?.split(' ')[0] ?? '').substring(0, 8);

    const authorLine = lines.find((line) => line.startsWith('author '));
    const timeLine = lines.find((line) => line.startsWith('author-time '));
    const summaryLine = lines.find((line) => line.startsWith('summary '));

    const epoch = parseInt((timeLine?.replace('author-time ', '') ?? '0'), 10);

    return {
        commitHash,
        author: authorLine?.replace('author ', '') ?? 'Unknown',
        timestamp: Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date(0),
        commitMessage: summaryLine?.replace('summary ', '') ?? '',
        linesChanged: lines.filter((line) => line.startsWith('\t')).length,
    };
}
