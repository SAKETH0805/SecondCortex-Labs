import * as vscode from 'vscode';
import { DecisionResult } from './types';

interface CacheEntry {
    result: DecisionResult;
    timestamp: number;
    hitCount: number;
}

export class DecisionCache {
    private cache = new Map<string, CacheEntry>();
    private readonly maxSize = 200;
    private readonly ttlMs = 30 * 60 * 1000;

    get(key: string): DecisionResult | null {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }

        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }

        entry.hitCount += 1;
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.result;
    }

    set(key: string, result: DecisionResult): void {
        if (this.cache.size >= this.maxSize) {
            const lruKey = this.cache.keys().next().value as string | undefined;
            if (lruKey) {
                this.cache.delete(lruKey);
            }
        }

        this.cache.set(key, {
            result,
            timestamp: Date.now(),
            hitCount: 1,
        });
    }

    buildKey(filePath: string, symbolName: string, commitHash: string): string {
        const relativePath = vscode.workspace.asRelativePath(filePath);
        return `${relativePath}::${symbolName}::${commitHash}`;
    }
}
