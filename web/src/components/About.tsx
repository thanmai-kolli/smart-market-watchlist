export function About() {
  return (
    <section className="section" id="about">
      <div className="section-inner about-grid">
        <div>
          <span className="eyebrow">About</span>
          <h2>Why Meanwhile exists</h2>
          <p className="section-lede">
            Most people check their watchlist for twenty seconds, standing
            somewhere, holding a phone. A wall of thirty numbers isn't
            information — it's homework.
          </p>
          <p className="section-lede">
            The useful question isn't “what are the prices?” but “has anything
            happened?” — and most days the answer is no. An app confident enough
            to say so beats one that fills the screen regardless.
          </p>
          <p className="section-lede">
            The name is the gap: everything that happened <em>meanwhile</em>,
            while you were doing something else.
          </p>
        </div>

        <div className="about-facts">
          <Fact label="Data" value="Yahoo chart API for prices and history">
            Unofficial in provenance, not in value — checked against NSE's own
            published figures across eight indices, it matched every one exactly.
            One request returns the price and six months of daily bars together,
            cached per symbol rather than per user: thirty seconds while trading,
            fifteen minutes once the market shuts.
          </Fact>
          <Fact label="Exchange" value="NSE for corporate actions and status">
            Their live quote endpoint is blocked to programs, but corporate
            actions are open — and an ex-date is what separates “your stock
            crashed 50%” from “your share count doubled”.
          </Fact>
          <Fact label="Built with" value="Express · SQLite · React · TypeScript">
            Two separate services, six production dependencies, no Docker. Clone
            it and two commands run the whole thing.
          </Fact>
          <Fact label="Not built, deliberately" value="Predictions, a news feed, and alerts you configure">
            No headline feed: an unexplained move on three times the usual volume
            already tells you news exists, without waiting for a publisher or
            deciding which outlet to believe. Forecasting isn't something to be
            trusted with. And the moment you set your own thresholds, the app has
            handed the problem back to you.
          </Fact>
        </div>
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fact">
      <div className="fact-label">{label}</div>
      <div className="fact-value">{value}</div>
      <p className="fact-body">{children}</p>
    </div>
  );
}
