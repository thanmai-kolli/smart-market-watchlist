/**
 * The reasoning, in the open.
 *
 * Deciding what deserves someone's attention is the whole product, and a
 * judgement nobody can inspect is just an assertion.
 */
const DECISIONS = [
  {
    q: "What counts as a meaningful change",
    a: "A move measured since your last visit, divided by that stock's own volatility, with the market's contribution removed. Roughly two standard deviations earns a card. Corporate actions, halts and 52-week breaks qualify regardless of size, because in those cases the size is not what matters.",
  },
  {
    q: "Why a card says what it says",
    a: "The move, how unusual it is, whether the sector explains it, whether volume backs it, and what happened that day — plus a Why button showing the full arithmetic. Every clause is one stage of the calculation read back in English, so the explanation cannot drift from the maths.",
  },
  {
    q: "How it remembers you without an account",
    a: "An anonymous cookie session with SQLite behind it \u2014 no signup wall. The 'last seen' marker stores a timestamp, never a price: a split between two visits would silently corrupt a stored one. Updates use a monotone max, so two devices acknowledging at once converge instead of overwriting each other.",
  },
  {
    q: "What happens when the data is late, or wrong",
    a: "A price is never a bare number: it carries when the trade happened, when we fetched it, and how much to trust it. 'Closed' and 'stale' are separate \u2014 one means the market is shut and the price is correctly frozen, the other means it's open but this stock hasn't traded. The benchmark is checked against a second source, and disagreement is reported rather than hidden.",
  },
  {
    q: "What happens when a lot of people use it at once",
    a: "Ten thousand users watching fifty stocks each is five hundred thousand subscriptions \u2014 but NSE has about two thousand symbols. Prices are fetched per symbol, not per user, so the work is proportional to the market rather than the audience. Concurrent requests for the same symbol collapse into one.",
  },
  {
    q: "What it deliberately doesn't do",
    a: "No queue, no Redis, no Docker, no ORM, no charts. Six production dependencies. The data is tens of megabytes and read-heavy, so SQLite is right-sized rather than a compromise. The universe is a hundred and forty-two NSE names, every one verified against the live feed \\u2014 that is the list that has been checked, not a ceiling the design imposes.",
  },
];

export function Decisions() {
  return (
    <section className="section alt" id="engineering">
      <div className="section-inner">
        <div className="section-head">
          <span className="eyebrow">Under the hood</span>
          <h2>How it actually works</h2>
          <p className="section-lede">
            Every one of these could have gone another way.
          </p>
        </div>

        <div className="decisions">
          {DECISIONS.map((d) => (
            <details className="decision" key={d.q}>
              <summary>
                <span className="decision-q">{d.q}</span>
                <span className="decision-mark" aria-hidden="true">
                  +
                </span>
              </summary>
              <p>{d.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
