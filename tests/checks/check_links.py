#!/usr/bin/env python3
"""Check all URLs in SKILL.md and README.md files return HTTP 200."""

import os
import re
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

URL_PATTERN = re.compile(r'https?://[^\s\)\]\>"\'`]+')
SKIP_PATTERNS = [
    r'localhost',
    r'127\.0\.0\.1',
    r'example\.com',
    r'\{',  # template URLs
    r'<your',
    r'\$\{',
]

def find_urls(root: Path) -> list[tuple[str, str, int]]:
    """Find all URLs in markdown files. Returns (file, url, line_no)."""
    results = []
    for md_file in root.rglob("*.md"):
        for i, line in enumerate(md_file.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            for match in URL_PATTERN.finditer(line):
                url = match.group(0).rstrip(".,;:)")
                if any(re.search(p, url) for p in SKIP_PATTERNS):
                    continue
                results.append((str(md_file.relative_to(root)), url, i))
    return results

def check_url(entry: tuple[str, str, int]) -> tuple[str, str, int, int | str]:
    """Check a single URL. Returns (file, url, line, status)."""
    file_path, url, line_no = entry
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0 link-checker"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return (file_path, url, line_no, resp.status)
    except urllib.error.HTTPError as e:
        # Retry with GET for sites that block HEAD
        if e.code == 405 or e.code == 403:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 link-checker"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    return (file_path, url, line_no, resp.status)
            except Exception as e2:
                return (file_path, url, line_no, str(e2))
        return (file_path, url, line_no, e.code)
    except Exception as e:
        return (file_path, url, line_no, str(e))

def main():
    root = Path(os.environ.get("REPO_ROOT", "."))
    urls = find_urls(root)
    print(f"Found {len(urls)} URLs to check...")

    errors = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(check_url, entry): entry for entry in urls}
        for future in as_completed(futures):
            file_path, url, line_no, status = future.result()
            if isinstance(status, int) and 200 <= status < 400:
                continue
            errors.append((file_path, url, line_no, status))

    if errors:
        print(f"\n✗ {len(errors)} broken links found:\n")
        for file_path, url, line_no, status in sorted(errors):
            print(f"  {file_path}:{line_no} — [{status}] {url}")
        sys.exit(1)
    else:
        print(f"✓ All {len(urls)} links are valid")

if __name__ == "__main__":
    main()
