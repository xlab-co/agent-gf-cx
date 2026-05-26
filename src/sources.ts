/**
 * Source: Apple Refurbished — US Mac mini page.
 *
 * Parses with Cloudflare's native HTMLRewriter (streaming, CSS-selector
 * based) rather than regex. Survives small markup changes that would
 * break a tighter pattern. If Apple restructures their tile shell
 * (e.g. moves the title <a> to a different ancestor), update the
 * selectors in TileCollector below.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const APPLE_REFURB_URL =
  "https://www.apple.com/shop/refurbished/mac/mac-mini";

export interface PriceResult {
  source: string;
  name: string;
  price: number | null;
  url: string;
  error?: string;
}

export interface Target {
  chip: string;
  ram: string;
  storage: string;
}

interface RawTile {
  urlPath: string;
  name: string;
  priceStr: string;
}

/**
 * HTMLRewriter handler that collects every product tile.
 *
 * Apple's refurbished grid renders each product as an anchor whose href
 * matches /shop/product/<sku>/... The title is the anchor's text. The
 * price lives in a sibling element, usually marked .as-pricepoint-price
 * or .as-price-currentprice. We capture both anchor text and any
 * `$<digits>` body text inside the surrounding tile container, then
 * pair them by tile in order.
 */
class TileCollector {
  tiles: RawTile[] = [];
  private current: Partial<RawTile> | null = null;
  private capturingTitle = false;
  private capturingPrice = false;

  // Anchor with the product href → start of a new tile.
  element(el: Element): void {
    const href = el.getAttribute("href");
    if (href && href.startsWith("/shop/product/")) {
      // Flush previous tile if it's complete.
      if (this.current?.urlPath && this.current.name && this.current.priceStr) {
        this.tiles.push(this.current as RawTile);
      }
      this.current = { urlPath: href, name: "", priceStr: "" };
      this.capturingTitle = true;
      el.onEndTag(() => {
        this.capturingTitle = false;
      });
    }
  }

  text(chunk: Text): void {
    if (!this.current) return;
    const t = chunk.text;
    if (this.capturingTitle) {
      this.current.name = `${this.current.name ?? ""}${t}`;
    }
    if (this.capturingPrice && !this.current.priceStr) {
      const m = t.match(/\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?)/);
      if (m) this.current.priceStr = m[1];
    }
  }

  // Price-bearing span — start scanning text for the first $... token.
  priceElement(el: Element): void {
    this.capturingPrice = true;
    el.onEndTag(() => {
      this.capturingPrice = false;
    });
  }

  flush(): RawTile[] {
    if (this.current?.urlPath && this.current.name && this.current.priceStr) {
      this.tiles.push(this.current as RawTile);
      this.current = null;
    }
    return this.tiles;
  }
}

export async function checkApple(target: Target): Promise<PriceResult[]> {
  const resp = await fetch(APPLE_REFURB_URL, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    cf: { cacheTtl: 300 }, // brief edge cache to be polite
  });

  if (!resp.ok) {
    throw new Error(`Apple Refurbished returned ${resp.status}`);
  }

  const collector = new TileCollector();
  const rewriter = new HTMLRewriter()
    .on('a[href^="/shop/product/"]', collector)
    .on(
      ".as-pricepoint-price, .as-price-currentprice, [data-autom='currentPrice']",
      {
        element(el: Element) {
          collector.priceElement(el);
        },
      },
    )
    .on("a[href^=\"/shop/product/\"], .as-pricepoint-price, .as-price-currentprice, [data-autom='currentPrice']", {
      text(chunk: Text) {
        collector.text(chunk);
      },
    });

  // Consume the body through the rewriter (we don't need the rewritten
  // output, just the side-effect of the handlers being called).
  await rewriter.transform(resp.clone()).arrayBuffer();
  const tiles = collector.flush();

  const matches: PriceResult[] = [];
  for (const tile of tiles) {
    const name = tile.name.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const nameL = name.toLowerCase();
    const matchesConfig =
      nameL.includes(target.chip.toLowerCase()) &&
      nameL.includes(target.ram.toLowerCase()) &&
      nameL.includes(target.storage.toLowerCase()) &&
      nameL.includes("mac mini");
    if (!matchesConfig) continue;

    const price = parseFloat(tile.priceStr.replace(/,/g, ""));
    if (Number.isNaN(price)) continue;

    matches.push({
      source: "Apple Refurbished",
      name,
      price,
      url: `https://www.apple.com${tile.urlPath}`,
    });
  }

  if (matches.length === 0) {
    return [
      {
        source: "Apple Refurbished",
        name: `No ${target.chip}/${target.ram}/${target.storage} listings today`,
        price: null,
        url: APPLE_REFURB_URL,
      },
    ];
  }

  return matches;
}
