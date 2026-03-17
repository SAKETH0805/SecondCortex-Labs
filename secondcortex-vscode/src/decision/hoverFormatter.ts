import * as vscode from 'vscode';
import { BlameResult, DecisionResult, ExtractedSymbol } from './types';

export function formatHover(
    result: DecisionResult,
    blame: BlameResult,
    symbol: ExtractedSymbol
): vscode.Hover {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    md.appendMarkdown(`### 🧠 Decision History: \`${symbol.name}\`\n\n`);
    md.appendMarkdown(
        `*Last changed by **${blame.author}** on ${blame.timestamp.toLocaleDateString()} — ` +
        `"${blame.commitMessage}"*\n\n`
    );
    md.appendMarkdown('---\n\n');

    if (!result.found) {
        md.appendMarkdown('*No workspace history found for this change.*\n');
    } else {
        md.appendMarkdown(`${result.summary}\n\n`);

        if (result.branchesTried.length > 0) {
            md.appendMarkdown('**Branches tried:** ');
            md.appendMarkdown(result.branchesTried.map((branch) => `\`${branch}\``).join(' → '));
            md.appendMarkdown('\n\n');
        }

        if (result.terminalCommands.length > 0) {
            md.appendMarkdown('**Key commands:**\n');
            for (const command of result.terminalCommands.slice(0, 3)) {
                md.appendMarkdown(`\`${command}\`\n`);
            }
            md.appendMarkdown('\n');
        }

        const confidenceBars = Math.round(result.confidence * 5);
        const bar = '█'.repeat(confidenceBars) + '░'.repeat(5 - confidenceBars);
        md.appendMarkdown(`\n*Context confidence: ${bar} (${Math.round(result.confidence * 100)}%)*`);
    }

    return new vscode.Hover(md, symbol.range);
}

export function formatPartialHover(
    blame: BlameResult,
    symbol: ExtractedSymbol
): vscode.Hover {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### 🧠 \`${symbol.name}\`\n\n`);
    md.appendMarkdown(
        `*${blame.author} · ${blame.timestamp.toLocaleDateString()} · "${blame.commitMessage}"*\n\n`
    );
    md.appendMarkdown('*Loading decision history...*');
    return new vscode.Hover(md, symbol.range);
}
