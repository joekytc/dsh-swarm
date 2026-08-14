#!/usr/bin/env python3
"""GUI 冒烟：验证 dsh-kanban 看板在 Web 页面渲染（shell.overlay 槽 + /kanban 数据桥）。
用法: python tests/e2e/gui-check.py [--url http://127.0.0.1:3081]
依赖: pip install playwright（headless chromium）
"""
import argparse
from playwright.sync_api import sync_playwright

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:3081/")
    ap.add_argument("--executable", default="",
                    help="cached chromium executable path (ms-playwright cache)")
    args = ap.parse_args()

    launch_kwargs = {"headless": True}
    if args.executable:
        launch_kwargs["executable_path"] = args.executable
        launch_kwargs["args"] = ["--no-sandbox"]

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(args.url, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(4000)

        board = page.locator(".kanban-board")
        print("kanban-board present:", board.count() > 0)
        if board.count() > 0:
            print("columns:", board.locator(".kanban-column").count())
            print("cards:", board.locator(".board-card").count())
        page.screenshot(path="/tmp/kanban-gui.png", full_page=True)
        print("screenshot: /tmp/kanban-gui.png")
        page.wait_for_timeout(1000)
        print("console errors:", len(errors))
        browser.close()
        return 0 if board.count() > 0 and not errors else 1

if __name__ == "__main__":
    raise SystemExit(main())
