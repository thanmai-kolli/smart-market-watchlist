export function SiteFooter() {
  return (
    <footer className="footer" id="contact">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="brand-mark">M</span>
          <div>
            <strong>Meanwhile</strong>
            <p className="faint">What happened while you were away.</p>
          </div>
        </div>

        <div className="footer-cols">
          <div className="footer-col">
            <h4>The product</h4>
            <a href="#app">Your watchlist</a>
            <a href="#how">How it decides</a>
            <a href="#engineering">Under the hood</a>
            <a href="#about">About</a>
          </div>

          <div className="footer-col">
            <h4>Data sources</h4>
            <a
              href="https://www.nseindia.com/companies-listing/corporate-filings-actions"
              target="_blank"
              rel="noreferrer noopener"
            >
              NSE corporate actions
            </a>
            <a
              href="https://www.nseindia.com/market-data/live-equity-market"
              target="_blank"
              rel="noreferrer noopener"
            >
              NSE market data
            </a>
            <span className="faint">Prices: delayed public feed</span>
          </div>

          <div className="footer-col">
            <h4>Contact</h4>
            <a
              href="https://github.com/thanmai-kolli"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
            <span className="faint">Built with Express, SQLite and React</span>
          </div>
        </div>
      </div>

      <div className="footer-legal">
        <div className="footer-inner">
          <p>
            <strong>This is not investment advice.</strong> Everything here is a
            factual observation about price movement, never a recommendation.
            Prices are delayed and always shown with their state.
          </p>
        </div>
      </div>
    </footer>
  );
}
