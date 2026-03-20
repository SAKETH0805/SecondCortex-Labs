import * as vscode from 'vscode';
import { ExtractedSymbol } from './types';

export const SUPPORTED_LANGUAGES = [
    'typescript',
    'javascript',
    'python',
    'go',
    'rust',
    'java',
    'cpp',
];

const SKIP_TOKENS = new Set([
    'if', 'else', 'for', 'while', 'return', 'const', 'let', 'var',
    'async', 'await', 'import', 'export', 'from', 'class', 'extends',
    'true', 'false', 'null', 'undefined', 'this', 'super',
]);

const DEFINITION_PATTERNS: RegExp[] = [
    /\bfunction\s+[A-Za-z_]\w*\s*\(/,
    /\bconst\s+[A-Za-z_]\w*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
    /\bconst\s+[A-Za-z_]\w*\s*=\s*(?:async\s+)?[A-Za-z_]\w*\s*=>/,
    /\bdef\s+[A-Za-z_]\w*\s*\(/,
    /\bfunc\s+(?:\([^)]+\)\s+)?[A-Za-z_]\w*\s*\(/,
    /\bfn\s+[A-Za-z_]\w*\s*\(/,
    /\bclass\s+[A-Za-z_]\w*/,
];

export function extractSymbol(
    document: vscode.TextDocument,
    position: vscode.Position
): ExtractedSymbol | null {
    const line = document.lineAt(position.line).text;
    const token = getIdentifierAtPosition(line, position.character);
    if (!token) {
        return null;
    }

    if (SKIP_TOKENS.has(token.value) || token.value.length < 3) {
        return null;
    }

    const isDefinition = DEFINITION_PATTERNS.some((pattern) => pattern.test(line));
    const callWindowStart = Math.max(0, token.start - 1);
    const callWindowEnd = Math.min(line.length, token.end + 12);
    const callWindow = line.slice(callWindowStart, callWindowEnd);
    const isFunctionCall = /[A-Za-z_]\w*\s*\(/.test(callWindow);
    const isClass = /\bclass\s+[A-Za-z_]\w*/.test(line);

    if (!isDefinition && !isFunctionCall && !isClass) {
        return null;
    }

    const signature = extractSignature(document, position.line);

    return {
        name: token.value,
        kind: isClass ? 'class' : (isDefinition ? 'definition' : 'call'),
        range: new vscode.Range(position.line, token.start, position.line, token.end),
        signature,
    };
}

export function extractTopSymbols(document: vscode.TextDocument, limit: number): ExtractedSymbol[] {
    const symbols: Array<{ symbol: ExtractedSymbol; score: number }> = [];

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
        const line = document.lineAt(lineNumber).text;
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        if (!DEFINITION_PATTERNS.some((pattern) => pattern.test(line))) {
            continue;
        }

        const nameMatch = trimmed.match(/[A-Za-z_]\w*/);
        if (!nameMatch) {
            continue;
        }

        const start = line.indexOf(nameMatch[0]);
        if (start < 0) {
            continue;
        }

        const symbol: ExtractedSymbol = {
            name: nameMatch[0],
            kind: /\bclass\b/.test(trimmed) ? 'class' : 'definition',
            range: new vscode.Range(lineNumber, start, lineNumber, start + nameMatch[0].length),
            signature: extractSignature(document, lineNumber),
        };

        symbols.push({ symbol, score: symbol.signature.length });
    }

    symbols.sort((a, b) => b.score - a.score);
    return symbols.slice(0, limit).map((item) => item.symbol);
}

function extractSignature(document: vscode.TextDocument, startLine: number): string {
    const parts: string[] = [];
    const maxLine = Math.min(document.lineCount - 1, startLine + 2);

    for (let lineNumber = startLine; lineNumber <= maxLine; lineNumber += 1) {
        const text = document.lineAt(lineNumber).text.trim();
        if (!text) {
            continue;
        }
        parts.push(text);

        if (/[{:]$/.test(text) || text.includes(')')) {
            break;
        }
    }

    return parts.join(' ').slice(0, 280);
}

function getIdentifierAtPosition(
    line: string,
    character: number
): { value: string; start: number; end: number } | null {
    const identifierRegex = /[A-Za-z_][A-Za-z0-9_]*/g;
    let match = identifierRegex.exec(line);

    while (match) {
        const start = match.index;
        const end = start + match[0].length;
        if (character >= start && character <= end) {
            return {
                value: match[0],
                start,
                end,
            };
        }
        match = identifierRegex.exec(line);
    }

    return null;
}
