/**
 * Seed universe: liquid NSE names across sectors.
 *
 * Sector is here because it drives cluster de-duplication — "5 IT stocks moved
 * together" is one card, not five. Deliberately small: the point is a realistic
 * spread of sectors, not full NSE coverage.
 */
export interface SeedSymbol {
  symbol: string;
  name: string;
  sector: string;
}

export const NSE_SYMBOLS: SeedSymbol[] = [
  { symbol: "TCS.NS", name: "Tata Consultancy Services", sector: "IT" },
  { symbol: "INFY.NS", name: "Infosys", sector: "IT" },
  { symbol: "WIPRO.NS", name: "Wipro", sector: "IT" },
  { symbol: "HCLTECH.NS", name: "HCL Technologies", sector: "IT" },
  { symbol: "TECHM.NS", name: "Tech Mahindra", sector: "IT" },
  { symbol: "PERSISTENT.NS", name: "Persistent Systems", sector: "IT" },
  { symbol: "COFORGE.NS", name: "Coforge", sector: "IT" },

  { symbol: "HDFCBANK.NS", name: "HDFC Bank", sector: "Banking" },
  { symbol: "ICICIBANK.NS", name: "ICICI Bank", sector: "Banking" },
  { symbol: "SBIN.NS", name: "State Bank of India", sector: "Banking" },
  { symbol: "KOTAKBANK.NS", name: "Kotak Mahindra Bank", sector: "Banking" },
  { symbol: "AXISBANK.NS", name: "Axis Bank", sector: "Banking" },
  { symbol: "INDUSINDBK.NS", name: "IndusInd Bank", sector: "Banking" },

  { symbol: "MARUTI.NS", name: "Maruti Suzuki", sector: "Auto" },
  { symbol: "TVSMOTOR.NS", name: "TVS Motor Company", sector: "Auto" },
  { symbol: "ASHOKLEY.NS", name: "Ashok Leyland", sector: "Auto" },
  { symbol: "BAJAJ-AUTO.NS", name: "Bajaj Auto", sector: "Auto" },
  { symbol: "EICHERMOT.NS", name: "Eicher Motors", sector: "Auto" },
  { symbol: "HEROMOTOCO.NS", name: "Hero MotoCorp", sector: "Auto" },

  { symbol: "HINDUNILVR.NS", name: "Hindustan Unilever", sector: "FMCG" },
  { symbol: "ITC.NS", name: "ITC", sector: "FMCG" },
  { symbol: "NESTLEIND.NS", name: "Nestle India", sector: "FMCG" },
  { symbol: "BRITANNIA.NS", name: "Britannia Industries", sector: "FMCG" },
  { symbol: "DABUR.NS", name: "Dabur India", sector: "FMCG" },

  { symbol: "SUNPHARMA.NS", name: "Sun Pharmaceutical", sector: "Pharma" },
  { symbol: "DRREDDY.NS", name: "Dr Reddy's Laboratories", sector: "Pharma" },
  { symbol: "CIPLA.NS", name: "Cipla", sector: "Pharma" },
  { symbol: "DIVISLAB.NS", name: "Divi's Laboratories", sector: "Pharma" },

  { symbol: "RELIANCE.NS", name: "Reliance Industries", sector: "Energy" },
  { symbol: "ONGC.NS", name: "Oil & Natural Gas Corp", sector: "Energy" },
  { symbol: "NTPC.NS", name: "NTPC", sector: "Energy" },
  { symbol: "POWERGRID.NS", name: "Power Grid Corp", sector: "Energy" },
  { symbol: "TATAPOWER.NS", name: "Tata Power", sector: "Energy" },

  { symbol: "TATASTEEL.NS", name: "Tata Steel", sector: "Metals" },
  { symbol: "JSWSTEEL.NS", name: "JSW Steel", sector: "Metals" },
  { symbol: "HINDALCO.NS", name: "Hindalco Industries", sector: "Metals" },

  { symbol: "BAJFINANCE.NS", name: "Bajaj Finance", sector: "Financials" },
  { symbol: "HDFCLIFE.NS", name: "HDFC Life Insurance", sector: "Financials" },
  { symbol: "SBILIFE.NS", name: "SBI Life Insurance", sector: "Financials" },

  { symbol: "TITAN.NS", name: "Titan Company", sector: "Consumer" },
  { symbol: "ASIANPAINT.NS", name: "Asian Paints", sector: "Consumer" },
  { symbol: "TRENT.NS", name: "Trent", sector: "Consumer" },

  { symbol: "LT.NS", name: "Larsen & Toubro", sector: "Infrastructure" },
  { symbol: "ULTRACEMCO.NS", name: "UltraTech Cement", sector: "Infrastructure" },
  { symbol: "GRASIM.NS", name: "Grasim Industries", sector: "Infrastructure" },
  { symbol: "ADANIPORTS.NS", name: "Adani Ports & SEZ", sector: "Infrastructure" },

  // Three names minimum, or the sector can never produce a "the whole sector
  // moved" card and a Telecom watchlist would be structurally unable to explain
  // itself.
  { symbol: "BHARTIARTL.NS", name: "Bharti Airtel", sector: "Telecom" },
  { symbol: "IDEA.NS", name: "Vodafone Idea", sector: "Telecom" },
  { symbol: "INDUSTOWER.NS", name: "Indus Towers", sector: "Telecom" },

  { symbol: "PNB.NS", name: "Punjab National Bank", sector: "Banking" },
  { symbol: "BANKBARODA.NS", name: "Bank of Baroda", sector: "Banking" },
  { symbol: "CANBK.NS", name: "Canara Bank", sector: "Banking" },
  { symbol: "IDFCFIRSTB.NS", name: "IDFC First Bank", sector: "Banking" },
  { symbol: "FEDERALBNK.NS", name: "Federal Bank", sector: "Banking" },
  { symbol: "AUBANK.NS", name: "AU Small Finance Bank", sector: "Banking" },

  { symbol: "BAJAJFINSV.NS", name: "Bajaj Finserv", sector: "Financials" },
  { symbol: "MUTHOOTFIN.NS", name: "Muthoot Finance", sector: "Financials" },
  { symbol: "CHOLAFIN.NS", name: "Cholamandalam Investment", sector: "Financials" },
  { symbol: "SHRIRAMFIN.NS", name: "Shriram Finance", sector: "Financials" },
  { symbol: "PFC.NS", name: "Power Finance Corporation", sector: "Financials" },
  { symbol: "RECLTD.NS", name: "REC", sector: "Financials" },
  { symbol: "IRFC.NS", name: "Indian Railway Finance Corp", sector: "Financials" },
  { symbol: "HDFCAMC.NS", name: "HDFC Asset Management", sector: "Financials" },
  { symbol: "ICICIGI.NS", name: "ICICI Lombard", sector: "Financials" },
  { symbol: "ICICIPRULI.NS", name: "ICICI Prudential Life", sector: "Financials" },
  { symbol: "LICI.NS", name: "Life Insurance Corporation", sector: "Financials" },

  { symbol: "PAYTM.NS", name: "One 97 Communications", sector: "New economy" },
  { symbol: "NYKAA.NS", name: "FSN E-Commerce Ventures", sector: "New economy" },
  { symbol: "POLICYBZR.NS", name: "PB Fintech", sector: "New economy" },
  { symbol: "DELHIVERY.NS", name: "Delhivery", sector: "New economy" },
  { symbol: "JIOFIN.NS", name: "Jio Financial Services", sector: "New economy" },
  { symbol: "IRCTC.NS", name: "Indian Railway Catering & Tourism", sector: "New economy" },
  // Renamed from Zomato in 2025. The old name stays searchable on purpose,
  // because that is still what people type.
  { symbol: "ETERNAL.NS", name: "Eternal (Zomato)", sector: "New economy" },
  { symbol: "SWIGGY.NS", name: "Swiggy", sector: "New economy" },

  { symbol: "TMPV.NS", name: "Tata Motors Passenger Vehicles", sector: "Auto" },
  { symbol: "M&M.NS", name: "Mahindra & Mahindra", sector: "Auto" },
  { symbol: "BOSCHLTD.NS", name: "Bosch", sector: "Auto" },
  { symbol: "MOTHERSON.NS", name: "Samvardhana Motherson", sector: "Auto" },
  { symbol: "BALKRISIND.NS", name: "Balkrishna Industries", sector: "Auto" },

  { symbol: "MPHASIS.NS", name: "Mphasis", sector: "IT" },
  { symbol: "OFSS.NS", name: "Oracle Financial Services", sector: "IT" },
  { symbol: "KPITTECH.NS", name: "KPIT Technologies", sector: "IT" },

  { symbol: "LUPIN.NS", name: "Lupin", sector: "Pharma" },
  { symbol: "AUROPHARMA.NS", name: "Aurobindo Pharma", sector: "Pharma" },
  { symbol: "ALKEM.NS", name: "Alkem Laboratories", sector: "Pharma" },
  { symbol: "TORNTPHARM.NS", name: "Torrent Pharmaceuticals", sector: "Pharma" },
  { symbol: "ZYDUSLIFE.NS", name: "Zydus Lifesciences", sector: "Pharma" },
  { symbol: "GLENMARK.NS", name: "Glenmark Pharmaceuticals", sector: "Pharma" },
  { symbol: "MANKIND.NS", name: "Mankind Pharma", sector: "Pharma" },
  { symbol: "BIOCON.NS", name: "Biocon", sector: "Pharma" },
  { symbol: "LAURUSLABS.NS", name: "Laurus Labs", sector: "Pharma" },

  { symbol: "APOLLOHOSP.NS", name: "Apollo Hospitals", sector: "Healthcare" },
  { symbol: "MAXHEALTH.NS", name: "Max Healthcare", sector: "Healthcare" },
  { symbol: "FORTIS.NS", name: "Fortis Healthcare", sector: "Healthcare" },

  { symbol: "COALINDIA.NS", name: "Coal India", sector: "Energy" },
  { symbol: "GAIL.NS", name: "GAIL India", sector: "Energy" },
  { symbol: "IOC.NS", name: "Indian Oil Corporation", sector: "Energy" },
  { symbol: "BPCL.NS", name: "Bharat Petroleum", sector: "Energy" },
  { symbol: "HINDPETRO.NS", name: "Hindustan Petroleum", sector: "Energy" },
  { symbol: "PETRONET.NS", name: "Petronet LNG", sector: "Energy" },
  { symbol: "ADANIGREEN.NS", name: "Adani Green Energy", sector: "Energy" },
  { symbol: "ADANIPOWER.NS", name: "Adani Power", sector: "Energy" },

  { symbol: "VEDL.NS", name: "Vedanta", sector: "Metals" },
  { symbol: "NATIONALUM.NS", name: "National Aluminium", sector: "Metals" },
  { symbol: "SAIL.NS", name: "Steel Authority of India", sector: "Metals" },
  { symbol: "JINDALSTEL.NS", name: "Jindal Steel & Power", sector: "Metals" },
  { symbol: "APLAPOLLO.NS", name: "APL Apollo Tubes", sector: "Metals" },

  { symbol: "ADANIENT.NS", name: "Adani Enterprises", sector: "Consumer" },
  { symbol: "DMART.NS", name: "Avenue Supermarts", sector: "Consumer" },
  { symbol: "MARICO.NS", name: "Marico", sector: "Consumer" },
  { symbol: "GODREJCP.NS", name: "Godrej Consumer Products", sector: "Consumer" },
  { symbol: "COLPAL.NS", name: "Colgate-Palmolive India", sector: "Consumer" },
  { symbol: "TATACONSUM.NS", name: "Tata Consumer Products", sector: "Consumer" },
  { symbol: "VBL.NS", name: "Varun Beverages", sector: "Consumer" },
  { symbol: "JUBLFOOD.NS", name: "Jubilant FoodWorks", sector: "Consumer" },
  { symbol: "PIDILITIND.NS", name: "Pidilite Industries", sector: "Consumer" },
  { symbol: "PAGEIND.NS", name: "Page Industries", sector: "Consumer" },

  { symbol: "DLF.NS", name: "DLF", sector: "Realty" },
  { symbol: "GODREJPROP.NS", name: "Godrej Properties", sector: "Realty" },
  { symbol: "OBEROIRLTY.NS", name: "Oberoi Realty", sector: "Realty" },
  { symbol: "PRESTIGE.NS", name: "Prestige Estates", sector: "Realty" },
  { symbol: "LODHA.NS", name: "Macrotech Developers", sector: "Realty" },

  { symbol: "AMBUJACEM.NS", name: "Ambuja Cements", sector: "Infrastructure" },
  { symbol: "SHREECEM.NS", name: "Shree Cement", sector: "Infrastructure" },
  { symbol: "ACC.NS", name: "ACC", sector: "Infrastructure" },
  { symbol: "DALBHARAT.NS", name: "Dalmia Bharat", sector: "Infrastructure" },

  { symbol: "SIEMENS.NS", name: "Siemens India", sector: "Industrials" },
  { symbol: "ABB.NS", name: "ABB India", sector: "Industrials" },
  { symbol: "BHEL.NS", name: "Bharat Heavy Electricals", sector: "Industrials" },
  { symbol: "CUMMINSIND.NS", name: "Cummins India", sector: "Industrials" },
  { symbol: "HAVELLS.NS", name: "Havells India", sector: "Industrials" },
  { symbol: "POLYCAB.NS", name: "Polycab India", sector: "Industrials" },
  { symbol: "DIXON.NS", name: "Dixon Technologies", sector: "Industrials" },
  { symbol: "THERMAX.NS", name: "Thermax", sector: "Industrials" },

  { symbol: "HAL.NS", name: "Hindustan Aeronautics", sector: "Defence & rail" },
  { symbol: "BEL.NS", name: "Bharat Electronics", sector: "Defence & rail" },
  { symbol: "MAZDOCK.NS", name: "Mazagon Dock Shipbuilders", sector: "Defence & rail" },
  { symbol: "RVNL.NS", name: "Rail Vikas Nigam", sector: "Defence & rail" },
  { symbol: "BDL.NS", name: "Bharat Dynamics", sector: "Defence & rail" },

  { symbol: "INDIGO.NS", name: "InterGlobe Aviation", sector: "Transport" },
  { symbol: "CONCOR.NS", name: "Container Corporation of India", sector: "Transport" },
  { symbol: "GESHIP.NS", name: "Great Eastern Shipping", sector: "Transport" },
];

/** Beta is measured against this. It is not watchable. */
export const BENCHMARK: SeedSymbol = {
  symbol: "^NSEI",
  name: "NIFTY 50",
  sector: "Index",
};

/**
 * Seeded into every new session.
 *
 * Deliberately not eight mega-caps. A list of only the calmest names in the
 * index is not what anybody's watchlist looks like, and it guarantees a first
 * screen with nothing on it — the scorer working correctly and appearing to do
 * nothing at all. This is the usual mix: a few things everyone holds, and a few
 * that actually move.
 */
export const DEMO_WATCHLIST = [
  "RELIANCE.NS",
  "INFY.NS",
  "TCS.NS",
  "HDFCBANK.NS",
  "TATASTEEL.NS",
  "DIVISLAB.NS",
  "TATAPOWER.NS",
  "SBILIFE.NS",
  "IDEA.NS",
];
