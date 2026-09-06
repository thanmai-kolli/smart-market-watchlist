/**
 * Verifies cross-device continuity with two independent cookie jars.
 *   npm run check-sync -w api   (dev server must be running)
 *
 * "Device B sees device A's list" is not something a unit test can prove, since
 * the whole mechanism is cookies over HTTP.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3001";

class Client {
  private cookie = "";
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async call(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    const set = res.headers.getSetCookie?.()[0];
    if (set) this.cookie = set.split(";")[0]!;
    return { status: res.status, body: await res.json().catch(() => null) };
  }
}

const laptop = new Client("laptop");
const phone = new Client("phone");

console.log("=== Two independent sessions ===");
const a = await laptop.call("/api/watchlist");
const b = await phone.call("/api/watchlist");
console.log(`  laptop: ${a.body.items.length} stocks`);
console.log(`  phone : ${b.body.items.length} stocks`);

console.log("\n=== Laptop customises its list ===");
await laptop.call("/api/watchlist", {
  method: "POST",
  body: JSON.stringify({ symbol: "COFORGE.NS" }),
});
await laptop.call("/api/watchlist?symbol=RELIANCE.NS", { method: "DELETE" });
const after = await laptop.call("/api/watchlist");
const laptopSymbols = after.body.items.map((i: any) => i.symbol).sort();
console.log(`  laptop now has ${laptopSymbols.length}: added COFORGE, removed RELIANCE`);

const phoneBefore = await phone.call("/api/watchlist");
const phoneSymbols = phoneBefore.body.items.map((i: any) => i.symbol).sort();
console.log(
  `  phone unaffected: ${JSON.stringify(phoneSymbols) !== JSON.stringify(laptopSymbols) ? "yes" : "NO — sessions leaked"}`,
);

console.log("\n=== Laptop issues a sync code ===");
const { body: issued } = await laptop.call("/api/sync/code", { method: "POST" });
console.log(`  code: ${issued.code.slice(0, 10)}… (${issued.code.length} chars)`);

console.log("\n=== Phone redeems it ===");
const redeem = await phone.call("/api/sync/redeem", {
  method: "POST",
  body: JSON.stringify({ code: issued.code }),
});
console.log(`  status ${redeem.status}`);

const phoneAfter = await phone.call("/api/watchlist");
const adopted = phoneAfter.body.items.map((i: any) => i.symbol).sort();
console.log(`  phone now has ${adopted.length} stocks`);
console.log(
  `  matches laptop: ${JSON.stringify(adopted) === JSON.stringify(laptopSymbols) ? "YES" : "NO"}`,
);

console.log("\n=== Bad codes are rejected ===");
const stranger = new Client("stranger");
await stranger.call("/api/watchlist");
for (const bad of ["wrongcode123", "", "x".repeat(200)]) {
  const r = await stranger.call("/api/sync/redeem", {
    method: "POST",
    body: JSON.stringify({ code: bad }),
  });
  console.log(`  ${JSON.stringify(bad.slice(0, 16)).padEnd(20)} -> HTTP ${r.status}`);
}

console.log("\n=== Brute force is rate limited ===");
let limited = 0;
for (let i = 0; i < 14; i++) {
  const r = await stranger.call("/api/sync/redeem", {
    method: "POST",
    body: JSON.stringify({ code: `guess-${i}-aaaaaaaa` }),
  });
  if (r.status === 429) limited++;
}
console.log(
  `  ${limited} of 14 attempts blocked with 429 ${limited > 0 ? "— limiter active" : "— NOT LIMITED"}`,
);
