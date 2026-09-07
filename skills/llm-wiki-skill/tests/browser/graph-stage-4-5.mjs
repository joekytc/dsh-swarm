import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const target = process.env.GRAPH_STAGE_4_5_TARGET || "offline";
const offlineHtml = process.env.GRAPH_STAGE_4_5_OFFLINE_HTML || "";
const denseHtml = process.env.GRAPH_STAGE_4_5_DENSE_HTML || "";
const artifactDir = process.env.GRAPH_STAGE_4_5_ARTIFACT_DIR || "";
const workbenchUrl = process.env.GRAPH_STAGE_4_5_WORKBENCH_URL || "";
const executablePath = process.env.GRAPH_STAGE_4_5_CHROME_EXECUTABLE || "";

if (target !== "offline" && target !== "workbench") {
  throw new Error(`Unknown stage 4.5 browser target: ${target}`);
}
assert.notEqual(offlineHtml, "", "GRAPH_STAGE_4_5_OFFLINE_HTML must point at generated HTML");
assert.notEqual(denseHtml, "", "GRAPH_STAGE_4_5_DENSE_HTML must point at generated dense HTML");

const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  if (target === "workbench") {
    await runWorkbenchChecks(browser);
  } else {
    await runOfflineChecks(browser);
  }
} finally {
  if (browser.isConnected()) await browser.close();
}

async function runOfflineChecks(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(offlineHtml).href);

  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector("[data-viewport-layer='true']");
  await runOfflineThemeChecks(page);

  const initial = await layerTransform(page);
  await page.mouse.move(64, 120);
  await page.mouse.wheel(0, -600);
  const zoomed = await waitForLayerTransform(page, initial);
  assert.notEqual(zoomed, initial, "wheel zoom should update the content layer transform");
  assert.notEqual(zoomed, "translate(0px, 0px) scale(1)", "wheel zoom should leave the default viewport");

  await page.mouse.move(72, 132);
  await page.mouse.down();
  await page.mouse.move(190, 182, { steps: 4 });
  await page.mouse.up();
  const panned = await waitForLayerTransform(page, zoomed);
  assert.notEqual(panned, zoomed, "blank drag should pan through the content layer transform");

  await page.mouse.dblclick(48, 132);
  const fitted = await waitForLayerTransform(page, panned);
  assert.notEqual(fitted, panned, "blank double-click should fit the graph through the content layer transform");

  await page.keyboard.down("Shift");
  await page.locator(".node").nth(0).click();
  await page.locator(".node").nth(1).click();
  await page.keyboard.up("Shift");
  const selectedAfterShiftClick = await page.locator(".node[aria-pressed='true']").count();
  assert.equal(selectedAfterShiftClick, 2, "Shift-clicking two nodes should keep both nodes selected in the graph");
  await assertOfflineSelectionPanel(page, "manual");

  await page.keyboard.press("Escape");
  await page.waitForSelector(".graph-selection-panel[data-state='closed']");
  await expectNoPressedNodes(page, "Escape should clear Shift-click selections");

  const transformBeforeReader = await layerTransform(page);
  await page.locator(".node[data-id='A']").click();
  await page.waitForSelector(".graph-reader[data-state='open']");
  const pressedAfterPlainClick = await page.locator(".node[aria-pressed='true']").count();
  assert.equal(pressedAfterPlainClick, 1, "plain node click should highlight one readable node");
  await assertOfflineReaderMeta(page, {
    title: "节点A",
    typeLabel: "实体",
    date: "2026-01-02",
    source: "不应作为实体来源链接",
    sourceLink: null
  });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".graph-reader[data-state='closed']");
  await expectNoPressedNodes(page, "Escape should clear the reader highlight");
  assert.equal(
    await layerTransform(page),
    transformBeforeReader,
    "clearing graph interaction should not reset the viewport transform"
  );

  await page.locator(".node[data-id='S']").click();
  await page.waitForSelector(".graph-reader[data-state='open']");
  await assertOfflineReaderMeta(page, {
    title: "节点来源S",
    typeLabel: "来源",
    date: "2026-01-03",
    source: "原始文章S",
    sourceLink: "/fake/wiki/sources/S.md"
  });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".graph-reader[data-state='closed']");
  await expectNoPressedNodes(page, "Escape should clear source reader highlight");

  await runSearchKeyboardChecks(page, "offline graph search should support shortcut, cycling, focus, and Escape");
  await runLegendChecks(page, { persistReload: true, expectWorkbenchDrawer: false });
  await runOfflinePinReloadCheck(page);

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "stage-4.5-offline-navigation.png"), fullPage: true });
  }
  await page.close();
  if (browser.isConnected()) await browser.close();

  const denseBrowser = await chromium.launch(executablePath ? { executablePath } : {});
  const densePage = await denseBrowser.newPage({ viewport: { width: 1440, height: 960 } });
  await densePage.goto(pathToFileURL(denseHtml).href);
  await densePage.waitForSelector("[data-llm-wiki-graph-root='true']");
  await densePage.waitForSelector("[data-viewport-layer='true']");
  await densePage.bringToFront();
  await runInteractionDegradationChecks(densePage);

  const denseInitial = await layerTransform(densePage);
  const denseRoot = densePage.locator("[data-llm-wiki-graph-root='true']");
  await denseRoot.click({ position: { x: 520, y: 420 } });
  await densePage.waitForTimeout(120);
  const idleFrameSample = await sampleAnimationFrames(densePage, 1500);
  const frameSamplePromise = sampleAnimationFrames(densePage, 3000);
  const wheelStartedAt = Date.now();
  while (Date.now() - wheelStartedAt < 3000) {
    await denseRoot.dispatchEvent("wheel", {
      deltaY: -180,
      deltaMode: 0,
      clientX: 520,
      clientY: 420,
      bubbles: true,
      cancelable: true
    });
    await densePage.waitForTimeout(50);
  }
  const frameSample = await frameSamplePromise;
  const denseZoomed = await layerTransform(densePage);
  assert.notEqual(denseZoomed, denseInitial, "continuous dense wheel interaction should keep updating the viewport");
  const minimumInteractionFps = Math.max(12, Math.min(30, idleFrameSample.fps * 0.5));
  assert.ok(
    frameSample.fps >= minimumInteractionFps,
    `dense wheel interaction should stay near the local browser baseline, baseline=${idleFrameSample.fps.toFixed(1)}fps, got ${frameSample.fps.toFixed(1)}fps`
  );

  if (artifactDir) {
    await densePage.screenshot({ path: path.join(artifactDir, "stage-4.5-offline-dense-wheel.png"), fullPage: true });
    await fs.writeFile(
      path.join(artifactDir, "stage-4.5-offline-dense-wheel.json"),
      `${JSON.stringify({
        viewport: "1440x960",
        durationMs: Math.round(frameSample.durationMs),
        frames: frameSample.frames,
        idleFps: Math.round(idleFrameSample.fps * 10) / 10,
        fps: Math.round(frameSample.fps * 10) / 10,
        minimumInteractionFps: Math.round(minimumInteractionFps * 10) / 10,
        transformChanged: denseZoomed !== denseInitial
      }, null, 2)}\n`
    );
  }
  await densePage.close();
  await denseBrowser.close();
}

async function sampleAnimationFrames(page, durationMs) {
  return page.evaluate((durationMs) => new Promise((resolve) => {
    const start = performance.now();
    let frames = 0;
    function tick() {
      frames += 1;
      const elapsed = performance.now() - start;
      if (elapsed >= durationMs) {
        resolve({ frames, durationMs: elapsed, fps: frames / (elapsed / 1000) });
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), durationMs);
}

async function runOfflineThemeChecks(page) {
  await page.waitForFunction(() => document.querySelector(".llm-wiki-graph-engine")?.dataset.theme === "shan-shui");
  await page.getByRole("button", { name: "切换墨夜主题" }).click({ force: true });
  await page.waitForFunction(() => document.querySelector(".llm-wiki-graph-engine")?.dataset.theme === "mo-ye");
  await page.getByRole("button", { name: "切换山水主题" }).click({ force: true });
  await page.waitForFunction(() => document.querySelector(".llm-wiki-graph-engine")?.dataset.theme === "shan-shui");
}

async function runInteractionDegradationChecks(page) {
  const root = page.locator("[data-llm-wiki-graph-root='true']");
  await page.waitForFunction(() => {
    const graph = document.querySelector("[data-llm-wiki-graph-root='true']");
    return graph?.dataset.interactionMode === "idle" && Number(graph.dataset.interactionMaxUpdates || 0) > 0;
  });
  await root.dispatchEvent("wheel", {
    deltaY: -180,
    deltaMode: 0,
    clientX: 520,
    clientY: 420,
    bubbles: true,
    cancelable: true
  });
  const active = await root.evaluate((element) => ({
    mode: element.dataset.interactionMode || "",
    updated: Number(element.dataset.interactionUpdatedObjects || 0),
    max: Number(element.dataset.interactionMaxUpdates || 0),
    preserved: Number(element.dataset.interactionPreservedNodes || 0),
    traceableNodes: element.querySelectorAll('.node[data-traceable="true"]').length,
    traceableEdges: element.querySelectorAll('.edge[data-traceable="true"]').length
  }));
  assert.equal(active.mode, "active", "wheel interaction should switch graph into lightweight interaction mode");
  assert.ok(active.updated <= active.max, "interaction mode should keep updated objects within budget");
  assert.ok(active.preserved > 0, "interaction mode should preserve traceable anchors");
  assert.ok(active.traceableNodes > 0, "interaction mode should leave traceable nodes visible");
  assert.ok(active.traceableEdges > 0, "interaction mode should leave traceable edges visible");
  await page.waitForFunction(() => document.querySelector("[data-llm-wiki-graph-root='true']")?.dataset.interactionMode === "idle");
}

async function layerTransform(page) {
  return page.locator("[data-viewport-layer='true']").evaluate((element) => element.style.transform);
}

async function waitForLayerTransform(page, previous) {
  const selector = "[data-viewport-layer='true']";
  await page.waitForFunction(
    ({ selector, previous }) => {
      const element = document.querySelector(selector);
      return Boolean(element && element.style.transform && element.style.transform !== previous);
    },
    { selector, previous },
    { timeout: 3000 }
  );
  return layerTransform(page);
}

async function expectNoPressedNodes(page, message) {
  const pressed = await page.locator(".node[aria-pressed='true']").count();
  assert.equal(pressed, 0, message);
}

async function assertOfflineReaderMeta(page, expected) {
  const reader = page.locator(".graph-reader[data-state='open']");
  await reader.locator(".graph-reader-title", { hasText: expected.title }).waitFor();
  const meta = reader.locator(".graph-reader-meta");
  const metaItems = await meta.locator("span").allInnerTexts();
  assert.ok(metaItems.includes(expected.typeLabel), `offline reader meta should include type ${expected.typeLabel}`);
  assert.ok(metaItems.includes(expected.date), `offline reader meta should include date ${expected.date}`);
  assert.ok(metaItems.includes(expected.source), `offline reader meta should include source ${expected.source}`);
  if (expected.sourceLink) {
    const sourceLink = reader.locator(".graph-reader-source");
    await sourceLink.waitFor();
    assert.equal(await sourceLink.innerText(), expected.sourceLink, "source pages should expose their source path as a reader link");
  } else {
    assert.equal(await reader.locator(".graph-reader-source").count(), 0, "non-source pages should not expose source path reader links");
  }
  await assertNoOfflineAskActions(reader);
}

async function runOfflinePinReloadCheck(page) {
  const pinKey = await nodePinKey(page, "A");
  await page.evaluate((pinKey) => {
    const key = window.__LLM_WIKI_GRAPH_PINS_KEY__;
    if (!key) throw new Error("offline graph pins key should be published");
    window.localStorage.setItem(key, JSON.stringify({ [pinKey]: { x: 333, y: 222 } }));
  }, pinKey);
  await page.reload();
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector(".node[data-id='A'][data-pinned='true']");
  const pinnedCount = await page.locator("[data-llm-wiki-graph-root='true']").evaluate((element) => element.dataset.pinnedCount);
  assert.equal(pinnedCount, "1", "offline localStorage pins should survive reload");
  const measurement = await page.locator(".node[data-id='A']").evaluate((node) => {
    return {
      worldPoint: {
        x: Number(node.dataset.worldX || node.dataset.liveX || Number.NaN),
        y: Number(node.dataset.worldY || node.dataset.liveY || Number.NaN)
      }
    };
  });
  const expected = { x: 333, y: 222 };
  const distance = Math.hypot(measurement.worldPoint.x - expected.x, measurement.worldPoint.y - expected.y);
  assert.ok(distance <= 6, `offline localStorage pin should reload at its world coordinate, distance=${distance.toFixed(2)}`);
}

async function nodePinKey(page, id) {
  return page.evaluate((id) => {
    const dataEl = document.getElementById("graph-data");
    const graphData = dataEl?.textContent ? JSON.parse(dataEl.textContent) : null;
    const node = graphData?.nodes?.find((item) => item.id === id);
    if (!node) return id;
    const existing = node.source_path || node.path || node.source;
    if (existing) return String(existing);
    const nodeId = String(node.id || id);
    const baseId = nodeId.endsWith(".md") ? nodeId.slice(0, -3) : nodeId;
    const type = String(node.type || "");
    const directory = type === "topic"
      ? "topics"
      : type === "source"
        ? "sources"
        : type === "comparison"
          ? "comparisons"
          : type === "synthesis"
            ? "synthesis"
            : type === "query"
              ? "queries"
              : "entities";
    return `wiki/${directory}/${baseId}.md`;
  }, id);
}

async function runSearchKeyboardChecks(page, message) {
  const root = page.locator("[data-llm-wiki-graph-root='true']");
  await root.click({ position: { x: 24, y: 24 } });
  await root.evaluate((element) => element.focus({ preventScroll: true }));
  await page.keyboard.press(searchShortcut());
  await waitForSearchState(page, "open");

  const input = page.locator(".graph-search-input");
  await input.fill("节点");
  await page.waitForSelector('.node[data-search-state="match"]');
  const matches = await page.locator('.node[data-search-state="match"]').count();
  assert.ok(matches >= 2, `${message}: query should match multiple nodes`);
  assert.equal(
    await page.locator('.node[data-search-state="faded"]').count(),
    0,
    `${message}: broad query should not fade matching fixture nodes`
  );

  const beforeFocus = await layerTransform(page);
  await input.press("ArrowDown");
  await page.waitForSelector('.node[data-search-focus="true"]');
  const firstFocus = await focusedSearchNodeId(page);
  await input.press("ArrowDown");
  await page.waitForFunction((previous) => {
    const focused = document.querySelector('.node[data-search-focus="true"]');
    return Boolean(focused && focused.dataset.id && focused.dataset.id !== previous);
  }, firstFocus);
  const secondFocus = await focusedSearchNodeId(page);
  assert.notEqual(secondFocus, firstFocus, `${message}: ArrowDown should cycle to another result`);
  assert.notEqual(
    await waitForLayerTransform(page, beforeFocus),
    beforeFocus,
    `${message}: ArrowDown should move the viewport to the focused result`
  );
  await input.press("Enter");
  await page.waitForSelector(`.node[data-id="${secondFocus}"][aria-pressed="true"]`);

  await input.press("Escape");
  await waitForSearchState(page, "closed");
  assert.equal(
    await page.locator('.node[data-search-state="match"], .node[data-search-state="faded"]').count(),
    0,
    `${message}: Escape should restore search visual state`
  );
  assert.equal(
    await page.locator('.node[data-search-focus="true"]').count(),
    0,
    `${message}: Escape should clear the focused search result`
  );
}

async function focusedSearchNodeId(page) {
  return page.locator('.node[data-search-focus="true"]').evaluate((element) => element.dataset.id || "");
}

function searchShortcut() {
  return process.platform === "darwin" ? "Meta+F" : "Control+F";
}

async function waitForSearchState(page, state) {
  await page.waitForFunction((state) => {
    return document.querySelector(".graph-search")?.dataset.state === state;
  }, state);
}

async function runLegendChecks(page, options) {
  await waitForToolbarPanel(page, "closed");
  await openToolbarFilters(page);
  await runTypeFilterChecks(page);
  await runEdgeLegendChecks(page);
  const row = page.locator(".community-legend-row").first();
  await row.hover();
  await page.waitForSelector('.node[data-community-state="faded"]');
  await page.mouse.move(900, 120);

  if (options.persistReload) {
    await page.reload();
    await page.waitForSelector("[data-llm-wiki-graph-root='true']");
    await waitForToolbarPanel(page, "filters");
    await closeToolbarWithBlankClick(page);
    await waitForToolbarPanel(page, "closed");
    await page.reload();
    await page.waitForSelector("[data-llm-wiki-graph-root='true']");
    await waitForToolbarPanel(page, "closed");
    await openToolbarFilters(page);
  }

  await page.waitForSelector(".edge");
  const focusableCommunity = await firstCommunityWithInternalEdge(page);
  const focusRow = page.locator(`.community-legend-row[data-community-id="${cssString(focusableCommunity)}"]`);
  const beforeClick = await layerTransform(page);
  const initialNodes = await page.locator(".node").count();
  await focusRow.click();
  await page.waitForFunction(() => document.querySelectorAll(".node[aria-pressed='true']").length > 0);
  await page.waitForTimeout(120);
  assert.equal(
    await layerTransform(page),
    beforeClick,
    "legend click should keep the global viewport and show a community summary first"
  );
  assert.equal(
    await page.locator(".node").count(),
    initialNodes,
    "legend click should not enter community focus before an explicit action"
  );
  const selected = await page.locator(".node[aria-pressed='true']").count();
  assert.ok(selected >= 1, "legend click should select the community nodes");

  if (options.expectWorkbenchDrawer) {
    await page.waitForSelector(".drawer-panel-open");
    await page.locator(".drawer-panel-open .drawer-title", { hasText: "选区" }).waitFor();
    await page.locator(".drawer-header button").last().click();
    await page.waitForSelector(".drawer-panel-open", { state: "detached" });
    assert.equal(
      await page.locator(".node").count(),
      initialNodes,
      "closing the workbench selection drawer should keep the global graph visible"
    );
    await expectNoPressedNodes(page, "closing the workbench selection drawer should clear highlights without changing global focus");

    await closeToolbarWithBlankClick(page);
    await waitForToolbarPanel(page, "closed");
    const target = await rightmostNodeSnapshot(page);
    await page.locator(`.node[data-id="${cssString(target.id)}"]`).click();
    await page.waitForSelector(".drawer-panel-open");
    await page.locator(".drawer-panel-open .drawer-title").waitFor();
    const afterOpen = await nodeSnapshot(page, target.id);
    const drift = Math.abs(afterOpen.centerRatioX - target.centerRatioX);
    assert.ok(
      drift <= 0.16,
      `opening the workbench reader drawer should keep the clicked node visually anchored; drift=${drift.toFixed(3)}`
    );
    assert.ok(
      afterOpen.centerRatioX >= 0.18 && afterOpen.centerRatioX <= 0.78,
      `clicked node should remain in a comfortable visible band after drawer opens; ratio=${afterOpen.centerRatioX.toFixed(3)}`
    );
    await page.keyboard.press("Escape");
    await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  } else {
    await assertOfflineSelectionPanel(page, "community");
  }
}

async function firstCommunityWithInternalEdge(page) {
  const communityId = await page.evaluate(() => {
    const nodeCommunity = new Map();
    for (const node of document.querySelectorAll(".node")) {
      nodeCommunity.set(node.getAttribute("data-id"), node.getAttribute("data-community"));
    }
    for (const edge of document.querySelectorAll(".edge")) {
      const from = edge.getAttribute("data-from");
      const to = edge.getAttribute("data-to");
      const fromCommunity = nodeCommunity.get(from);
      if (fromCommunity && fromCommunity === nodeCommunity.get(to)) return fromCommunity;
    }
    return "";
  });
  assert.notEqual(communityId, "", "fixture should include a community with at least one internal relation edge");
  return communityId;
}

async function runEdgeLegendChecks(page) {
  await page.getByRole("button", { name: "图例" }).click();
  await waitForToolbarPanel(page, "legend");
  await page.locator(".graph-edge-legend").waitFor();
  await page.locator(".graph-edge-legend-relation", { hasText: "矛盾" }).waitFor();
  await page.locator(".graph-edge-legend-confidence", { hasText: "推断" }).waitFor();
  await hoverFirstEdgeMidpoint(page);
  await page.waitForSelector(".graph-hover-preview[data-state='open'][data-kind='edge']");
  const preview = page.locator(".graph-hover-preview");
  await preview.locator(".graph-hover-preview-type", { hasText: "关系" }).waitFor();
  await preview.locator(".graph-hover-preview-title").waitFor();
  await assertBoxInsideViewport(page, ".graph-hover-preview", "edge relation hover preview should stay inside viewport");
  await page.getByRole("button", { name: "筛选" }).click();
  await waitForToolbarPanel(page, "filters");
}

async function hoverFirstEdgeMidpoint(page) {
  const point = await page.locator(".edge").first().evaluate((edge) => {
    if (!(edge instanceof SVGPathElement)) throw new Error("edge should be an SVG path");
    const svg = edge.ownerSVGElement;
    if (!svg) throw new Error("edge should have an owner SVG");
    const length = edge.getTotalLength();
    const mid = edge.getPointAtLength(length / 2);
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return {
      x: rect.left + (mid.x - viewBox.x) / viewBox.width * rect.width,
      y: rect.top + (mid.y - viewBox.y) / viewBox.height * rect.height
    };
  });
  await page.mouse.move(point.x, point.y);
}

async function runTypeFilterChecks(page) {
  const option = page.locator(".graph-type-filter-option").first();
  await option.waitFor();
  const type = await option.locator("input").evaluate((input) => input.dataset.type || "");
  assert.notEqual(type, "", "type filter option should publish its graph node type");
  const toggle = option.locator("input");
  const selector = `.node[data-type="${cssString(type)}"]`;
  const initialTypeNodes = await page.locator(selector).count();
  const initialNodes = await page.locator(".node").count();
  const beforeFilterTransform = await layerTransform(page);
  await toggle.uncheck();
  await page.waitForFunction((selector) => {
    return [...document.querySelectorAll(selector)].every((node) => node.getAttribute("data-filter-state") === "hidden");
  }, selector);
  const filteredNodes = await page.locator(".node").count();
  const hiddenTypeNodes = await page.locator(`${selector}[data-filter-state="hidden"]`).count();
  assert.equal(filteredNodes, initialNodes, "turning off a node type should preserve graph node elements");
  assert.equal(hiddenTypeNodes, initialTypeNodes, "turning off a node type should mark that type hidden");
  assert.equal(await layerTransform(page), beforeFilterTransform, "type filter changes should not move the graph layout");
  await toggle.check();
  await page.waitForFunction(
    ({ selector, initialTypeNodes }) => {
      const nodes = [...document.querySelectorAll(selector)];
      return nodes.length === initialTypeNodes && nodes.every((node) => node.getAttribute("data-filter-state") !== "hidden");
    },
    { selector, initialTypeNodes }
  );
}

function cssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function rightmostNodeSnapshot(page) {
  const nodes = await page.locator(".node").evaluateAll((elements) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("graph root should exist");
    const rootRect = root.getBoundingClientRect();
    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.getAttribute("data-id") || "",
        centerRatioX: (rect.left + rect.width / 2 - rootRect.left) / Math.max(1, rootRect.width),
        centerRatioY: (rect.top + rect.height / 2 - rootRect.top) / Math.max(1, rootRect.height)
      };
    }).filter((item) => item.id);
  });
  assert.ok(nodes.length > 0, "focused community should expose at least one node");
  return nodes.sort((a, b) => b.centerRatioX - a.centerRatioX)[0];
}

async function nodeSnapshot(page, id) {
  return page.locator(`.node[data-id="${cssString(id)}"]`).evaluate((element) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("graph root should exist");
    const rootRect = root.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      id: element.getAttribute("data-id") || "",
      centerRatioX: (rect.left + rect.width / 2 - rootRect.left) / Math.max(1, rootRect.width),
      centerRatioY: (rect.top + rect.height / 2 - rootRect.top) / Math.max(1, rootRect.height)
    };
  });
}

async function assertOfflineSelectionPanel(page, expectedMode) {
  await page.waitForSelector(".graph-selection-panel[data-state='open']");
  const panel = page.locator(".graph-selection-panel");
  await panel.getByText("Shift+点击 增删节点").waitFor();
  await panel.getByText("内部关联").waitFor();
  assert.ok(await panel.locator(".graph-selection-fact").count() >= 4, "offline selection panel should show structural facts");
  assert.equal(await panel.getByText("提问选区").count(), 0, "offline selection panel should not show ask actions");
  await assertNoOfflineAskActions(panel);
  if (expectedMode === "community") {
    await panel.getByText(/社区选区/).waitFor();
  } else {
    await panel.getByText(/手动选区|选中页面/).waitFor();
  }
}

async function assertNoOfflineAskActions(scope) {
  for (const label of ["提问选区", "在对话中引用", "它和谁有关", "总结这一组", "探索潜在联系"]) {
    assert.equal(await scope.getByText(label).count(), 0, `offline graph should not show ${label}`);
  }
}

async function openToolbarFilters(page) {
  const state = await page.locator("[data-llm-wiki-graph-root='true']").evaluate((element) => element.dataset.toolbarPanel || "");
  if (state !== "filters") {
    await page.getByRole("button", { name: "筛选" }).click();
  }
  await waitForToolbarPanel(page, "filters");
  await page.waitForSelector('.graph-toolbar-panel[data-state="filters"] .community-legend-row');
}

async function closeToolbarWithBlankClick(page) {
  const root = page.locator("[data-llm-wiki-graph-root='true']");
  const pointer = {
    button: 0,
    pointerId: 1,
    clientX: 32,
    clientY: 128,
    bubbles: true,
    cancelable: true
  };
  await root.dispatchEvent("pointerdown", {
    ...pointer,
    buttons: 1
  });
  await root.dispatchEvent("pointerup", pointer);
}

async function waitForToolbarPanel(page, state) {
  await page.waitForFunction((state) => {
    return document.querySelector(".llm-wiki-graph-engine")?.dataset.toolbarPanel === state;
  }, state);
}

async function runWorkbenchChecks(browser) {
  assert.notEqual(workbenchUrl, "", "GRAPH_STAGE_4_5_WORKBENCH_URL must point at the workbench dev server");
  const page = await openWorkbenchGraphPage(browser, { width: 1440, height: 960 }, "dark");
  await runSearchKeyboardChecks(page, "workbench graph search should support shortcut, cycling, focus, and Escape");
  await page.locator(".node[data-id='A']").click();

  await page.waitForSelector(".drawer-panel-open");
  const drawer = page.locator(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "节点A" }).waitFor();
  await drawer.getByText("这是节点A的正文").waitFor();
  await drawer.getByRole("button", { name: "在对话中引用" }).waitFor();
  await drawer.getByRole("button", { name: "它和谁有关" }).waitFor();
  await drawer.getByRole("button", { name: "它和谁有关" }).click();
  await drawer.locator(".drawer-title", { hasText: "选区" }).waitFor();
  await drawer.getByText("Shift+点击 增删节点").waitFor();
  const readerNeighborFacts = await drawer.locator(".graph-selection-fact").count();
  assert.ok(readerNeighborFacts >= 3, "reader related action should upgrade the page to a neighbor selection");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, "Escape should clear the reader related selection");

  await page.locator(".node[data-id='A']").click();
  await page.waitForSelector(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "节点A" }).waitFor();
  await drawer.getByRole("button", { name: "在对话中引用" }).click();
  await page.getByText("@[选区:节点A · 1页] 在对话中引用").waitFor();
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await page.getByRole("button", { name: /图谱/ }).click();
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.locator(".node[data-id='A']").click();
  await page.waitForSelector(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "节点A" }).waitFor();
  assert.equal(await drawer.getByText("学习队列").count(), 0, "graph reader should not show learning queue");
  assert.equal(await drawer.getByText("摘要").count(), 0, "graph reader should not show a summary block");
  assert.equal(await drawer.getByText("相邻节点").count(), 0, "graph reader should not show a neighbor section");

  await drawer.getByRole("link", { name: "wiki/entities/B.md" }).click();
  await drawer.locator(".drawer-title", { hasText: "wiki/entities/B.md" }).waitFor();
  await drawer.getByText("这是节点B的正文").waitFor();
  const focused = await page.locator(".node[aria-pressed='true']").count();
  assert.equal(focused, 1, "wikilink navigation should keep one graph node highlighted");
  assert.equal(await page.locator(".graph-selection-panel").count(), 0, "selection should not use the old floating canvas panel");

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "stage-4.5-workbench-reader.png"), fullPage: true });
  }

  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, "closing the graph reader should clear the graph highlight");

  await page.keyboard.down("Shift");
  await page.locator(".node[data-id='A']").click();
  await page.keyboard.up("Shift");
  await page.waitForSelector(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "选区" }).waitFor();
  await drawer.getByText("Shift+点击 增删节点").waitFor();
  assert.equal(await drawer.locator(".graph-selection-fact").count(), 0, "single-node selection should hide structural facts");
  assert.equal(await drawer.getByText("探索潜在联系").count(), 0, "single-node selection should not show group exploration");

  await page.keyboard.down("Shift");
  await page.locator(".node[data-id='B']").click();
  await page.keyboard.up("Shift");
  await drawer.getByText("Shift+点击 增删节点").waitFor();
  await drawer.getByText("总结这一组").waitFor();
  assert.ok(await drawer.locator(".graph-selection-fact").count() >= 3, "multi-node selection should show structural facts");

  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, "Escape should clear the workbench selection drawer and graph highlights");
  await runLegendChecks(page, { persistReload: false, expectWorkbenchDrawer: true });
  await runWorkbenchThemeViewportMatrix(browser);
}

async function openWorkbenchGraphPage(browser, viewport, theme) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(({ theme }) => {
    window.localStorage.setItem("llm-wiki-agent-main-view", "graph");
    window.localStorage.setItem("llm-wiki-agent-theme", theme);
  }, { theme });
  await page.goto(workbenchUrl);
  await page.waitForSelector(".app-shell");
  const kbButton = page.getByRole("button", { name: /Stage 4\.5 Workbench Test|workbench-kb/ });
  if (await kbButton.count() && await kbButton.first().isVisible()) {
    await kbButton.first().click();
  }
  const graphButton = page.getByRole("button", { name: /图谱/ });
  if (await graphButton.count() && await graphButton.first().isVisible()) {
    await graphButton.first().click();
  }
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  const expectedGraphTheme = theme === "dark" ? "mo-ye" : "shan-shui";
  await page.waitForFunction((expectedGraphTheme) => {
    return document.querySelector(".graph-screen")?.dataset.graphTheme === expectedGraphTheme
      && document.querySelector(".llm-wiki-graph-engine")?.dataset.theme === expectedGraphTheme;
  }, expectedGraphTheme);
  return page;
}

async function runWorkbenchThemeViewportMatrix(browser) {
  const cases = [
    { name: "desktop-light", viewport: { width: 1440, height: 960 }, theme: "light" },
    { name: "desktop-dark", viewport: { width: 1440, height: 960 }, theme: "dark" },
    { name: "tablet-light", viewport: { width: 768, height: 1024 }, theme: "light" },
    { name: "tablet-dark", viewport: { width: 768, height: 1024 }, theme: "dark" },
    { name: "mobile-light", viewport: { width: 390, height: 844 }, theme: "light" },
    { name: "mobile-dark", viewport: { width: 390, height: 844 }, theme: "dark" }
  ];
  for (const item of cases) {
    const page = await openWorkbenchGraphPage(browser, item.viewport, item.theme);
    await runWorkbenchThemeViewportChecks(page, item);
    await page.close();
  }
}

async function runWorkbenchThemeViewportChecks(page, item) {
  await runPreviewCheck(page, `${item.name} hover preview should open`);
  await runSearchKeyboardChecks(page, `${item.name} workbench graph search should work`);
  await openToolbarFilters(page);
  await page.locator(".community-legend-row").first().hover();
  await page.waitForSelector('.node[data-community-state="faded"]');
  await page.mouse.move(80, 80);
  await closeToolbarWithBlankClick(page);
  await waitForToolbarPanel(page, "closed");

  await page.locator(".node[data-id='A']").click();

  await page.waitForSelector(".drawer-panel-open");
  const drawer = page.locator(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "节点A" }).waitFor();
  await drawer.getByText("这是节点A的正文").waitFor();
  await assertNoViewportOverflow(page, `.drawer reader ${item.name}`);
  assert.equal(await page.locator(".graph-selection-panel").count(), 0, `${item.name} should not use the old floating canvas panel`);

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, `stage-4.5-workbench-${item.name}.png`), fullPage: true });
  }

  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, `${item.name} Escape should clear the graph reader highlight`);

  await page.keyboard.down("Shift");
  await page.locator(".node[data-id='A']").click();
  await page.keyboard.up("Shift");
  await page.waitForSelector(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "选区" }).waitFor();
  await drawer.getByText("Shift+点击 增删节点").waitFor();
  await assertNoViewportOverflow(page, `.drawer selection ${item.name}`);

  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, `${item.name} Escape should clear the selection drawer and graph highlights`);
}

async function runPreviewCheck(page, message) {
  const node = page.locator(".node[data-id='A']");
  await node.hover();
  await page.waitForSelector(".graph-hover-preview[data-state='open']");
  const preview = page.locator(".graph-hover-preview");
  await preview.locator(".graph-hover-preview-title").waitFor();
  await preview.locator(".graph-hover-preview-type").waitFor();
  await assertBoxInsideViewport(page, ".graph-hover-preview", message);
  await page.mouse.move(20, 20);
  await waitForPreviewState(page, "closed");
}

async function waitForPreviewState(page, state) {
  await page.waitForFunction((state) => {
    return document.querySelector(".graph-hover-preview")?.dataset.state === state;
  }, state);
}

async function assertNoViewportOverflow(page, label) {
  await assertBoxInsideViewport(page, ".drawer-panel-open", label);
  await assertBoxInsideViewport(page, "[data-llm-wiki-graph-root='true']", label);
}

async function assertBoxInsideViewport(page, selector, label) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${label}: ${selector} should have a bounding box`);
  const viewport = page.viewportSize();
  assert.ok(viewport, `${label}: viewport should be available`);
  assert.ok(box.x >= -1, `${label}: ${selector} should not overflow left`);
  assert.ok(box.y >= -1, `${label}: ${selector} should not overflow top`);
  assert.ok(box.x + box.width <= viewport.width + 1, `${label}: ${selector} should not overflow right`);
  assert.ok(box.y + box.height <= viewport.height + 1, `${label}: ${selector} should not overflow bottom`);
}
