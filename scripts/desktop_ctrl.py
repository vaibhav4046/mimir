"""Windows Own-Computer desktop inspection & gated input helper for Mimir.

Fails loudly with HEADLESS_SESSION when launched inside a non-interactive service
session without an interactive window station.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import io
import json
import sys


def enum_visible_windows(limit: int = 25) -> list[dict]:
    user32 = ctypes.windll.user32
    windows: list[dict] = []

    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def callback(hwnd, _lparam):
        if len(windows) >= limit:
            return False
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value.strip()
        if title:
            windows.append({"hwnd": int(hwnd), "title": title})
        return True

    user32.EnumWindows(EnumWindowsProc(callback), 0)
    return windows


def capture_screen_jpeg() -> tuple[str, int, int]:
    from PIL import ImageGrab

    img = ImageGrab.grab(all_screens=False)
    w, h = img.size
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=72)
    return base64.b64encode(buf.getvalue()).decode("ascii"), w, h


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=["list_windows", "screenshot", "focus_window", "click", "type"])
    parser.add_argument("--hwnd", type=int, default=0)
    parser.add_argument("--x", type=int, default=0)
    parser.add_argument("--y", type=int, default=0)
    parser.add_argument("--text", default="")
    args = parser.parse_args()

    try:
        if args.action == "list_windows":
            wins = enum_visible_windows()
            if not wins:
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "blocked": True,
                            "code": "HEADLESS_SESSION",
                            "error": "No interactive desktop windows visible in current session (headless Session 0 or locked station). Use Electron desktop window or Own Computer CDP browser instead.",
                            "windows": [],
                        }
                    )
                )
                return 0
            print(json.dumps({"ok": True, "windows": wins}))
            return 0

        if args.action == "screenshot":
            try:
                b64, w, h = capture_screen_jpeg()
                print(json.dumps({"ok": True, "width": w, "height": h, "screenshotBase64": b64}))
                return 0
            except Exception as exc:
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "blocked": True,
                            "code": "HEADLESS_SESSION",
                            "error": f"Desktop capture unavailable in current window station ({exc}). Launch Electron desktop app or Own Computer CDP browser.",
                        }
                    )
                )
                return 0

        if args.action == "focus_window":
            user32 = ctypes.windll.user32
            if args.hwnd <= 0:
                print(json.dumps({"ok": False, "error": "hwnd must be positive"}))
                return 1
            ok = bool(user32.SetForegroundWindow(ctypes.c_void_p(args.hwnd)))
            print(json.dumps({"ok": ok, "hwnd": args.hwnd}))
            return 0

        if args.action == "click":
            import uiautomation as auto

            auto.Click(args.x, args.y)
            print(json.dumps({"ok": True, "clicked": [args.x, args.y]}))
            return 0

        if args.action == "type":
            import uiautomation as auto

            auto.SendKeys(args.text)
            print(json.dumps({"ok": True, "typedChars": len(args.text)}))
            return 0

    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
