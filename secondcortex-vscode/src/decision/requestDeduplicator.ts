export class RequestDeduplicator<T> {
    private inFlight = new Map<string, Promise<T | null>>();

    async deduplicate(
        key: string,
        fetcher: () => Promise<T | null>
    ): Promise<T | null> {
        const existing = this.inFlight.get(key);
        if (existing) {
            return existing;
        }

        const promise = fetcher().finally(() => {
            this.inFlight.delete(key);
        });

        this.inFlight.set(key, promise);
        return promise;
    }
}
