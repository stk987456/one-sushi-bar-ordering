#!/usr/bin/env python3
"""
Scrape the One Sushi Bar menu (https://onesushibar.co.il/תפריט/) into
data/menu.json and js/menu-data.js, merging the hand-curated extras from
data/menu-overrides.json (option groups, category images, ordering, fixes).

Usage:
    python tools/scrape_menu.py                     # fetch the live page
    python tools/scrape_menu.py saved-menu.html     # parse a saved copy
    python tools/scrape_menu.py --no-fetch          # only re-apply overrides to data/menu-raw.json

The page is built with Elementor: every category is a tab. Inside a tab,
section titles / notes are text widgets placed directly in the column, while
dishes live inside inner sections: one widget with <strong>name</strong> +
description, followed by a widget holding the price ("₪53", "₪31/28", "177 ₪").
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString

ROOT = Path(__file__).resolve().parent.parent
MENU_URL = "https://onesushibar.co.il/%d7%aa%d7%a4%d7%a8%d7%99%d7%98/"
PRICE_RE = re.compile(r"^\s*₪?\s*([\d][\d\s]*)(?:\s*/\s*([\d][\d\s]*))?\s*₪?\s*$")
TAG_RULES = [
    ("צמחוני", re.compile(r"צמחוני|מלפפון בלבד")),
    ("חריף", re.compile(r"ספייסי|חריף|החריפה")),
    ("פירות ים", re.compile(r"שרימפס|פירות ים|קלמרי|קלמארי|מולים|סרטנים")),
]


def clean(text: str) -> str:
    text = text.replace("\xa0", " ").replace("​", "").replace("‎", "")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.])", r"\1", text)
    return text.strip(" /–-|").strip()


def parse_price(text: str):
    m = PRICE_RE.match(text.replace("\xa0", " "))
    if not m:
        return None
    return [int(re.sub(r"\s+", "", g)) for g in m.groups() if g]


def widget_runs(widget):
    """(bold_text, plain_text) of a text widget, walking its nodes in order."""
    container = widget.select_one(".elementor-widget-container") or widget
    for br in container.find_all("br"):
        br.replace_with("\n")
    bold, plain = [], []
    for node in container.descendants:
        if isinstance(node, NavigableString) and node.parent.name not in ("style", "script"):
            is_bold = any(p.name in ("strong", "b") for p in node.parents)
            (bold if is_bold else plain).append(str(node))
    return clean("".join(bold)), clean("".join(plain))


def slugify(text: str, used: set) -> str:
    base = re.sub(r"[^a-z0-9א-ת]+", "-", text.lower()).strip("-") or "item"
    slug, n = base, 2
    while slug in used:
        slug = f"{base}-{n}"
        n += 1
    used.add(slug)
    return slug


def split_name(full: str):
    """'מאקי סלמון ילדים – 6 יח' ...' -> ('מאקי סלמון ילדים', '6 יח' ...')"""
    for sep in (" – ", " - ", ": "):
        if sep in full:
            name, desc = full.split(sep, 1)
            return clean(name), clean(desc)
    return full, ""


def is_header(text: str) -> bool:
    return len(text) <= 22 and not re.search(r"\d|:", text)


def parse_tab(tab, cname):
    entries = []
    for w in tab.select(".elementor-widget-text-editor, .elementor-widget-heading"):
        bold, plain = widget_runs(w)
        full = clean(f"{bold} {plain}")
        if not full:
            continue
        entries.append({
            "inner": w.find_parent(class_="elementor-inner-section") is not None,
            "bold": bold, "plain": plain, "full": full, "price": parse_price(full),
        })

    sections, current, pending, last_priced = [], None, None, None

    def section(title=None):
        nonlocal current
        if title is not None or current is None:
            current = {"title": title or cname, "notes": [], "items": []}
            sections.append(current)
        return current

    def add_item(name, desc):
        nonlocal pending
        if pending is not None and "price" not in pending:
            pending["price"] = None
        pending = {"name": name, "description": desc}
        section()["items"].append(pending)

    for i, e in enumerate(entries):
        nxt = entries[i + 1] if i + 1 < len(entries) else None
        if e["price"]:
            if pending is not None:
                pending["price"] = e["price"][0]
                if len(e["price"]) > 1:
                    pending["prices"] = e["price"]
                last_priced, pending = pending, None
            else:
                section()["notes"].append(e["full"])
            continue
        next_is_price = bool(nxt and nxt["price"])
        if e["bold"]:
            name, desc = e["bold"], e["plain"]
            if not next_is_price and (name.endswith(":") or len(e["full"]) > 45):
                # option lists ("מרכיב מרכזי: ...") and long bold remarks are notes
                section()["notes"].append(e["full"])
                continue
            add_item(name.rstrip(":"), desc)
        elif next_is_price:
            name, desc = split_name(e["full"])
            add_item(name, desc)
        elif is_header(e["full"]) and pending is None:
            section(e["full"])
            last_priced = None
        elif last_priced is not None and not last_priced["description"]:
            last_priced["description"] = e["full"]  # description printed after the price
        else:
            section()["notes"].append(e["full"])
    if pending is not None and "price" not in pending:
        pending["price"] = None
    return sections


def parse(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    tabs = [(t["id"].replace("title", "content"), clean(t.get_text(" ", strip=True)))
            for t in soup.select(".elementor-tab-title[id]")]
    categories = []
    for cid, cname in tabs:
        tab = soup.find(id=cid)
        if tab is not None:
            categories.append({"id": cid.replace("elementor-tab-content-", "cat-"),
                               "name": cname, "sections": parse_tab(tab, cname)})
    return {"source": MENU_URL, "categories": categories}


# ---------------------------------------------------------------------------
# Ingredients: derived from the dish description so customers can remove them.
# "סלמון, שיטאקה, קנפיו, אבוקדו, עירית בציפוי אבוקדו וסלמון" ->
#   [סלמון, שיטאקה, קנפיו, אבוקדו, עירית]
# Coating keywords keep the part after them (a coating is removable too);
# other keywords ("ברוטב", "מוקפצים"...) end the ingredient list of a clause.
# ---------------------------------------------------------------------------
COATING_KEYS = ("בציפוי", "בצפוי", "עטוף במעטפת חמה של", "עטוף במעטפת של", "עטופים במעטפת של", "עטופים במעטפת",
                "עטוף במעטפת", "במעטפת של", "במעטפת", "עטוף ב", "עטופים ב", "עטוף", "בתוספת")
STOP_KEYS = ("ברוטב", "בתיבול", "מוקפצים", "מוקפץ", "מוגש", "על מצע", "ממולאים", "במילוי", "נעשות", "עבודת יד",
             "עם נגיעות של", "עם נגיעות", "ונגיעות של", "נגיעות של", "בתערובת", "בזילוף", "וזילוף", "מתובל", "אפוי", "או ")
KEY_RE = re.compile(r"\s*(?<![א-ת])ו?(" + "|".join(re.escape(k) for k in COATING_KEYS + STOP_KEYS) + r")\s*")
CONJ_RE = re.compile(r"\s+ו(?=[א-הז-ת])")  # " ו..." but not "וו..." (e.g. וואקמה)
TRAILING_RE = re.compile(r"\s+(קצוצה|קצוצים|קצוץ|טריים|טרי|טריות|קריספיים|קריספי|קריספית)$")
LEADING_RE = re.compile(r"^(של|מעטפת|תערובת של|תערובת|מיקס|שבבי)\s+")
JUNK = {"ירקות", "חמה", "קריספית", "חמה וקריספית", "טמפורה", "טמפורה חמה", "פנקו", "פאנקו", "אסייתית קראנצ'ית",
        "כתום", "שחור", "ירוק", "סגול", "אדום", "לבן", "חם", "קר"}
JUNK_START = ("צלוי ", "צלויה ", "מוקפץ", "עטוף", "מוגש", "ממולא", "בוחרים", "שלוש ", "לבחירה",
              "טמפורה", "פנקו", "פאנקו", "חמה", "פתיתי", "עיגולי פנקו")
MAX_INGREDIENTS = 12


def _pieces(text: str):
    """Split one comma-clause into ingredient pieces using the keyword rules."""
    out = []
    while text:
        m = KEY_RE.search(text)
        if not m:
            out.append(text)
            break
        before, key, after = text[:m.start()], m.group(1), text[m.end():]
        if before.strip():
            out.append(before)
        if key in COATING_KEYS:
            text = after
        else:
            break
    return [p.strip(" .,") for p in out if p.strip(" .,")]


def _raw_pieces(description: str):
    text = description.replace("״", '"').replace("׳", "'")
    clauses = [c.strip(" .") for c in re.split(r"[,.]|\s[–-]\s|\s+עם\s+", text) if c.strip(" .")]
    pieces = []
    for c in clauses:
        pieces += _pieces(c)
    return pieces


def _norm(piece: str) -> str:
    piece = TRAILING_RE.sub("", piece.strip(" .,"))
    return LEADING_RE.sub("", piece).strip()


def _usable(piece: str) -> bool:
    return (2 <= len(piece) <= 40 and not re.search(r"\d|/|₪", piece) and "יח" not in piece
            and len(piece.split()) <= 4 and piece not in JUNK and not piece.startswith(JUNK_START))


def _split_conj(piece: str, vocab: set):
    parts, changed = [piece], True
    while changed:
        changed, new = False, []
        for p in parts:
            split_done = False
            for m in CONJ_RE.finditer(p):
                left, right = p[:m.start()].strip(), p[m.end():].strip()
                if _norm(left) in vocab or _norm(right) in vocab:
                    new += [left, right]
                    changed = split_done = True
                    break
            if not split_done:
                new.append(p)
        parts = new
    return parts


def assign_ingredients(data: dict):
    items = [it for cat in data["categories"] if not cat.get("noIngredients")
             for sec in cat["sections"] for it in sec["items"]]
    vocab: set = set()
    for it in items:  # pass 1: simple pieces become the vocabulary used to split "X וY"
        for p in _raw_pieces(it.get("description", "")):
            p = _norm(p)
            if _usable(p) and not CONJ_RE.search(p) and len(p.split()) <= 3:
                vocab.add(p)
    for it in items:  # pass 2
        if "ingredients" in it:  # explicit override (a list, possibly empty)
            continue
        found, seen = [], set()
        for raw in _raw_pieces(it.get("description", "")):
            for p in _split_conj(raw, vocab):
                p = _norm(p)
                if _usable(p) and p not in seen:
                    seen.add(p)
                    found.append(p)
        it["ingredients"] = found[:MAX_INGREDIENTS]


def apply_overrides(data: dict, ov: dict) -> dict:
    items_ov = dict(ov.get("items", {}))
    remove = set(ov.get("removeItems", []))
    cat_ov = ov.get("categories", {})
    used_ids: set = set()
    for cat in data["categories"]:
        cat.update({k: v for k, v in cat_ov.get(cat["id"], {}).items() if k != "sectionNotes"})
        for sec in cat["sections"]:
            sec["items"] = [it for it in sec["items"]
                            if it["name"] not in remove and f"{it['name']}@{cat['id']}" not in remove]
            for it in sec["items"]:
                o = items_ov.pop(it["name"], None)
                if o:
                    it.update(o)
                it.setdefault("tags", [])
                badge = cat_ov.get(cat["id"], {}).get("itemBadge")
                if badge and badge not in it.setdefault("badges", []):
                    it["badges"].append(badge)
                hay = f"{it['name']} {it['description']}"
                for tag, rx in TAG_RULES:
                    if rx.search(hay) and tag not in it["tags"]:
                        it["tags"].append(tag)
                if it.get("prices") and not it.get("variants"):
                    labels = ov.get("priceVariantLabels", {}).get(sec["title"], ["גדול", "קטן"])
                    it["variants"] = [{"name": lbl, "price": p} for lbl, p in zip(labels, it["prices"])]
                it["id"] = slugify(it["name"], used_ids)
            # notes like "8 יח' i.o" become the section subtitle
            sec["notes"] = [n for n in sec["notes"] if not parse_price(n)]
            if "sectionNotes" in cat_ov.get(cat["id"], {}):
                sec["notes"] = cat_ov[cat["id"]]["sectionNotes"].get(sec["title"], sec["notes"])
        cat["sections"] = [s for s in cat["sections"] if s["items"] or s["notes"]]
    for name in items_ov:
        print(f"warning: override for unknown item {name!r}", file=sys.stderr)
    order = ov.get("categoryOrder")
    if order:
        rank = {cid: i for i, cid in enumerate(order)}
        data["categories"].sort(key=lambda c: rank.get(c["id"], len(rank)))
    for extra in ov.get("extraItems", []):
        cat = next(c for c in data["categories"] if c["id"] == extra["category"])
        sec = next((s for s in cat["sections"] if s["title"] == extra["section"]), None)
        if sec is None:
            sec = {"title": extra["section"], "notes": [], "items": []}
            cat["sections"].append(sec)
        item = dict(extra["item"])
        item.setdefault("tags", [])
        item["id"] = slugify(item["name"], used_ids)
        sec["items"].append(item)
    assign_ingredients(data)
    by_name = {}
    for cat in data["categories"]:
        for sec in cat["sections"]:
            for it in sec["items"]:
                by_name.setdefault(it["name"], it["id"])
    data["featured"] = [by_name[n] for n in ov.get("featuredItems", []) if n in by_name]
    for n in ov.get("featuredItems", []):
        if n not in by_name:
            print(f"warning: featured item not found {n!r}", file=sys.stderr)
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", nargs="?", help="local HTML file (default: fetch the live page)")
    ap.add_argument("--no-fetch", action="store_true", help="re-apply overrides to data/menu-raw.json only")
    args = ap.parse_args()
    raw_path = ROOT / "data" / "menu-raw.json"
    if args.no_fetch:
        data = json.loads(raw_path.read_text(encoding="utf-8"))
    else:
        if args.source:
            html = Path(args.source).read_text(encoding="utf-8")
        else:
            req = urllib.request.Request(MENU_URL, headers={"User-Agent": "Mozilla/5.0"})
            html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        data = parse(html)
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    ov_path = ROOT / "data" / "menu-overrides.json"
    ov = json.loads(ov_path.read_text(encoding="utf-8")) if ov_path.exists() else {}
    data = apply_overrides(data, ov)
    (ROOT / "data" / "menu.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    js = "// Generated by tools/scrape_menu.py - do not edit by hand; edit data/menu-overrides.json and re-run.\n"
    js += "window.ONE_MENU = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n"
    (ROOT / "js").mkdir(exist_ok=True)
    (ROOT / "js" / "menu-data.js").write_text(js, encoding="utf-8")
    n_items = sum(len(s["items"]) for c in data["categories"] for s in c["sections"])
    missing = [it["name"] for c in data["categories"] for s in c["sections"] for it in s["items"] if it.get("price") is None]
    print(f"wrote data/menu.json and js/menu-data.js - {len(data['categories'])} categories, {n_items} items")
    if missing:
        print("items without a price:", missing)


if __name__ == "__main__":
    main()
