import * as vscode from 'vscode';

export interface ExtractedSymbol {
    name: string;
    kind: 'definition' | 'call' | 'class';
    range: vscode.Range;
    signature: string;
}

export interface BlameResult {
    commitHash: string;
    author: string;
    timestamp: Date;
    commitMessage: string;
    linesChanged: number;
}

export interface DecisionResult {
    found: boolean;
    summary: string;
    branchesTried: string[];
    terminalCommands: string[];
    confidence: number;
}

export interface PrefetchJob {
    document: vscode.TextDocument;
    symbol: ExtractedSymbol;
}
