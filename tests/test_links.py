# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Validate that external URLs in markdown files are reachable.

Uses a HEAD request (falling back to GET on 403/405) and treats transient
DNS/TLS/timeout failures as non-blocking.
"""

import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from conftest import ROOT

URL_PATTERN = re.compile(r"https?://[^\s\)\]\>\"'`]+")
SKIP_PATTERNS = [
    r"localhost",
    r"127\.0\.0\.1",
    r"example\.com",
    r"\{",
    r"<your",
    r"<resource",
    r"\$\{",
    r"ossrdbms-aad\.database\.windows\.net/\.default",
    r"management\.azure\.com/\.default",
    r"management\.azure\.com/?$",
    r"myresource\.openai\.azure\.com",
    r"dl\.cacerts\.digicert\.com",
    r"github\.com/[^/\s]+/postgresql-agent-skills(?:\.git|/|$)",
]
NON_BLOCKING_NETWORK_ERRORS = [
    "No address associated with hostname",
    "Name or service not known",
    "Temporary failure in name resolution",
    "timed out",
    "CERTIFICATE_VERIFY_FAILED",
]


def _find_urls():
    results = []
    for md_file in ROOT.rglob("*.md"):
        for i, line in enumerate(md_file.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            for match in URL_PATTERN.finditer(line):
                url = match.group(0).rstrip(".,;:)")
                if any(re.search(p, url) for p in SKIP_PATTERNS):
                    continue
                results.append((str(md_file.relative_to(ROOT)), url, i))
    return results


def _check_url(entry):
    file_path, url, line_no = entry
    headers = {"User-Agent": "Mozilla/5.0 link-checker"}
    try:
        req = urllib.request.Request(url, method="HEAD", headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return (file_path, url, line_no, resp.status)
    except urllib.error.HTTPError as e:
        if e.code in (405, 403):
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    return (file_path, url, line_no, resp.status)
            except Exception as e2:
                return (file_path, url, line_no, str(e2))
        return (file_path, url, line_no, e.code)
    except Exception as e:
        return (file_path, url, line_no, str(e))


def test_external_links_valid():
    urls = _find_urls()
    errors = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_check_url, entry): entry for entry in urls}
        for future in as_completed(futures):
            file_path, url, line_no, status = future.result()
            if isinstance(status, int) and 200 <= status < 400:
                continue
            if isinstance(status, str) and any(err in status for err in NON_BLOCKING_NETWORK_ERRORS):
                continue
            errors.append(f"{file_path}:{line_no} — [{status}] {url}")
    assert not errors, f"{len(errors)} broken links:\n" + "\n".join(sorted(errors))
