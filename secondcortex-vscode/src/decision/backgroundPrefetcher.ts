import * as vscode from 'vscode';
import { BackendClient } from '../backendClient';
import { DecisionCache } from './decisionCache';
import { runGitBlame } from './gitBlame';
import { RequestDeduplicator } from './requestDeduplicator';
import { fetchAndCacheDecision } from './service';
import { extractTopSymbols, SUPPORTED_LANGUAGES } from './symbolExtractor';
import { DecisionResult, PrefetchJob } from './types';

export class BackgroundPrefetcher {
    private queue: PrefetchJob[] = [];
    private isRunning = false;

    constructor(
        private client: BackendClient,
        private cache: DecisionCache,
        private deduplicator: RequestDeduplicator<DecisionResult>
    ) {}

    scheduleFile(document: vscode.TextDocument): void {
        if (!SUPPORTED_LANGUAGES.includes(document.languageId)) {
            return;
        }

        const symbols = extractTopSymbols(document, 5);
        for (const symbol of symbols) {
            this.queue.push({ document, symbol });
        }

        void this.processQueue();
    }

    private async processQueue(): Promise<void> {
        if (this.isRunning || this.queue.length === 0) {
            return;
        }

        this.isRunning = true;

        while (this.queue.length > 0) {
            const job = this.queue.shift();
            if (!job) {
                continue;
            }

            const blame = await runGitBlame(job.document.uri.fsPath, job.symbol.range);
            if (!blame) {
                continue;
            }

            const key = this.cache.buildKey(
                job.document.uri.fsPath,
                job.symbol.name,
                blame.commitHash
            );

            if (!this.cache.get(key)) {
                await delay(100);
                await fetchAndCacheDecision(
                    key,
                    job.document,
                    job.symbol,
                    blame,
                    this.client,
                    this.cache,
                    this.deduplicator
                );
            }
        }

        this.isRunning = false;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
