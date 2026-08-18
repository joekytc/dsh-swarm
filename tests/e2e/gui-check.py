#!/usr/bin/env python3
"""会话中心「看板」tab GUI 验收：tab 顺序（对话→轨迹→看板）、.dsh-kb-tab 可见、无 overlay/resize、
宽度 715-780px（最小 715 / 最大 780）、全高（中心栏可视高度）、多链路、详情往返、SSE 订阅、断线 banner、深浅主题、
无重叠、单快照请求、无 console error。
用法: python tests/e2e/gui-check.py [--url http://127.0.0.1:3080]
依赖: pip install playwright（headless chromium）

注意：默认端口为 3080（DSH web 默认端口）；不要在已有 dsh web 服务运行时再起一个实例。
"""
import argparse
from playwright.sync_api import sync_playwright


def boxes_overlap(a, b, tolerance: float = 1.0) -> bool:
    if a is None or b is None:
        return False
    if a == b:
        return False
    return not (
        a["x"] + a["width"] - tolerance <= b["x"]
        or b["x"] + b["width"] - tolerance <= a["x"]
        or a["y"] + a["height"] - tolerance <= b["y"]
        or b["y"] + b["height"] - tolerance <= a["y"]
    )


def open_kanban_tab(page) -> None:
    """会话中心 tab 顺序 对话→轨迹→看板；点击看板并等待 .dsh-kb-tab 可见。"""
    sb = page.get_by_role("button", name="打开侧边栏")
    if sb.count() == 0:
        sb = page.get_by_role("button", name="Open sidebar")
    if sb.count():
        sb.first.click()
        page.wait_for_timeout(1200)
    page.locator("[class*=sessionRow]").filter(has_text="/plan:").first.wait_for(state="visible", timeout=60_000)
    page.locator("[class*=sessionRow]").filter(has_text="/plan:").first.evaluate("el => el.click()")
    page.wait_for_timeout(1500)
    labels = ["对话", "轨迹", "看板"]
    page.get_by_role("tab", name="看板").wait_for(state="visible", timeout=60_000)
    for label in labels:
        assert page.get_by_role("tab", name=label).count() == 1, f"tab {label} missing"
    names = [t.strip() for t in page.locator("[role='tab']").all_inner_texts()]
    present = [n for n in names if n in labels]
    assert present == labels, f"会话中心 tab 顺序错误: {names}"
    page.get_by_role("tab", name="看板").click()
    if page.locator(".dsh-kb-task").count() == 0:
        page.locator(".dsh-kb-chain__title").first.click()
        page.wait_for_timeout(800)
    assert_tab_layout(page)
    print("tabs 对话→轨迹→看板 order OK; .dsh-kb-tab visible; no overlay/resize")


def assert_tab_layout(page) -> None:
    """布局约束：无 .dsh-kb-panel/.dsh-kb-resize；宽度 715-780px（最小 715 / 最大 780）；高度 = 中心栏可视高度。"""
    tab = page.locator(".dsh-kb-tab")
    tab.wait_for(state="visible", timeout=60_000)
    assert page.locator(".dsh-kb-panel").count() == 0, "legacy .dsh-kb-panel overlay still present"
    assert page.locator(".dsh-kb-resize").count() == 0, "legacy .dsh-kb-resize handle still present"
    rects = tab.evaluate(
        """el => {
            const self = el.getBoundingClientRect();
            let pEl = el.parentElement;
            while (pEl) {
                const pr = pEl.getBoundingClientRect();
                const cs = getComputedStyle(pEl);
                if (pr.height > 0 && cs.display !== "contents") break;
                pEl = pEl.parentElement;
            }
            const parent = pEl ? pEl.getBoundingClientRect() : { height: self.height };
            return {
                width: self.width,
                height: self.height,
                top: self.top,
                bottom: self.bottom,
                parentHeight: parent.height,
                vh: window.innerHeight,
            };
        }"""
    )
    assert 715 - 2 <= rects["width"] <= 780 + 2, f"tab width {rects['width']:.1f} outside 715-780px"
    assert abs(rects["height"] - rects["parentHeight"]) <= 2, (
        f"tab height {rects['height']:.1f} != center rail visible height {rects['parentHeight']:.1f}"
    )
    assert rects["top"] >= -1 and rects["bottom"] <= rects["vh"] + 1, (
        f"tab {rects['top']:.1f}..{rects['bottom']:.1f} exceeds viewport height {rects['vh']}"
    )


def _rects(page, selector):
    return page.locator(selector).evaluate_all(
        "els => els.map(e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; })"
    )
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:3080/")
    ap.add_argument("--executable", default="", help="cached chromium executable path (ms-playwright cache)")
    args = ap.parse_args()

    launch_kwargs = {"headless": True}
    if args.executable:
        launch_kwargs["executable_path"] = args.executable
        launch_kwargs["args"] = ["--no-sandbox"]

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs)
        context = browser.new_context(locale="zh-CN", viewport={"width": 1200, "height": 800})
        board_requests: list[str] = []
        sse_requests: list[str] = []

        def track_request(req) -> None:
            if "/kanban/board" in req.url:
                board_requests.append(req.url)
            if "/kanban/events" in req.url:
                sse_requests.append(req.url)

        for vw, vh in [(900, 800), (1200, 800), (1600, 900)]:
            page = context.new_page()
            page.set_viewport_size({"width": vw, "height": vh})
            errors: list[str] = []
            board_requests.clear()
            sse_requests.clear()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("request", track_request)

            page.goto(args.url, wait_until="load", timeout=60000)
            open_kanban_tab(page)
            page.wait_for_timeout(1500)

            assert page.locator(".kanban-column").count() == 0, "legacy column DOM still present"
            assert page.locator(".dsh-kb-chain").count() >= 1, "workflow chains missing"
            if page.locator(".dsh-kb-task").count() == 0:
                page.locator(".dsh-kb-chain__title").first.click()
                page.wait_for_timeout(800)
            assert page.locator(".dsh-kb-task").count() >= 1, "workflow tasks missing"
            assert page.locator(".dsh-kb-tab-body").evaluate(
                "el => el.scrollWidth <= el.clientWidth + 1"
            ), "tab body overflows horizontally"

            # 列表 → 详情：五区 tab（限定在详情容器内，避免与会话中心「轨迹」tab 重名）
            page.locator(".dsh-kb-task").first.click()
            detail = page.locator(".dsh-kb-detail")
            detail.wait_for(state="visible", timeout=60_000)
            for label in ["概览", "轨迹", "交接", "规格", "评论"]:
                assert detail.get_by_role("tab", name=label).count() == 1, f"detail tab {label} missing"

            # SSE 实时更新：初始快照后浏览器订阅 /kanban/events（连接机制断言）
            assert len(sse_requests) >= 1, "SSE /kanban/events not subscribed"
            assert len(board_requests) == 1, board_requests

            # 无重叠检查：任务卡、tab、header
            boxes = []
            for selector in [".dsh-kb-task", ".dsh-kb-detail [role='tab']", ".dsh-kb-detail__header"]:
                boxes.extend(_rects(page, selector))
            for j, a in enumerate(boxes):
                for b in boxes[j + 1:]:
                    assert not boxes_overlap(a, b), f"overlap between {a} and {b}"

            page.screenshot(path=f"/tmp/dsh-kanban-tab-{vw}x{vh}.png", full_page=True)
            page.emulate_media(color_scheme="dark")
            page.screenshot(path=f"/tmp/dsh-kanban-tab-{vw}x{vh}-dark.png", full_page=True)
            page.emulate_media(color_scheme="light")

            # 详情 → 返回：Esc（浏览器历史）回到列表
            page.keyboard.press("Escape")
            page.locator(".dsh-kb-task").first.wait_for(state="visible", timeout=60_000)
            assert page.locator(".dsh-kb-detail").count() == 0, "detail did not close on Esc"

            print(f"viewport {vw}x{vh} tab 715-780px full-height detail roundtrip: OK")
            page.close()

        # 断线 banner：阻断 SSE 订阅 → reconnecting banner 出现，最近快照仍在
        page = context.new_page()
        page.route("**/kanban/events*", lambda route: route.abort())
        page.goto(args.url, wait_until="load", timeout=60000)
        open_kanban_tab(page)
        banner = page.locator(".dsh-kb-banner--reconnecting")
        banner.wait_for(state="visible", timeout=60_000)
        assert "正在重连" in banner.inner_text()
        assert page.locator(".dsh-kb-task").count() >= 1, "snapshot hidden behind reconnecting banner"
        print("SSE disconnected: reconnecting banner shown, last snapshot kept: OK")
        page.close()

        # 单快照请求：打开详情等业务操作不得触发第二次 /kanban/board
        page = context.new_page()
        board_requests.clear()
        sse_requests.clear()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("request", track_request)
        page.goto(args.url, wait_until="load", timeout=60000)
        open_kanban_tab(page)
        page.locator(".dsh-kb-task").first.click()
        page.wait_for_timeout(6000)
        assert len(board_requests) == 1, board_requests
        assert len(errors) == 0, errors
        print("board snapshot requests:", len(board_requests))
        print("console errors:", len(errors))
        browser.close()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
