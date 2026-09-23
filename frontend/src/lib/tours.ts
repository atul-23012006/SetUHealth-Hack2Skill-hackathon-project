// One guided tour per route. Each step's `target` is a CSS selector for an
// element the page renders; those ids are a hard contract with the page
// components (there is no type or build error if one is renamed, the step is
// just skipped at runtime — see resolveTourSteps in components/TourButton.tsx).
// Console-nav targets (`a[href="/federated"]` etc.) come from Layout's NavLinks.
import { matchPath } from "react-router-dom";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center" | "auto";

export interface TourStepDef {
  target: string;
  title: string;
  content: string;
  placement?: TourPlacement;
}

export interface TourDef {
  /** Stable id, also the localStorage key suffix for the "unseen" hint. */
  id: string;
  /** Shown in the tooltip header. */
  name: string;
  steps: TourStepDef[];
}

const dashboard: TourDef = {
  id: "dashboard",
  name: "Dashboard tour",
  steps: [
    {
      target: "#dashboard-hero",
      title: "Your national command view",
      content:
        "Everything here is computed from the network's synthetic demo dataset: every PHC's stock, beds and staff, forecast forward so problems surface before they happen.",
      placement: "bottom",
    },
    {
      target: "#demo-mode-btn",
      title: "Run the whole story in one click",
      content:
        "Run Demo resets the simulation, injects a monsoon-flood crisis, recomputes stockout forecasts and shows the redistribution response, end to end.",
      placement: "bottom",
    },
    {
      target: "#crisis-simulator",
      title: "Inject your own emergency",
      content:
        "Pick a state or district and an outbreak type, then Simulate Outbreak. Forecasts flip critical, stockouts accelerate and redistribution recomputes live.",
      placement: "bottom",
    },
    {
      target: "#stat-cards",
      title: "Live network vitals",
      content:
        "Critical and warning stockout alerts, bed occupancy and staff attendance across every monitored facility. Critical tiles pulse when something needs attention.",
      placement: "bottom",
    },
    {
      target: "#live-signals",
      title: "Real weather, real signals",
      content:
        "Actual 7-day forecasts for each state, turned into signals for heavy rain, mosquito-borne conditions and cold-chain heat stress. Press Simulate on a signal to load it into the crisis simulator.",
      placement: "top",
    },
    {
      target: "#weather-impact",
      title: "What if the weather turns into demand?",
      content:
        "Applies stated planning assumptions to the real forecast and shows where supply would run short first. Drag the strength slider, or switch on the option to re-plan the alerts and recommendations below. Stored data never changes.",
      placement: "top",
    },
    {
      target: "#sdg-panel",
      title: "Impact against SDG 3.8",
      content:
        "Estimates of facilities at risk, patients potentially affected, and stockout-days that pending transfers could prevent, tied to Universal Health Coverage.",
      placement: "top",
    },
    {
      target: "#national-map",
      title: "Every PHC on one map",
      content:
        "Colour-coded dots: red is critical, amber is warning, green is healthy. Zoomed out, nearby facilities cluster. Animated arrows show recommended supply transfers.",
      placement: "right",
    },
    {
      target: "#state-list",
      title: "Drill into a state",
      content: "Jump to any state's facility table, alerts and recommendations. The badges count its critical and warning PHCs.",
      placement: "left",
    },
    {
      target: "#alerts-panel",
      title: "Stockout early warnings",
      content:
        "Holt's exponential smoothing projects each facility's stock 14 days ahead. Ask for an AI explanation of any alert in plain language.",
      placement: "top",
    },
    {
      target: "#redistribution-panel",
      title: "Who should send what to whom",
      content:
        "A linear-programming optimiser matches facilities in deficit with nearby surplus, minimising distance. Execute a transfer here and the ledger, stock and forecasts update.",
      placement: "top",
    },
    {
      target: "#anomaly-panel",
      title: "Consumption integrity",
      content:
        "Medicine drawdown is reconciled against patient footfall. Facilities that are outliers are flagged as possible over-consumption or under-reporting.",
      placement: "top",
    },
    {
      target: "#notification-bell",
      title: "Alerts when real signals turn high",
      content:
        "The server checks the real weather forecast in the background and raises one alert when a signal newly turns high. Open the bell to read them, run a check now, or opt in to desktop notifications.",
      placement: "bottom",
    },
    {
      target: 'a[href="/federated"]',
      title: "Federated Network",
      content:
        "See how states, and simulated BRICS partners, share only aggregated statistics, never raw facility data.",
      placement: "bottom",
    },
    {
      target: 'a[href="/assistant"]',
      title: "Ask the Assistant",
      content: "Natural-language questions about stock, beds and redistribution, in English, Hindi, Marathi or Tamil.",
      placement: "bottom",
    },
  ],
};

const stateView: TourDef = {
  id: "state",
  name: "State view tour",
  steps: [
    {
      target: "#state-header",
      title: "State overview",
      content: "This page narrows the national picture to one state. Use the back link to return to the dashboard.",
      placement: "bottom",
    },
    {
      target: "#state-phc-table",
      title: "Every facility in the state",
      content: "District, bed occupancy and staff attendance at a glance. Click a facility name to open its full forecast page.",
      placement: "top",
    },
    {
      target: "#state-alerts",
      title: "The state's stockout alerts",
      content: "The most urgent projected stockouts here, ranked by days remaining. Each can be explained in plain language.",
      placement: "top",
    },
    {
      target: "#state-redistribution",
      title: "Recommended transfers",
      content: "Optimised transfer recommendations for this state. Each can be expanded into an AI-written justification and executed from here.",
      placement: "top",
    },
  ],
};

const phcDetail: TourDef = {
  id: "phc",
  name: "Facility tour",
  steps: [
    {
      target: "#phc-header",
      title: "One facility",
      content: "Name, district and state. The link above returns you to the state's facility list.",
      placement: "bottom",
    },
    {
      target: "#phc-staff",
      title: "Sanctioned staff",
      content: "The staffing roster this facility is funded for, by role.",
      placement: "bottom",
    },
    {
      target: "#phc-stock",
      title: "Stock level and risk",
      content:
        "Choose a medicine to see its 90-day stock history, the reorder line, and a risk badge with days until stockout. Cold-chain items also show fridge temperature.",
      placement: "top",
    },
    {
      target: "#phc-forecast",
      title: "14-day forecast",
      content: "The projected stock curve with a ±1σ uncertainty band. Where the band meets the reorder line is when to act.",
      placement: "top",
    },
    {
      target: "#phc-capacity",
      title: "Beds and attendance",
      content: "Bed occupancy against capacity, and staff attendance over the same window. Strain here can signal demand before stock does.",
      placement: "top",
    },
  ],
};

const medicineState: TourDef = {
  id: "medicine-state",
  name: "Medicine drill-down tour",
  steps: [
    {
      target: "#med-header",
      title: "One medicine, one state",
      content: "Aggregated statistics for this medicine across the selected state's facilities.",
      placement: "bottom",
    },
    {
      target: "#med-phc-list",
      title: "Most urgent first",
      content: "Facilities holding this medicine, sorted by risk and then days to stockout. Press View to load one.",
      placement: "right",
    },
    {
      target: "#med-detail",
      title: "Facility detail",
      content:
        "Once you pick a facility, its stock history, forecast, bed occupancy and staff attendance charts appear here.",
      placement: "left",
    },
  ],
};

const federated: TourDef = {
  id: "federated",
  name: "Federated network tour",
  steps: [
    {
      target: "#fed-header",
      title: "Learning without sharing",
      content:
        "States, and eventually partner nations, improve a shared forecasting prior by exchanging aggregate statistics only. No facility or patient record crosses a boundary.",
      placement: "bottom",
    },
    {
      target: "#fed-privacy-toggle",
      title: "Try to break the boundary",
      content: "Switch to Show Raw Data. It is blocked by design: only the aggregated flow is ever allowed through.",
      placement: "bottom",
    },
    {
      target: "#fed-network",
      title: "The live network",
      content:
        "Nodes send summaries to the central aggregator. Partner nations (Brazil, South Africa, Egypt) are simulated and labelled as such.",
      placement: "top",
    },
    {
      target: "#fed-national",
      title: "National prior",
      content: "The federated average of every state's category depletion rates, weighted by facility count.",
      placement: "top",
    },
    {
      target: "#fed-brics",
      title: "BRICS shared prior",
      content:
        "The same averaging extended across countries. The confidence figure is a simple proxy that rises as more nodes contribute; it is not a per-prediction accuracy.",
      placement: "top",
    },
    {
      target: "#fed-facility-counts",
      title: "How big is the real network, really?",
      content:
        "Official government facility counts for these six states, from India's own Rural Health Statistics, next to how many facilities this demo's synthetic network models for the same state. The gap is deliberate — this demo runs at a fraction of real scale — and is explained if you expand \"Why is the network count so much smaller?\".",
      placement: "top",
    },
    {
      target: "#fed-benchmarks",
      title: "Real numbers, not simulated",
      content:
        "Everything above this panel is a simulation, but these are real World Bank indicators for BRICS countries. Switch indicator, toggle countries, and hover a country to isolate its line. The banner compares India with the median of the others.",
      placement: "top",
    },
  ],
};

const transfers: TourDef = {
  id: "transfers",
  name: "Transfers tour",
  steps: [
    {
      target: "#transfers-header",
      title: "The transfer ledger",
      content: "Every executed stock movement, stored durably so it survives a backend restart.",
      placement: "bottom",
    },
    {
      target: "#transfers-refresh",
      title: "Stay current",
      content: "Refresh to pull the latest manifests and audit events after executing a transfer elsewhere.",
      placement: "left",
    },
    {
      target: "#transfers-table",
      title: "Manifests",
      content:
        "Donor, recipient, quantity, who requested it, and a badge when a simulated courier was auto-dispatched. Each manifest can be exported as a FHIR R4 SupplyRequest.",
      placement: "top",
    },
    {
      target: "#audit-trail",
      title: "Audit trail",
      content: "A chronological record of every state change: transfers, crises, resets and rejected attempts.",
      placement: "top",
    },
  ],
};

const assistant: TourDef = {
  id: "assistant",
  name: "Assistant tour",
  steps: [
    {
      target: "#assistant-header",
      title: "Setu Assistant",
      content: "Scope answers to one state with the selector, or leave it on all states for the national view.",
      placement: "bottom",
    },
    {
      target: "#assistant-chat",
      title: "Ask in your language",
      content:
        "Ask about stock, beds or redistribution in English, Hindi, Marathi or Tamil (switch language in the header). Without an API key it answers in offline demo mode.",
      placement: "top",
    },
    {
      target: "#assistant-input",
      title: "It can act, too",
      content:
        'Try "transfer 10 paracetamol from PHC-0001 to PHC-0002", "simulate dengue in Pune" or "reset the simulation". Transfers need an identity picked in the header and follow the same authorisation as the manual form.',
      placement: "top",
    },
    {
      target: "#assistant-mic",
      title: "Voice input",
      content: "Speak your question instead of typing, where your browser supports speech recognition.",
      placement: "top",
    },
  ],
};

const explore: TourDef = {
  id: "explore",
  name: "Explore tour",
  steps: [
    {
      target: "#explore-search",
      title: "Search any place in India",
      content: "Type a city, town or district. Suggestions come from a real geocoding service, and arrow keys plus Enter work.",
      placement: "bottom",
    },
    {
      target: "#explore-locate",
      title: "Or use where you are",
      content: "Your browser will ask for permission. Your location is only used to fetch weather and nearby facilities; nothing is stored.",
      placement: "bottom",
    },
    {
      target: "#explore-map",
      title: "Two kinds of facility, clearly separated",
      content:
        "Blue squares are real hospitals and clinics from OpenStreetMap. Coloured dots are SetuHealth's synthetic network facilities, coloured by stock risk. Click the map to drop the pin somewhere else, and use the switches above to toggle layers and the radius.",
      placement: "top",
    },
    {
      target: "#explore-weather",
      title: "Real weather and air quality",
      content:
        "Current conditions, a 7-day rain outlook and US AQI for this exact point, plus the same rule-of-thumb health signals the Dashboard uses. Hover a signal to see its reasoning.",
      placement: "left",
    },
    {
      target: "#explore-nearby",
      title: "Nearby facilities, both worlds",
      content:
        "Switch between the synthetic network (with stock risk and days to first stockout) and real OpenStreetMap facilities. Hovering a row highlights it on the map.",
      placement: "left",
    },
  ],
};

const publicPortal: TourDef = {
  id: "public",
  name: "Public portal tour",
  steps: [
    {
      target: "#public-hero",
      title: "The open view",
      content:
        "A no-login window onto the network. Every figure is a state or national aggregate, the same numbers the federated layer computes internally.",
      placement: "bottom",
    },
    {
      target: "#public-orb",
      title: "The grid, visualised",
      content:
        "Gold core, a lattice of connected facilities, and supply packets bridging them. Move your cursor to tilt it. (Setu means bridge.)",
      placement: "left",
    },
    {
      target: "#public-stats",
      title: "Network at a glance",
      content: "Facilities monitored, population served, and 30-day transfer and stockout-averted counts.",
      placement: "top",
    },
    {
      target: "#public-map",
      title: "Risk by state",
      content: "Each bubble is sized by facility count and coloured by aggregate risk. Click one for that state's summary.",
      placement: "top",
    },
    {
      target: "#public-insights",
      title: "What the numbers say",
      content: "Plain-language highlights: lowest risk, most support needed, highest per-capita exposure and most active redistribution.",
      placement: "top",
    },
  ],
};

const publicState: TourDef = {
  id: "public-state",
  name: "State summary tour",
  steps: [
    {
      target: "#pub-state-header",
      title: "One state, aggregates only",
      content: "This page never lists individual facilities, only the state-level figures the public API returns.",
      placement: "bottom",
    },
    {
      target: "#pub-state-stats",
      title: "Key indicators",
      content:
        "Network risk score, critical-risk facilities (also per 100,000 people served, so states of different size compare fairly), and 30-day transfers and averted stockouts.",
      placement: "top",
    },
  ],
};

// Most specific patterns first; every pattern is matched with end: true.
const ROUTES: { path: string; tour: TourDef }[] = [
  { path: "/", tour: dashboard },
  { path: "/states/:state", tour: stateView },
  { path: "/phcs/:id", tour: phcDetail },
  { path: "/medicines/:medicine/states/:state", tour: medicineState },
  { path: "/explore", tour: explore },
  { path: "/federated", tour: federated },
  { path: "/transfers", tour: transfers },
  { path: "/assistant", tour: assistant },
  { path: "/public", tour: publicPortal },
  { path: "/public/states/:state", tour: publicState },
];

export function tourForPath(pathname: string): TourDef | null {
  for (const { path, tour } of ROUTES) {
    if (matchPath({ path, end: true }, pathname)) return tour;
  }
  return null;
}

export const ALL_TOURS: TourDef[] = ROUTES.map((r) => r.tour);
