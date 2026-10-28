"""MUT-441 benchmark (AC1, AC6): the sidecar plus the API's real extractor, scored per language.

    server/ocr/.venv/bin/python server/ocr/bench/run.py [--label NAME] [--env OCR_THREADS=4 ...]

1. Starts the sidecar locally (uvicorn on 127.0.0.1:8090, the production ProcessWorker), timing process start to
   /healthz 200 (cold start, local).
2. Sends every fixture with its capture hint (photo and screenshot: `photo`, as a gallery pick or portal upload
   arrives; PDFs: no hint), one at a time, timing each round trip and keeping the sidecar's own stage timings.
3. Runs the responses through the API's extractor (server/src/scripts/receipt-bench-extract.ts, the code the read
   job calls) and scores per language: amount, date and currency exact, vendor loose, and every filled field that is
   wrong ("wrong and confident": the extractor only fills fields at or over MIN_FIELD_CONFIDENCE, so a filled wrong
   field is a confident one; an empty field is fine).

Real receipts (--real, default ~/Work/Barmajiyat/Mutaba3a/receipt-bench): read when the folder exists. With a
`manifest.json` there ({"receipts": [{"file", "lang", "kind"?, "truth": {totalMinor, date, currency, vendorName?}}]})
they are scored and only aggregates are printed; without one, `manifest.draft.json` is written there with what the
pipeline read, for a person to correct. Everything that holds a real receipt's text stays in that folder.

Outputs go to --out (default server/ocr/bench/out, git-ignored): reads.json and suggestions.json hold synthetic
receipt text and are never committed; summary.md and summary.json hold aggregates only.
"""

from __future__ import annotations

import argparse
import difflib
import json
import math
import os
import re
import statistics
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

OCR_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = OCR_DIR.parent
DEFAULT_FIXTURES = Path.home() / "Work/elMokhtbr/Mutaba3a/mutaba3a-flutter/mutaba3a/test/fixtures/receipts"
DEFAULT_REAL = Path.home() / "Work/Barmajiyat/Mutaba3a/receipt-bench"
CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf"}
#: The spike's language groups: ar+en receipts count as Arabic, he+en as Hebrew.
LANG_GROUP = {"ar": "ar", "ar+en": "ar", "he": "he", "he+en": "he", "en": "en"}
LANGS = ("ar", "he", "en")
#: Fields scored when the truth has them; a filled field that disagrees is wrong and confident.
FIELDS = ("totalMinor", "date", "currency", "vendorName", "vatMinor", "vatRateBasisPoints", "registrationNo", "phone", "email")
#: Vendor names match loosely: after folding, one contains the other or they are this similar.
VENDOR_SIMILARITY = 0.8
#: The currencies the API takes (server/src/money.ts SUPPORTED_CURRENCIES). A receipt in any other (the SAR fixtures)
#: must leave the currency empty: it is scored as "should be absent", not as a miss.
API_CURRENCIES = frozenset({"ILS", "USD", "EUR", "JOD"})
#: AC1's bar.
BAR = 0.85
READY_TIMEOUT_S = 180


# ── scoring ──────────────────────────────────────────────────────────────────────────────────────────────────────


def fold(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[ً-ٰٟـ‎‏؜]", "", text)  # diacritics, tatweel, bidi marks
    text = re.sub(r"[أإآٱ]", "ا", text).replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"[\W_]+", "", text)


def vendor_matches(got: str, want: str) -> bool:
    a, b = fold(got), fold(want)
    if not a or not b:
        return False
    return a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() >= VENDOR_SIMILARITY


def field_matches(name: str, got, want) -> bool:
    if name == "vendorName":
        return vendor_matches(str(got), str(want))
    if name == "phone":
        return re.sub(r"\D", "", str(got)) == re.sub(r"\D", "", str(want))
    if name == "email":
        return str(got).strip().lower() == str(want).strip().lower()
    return str(got) == str(want)


def score_one(suggestion: dict, truth: dict) -> dict:
    """Per field: `hit` (filled and right), `filled`, `wrong` (filled and wrong, or filled where the truth has none)."""
    out = {}
    for name in FIELDS:
        want = truth.get(name)
        if name == "currency" and want not in API_CURRENCIES:
            want = None
        got = suggestion.get(name, {}).get("value") if isinstance(suggestion.get(name), dict) else None
        filled = got is not None
        if want is None:
            out[name] = {"hit": None, "filled": filled, "wrong": filled}
            continue
        hit = filled and field_matches(name, got, want)
        out[name] = {"hit": hit, "filled": filled, "wrong": filled and not hit}
    return out


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


def percentile(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def aggregate(rows: list[dict]) -> dict:
    """rows: [{lang, kind, scores, ms}] -> per language and scope, hit counts, wrong-and-confident counts, timings."""
    result: dict = {}
    for scope, keep in (("photo", lambda r: r["kind"] == "photo"), ("all", lambda r: True)):
        per_lang = {}
        for lang in LANGS:
            sel = [r for r in rows if r["lang"] == lang and keep(r)]
            cell = {"n": len(sel)}
            for name in ("totalMinor", "date", "currency", "vendorName"):
                scored = [r for r in sel if r["scores"][name]["hit"] is not None]
                k = sum(1 for r in scored if r["scores"][name]["hit"])
                cell[name] = {"hit": k, "n": len(scored), "rate": k / len(scored) if scored else None, "ci95": wilson(k, len(scored))}
            cell["wrongConfident"] = {name: sum(1 for r in sel if r["scores"][name]["wrong"]) for name in FIELDS}
            ms = [r["ms"] for r in sel if r.get("ms") is not None]
            cell["ms"] = {"p50": percentile(ms, 0.5), "p95": percentile(ms, 0.95), "max": max(ms) if ms else None}
            per_lang[lang] = cell
        result[scope] = per_lang
    return result


# ── the sidecar ──────────────────────────────────────────────────────────────────────────────────────────────────


class Sidecar:
    def __init__(self, port: int, env: dict[str, str], log_path: Path) -> None:
        self.url = f"http://127.0.0.1:{port}"
        self.port = port
        self.env = env
        self.log_path = log_path
        self.proc: subprocess.Popen | None = None
        self.cold_ready_s: float | None = None

    def start(self) -> None:
        env = {**os.environ, **self.env}
        self._log = self.log_path.open("w", encoding="utf-8")
        started = time.perf_counter()
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app_factory", "--factory", "--host", "127.0.0.1", "--port", str(self.port), "--workers", "1", "--no-access-log"],
            cwd=OCR_DIR,
            env=env,
            stdout=self._log,
            stderr=subprocess.STDOUT,
        )
        while time.perf_counter() - started < READY_TIMEOUT_S:
            if self.proc.poll() is not None:
                raise RuntimeError(f"sidecar exited ({self.proc.returncode}); see {self.log_path}")
            try:
                with urllib.request.urlopen(self.url + "/healthz", timeout=2) as res:
                    if res.status == 200:
                        self.cold_ready_s = time.perf_counter() - started
                        return
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                pass
            time.sleep(0.25)
        raise RuntimeError("sidecar not ready in time")

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if getattr(self, "_log", None):
            self._log.close()

    def stage_timings(self) -> list[dict]:
        """The sidecar's own `read` log lines (counts and timings only), in order."""
        out = []
        for line in self.log_path.read_text(encoding="utf-8").splitlines():
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("message") == "read" and entry.get("logger") == "receipt_ocr.pipeline":
                out.append(entry)
        return out


def post(url: str, body: bytes, content_type: str, hint: str | None) -> tuple[int, dict, float]:
    headers = {"content-type": content_type}
    if hint:
        headers["x-capture-hint"] = hint
    req = urllib.request.Request(url + "/v1/read", data=body, headers=headers, method="POST")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            payload = json.loads(res.read())
            status = res.status
    except urllib.error.HTTPError as err:
        payload, status = json.loads(err.read() or b"{}"), err.code
    return status, payload, (time.perf_counter() - started) * 1000


# ── inputs ───────────────────────────────────────────────────────────────────────────────────────────────────────


def synthetic_items(fixtures: Path) -> list[dict]:
    manifest = json.loads((fixtures / "manifest.json").read_text(encoding="utf-8"))
    return [
        {"id": f["id"], "path": fixtures / f["file"], "lang": LANG_GROUP[f["lang"]], "kind": f["kind"], "truth": f["truth"]}
        for f in manifest["fixtures"]
    ]


def real_items(folder: Path) -> tuple[list[dict], bool]:
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in CONTENT_TYPES and p.is_file())
    manifest_path = folder / "manifest.json"
    if not manifest_path.is_file():
        return [{"id": p.name, "path": p, "lang": None, "kind": "photo", "truth": None} for p in files], False
    entries = {e["file"]: e for e in json.loads(manifest_path.read_text(encoding="utf-8"))["receipts"]}
    items = []
    for p in files:
        e = entries.get(p.name)
        if e and e.get("truth"):
            items.append({"id": p.name, "path": p, "lang": LANG_GROUP.get(e.get("lang", ""), e.get("lang")), "kind": e.get("kind", "photo"), "truth": e["truth"]})
    return items, True


def hint_for(item: dict) -> str | None:
    return None if item["path"].suffix.lower() == ".pdf" else "photo"


# ── extractor ────────────────────────────────────────────────────────────────────────────────────────────────────


def extract(reads: list[dict], work: Path) -> dict[str, dict]:
    reads_path = work / "reads.json"
    reads_path.write_text(json.dumps(reads, ensure_ascii=False), encoding="utf-8")
    out = subprocess.run(
        [str(SERVER_DIR / "node_modules/.bin/tsx"), "src/scripts/receipt-bench-extract.ts", str(reads_path)],
        cwd=SERVER_DIR,
        capture_output=True,
        check=True,
    )
    return {r["id"]: r["suggestion"] for r in json.loads(out.stdout)}


# ── report ───────────────────────────────────────────────────────────────────────────────────────────────────────


def pct(cell: dict) -> str:
    if cell["rate"] is None:
        return "–"
    mark = "" if cell["rate"] >= BAR else " ✗"
    return f"{cell['hit']}/{cell['n']} ({cell['rate'] * 100:.0f}%){mark}"


def table(agg: dict, title: str) -> str:
    lines = [f"#### {title}", "", "| Lang | n | Amount | Date | Currency | Vendor (loose) | Wrong & confident | p50 ms | p95 ms |", "|---|---|---|---|---|---|---|---|---|"]
    for lang in LANGS:
        c = agg[lang]
        if not c["n"]:
            continue
        wrong = sum(c["wrongConfident"].values())
        detail = ", ".join(f"{k} {v}" for k, v in c["wrongConfident"].items() if v)
        lines.append(
            f"| {lang} | {c['n']} | {pct(c['totalMinor'])} | {pct(c['date'])} | {pct(c['currency'])} | {pct(c['vendorName'])} | {wrong}{f' ({detail})' if detail else ''} | {c['ms']['p50']:.0f} | {c['ms']['p95']:.0f} |"
        )
    return "\n".join(lines)


def rescore(args: argparse.Namespace) -> int:
    """The extractor and the scoring again over a synthetic run's saved reads (no OCR): for extractor changes."""
    items = {i["id"]: i for i in synthetic_items(args.fixtures)}
    reads = json.loads((args.rescore / "reads.json").read_text(encoding="utf-8"))
    before = {r["id"]: r for r in json.loads((args.rescore / "summary.json").read_text(encoding="utf-8"))["perFixture"]}
    out = args.out / args.label
    out.mkdir(parents=True, exist_ok=True)
    suggestions = extract(reads, out)
    rows = [
        {"id": r["id"], "lang": items[r["id"]]["lang"], "kind": items[r["id"]]["kind"], "ms": before[r["id"]]["ms"], "scores": score_one(suggestions.get(r["id"], {}), items[r["id"]]["truth"])}
        for r in reads
    ]
    agg = aggregate(rows)
    (out / "suggestions.json").write_text(json.dumps(suggestions, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "summary.json").write_text(json.dumps({"label": args.label, "rescoredFrom": str(args.rescore), "synthetic": agg, "perFixture": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    md = [f"### {args.label} (extractor re-run over {args.rescore.name}'s reads)", "", table(agg["photo"], "Photos (AC1's bar, the spike's scope)"), "", table(agg["all"], "All kinds (photos, screenshots, PDFs)")]
    (out / "summary.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    ap.add_argument("--real", type=Path, default=DEFAULT_REAL)
    ap.add_argument("--out", type=Path, default=OCR_DIR / "bench" / "out")
    ap.add_argument("--label", default="run")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--env", action="append", default=[], help="KEY=VALUE for the sidecar, e.g. OCR_THREADS=4")
    ap.add_argument("--only", default="", help="comma-separated fixture ids")
    ap.add_argument("--no-real", action="store_true")
    ap.add_argument("--rescore", type=Path, help="an earlier run's output folder: re-run only the extractor over its reads.json")
    args = ap.parse_args()
    if args.rescore:
        return rescore(args)

    out = args.out / args.label
    out.mkdir(parents=True, exist_ok=True)
    env = dict(kv.split("=", 1) for kv in args.env)
    items = synthetic_items(args.fixtures)
    if args.only:
        wanted = set(args.only.split(","))
        items = [i for i in items if i["id"] in wanted]
    real, real_scored = ([], False)
    real_dir = args.real.expanduser()
    if not args.no_real and real_dir.is_dir():
        real, real_scored = real_items(real_dir)

    sidecar = Sidecar(args.port, env, out / "sidecar.log")
    load_start = os.getloadavg()[0]
    sidecar.start()
    try:
        # Cold: the first read after the models are loaded (the worker warms up before /healthz says ready).
        first = items[0]
        _, _, cold_first_ms = post(sidecar.url, first["path"].read_bytes(), CONTENT_TYPES[first["path"].suffix.lower()], hint_for(first))
        timed: list[dict] = []
        for group in (items, real):
            for item in group:
                body = item["path"].read_bytes()
                load = os.getloadavg()[0]
                status, payload, ms = post(sidecar.url, body, CONTENT_TYPES[item["path"].suffix.lower()], hint_for(item))
                timed.append({"item": item, "status": status, "payload": payload, "ms": ms, "load1": load})
    finally:
        sidecar.stop()
    stages = sidecar.stage_timings()[1:]  # the first is the cold read
    load_end = os.getloadavg()[0]

    ok = [t for t in timed if t["status"] == 200]
    syn_ok = [t for t in ok if t["item"] in items]
    real_ok = [t for t in ok if t["item"] in real]
    suggestions = extract([{"id": t["item"]["id"], "result": t["payload"]} for t in syn_ok], out)
    real_suggestions = extract([{"id": t["item"]["id"], "result": t["payload"]} for t in real_ok], real_dir) if real_ok else {}
    (out / "suggestions.json").write_text(json.dumps(suggestions, ensure_ascii=False, indent=1), encoding="utf-8")

    rows = []
    for t in timed:
        if t["item"] not in items:
            continue
        sug = suggestions.get(t["item"]["id"], {})
        rows.append({"id": t["item"]["id"], "lang": t["item"]["lang"], "kind": t["item"]["kind"], "status": t["status"], "ms": t["ms"], "load1": t["load1"], "scores": score_one(sug, t["item"]["truth"])})
    agg = aggregate(rows)

    ocr_ms = [t["ms"] for t in timed if t["item"] in items and t["payload"].get("engine") == "rapid-tess"]
    stage_keys = ("prepareMs", "rapidMs", "tessMs", "totalMs")
    stage_summary = {k: {"mean": statistics.mean(s[k] for s in stages if k in s), "p95": percentile([s[k] for s in stages if k in s], 0.95)} for k in stage_keys if any(k in s for s in stages)}
    timing = {
        "coldReadyS": sidecar.cold_ready_s,
        "coldFirstReadMs": cold_first_ms,
        "ocrWarm": {"n": len(ocr_ms), "p50": percentile(ocr_ms, 0.5), "p95": percentile(ocr_ms, 0.95), "max": max(ocr_ms) if ocr_ms else None},
        "stages": stage_summary,
        "load1": {"start": load_start, "end": load_end, "meanDuringReads": statistics.mean(t["load1"] for t in timed) if timed else None},
        "cpus": os.cpu_count(),
        "env": env,
    }

    real_summary: dict = {"folder": "present" if real_dir.is_dir() else "missing", "files": len(real)}
    if real and not real_scored:
        draft = {
            "note": "Draft from the pipeline's reading (MUT-441 bench). Correct truth.* by hand (totalMinor in minor units, date YYYY-MM-DD, currency ISO code), set lang to ar|he|en and kind to photo|scanned|screenshot|pdf, then rename to manifest.json.",
            "receipts": [
                {
                    "file": t["item"]["id"],
                    "lang": "",
                    "kind": "photo",
                    "truth": {k: (real_suggestions.get(t["item"]["id"], {}).get(k) or {}).get("value") for k in ("totalMinor", "date", "currency", "vendorName")},
                }
                for t in timed
                if t["item"] in real
            ],
        }
        (real_dir / "manifest.draft.json").write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
        real_summary["draftManifest"] = "written"
    elif real:
        real_rows = [
            {"id": t["item"]["id"], "lang": t["item"]["lang"], "kind": t["item"]["kind"], "ms": t["ms"], "scores": score_one(real_suggestions.get(t["item"]["id"], {}), t["item"]["truth"])}
            for t in timed
            if t["item"] in real
        ]
        real_summary["aggregate"] = aggregate(real_rows)

    failures = [{"id": t["item"]["id"], "status": t["status"]} for t in timed if t["status"] != 200 and t["item"] in items]
    summary = {"label": args.label, "synthetic": agg, "timing": timing, "real": real_summary, "failedRequests": failures, "perFixture": [{k: r[k] for k in ("id", "lang", "kind", "ms", "load1", "scores")} for r in rows]}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")

    md = [
        f"### {args.label}",
        "",
        f"Sidecar env {env or '{}'}; {os.cpu_count()} CPUs; 1-min load {load_start:.1f} at start, {timing['load1']['meanDuringReads']:.1f} mean during reads, {load_end:.1f} at end.",
        f"Cold: ready {sidecar.cold_ready_s:.1f} s, first read {cold_first_ms:.0f} ms. Warm OCR reads (n={len(ocr_ms)}): p50 {timing['ocrWarm']['p50']:.0f} ms, p95 {timing['ocrWarm']['p95']:.0f} ms, max {timing['ocrWarm']['max']:.0f} ms.",
        "Stages (mean / p95 ms): " + ", ".join(f"{k} {v['mean']:.0f} / {v['p95']:.0f}" for k, v in stage_summary.items()),
        "",
        table(agg["photo"], "Photos (AC1's bar, the spike's scope)"),
        "",
        table(agg["all"], "All kinds (photos, screenshots, PDFs)"),
        "",
        f"Real receipts: folder {real_summary['folder']}, {real_summary['files']} files" + (", draft manifest written" if real_summary.get("draftManifest") else ""),
    ]
    if failures:
        md.append(f"Failed requests: {failures}")
    (out / "summary.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))
    return 0


if __name__ == "__main__":
    sys.exit(main())
