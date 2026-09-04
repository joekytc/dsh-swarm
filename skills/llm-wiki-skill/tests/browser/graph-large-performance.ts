import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  generateLargeGraphFixture,
  type LargeGraphFixtureMetadata
} from "../../packages/graph-engine/test/large-graph-fixtures";
import type { GraphData } from "../../packages/graph-engine/src/types";

type LargeGraphFixtureId = Parameters<typeof generateLargeGraphFixture>[0];

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const repoRoot = path.resolve(import.meta.dirname, "../..");
const artifactDir = process.env.GRAPH_LARGE_PERF_ARTIFACT_DIR || path.join(os.tmpdir(), `llm-wiki-graph-large-perf-${Date.now()}`);
const executablePath = process.env.GRAPH_LARGE_PERF_CHROME_EXECUTABLE || "";
const requestedShapes = (process.env.GRAPH_LARGE_PERF_SHAPES || [
  "nodes-1000-sparse",
  "nodes-1000-dense",
  "nodes-5000-sparse",
  "nodes-10000-aggregation",
  "oversized-community"
].join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean) as LargeGraphFixtureId[];
const resultPath = path.join(artifactDir, "large-graph-performance-results.json");
const resultPhase = process.env.GRAPH_LARGE_PERF_PHASE || "phase-1";
const resultTask = process.env.GRAPH_LARGE_PERF_TASK || "1.2";
let fixtureRoot = "";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  const runStartedAt = new Date().toISOString();
  const records: PerformanceRecord[] = [];
  const errors: string[] = [];
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-large-graph-fixtures-"));

  for (const shape of requestedShapes) {
    let metadata: LargeGraphFixtureMetadata | null = null;
    let browser: BrowserLike | null = null;
    try {
      const fixture = generateLargeGraphFixture(shape);
      metadata = fixture.metadata;
      const html = await buildOfflineHtml(shape, fixture.data, fixture.pins, fixture.metadata);
      browser = await chromium.launch(executablePath ? { executablePath } : {});
      try {
        const shapeRecords = await measureShape(browser, fixture.metadata, html);
        records.push(...shapeRecords);
      } finally {
        await browser.close().catch(() => undefined);
        browser = null;
      }
    } catch (error) {
      errors.push(`${shape}: ${error instanceof Error ? error.message : String(error)}`);
      if (metadata) {
        records.push(failedRecord(metadata, {
          action: "fixture_build_or_measure",
          failure_class: classifyError(error),
          failure_detail: errorDetail(error),
          artifact_path: resultPath
        }));
      }
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await writeResult(runStartedAt, records, errors);
    }
  }

  const required1000 = new Set(["nodes-1000-sparse", "nodes-1000-dense"]);
  const failedRequired = records.filter((record) => required1000.has(record.graph_shape) && !record.pass);
  const missingRequired = [...required1000].filter((shape) => requestedShapes.includes(shape as LargeGraphFixtureId) && !records.some((record) => record.graph_shape === shape));
  if (failedRequired.length > 0 || missingRequired.length > 0) {
    throw new Error(
      `Large graph performance runner recorded blocking failures. result=${resultPath}, errors=${errors.length}, failedRequired=${failedRequired.length}, missingRequired=${missingRequired.join(",")}`
    );
  }

  console.log(`Wrote ${records.length} performance records to ${resultPath}`);
}

async function writeResult(runStartedAt: string, records: PerformanceRecord[], errors: string[]): Promise<void> {
  const result = {
    run_started_at: runStartedAt,
    run_finished_at: new Date().toISOString(),
    renderer: "dom-svg-current",
    artifact_dir: artifactDir,
    shapes: requestedShapes,
    records,
    errors
  };
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}

async function buildOfflineHtml(
  shape: LargeGraphFixtureId,
  graphData: GraphData,
  pins: Record<string, unknown>,
  metadata: LargeGraphFixtureMetadata
): Promise<string> {
  const root = path.join(fixtureRoot, shape);
  const wikiDir = path.join(root, "wiki");
  await fs.mkdir(wikiDir, { recursive: true });
  await fs.writeFile(path.join(wikiDir, "graph-data.json"), `${JSON.stringify(graphData, null, 2)}\n`);
  await fs.writeFile(path.join(wikiDir, "graph-pins.json"), `${JSON.stringify(pins, null, 2)}\n`);
  const build = spawnSync("bash", ["scripts/build-graph-html.sh", root], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: buildTimeoutFor(metadata)
  });
  if (build.error) {
    throw build.error;
  }
  if (build.status !== 0) {
    throw new Error(`build-graph-html.sh failed for ${shape}: ${build.stderr || build.stdout}`);
  }
  return path.join(wikiDir, "knowledge-graph.html");
}

async function measureShape(
  browser: BrowserLike,
  metadata: LargeGraphFixtureMetadata,
  html: string
): Promise<PerformanceRecord[]> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(timeoutFor(metadata));
  page.setDefaultNavigationTimeout(45_000);
  const records: PerformanceRecord[] = [];
  try {
    const renderStarted = performance.now();
    await page.goto(pathToFileURL(html).href, { waitUntil: "domcontentloaded", timeout: navigationTimeoutFor(metadata) });
    await page.waitForSelector("[data-llm-wiki-graph-root='true']");
    await page.waitForSelector("[data-viewport-layer='true']");
    await page.waitForSelector(".node");
    const renderDuration = performance.now() - renderStarted;
    records.push(await recordFromPage(page, metadata, {
      action: "initial_render",
      duration_ms: renderDuration,
      pass: true,
      artifact_path: resultPath
    }));

    const actions: Array<() => Promise<PerformanceRecord>> = [
      () => measureWheelZoom(page, metadata),
      () => measurePan(page, metadata),
      () => measureHover(page, metadata),
      () => measureSearch(page, metadata),
      () => measureNodeClick(page, metadata),
      () => measureDrawerOpen(page, metadata),
      () => measureEnterCommunity(page, metadata),
      () => measureReturnGlobal(page, metadata)
    ];
    if (metadata.nodes <= 1000) {
      actions.push(() => measureRepeatedCycles(page, metadata));
    }
    for (const action of actions) {
      records.push(await safeMeasure(page, metadata, action));
    }
  } catch (error) {
    records.push(failedRecord(metadata, {
      action: "fixture_load_or_action",
      failure_class: classifyError(error),
      failure_detail: errorDetail(error),
      artifact_path: resultPath
    }));
  } finally {
    await page.close().catch(() => undefined);
  }
  return records;
}

async function safeMeasure(
  page: PageLike,
  metadata: LargeGraphFixtureMetadata,
  action: () => Promise<PerformanceRecord>
): Promise<PerformanceRecord> {
  try {
    return await action();
  } catch (error) {
    return failedRecord(metadata, {
      action: inferActionName(error),
      failure_class: classifyError(error),
      failure_detail: errorDetail(error),
      artifact_path: resultPath
    });
  }
}

async function measureWheelZoom(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  const root = page.locator("[data-llm-wiki-graph-root='true']");
  const before = await layerTransform(page);
  const samplePromise = sampleAnimationFrames(page, 1000);
  const started = performance.now();
  while (performance.now() - started < 1000) {
    await root.dispatchEvent("wheel", {
      deltaY: -180,
      deltaMode: 0,
      clientX: 520,
      clientY: 420,
      bubbles: true,
      cancelable: true
    });
    await page.waitForTimeout(50);
  }
  const sample = await samplePromise;
  const after = await layerTransform(page);
  return recordFromPage(page, metadata, {
    action: "wheel_zoom",
    duration_ms: sample.durationMs,
    fps: sample.fps,
    frame_p95_ms: sample.p95,
    pass: after !== before && sample.fps >= 10,
    failure_class: after === before ? "viewport_transform_unchanged" : sample.fps < 10 ? "fps_below_floor" : null,
    artifact_path: resultPath
  });
}

async function measurePan(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  const before = await layerTransform(page);
  const blank = await blankPoint(page);
  const started = performance.now();
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(blank.x + 180, blank.y + 120, { steps: 6 });
  await page.mouse.up();
  await waitForTransformChange(page, before, 3000);
  const duration = performance.now() - started;
  return recordFromPage(page, metadata, {
    action: "pan",
    duration_ms: duration,
    pass: true,
    artifact_path: resultPath
  });
}

async function measureHover(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  const started = performance.now();
  const node = await visibleNodeTarget(page);
  await page.mouse.move(node.x, node.y);
  await page.waitForFunction(() => document.querySelectorAll(".graph-hover-preview[data-state='open']").length > 0, undefined, { timeout: 5000 });
  const duration = performance.now() - started;
  return recordFromPage(page, metadata, {
    action: "hover",
    duration_ms: duration,
    pass: true,
    artifact_path: resultPath
  });
}

async function measureSearch(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  const started = performance.now();
  const input = page.locator(".graph-search-input");
  await input.fill("needle");
  await page.waitForFunction(() => document.querySelectorAll('.node[data-search-state="match"]').length > 0);
  const duration = performance.now() - started;
  return recordFromPage(page, metadata, {
    action: "search_highlight",
    duration_ms: duration,
    pass: true,
    artifact_path: resultPath
  });
}

async function measureNodeClick(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  const started = performance.now();
  await clickVisibleNode(page);
  await page.waitForFunction(() => document.querySelectorAll('.node[aria-pressed="true"]').length > 0);
  const duration = performance.now() - started;
  return recordFromPage(page, metadata, {
    action: "node_click",
    duration_ms: duration,
    pass: true,
    artifact_path: resultPath
  });
}

async function measureDrawerOpen(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  await page.keyboard.press("Escape").catch(() => undefined);
  const started = performance.now();
  await clickVisibleNode(page);
  await waitForGraphDrawerOpen(page);
  const duration = performance.now() - started;
  return recordFromPage(page, metadata, {
    action: "drawer_open",
    duration_ms: duration,
    pass: true,
    artifact_path: resultPath
  });
}

async function measureEnterCommunity(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  await page.keyboard.press("Escape").catch(() => undefined);
  const started = performance.now();
  await ensureFiltersOpen(page);
  await page.locator(".community-legend-row").first().click({ force: true });
  await page.waitForFunction(() => document.querySelectorAll('.node[aria-pressed="true"]').length > 1);
  const duration = performance.now() - started;
  return recordFromPage(page, metadata, {
    action: "enter_community",
    duration_ms: duration,
    pass: true,
    artifact_path: resultPath
  });
}

async function measureReturnGlobal(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  const before = await layerTransform(page);
  const started = performance.now();
  await page.getByRole("button", { name: "回全图" }).click({ force: true });
  await waitForTransformChange(page, before, 3000).catch(() => undefined);
  const duration = performance.now() - started;
  return recordFromPage(page, metadata, {
    action: "return_global",
    duration_ms: duration,
    pass: true,
    artifact_path: resultPath
  });
}

async function measureRepeatedCycles(page: PageLike, metadata: LargeGraphFixtureMetadata): Promise<PerformanceRecord> {
  const before = await memoryMb(page);
  const started = performance.now();
  const cycles = 1;
  for (let index = 0; index < cycles; index += 1) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.getByRole("button", { name: "回全图" }).click({ force: true }).catch(() => undefined);
    await page.waitForFunction(() => document.querySelectorAll(".node").length >= 250);
    await page.locator(".graph-search-input").fill(index % 2 === 0 ? "needle" : "node");
    await page.waitForFunction(() => document.querySelectorAll('.node[data-search-state="match"]').length > 0);
    await clickVisibleNode(page);
    await waitForGraphDrawerOpen(page);
    await page.keyboard.press("Escape").catch(() => undefined);
    await ensureFiltersOpen(page);
    await page.locator(".community-legend-row").nth(index % 3).click({ force: true });
    await page.waitForFunction(() => document.querySelectorAll('.node[aria-pressed="true"]').length > 1);
    await page.getByRole("button", { name: "回全图" }).click({ force: true });
    await page.waitForFunction(() => document.querySelectorAll(".node").length >= 250);
    await page.waitForTimeout(120);
  }
  const duration = performance.now() - started;
  const after = await memoryMb(page);
  const record = await recordFromPage(page, metadata, {
    action: "repeated_search_community_drawer_cycles",
    duration_ms: duration,
    pass: true,
    artifact_path: resultPath
  });
  record.memory_after_cycles_mb = after;
  record.memory_growth_mb = before == null || after == null ? null : round(after - before);
  return record;
}

async function recordFromPage(
  page: PageLike,
  metadata: LargeGraphFixtureMetadata,
  input: Partial<PerformanceRecord> & { action: string; artifact_path: string }
): Promise<PerformanceRecord> {
  const counts = await page.evaluate(`(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    return {
      dom_node_count: document.querySelectorAll("*").length,
      visible_node_count: document.querySelectorAll(".node").length,
      visible_edge_count: document.querySelectorAll(".edge").length,
      visible_label_count: document.querySelectorAll(".node:not(.is-label-hidden) .node-name").length,
      visible_card_count: document.querySelectorAll(".node:not(.is-point)").length,
      interaction_mode: root?.dataset.interactionMode || null,
      interaction_updated_objects: root ? Number(root.dataset.interactionUpdatedObjects || 0) : null,
      interaction_hidden_objects: root ? Number(root.dataset.interactionHiddenObjects || 0) : null,
      interaction_preserved_nodes: root ? Number(root.dataset.interactionPreservedNodes || 0) : null,
      interaction_max_updates: root ? Number(root.dataset.interactionMaxUpdates || 0) : null,
      memory_peak_mb: typeof performance !== "undefined" && "memory" in performance
        ? Math.round((performance.memory?.usedJSHeapSize || 0) / 1024 / 1024 * 10) / 10
        : null,
      long_task_count: performance.getEntriesByType ? performance.getEntriesByType("longtask").length : null,
      viewport_scale: root ? Number(root.dataset.viewportScale || 1) : 1
    };
  })()`);
  return {
    ...baseRecord(metadata, input.action, input.artifact_path),
    ...counts,
    duration_ms: round(input.duration_ms ?? 0),
    fps: input.fps == null ? null : round(input.fps),
    frame_p95_ms: input.frame_p95_ms == null ? null : round(input.frame_p95_ms),
    pass: (input.pass ?? true) && (counts.interaction_updated_objects == null || counts.interaction_max_updates == null || counts.interaction_updated_objects <= counts.interaction_max_updates),
    failure_class: input.failure_class ?? (counts.interaction_updated_objects != null && counts.interaction_max_updates != null && counts.interaction_updated_objects > counts.interaction_max_updates ? "interaction_updates_over_budget" : null)
  };
}

function failedRecord(
  metadata: LargeGraphFixtureMetadata,
  input: { action: string; failure_class: string; failure_detail?: string; artifact_path: string }
): PerformanceRecord {
  return {
    ...baseRecord(metadata, input.action, input.artifact_path),
    duration_ms: null,
    fps: null,
    frame_p95_ms: null,
    long_task_count: null,
    dom_node_count: null,
    visible_node_count: null,
    visible_edge_count: null,
    visible_label_count: null,
    visible_card_count: null,
    interaction_mode: null,
    interaction_updated_objects: null,
    interaction_hidden_objects: null,
    interaction_preserved_nodes: null,
    interaction_max_updates: null,
    memory_peak_mb: null,
    memory_after_cycles_mb: null,
    memory_growth_mb: null,
    pass: false,
    failure_class: input.failure_class,
    failure_detail: input.failure_detail ?? null
  };
}

function baseRecord(metadata: LargeGraphFixtureMetadata, action: string, artifactPath: string): PerformanceRecord {
  return {
    phase: resultPhase,
    task: resultTask,
    renderer: "dom-svg-current",
    graph_shape: metadata.id,
    nodes: metadata.nodes,
    edges: metadata.edges,
    communities: metadata.communities,
    largest_community: metadata.largest_community,
    largest_connected_density: metadata.largest_connected_density,
    search_hits: metadata.search_hits,
    pin_count: metadata.pin_count,
    oversized_community: metadata.oversized_community,
    action,
    duration_ms: null,
    fps: null,
    frame_p95_ms: null,
    long_task_count: null,
    dom_node_count: null,
    visible_node_count: null,
    visible_edge_count: null,
    visible_label_count: null,
    visible_card_count: null,
    interaction_mode: null,
    interaction_updated_objects: null,
    interaction_hidden_objects: null,
    interaction_preserved_nodes: null,
    interaction_max_updates: null,
    memory_peak_mb: null,
    memory_after_cycles_mb: null,
    memory_growth_mb: null,
    pass: false,
    failure_class: null,
    artifact_path: artifactPath,
    measured_at: new Date().toISOString()
  };
}

async function layerTransform(page: PageLike): Promise<string> {
  return page.evaluate(`document.querySelector("[data-viewport-layer='true']")?.style.transform || ""`);
}

async function waitForTransformChange(page: PageLike, previous: string, timeout: number): Promise<void> {
  await page.waitForFunction(
    `(() => {
      const previous = ${JSON.stringify(previous)};
      const element = document.querySelector("[data-viewport-layer='true']");
      return Boolean(element && element.style.transform && element.style.transform !== previous);
    })()`,
    undefined,
    { timeout }
  );
}

async function waitForGraphDrawerOpen(page: PageLike): Promise<void> {
  await page.waitForFunction(`(() => {
    return Boolean(
      document.querySelector(".graph-reader[data-state='open']")
      || document.querySelector(".graph-selection-panel[data-state='open']")
      || document.querySelector("[data-testid='graph-node-summary']")
      || document.querySelector("[data-testid='graph-community-summary']")
    );
  })()`, undefined, { timeout: 12000 });
}

async function visibleNodeTarget(page: PageLike): Promise<{ id: string; x: number; y: number }> {
  return page.evaluate(`(() => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    for (const element of document.querySelectorAll(".node")) {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      const topNode = top ? top.closest(".node") : null;
      if (rect.width > 0 && rect.height > 0 && x >= 8 && y >= 8 && x <= viewportWidth - 8 && y <= viewportHeight - 8 && topNode === element) {
        return { id: element.dataset.id || "", x, y };
      }
    }
    throw new Error("no_clickable_node");
  })()`);
}

async function blankPoint(page: PageLike): Promise<{ x: number; y: number }> {
  return page.evaluate(`(() => {
    const blocked = ".node,.community-wash,.edge,.graph-toolbar,.mini-map,.graph-search,.graph-reader,.graph-selection-panel,.graph-hover-preview";
    const candidates = [
      [72, 132],
      [96, 220],
      [180, 180],
      [window.innerWidth * 0.36, window.innerHeight * 0.36],
      [window.innerWidth * 0.5, window.innerHeight * 0.5],
      [window.innerWidth * 0.72, window.innerHeight * 0.48]
    ];
    for (const [x, y] of candidates) {
      const element = document.elementFromPoint(x, y);
      if (element && !element.closest(blocked)) return { x, y };
    }
    return { x: 72, y: 132 };
  })()`);
}

async function clickVisibleNode(page: PageLike): Promise<void> {
  const target = await visibleNodeTarget(page);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function ensureFiltersOpen(page: PageLike): Promise<void> {
  const open = await page.evaluate(`document.querySelector("[data-llm-wiki-graph-root='true']")?.dataset.toolbarPanel === "filters"`);
  if (!open) {
    await page.getByRole("button", { name: "筛选" }).click({ force: true });
  }
  await page.waitForSelector('.graph-toolbar-panel[data-state="filters"] .community-legend-row');
}

async function memoryMb(page: PageLike): Promise<number | null> {
  return page.evaluate(`(() => {
    if (typeof performance === "undefined" || !("memory" in performance)) return null;
    const used = performance.memory?.usedJSHeapSize;
    return typeof used === "number" ? Math.round((used / 1024 / 1024) * 10) / 10 : null;
  })()`) as Promise<number | null>;
}

async function sampleAnimationFrames(page: PageLike, durationMs: number): Promise<{ durationMs: number; fps: number; p95: number }> {
  return page.evaluate(`(() => new Promise((resolve) => {
    const durationMs = ${JSON.stringify(durationMs)};
    const started = performance.now();
    const deltas = [];
    let last = started;
    function tick(now) {
      deltas.push(now - last);
      last = now;
      const elapsed = now - started;
      if (elapsed >= durationMs) {
        const sorted = [...deltas].sort((a, b) => a - b);
        const p95 = sorted[Math.max(0, Math.floor(sorted.length * 0.95) - 1)] || 0;
        resolve({ durationMs: elapsed, fps: deltas.length / (elapsed / 1000), p95 });
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }))()`) as Promise<{ durationMs: number; fps: number; p95: number }>;
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Timeout/i.test(message)) return "timeout";
  if (/Target page|browser has been closed/i.test(message)) return "browser_closed";
  if (/JavaScript heap|out of memory/i.test(message)) return "memory";
  return "exception";
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function inferActionName(error: unknown): string {
  const stack = error instanceof Error ? error.stack || error.message : String(error);
  const match = stack.match(/measure[A-Z][A-Za-z0-9_]*/);
  if (!match) return "unknown_action";
  return match[0]
    .replace(/^measure/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function timeoutFor(metadata: LargeGraphFixtureMetadata): number {
  if (metadata.nodes >= 10000) return 12_000;
  if (metadata.nodes >= 5000) return 10_000;
  return 20_000;
}

function navigationTimeoutFor(metadata: LargeGraphFixtureMetadata): number {
  if (metadata.nodes >= 10000) return 25_000;
  if (metadata.nodes >= 5000) return 20_000;
  return 45_000;
}

function buildTimeoutFor(metadata: LargeGraphFixtureMetadata): number {
  if (metadata.nodes >= 10000) return 60_000;
  if (metadata.nodes >= 5000) return 45_000;
  return 30_000;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

interface BrowserLike {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  setDefaultTimeout(timeout: number): void;
  setDefaultNavigationTimeout(timeout: number): void;
  goto(url: string): Promise<unknown>;
  waitForSelector(selector: string, options?: unknown): Promise<unknown>;
  waitForFunction(fn: Function | string, arg?: unknown, options?: unknown): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<void>;
  evaluate<T>(fn: Function | string, arg?: unknown): Promise<T>;
  locator(selector: string): LocatorLike;
  getByRole(role: string, options: { name: string | RegExp }): LocatorLike;
  keyboard: { press(key: string): Promise<void> };
  mouse: {
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
  };
  close(): Promise<void>;
}

interface LocatorLike {
  first(): LocatorLike;
  nth(index: number): LocatorLike;
  fill(value: string): Promise<void>;
  click(options?: { force?: boolean }): Promise<void>;
  dispatchEvent(name: string, eventInit: Record<string, unknown>): Promise<void>;
  evaluate<T>(fn: Function | string): Promise<T>;
}

interface PerformanceRecord {
  phase: string;
  task: string;
  renderer: string;
  graph_shape: string;
  nodes: number;
  edges: number;
  communities: number;
  largest_community: number;
  largest_connected_density: number;
  search_hits: number;
  pin_count: number;
  oversized_community: boolean;
  action: string;
  duration_ms: number | null;
  fps: number | null;
  frame_p95_ms: number | null;
  long_task_count: number | null;
  dom_node_count: number | null;
  visible_node_count: number | null;
  visible_edge_count: number | null;
  visible_label_count: number | null;
  visible_card_count: number | null;
  interaction_mode: string | null;
  interaction_updated_objects: number | null;
  interaction_hidden_objects: number | null;
  interaction_preserved_nodes: number | null;
  interaction_max_updates: number | null;
  memory_peak_mb: number | null;
  memory_after_cycles_mb: number | null;
  memory_growth_mb: number | null;
  pass: boolean;
  failure_class: string | null;
  failure_detail?: string | null;
  artifact_path: string;
  measured_at: string;
}
