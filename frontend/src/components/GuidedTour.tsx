import { Joyride, EVENTS, type EventData, type Step } from "react-joyride";

// Targets #national-map / #stat-cards / #demo-mode-btn live only on the Dashboard
// ("/"), so GuidedTour must only be run after navigating there — see Layout.tsx.
const steps: Step[] = [
  {
    target: "#national-map",
    content:
      "The national map shows every PHC as a colour-coded dot — red is critical, amber is warning, green is healthy. Zoomed out, nearby PHCs cluster together.",
  },
  {
    target: "#stat-cards",
    content: "These stat tiles summarise critical and warning alerts across every monitored facility, live.",
  },
  {
    target: "#demo-mode-btn",
    content: "Run Demo simulates a real crisis end-to-end — outbreak detection, forecasting, and redistribution.",
  },
  {
    target: 'a[href="/federated"]',
    content:
      "The Federated Network page shows how states (and BRICS partners, simulated) share only aggregated statistics — never raw facility data.",
  },
  {
    target: 'a[href="/assistant"]',
    content: "The Assistant answers natural-language questions about stock, beds, and redistribution in multiple languages.",
  },
];

interface Props {
  run: boolean;
  onFinish: () => void;
}

export default function GuidedTour({ run, onFinish }: Props) {
  const handleEvent = (data: EventData) => {
    if (data.type === EVENTS.TOUR_END) {
      onFinish();
    }
  };

  return (
    <Joyride
      run={run}
      steps={steps}
      continuous
      scrollToFirstStep
      options={{
        primaryColor: "#0d9488",
        zIndex: 10000,
        showProgress: true,
        skipBeacon: true,
        buttons: ["back", "close", "skip", "primary"],
      }}
      onEvent={handleEvent}
    />
  );
}
