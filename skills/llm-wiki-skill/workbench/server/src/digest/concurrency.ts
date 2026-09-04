export interface Outcome<R> {
	ok: boolean;
	value?: R;
	error?: string;
}

export async function mapWithConcurrencyLimit<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<Outcome<R>[]> {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new Error("concurrency must be a positive integer");
	}
	const results: Outcome<R>[] = new Array(items.length);
	let cursor = 0;

	async function worker() {
		while (cursor < items.length) {
			const i = cursor++;
			try {
				results[i] = { ok: true, value: await fn(items[i] as T, i) };
			} catch (err) {
				results[i] = { ok: false, error: err instanceof Error ? err.message : String(err) };
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
	return results;
}
