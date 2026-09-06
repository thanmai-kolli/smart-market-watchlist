const STEPS = [
  {
    n: "01",
    title: "Measure from when you last looked",
    body: "Not from yesterday's close. A week away is measured as a week, not reset every morning.",
  },
  {
    n: "02",
    title: "Compare it to that stock's own normal",
    body: "A 3% move in a steady large-cap is remarkable. In a jumpy small-cap it's a Tuesday. Every move is divided by that stock's own normal.",
  },
  {
    n: "03",
    title: "Remove what the whole market did",
    body: "If everything fell 2% and yours fell 2%, the tide went out — nothing happened to your stock. Only the difference is news.",
  },
  {
    n: "04",
    title: "Check whether anyone was actually trading",
    body: "The same move on 4× the usual volume means something different from one on a quiet afternoon.",
  },
  {
    n: "05",
    title: "Never cry wolf twice",
    body: "Once you've been told, you won't be told again. Repetition is why people mute notifications.",
  },
  {
    n: "06",
    title: "Show three things, or say nothing",
    body: "A fixed budget forces ranking instead of listing. On a quiet day the answer is “nothing needs you”, with the evidence for it.",
  },
];

export function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="section-inner">
        <div className="section-head">
          <span className="eyebrow">How it decides</span>
          <h2>Six filters between a price change and your attention</h2>
          <p className="section-lede">
            Anyone can show a percentage. The work is deciding which ones are
            worth interrupting you for.
          </p>
        </div>

        <ol className="how-grid">
          {STEPS.map((s) => (
            <li className="how-card" key={s.n}>
              <span className="how-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="formula">
          <div className="formula-label">Which comes down to one number</div>
          <code>
            z = (return − beta × market&nbsp;return) ÷ (volatility × √days)
          </code>
          <p className="faint">
            The √days term is what lets one formula handle “I checked ten minutes
            ago” and “I checked three weeks ago” without any special cases.
          </p>
        </div>
      </div>
    </section>
  );
}
