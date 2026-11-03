# one סושי בר – Online ordering (delivery & pickup)

A self-contained online-ordering front-end built as an addition to
[onesushibar.co.il](https://onesushibar.co.il/). It reproduces the site's look
(Heebo, black/white with the teal accent, the site's own category photos and
logo), contains the restaurant's full menu (scraped from the live site, 116
items in 9 categories) and lets customers build a cart, choose delivery or
pickup, fill in their details and send the order.

No framework, no build step, no server-side code required: plain HTML, CSS and
JavaScript. It can be uploaded next to the WordPress site as-is.

**Live preview (GitHub Pages):** https://stk987456.github.io/one-sushi-bar-ordering/
– updates automatically about a minute after every push to `main`.

## Design

Dark edition, modelled on how upscale sushi brands (Zuma, Sushi Samba) and
Wolt's dark mode present food online: full-bleed photography that fades into a
near-black page, delivery-info pills, a glass sticky category bar with search,
a horizontal "featured" strip, glowing round add buttons and spring-like
micro-interactions. Everything is CSS/vanilla JS, no libraries:

* ambient background: two slowly drifting colour glows (brand teal / crimson)
  plus an animated film-grain layer (`.bg` in `index.html`)
* hero photo with a slow Ken Burns zoom and scroll parallax
* cards fade/rise into view while scrolling (IntersectionObserver), hover lift
  and glow, add button rotates on hover
* "fly to cart" dot animation and badge bump on every add, animated totals
* bottom-sheet item customiser on phones with a drag handle, spring animations
* gold "מנת שף" badges (category `itemBadge`) and the featured strip
  (`featuredItems` in `data/menu-overrides.json`)
* respects `prefers-reduced-motion`

Colours and radii are CSS variables at the top of `css/style.css`.

## Project layout

```
index.html               the ordering page (Hebrew, RTL)
css/style.css            styles (design tokens at the top)
js/config.js             restaurant settings: hours, fees, order channels… ← edit this
js/app.js                the app: menu, cart, item options, checkout, order sending
js/menu-data.js          GENERATED menu used by the page (window.ONE_MENU)
data/menu.json           GENERATED menu as JSON (same content, for other tools)
data/menu-raw.json       GENERATED raw scrape, before overrides
data/menu-overrides.json hand-curated extras: option groups, category images, fixes ← edit this
tools/scrape_menu.py     scraper: live site → data/*.json + js/menu-data.js
```

## Run locally

```bash
cd D:\Users\WS64\Projects\Website
python -m http.server 8000
# open http://localhost:8000/
```

(`npx serve` works too. Double-clicking `index.html` also works because the
menu is loaded from a plain script, not fetched.)

## Configure (`js/config.js`)

| Key | Meaning |
| --- | --- |
| `restaurant.*` | name, phone, address, site URL, logo and hero image URLs |
| `ordering.whatsappNumber` | restaurant WhatsApp, international digits only, e.g. `"972501234567"`. The order opens in WhatsApp as a pre-filled message the customer sends. |
| `ordering.orderEndpoint` | HTTPS URL that receives the order as JSON (`POST`). Use for a backend, Google Apps Script, Make/Zapier webhook… |
| `ordering.orderEmail` | opens the customer's mail app with the order (fallback channel) |
| `ordering.minimumOrder` | minimum subtotal in ₪ (0 = none) |
| `ordering.deliveryFee` / `freeDeliveryFrom` | delivery fee and the subtotal from which delivery is free |
| `ordering.deliveryCities` | cities offered in the address form |
| `ordering.prepTimeMinutes` | shown as the "ASAP" estimate and used to validate scheduled times |
| `ordering.paymentMethods` | choices shown at checkout (cash / card on delivery / Bit …) |
| `ordering.hours` | opening hours per weekday (0 = Sunday). Ranges may cross midnight. |
| `ordering.acceptOrdersWhenClosed` | allow scheduling an order while closed |

Until one of the three order channels is filled in, the page runs in a clearly
labelled **demo mode**: checkout works end to end but the order is only shown
as text to copy.

### Order payload sent to `orderEndpoint`

```json
{
  "number": "ONE-K3F9QZ",
  "createdAt": "2026-11-03T18:21:07.000Z",
  "service": "delivery",
  "when": { "type": "asap", "label": "בהקדם האפשרי" },
  "customer": { "name": "ישראל ישראלי", "phone": "0501234567" },
  "address": { "street": "הציונות", "house": "13", "apt": "קומה 2", "city": "אשדוד" },
  "payment": "מזומן בעת המסירה",
  "notes": "",
  "items": [
    { "id": "צ-יז-רול", "name": "צ'יז רול", "qty": 2, "unitPrice": 53, "total": 106,
      "variant": null, "choices": [{ "group": "דג", "name": "סלמון", "price": 0 }], "notes": "בלי עירית" }
  ],
  "subtotal": 106, "deliveryFee": 20, "total": 126, "currency": "₪"
}
```

The same information is formatted as a Hebrew text message for WhatsApp/e-mail.

## Update the menu

The menu is scraped from the Elementor tabs on the site's menu page, then the
hand-written extras in `data/menu-overrides.json` are merged in:

```bash
pip install beautifulsoup4           # once
python tools/scrape_menu.py          # fetches the live page and regenerates data/* and js/menu-data.js
python tools/scrape_menu.py --no-fetch   # only re-apply overrides to the last scrape
```

`data/menu-overrides.json` holds, keyed by the exact item name on the site:

* `options` – choice groups (`min`/`max` = how many must/may be picked, optional
  `price` surcharge per choice). Used for "salmon / red tuna", cheese choices,
  the build-your-own roll, kids' drinks, wine types, etc.
* `ingredients` – the list shown as tap-to-remove chips ("✕ בלי אבוקדו") in the
  dish sheet. The scraper derives it automatically from the description
  (comma-separated ingredients, coatings after "בציפוי"/"עטוף", sauces and
  cooking words dropped); set it explicitly to correct a dish, or to `[]` to
  hide the remove option. A category can opt out with `"noIngredients": true`
  (drinks). Removed ingredients travel with the order as `removed: [...]` and
  as "בלי …" in the message text.
* `name` / `description` / `tags` fixes.
* `categories` – display order, short pill labels, taglines, banner images (the
  site's own category photos), section notes.
* `priceVariantLabels` – labels for double prices like `₪31/28`.
* `removeItems` – e.g. the duplicate "קומבינציית דיימונד" that appears in two tabs.

Tags (צמחוני / חריף / פירות ים) are derived automatically from names and
descriptions and can be corrected per item.

## Add it to the WordPress site

The page is static, so any of these works:

1. **Sub-folder on the same host (recommended).** Upload the project folder
   to the web root as `order/` (cPanel File Manager / FTP) so it is served at
   `https://onesushibar.co.il/order/`. Then add a menu item "הזמנה אונליין"
   (WordPress → Appearance → Menus) pointing to `/order/`, and optionally a
   floating button on every page via Elementor → HTML widget:

   ```html
   <a href="/order/" style="position:fixed;bottom:20px;left:20px;z-index:999;background:#12a89d;color:#fff;
      font-family:Heebo,sans-serif;font-weight:700;padding:14px 22px;border-radius:999px;text-decoration:none;
      box-shadow:0 6px 20px rgba(0,0,0,.25)">🛵 הזמנה למשלוח</a>
   ```

2. **Sub-domain**, e.g. `order.onesushibar.co.il`, pointing at the same files.
3. **Embedded in a WordPress page** with an iframe (Elementor HTML widget):

   ```html
   <iframe src="/order/" style="width:100%;min-height:100vh;border:0" title="הזמנה אונליין" loading="lazy"></iframe>
   ```

Because the logo, hero and category images are referenced from the existing
site, nothing else has to be copied. If you host it elsewhere, copy those images
into `assets/` and change the URLs in `js/config.js` and
`data/menu-overrides.json`.

## Things to confirm with the restaurant

* **Opening hours** in `js/config.js` are placeholders.
* **Delivery fee, free-delivery threshold, minimum order, delivery area** are placeholders.
* **WhatsApp number / e-mail / endpoint** for receiving orders.
* The site lists two prices for beers, whisky and wine (e.g. `₪31/28`) without
  labels. They are shown as חצי ליטר/שליש, כוס/צ'ייסר and בקבוק/כוס – adjust in
  `data/menu-overrides.json` → `priceVariantLabels`.
* Option groups were inferred from dish descriptions ("סלמון / טונה אדומה",
  "ברי / רוקפור / סנט מור", noodle choices, combination choices). Review them
  in `data/menu-overrides.json`.
* Whether alcohol should be offered for delivery at all.
* "קומבינציית דיימונד" is listed in both קומבינציות (8 pcs per roll) and
  ספיישלים (6 pcs per roll) on the site; only the קומבינציות version is kept.

## Possible next steps

* Online payment (Tranzila / Cardcom / PayPlus / Meshulam) at checkout.
* A small backend or Google Sheet behind `orderEndpoint` with an order screen
  for the kitchen, SMS/WhatsApp confirmations to the customer.
* Delivery zones with different fees, time-slot capacity.
* Analytics events (add-to-cart, checkout) via the site's existing Google tag.
