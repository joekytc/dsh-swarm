import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrencyLimit } from "./concurrency.js";

test("limits active work to requested concurrency", async () => {
	let active = 0;
	let maxActive = 0;
	const items = Array.from({ length: 10 }, (_, i) => i);
	const outcomes = await mapWithConcurrencyLimit(items, 3, async (item) => {
		active++;
		maxActive = Math.max(maxActive, active);
		await new Promise((resolve) => setTimeout(resolve, 5));
		active--;
		return item * 2;
	});

	assert.equal(maxActive, 3);
	assert.deepEqual(
		outcomes.map((outcome) => outcome.value),
		items.map((item) => item * 2),
	);
	assert.ok(outcomes.every((outcome) => outcome.ok));
});

test("handles empty and smaller-than-concurrency inputs", async () => {
	assert.deepEqual(await mapWithConcurrencyLimit([], 3, async (item) => item), []);
	const outcomes = await mapWithConcurrencyLimit([1, 2], 5, async (item) => item + 1);
	assert.deepEqual(outcomes.map((outcome) => outcome.value), [2, 3]);
});

test("rejects invalid concurrency", async () => {
	await assert.rejects(() => mapWithConcurrencyLimit([1], 0, async (item) => item));
	await assert.rejects(() => mapWithConcurrencyLimit([1], -1, async (item) => item));
	await assert.rejects(() => mapWithConcurrencyLimit([1], Number.NaN, async (item) => item));
});
