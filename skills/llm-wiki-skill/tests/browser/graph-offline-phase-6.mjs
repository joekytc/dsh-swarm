import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const basicHtml = process.env.GRAPH_OFFLINE_PHASE_6_BASIC_HTML || "";
const denseHtml = process.env.GRAPH_OFFLINE_PHASE_6_DENSE_HTML || "";
const multicommHtml = process.env.GRAPH_OFFLINE_PHASE_6_MULTICOMM_HTML || "";
const artifactDir = process.env.GRAPH_OFFLINE_PHASE_6_ARTIFACT_DIR || "";
const executablePath = process.env.GRAPH_OFFLINE_PHASE_6_CHROME_EXECUTABLE || "";

assert.notEqual(basicHtml, "", "GRAPH_OFFLINE_PHASE_6_BASIC_HTML must point at generated basic HTML");
assert.notEqual(denseHtml, "", "GRAPH_OFFLINE_PHASE_6_DENSE_HTML must point at generated dense HTML");
assert.notEqual(multicommHtml, "", "GRAPH_OFFLINE_PHASE_6_MULTICOMM_HTML must point at generated multicomm HTML");

const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const basic = await runBasicOfflineChecks(browser);
  const dense = await runFixtureSmoke(browser, denseHtml, "dense");
  const multicomm = await runFixtureSmoke(browser, multicommHtml, "multicomm");
  const evidence = { basic, dense, multicomm };
  if (artifactDir) {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(artifactDir, "phase-6-offline-interactions.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}

async function runBasicOfflineChecks(browser) {
  const page = await openOfflinePage(browser, basicHtml, { width: 1440, height: 960 });
  const evidence = {
    html: basicHtml,
    viewport: "1440x960",
    wheelTargets: {},
    rootScroll: {},
    hover: {},
    drag: {},
    reader: {},
    pinPersistence: {},
    theme: {}
  };

  evidence.wheelTargets.blank = await assertWheelZoomsFromReset(page, () => findBlankPoint(page), "blank");
  evidence.wheelTargets.node = await assertWheelZoomsFromReset(page, () => visibleNodeCenter(page), "node");
  evidence.wheelTargets.communityWash = await assertWheelZoomsFromReset(page, () => findCommunityWashPoint(page, "t1"), "community wash");

  await resetGraphView(page);
  evidence.rootScroll = await assertGraphRootScrollResets(page);
  evidence.hover.beforeZoom = await hoverNodeAndMeasure(page, null, {
    preferCenter: true,
    roomLeft: 120,
    roomRight: 360,
    roomTop: 120,
    roomBottom: 180
  });
  evidence.hover.node = evidence.hover.beforeZoom.target;
  evidence.hover.zoom = await assertWheelZooms(page, await nodeCenter(page, evidence.hover.node.id), "hovered node");
  evidence.hover.afterZoom = await hoverNodeAndMeasure(page, evidence.hover.node.id);
  assert.equal(
    evidence.hover.afterZoom.target.id,
    evidence.hover.node.id,
    "offline hover after zoom should stay on the same node"
  );
  assertHoverStaysNearAnchor(evidence.hover.beforeZoom, "offline hover before zoom should stay near its node");
  assertHoverStaysNearAnchor(evidence.hover.afterZoom, "offline hover after zoom should stay near its node");

  await resetGraphView(page);
  const dragNode = await visibleNode(page, { roomRight: 360 });
  evidence.drag = await dragNodeAndMeasure(page, dragNode.id);
  evidence.pinPersistence = await assertPinPersistsAfterReload(page, dragNode.id);

  evidence.reader = await assertBuiltInReader(page);
  evidence.theme = await assertThemeToggle(page);

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "phase-6-offline-basic.png"), fullPage: true });
  }
  await page.close();
  return roundObject(evidence);
}

async function runFixtureSmoke(browser, html, name) {
  const page = await openOfflinePage(browser, html, { width: 1280, height: 860 });
  const before = await layerTransform(page);
  const point = await visibleNodeCenter(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -360);
  const after = await waitForLayerTransform(page, before);
  assert.notEqual(after, before, `${name} offline graph should zoom over a node`);
  const counts = await page.evaluate(() => ({
    nodes: document.querySelectorAll(".node").length,
    edges: document.querySelectorAll(".edge").length,
    communities: document.querySelectorAll(".community-wash").length,
    hasReactDrawer: Boolean(document.querySelector(".drawer-panel-open"))
  }));
  assert.ok(counts.nodes > 0, `${name} offline graph should render nodes`);
  assert.equal(counts.hasReactDrawer, false, `${name} offline graph should not depend on the React host drawer`);
  await page.close();
  return { html, before, after, counts };
}

async function openOfflinePage(browser, html, viewport) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    window.__graphOfflinePhase6 = {
      round(value) {
        return Math.round(value * 1000) / 1000;
      },
      roundRect(rect) {
        return {
          left: this.round(rect.left),
          top: this.round(rect.top),
          right: this.round(rect.right),
          bottom: this.round(rect.bottom),
          width: this.round(rect.width),
          height: this.round(rect.height)
        };
      },
      relativeRect(rect, rootRect) {
        return {
          left: this.round(rect.left - rootRect.left),
          top: this.round(rect.top - rootRect.top),
          right: this.round(rect.right - rootRect.left),
          bottom: this.round(rect.bottom - rootRect.top),
          width: this.round(rect.width),
          height: this.round(rect.height)
        };
      },
      relativePoint(point, rootRect) {
        return {
          x: this.round(point.x - rootRect.left),
          y: this.round(point.y - rootRect.top)
        };
      }
    };
  });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector("[data-viewport-layer='true']");
  await page.waitForSelector(".node");
  return page;
}

async function assertWheelZooms(page, point, label) {
  const before = await layerTransform(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -420);
  const after = await waitForLayerTransform(page, before);
  assert.notEqual(after, before, `offline wheel over ${label} should zoom`);
  return { before, after, point: roundedPoint(point) };
}

async function assertWheelZoomsFromReset(page, pointFactory, label) {
  await resetGraphView(page);
  await waitForGraphMotionSettled(page);
  const point = await pointFactory();
  return assertWheelZooms(page, point, label);
}

async function hoverNodeAndMeasure(page, preferredId = null, targetOptions = {}) {
  const target = await visibleNode(page, { ...targetOptions, preferredId });
  const id = target.id;
  await waitForNodeMotionSettled(page, id);
  let lastProbe = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await movePointerAwayFromGraphObjects(page);
    await waitForNodeMotionSettled(page, id);
    const point = await nodeCenter(page, id);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await page.waitForTimeout(450);
    const probe = await hoverProbe(page, id, point);
    lastProbe = probe;
    if (probe.preview.state === "open" && probe.preview.kind === "node" && probe.hit.closestNode === id) break;
  }
  assert.ok(
    lastProbe?.preview.state === "open" && lastProbe.preview.kind === "node" && lastProbe.hit.closestNode === id,
    `offline hover preview for ${id} should open after pointer enters node: ${JSON.stringify(lastProbe)}`
  );
  await page.locator(".graph-hover-preview-title").waitFor();
  const measurement = await page.evaluate((id) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const node = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
    const preview = document.querySelector(".graph-hover-preview");
    if (!root || !node || !preview) throw new Error("Missing hover measurement elements");
    const rootRect = root.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const nodeAnchor = {
      x: nodeRect.left + nodeRect.width / 2,
      y: nodeRect.top + nodeRect.height / 2
    };
    return {
      target: {
        id,
        label: node.querySelector(".node-name")?.textContent || node.textContent?.trim() || id
      },
      nodeAnchor: window.__graphOfflinePhase6.relativePoint(nodeAnchor, rootRect),
      preview: window.__graphOfflinePhase6.relativeRect(previewRect, rootRect),
      offset: {
        x: previewRect.left - nodeAnchor.x,
        y: previewRect.bottom - nodeAnchor.y
      }
    };
  }, id);
  await assertBoxInsideViewport(page, ".graph-hover-preview", `offline hover preview for ${id}`);
  await assertGraphRootNotScrolled(page, `offline hover preview for ${id}`);
  return roundObject({ ...measurement, target });
}

async function hoverProbe(page, id, point) {
  return page.evaluate(({ id, point }) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const node = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
    const preview = document.querySelector(".graph-hover-preview");
    if (!root || !node || !preview) throw new Error("Missing hover probe elements");
    const hit = document.elementFromPoint(point.x, point.y);
    const nodeRect = node.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return {
      point: window.__graphOfflinePhase6.relativePoint(point, rootRect),
      rootScroll: { left: root.scrollLeft, top: root.scrollTop },
      nodeRect: window.__graphOfflinePhase6.relativeRect(nodeRect, rootRect),
      nodeHovered: node.matches(":hover"),
      hit: {
        tag: hit?.tagName || "",
        className: typeof hit?.className === "string" ? hit.className : hit?.className?.baseVal || "",
        closestNode: hit?.closest?.(".node")?.dataset?.id || "",
        closestWash: hit?.closest?.(".community-wash")?.dataset?.communityId || ""
      },
      preview: {
        state: preview.dataset.state || "",
        kind: preview.dataset.kind || "",
        textLength: preview.textContent?.length || 0
      }
    };
  }, { id, point });
}

async function movePointerAwayFromGraphObjects(page) {
  const point = await findBlankPoint(page);
  await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.waitForTimeout(80);
}

async function dragNodeAndMeasure(page, id) {
  await waitForNodeMotionSettled(page, id);
  const start = await nodeCenter(page, id);
  const target = { x: start.x + 360, y: start.y + 28 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.waitForTimeout(80);
  const during = await nodeCenter(page, id);
  const pointerDistance = Math.hypot(during.x - target.x, during.y - target.y);
  assert.ok(pointerDistance <= 48, `offline dragged node should stay under pointer, distance=${pointerDistance.toFixed(1)}`);
  await page.mouse.up();
  await page.waitForSelector(`.node[data-id="${cssString(id)}"][data-pinned="true"]`);
  await page.waitForTimeout(140);
  const after = await page.locator(`.node[data-id="${cssString(id)}"]`).evaluate((node) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("Missing root after drag");
    const rootRect = root.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return {
      center: {
        x: rect.left + rect.width / 2 - rootRect.left,
        y: rect.top + rect.height / 2 - rootRect.top
      },
      pinned: node.dataset.pinned,
      dragging: root.dataset.dragging || ""
    };
  });
  assert.equal(after.pinned, "true", "offline drag should commit a pin");
  assert.equal(after.dragging, "", "offline drag should not remain stuck");
  return roundObject({ start, target, during, pointerDistance, after });
}

async function assertPinPersistsAfterReload(page, id) {
  const key = await page.evaluate(() => window.__LLM_WIKI_GRAPH_PINS_KEY__ || "");
  assert.notEqual(key, "", "offline graph pins key should be exposed");
  const before = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "{}"), key);
  assert.ok(Object.keys(before).length >= 1, "offline drag should write at least one pin");
  for (const pin of Object.values(before)) {
    assert.equal(pin.coordinateSpace, "world", "offline persisted pins should be explicit world coordinates");
  }
  await page.reload();
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector(`.node[data-id="${cssString(id)}"][data-pinned="true"]`);
  const pinnedCount = await page.locator("[data-llm-wiki-graph-root='true']").evaluate((root) => root.dataset.pinnedCount || "");
  assert.equal(pinnedCount, "1", "offline pin should survive reload");
  const unmarkedWorldPin = { x: 333, y: 222 };
  const pinKey = await nodePinKey(page, id);
  await page.evaluate(({ key, id, pin }) => {
    window.localStorage.setItem(key, JSON.stringify({
      [id]: pin
    }));
  }, { key, id: pinKey, pin: unmarkedWorldPin });
  await page.reload();
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector(`.node[data-id="${cssString(id)}"][data-pinned="true"]`);
  await resetGraphView(page);
  await page.waitForTimeout(120);
  const unmarkedWorldCenter = await page.locator(`.node[data-id="${cssString(id)}"]`).evaluate((node) => {
    return {
      worldPoint: {
        x: Number(node.dataset.worldX || node.dataset.liveX || Number.NaN),
        y: Number(node.dataset.worldY || node.dataset.liveY || Number.NaN)
      },
      pinned: node.dataset.pinned || ""
    };
  });
  assert.equal(unmarkedWorldCenter.pinned, "true", "offline unmarked localStorage pin should reload as pinned");
  const worldDistance = Math.hypot(
    unmarkedWorldCenter.worldPoint.x - unmarkedWorldPin.x,
    unmarkedWorldCenter.worldPoint.y - unmarkedWorldPin.y
  );
  assert.ok(
    worldDistance <= 0.01,
    `offline unmarked localStorage pin should stay in world coordinates, distance=${worldDistance.toFixed(2)}`
  );
  return { key, storedPins: before, pinnedCount, unmarkedWorldPin, pinKey, unmarkedWorldCenter, worldDistance };
}

async function assertBuiltInReader(page, id) {
  await resetGraphView(page);
  const target = id ? await visibleNode(page, { preferredId: id }) : await visibleNode(page);
  await clickNodeByPointer(page, target.id);
  await page.waitForSelector(".graph-reader[data-state='open']");
  await page.locator(".graph-reader-title", { hasText: target.label }).waitFor();
  await page.locator(".graph-reader-body").waitFor();
  assert.equal(await page.locator(".drawer-panel-open").count(), 0, "offline graph should not open the React host drawer");
  const snapshot = await page.locator(".graph-reader[data-state='open']").evaluate((reader) => ({
    title: reader.querySelector(".graph-reader-title")?.textContent || "",
    bodyLength: reader.querySelector(".graph-reader-body")?.textContent?.length || 0,
    hasHostDrawer: Boolean(document.querySelector(".drawer-panel-open"))
  }));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".graph-reader[data-state='closed']");
  return { ...snapshot, target };
}

async function assertThemeToggle(page) {
  const before = await graphTheme(page);
  await page.getByRole("button", { name: before === "shan-shui" ? "切换墨夜主题" : "切换山水主题" }).click();
  const after = await waitForGraphThemeChange(page, before);
  await page.getByRole("button", { name: after === "shan-shui" ? "切换墨夜主题" : "切换山水主题" }).click();
  const restored = await waitForGraphThemeChange(page, after);
  assert.equal(restored, before, "offline theme toggle should restore the original theme");
  return { before, after, restored };
}

async function assertGraphRootScrollResets(page) {
  const before = await graphRootScroll(page);
  await page.locator("[data-llm-wiki-graph-root='true']").evaluate((root) => {
    root.scrollLeft = 120;
    root.scrollTop = 240;
  });
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    return root && root.scrollLeft === 0 && root.scrollTop === 0;
  });
  const after = await graphRootScroll(page);
  assert.deepEqual(after, { left: 0, top: 0 }, "offline graph root native scroll should reset to zero");
  return { before, after };
}

async function assertGraphRootNotScrolled(page, label) {
  const scroll = await graphRootScroll(page);
  assert.deepEqual(scroll, { left: 0, top: 0 }, `${label}: graph root native scroll should stay at zero`);
}

async function resetGraphView(page) {
  const before = await layerTransform(page);
  await page.getByRole("button", { name: "回全图" }).click();
  await page.waitForTimeout(220);
  const after = await layerTransform(page);
  if (after === before) await page.waitForTimeout(120);
}

async function layerTransform(page) {
  return page.locator("[data-viewport-layer='true']").evaluate((element) => element.style.transform);
}

async function waitForLayerTransform(page, previous) {
  await page.waitForFunction(
    (previous) => document.querySelector("[data-viewport-layer='true']")?.style.transform !== previous,
    previous,
    { timeout: 3000 }
  );
  return layerTransform(page);
}

async function nodeCenter(page, id) {
  return page.locator(`.node[data-id="${cssString(id)}"]`).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  });
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

async function visibleNodeCenter(page, preferredId = null, options = {}) {
  const targetOptions = typeof preferredId === "object" && preferredId !== null
    ? preferredId
    : { ...options, preferredId };
  const node = await visibleNode(page, targetOptions);
  return node.center;
}

async function visibleNode(page, options = {}) {
  const {
    preferredId = null,
    roomLeft = 0,
    roomRight = 0,
    roomTop = 0,
    roomBottom = 0,
    preferCenter = false
  } = options;
  await waitForGraphMotionSettled(page);
  const candidate = await page.evaluate((options) => {
    const { preferredId, roomLeft, roomRight, roomTop, roomBottom, preferCenter } = options;
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("Missing graph root");
    const rootRect = root.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const minX = Math.max(rootRect.left + roomLeft, 0);
    const maxX = Math.min(rootRect.right - roomRight, viewportWidth);
    const minY = Math.max(rootRect.top + roomTop, 0);
    const maxY = Math.min(rootRect.bottom - roomBottom, viewportHeight);
    const ideal = {
      x: minX + Math.max(0, maxX - minX) / 2,
      y: minY + Math.max(0, maxY - minY) / 2
    };
    const nodes = Array.from(document.querySelectorAll(".node"));
    const measurements = nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      const hit = document.elementFromPoint(center.x, center.y);
      const centerHitsNode = hit?.closest?.(".node") === node;
      const visibleLeft = Math.max(rect.left, minX);
      const visibleRight = Math.min(rect.right, maxX);
      const visibleTop = Math.max(rect.top, minY);
      const visibleBottom = Math.min(rect.bottom, maxY);
      const visibleArea = Math.max(0, visibleRight - visibleLeft) * Math.max(0, visibleBottom - visibleTop);
      const centerInViewport = center.x >= rootRect.left
        && center.x >= minX
        && center.x <= maxX
        && center.y >= minY
        && center.y <= maxY;
      const centerDistance = Math.hypot(center.x - ideal.x, center.y - ideal.y);
      return {
        id: node.dataset.id || "",
        label: node.querySelector(".node-name")?.textContent || node.textContent?.trim() || node.dataset.id || "",
        center,
        rect: window.__graphOfflinePhase6.relativeRect(rect, rootRect),
        visibleArea,
        centerDistance,
        centerHitsNode,
        centerInViewport
      };
    }).filter((item) => item.id && item.visibleArea > 0);
    const preferred = preferredId
      ? measurements.find((item) => item.id === preferredId && item.centerInViewport && item.centerHitsNode)
      : null;
    if (preferred) return preferred;
    const best = measurements
      .filter((item) => item.centerInViewport && item.centerHitsNode)
      .sort((a, b) => preferCenter
        ? a.centerDistance - b.centerDistance || b.visibleArea - a.visibleArea
        : b.visibleArea - a.visibleArea || a.centerDistance - b.centerDistance
      )[0];
    if (best) return best;
    throw new Error(`Could not find an interactable visible node: ${JSON.stringify(measurements)}`);
  }, { preferredId, roomLeft, roomRight, roomTop, roomBottom, preferCenter });
  return roundObject(candidate);
}

async function clickNodeByPointer(page, id) {
  const node = await visibleNode(page, { preferredId: id });
  await movePointerAwayFromGraphObjects(page);
  await page.mouse.move(node.center.x, node.center.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  return node;
}

async function waitForGraphMotionSettled(page) {
  const firstId = await firstNodeId(page);
  await waitForNodeMotionSettled(page, firstId);
}

async function waitForNodeMotionSettled(page, id) {
  let previous = await nodeCenter(page, id);
  for (let sample = 0; sample < 12; sample += 1) {
    await page.waitForTimeout(140);
    const next = await nodeCenter(page, id);
    const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
    if (distance <= 1.5) return;
    previous = next;
  }
}

async function firstNodeId(page) {
  return page.locator(".node").first().evaluate((node) => node.dataset.id || "");
}

async function findBlankPoint(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("Missing graph root");
    const rect = root.getBoundingClientRect();
    const blocked = ".node,.community-wash,.edge,.graph-toolbar,.mini-map,.graph-search,.graph-reader,.graph-selection-panel";
    const xs = [0.08, 0.16, 0.28, 0.42, 0.58, 0.74, 0.88];
    const ys = [0.18, 0.32, 0.48, 0.64, 0.8, 0.9];
    for (const ry of ys) {
      for (const rx of xs) {
        const x = rect.left + rect.width * rx;
        const y = rect.top + rect.height * ry;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !root.contains(hit)) continue;
        if (hit.closest(blocked)) continue;
        return { x, y };
      }
    }
    throw new Error("Could not find blank graph point");
  });
}

async function findCommunityWashPoint(page, communityId) {
  return page.evaluate((communityId) => {
    const wash = document.querySelector(`.community-wash[data-community-id="${CSS.escape(communityId)}"]`) || document.querySelector(".community-wash");
    if (!wash) throw new Error("Missing community wash");
    const rect = wash.getBoundingClientRect();
    const candidates = [
      [0.5, 0.18],
      [0.2, 0.5],
      [0.8, 0.5],
      [0.5, 0.82],
      [0.32, 0.32],
      [0.68, 0.68],
      [0.5, 0.5]
    ];
    for (const [rx, ry] of candidates) {
      const x = rect.left + rect.width * rx;
      const y = rect.top + rect.height * ry;
      if (document.elementFromPoint(x, y)?.closest?.(".community-wash") === wash) {
        return { x, y, communityId: wash.dataset.communityId || "" };
      }
    }
    throw new Error("Could not find exposed community wash point");
  }, communityId);
}

async function assertBoxInsideViewport(page, selector, label) {
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box, `${label}: ${selector} should have a bounding box`);
  const viewport = page.viewportSize();
  assert.ok(viewport, `${label}: viewport should be available`);
  assert.ok(box.x >= -1, `${label}: ${selector} should not overflow left`);
  assert.ok(box.y >= -1, `${label}: ${selector} should not overflow top`);
  assert.ok(box.x + box.width <= viewport.width + 1, `${label}: ${selector} should not overflow right`);
  assert.ok(box.y + box.height <= viewport.height + 1, `${label}: ${selector} should not overflow bottom`);
}

async function graphRootScroll(page) {
  return page.locator("[data-llm-wiki-graph-root='true']").evaluate((root) => ({
    left: root.scrollLeft,
    top: root.scrollTop
  }));
}

async function graphTheme(page) {
  return page.locator(".llm-wiki-graph-engine").evaluate((root) => root.dataset.theme || "");
}

async function waitForGraphThemeChange(page, previous) {
  await page.waitForFunction((previous) => {
    const next = document.querySelector(".llm-wiki-graph-engine")?.dataset.theme || "";
    return next && next !== previous;
  }, previous);
  return graphTheme(page);
}

function assertHoverStaysNearAnchor(measurement, message) {
  const preview = measurement.preview;
  const anchor = measurement.nodeAnchor;
  const horizontalGap = preview.left > anchor.x
    ? preview.left - anchor.x
    : anchor.x > preview.right
      ? anchor.x - preview.right
      : 0;
  const verticalGap = preview.top > anchor.y
    ? preview.top - anchor.y
    : anchor.y > preview.bottom
      ? anchor.y - preview.bottom
      : 0;
  assert.ok(horizontalGap <= 180, `${message}: horizontal gap ${horizontalGap.toFixed(2)}px`);
  assert.ok(verticalGap <= 140, `${message}: vertical gap ${verticalGap.toFixed(2)}px`);
}

function cssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function roundedPoint(point) {
  return {
    x: round(point.x),
    y: round(point.y)
  };
}

function roundObject(value) {
  if (Array.isArray(value)) return value.map(roundObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundObject(item)]));
  }
  if (typeof value === "number") return round(value);
  return value;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
