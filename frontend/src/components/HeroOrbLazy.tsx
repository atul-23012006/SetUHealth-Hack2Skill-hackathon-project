// Performance/accessibility wrapper around HeroOrb. Three.js is heavy
// (~150kb+ gzipped with react-three-fiber), so:
//   1. It's code-split via React.lazy — never in the Officer Console's bundle,
//      since nothing there imports this module.
//   2. prefers-reduced-motion freezes all motion but still renders one real
//      3D frame.
//   3. Narrow viewports and browsers without WebGL get a static image instead
//      of ever mounting the Canvas at all.
//   4. Rendering pauses while the orb is off-screen or the tab is hidden.
//   5. If the 3D chunk or context fails, the static image stays.
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

const HeroOrb = lazy(() => import("./HeroOrb"));

const MOBILE_BREAKPOINT_PX = 640;

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

// A pre-rendered snapshot of the orb (captured from the live component) for
// devices that shouldn't pay for Three.js, and shown while the 3D scene loads.
// If the asset is missing it degrades to a CSS approximation, tracked as React
// state so the swap never leaves an orphaned node behind.
function StaticOrbFallback({ float = true }: { float?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
    return (
      <div
        aria-hidden="true"
        className={`h-full w-full rounded-full ${float ? "animate-float" : ""}`}
        style={{
          background: "radial-gradient(circle at 35% 30%, #fde68a, #f2b632 45%, #c9971f 75%, #8a6210 100%)",
          boxShadow: "inset -20px -20px 60px rgba(0,0,0,0.25), inset 20px 20px 40px rgba(255,255,255,0.15)",
        }}
      />
    );
  }

  return (
    <img
      src="/hero-orb-static.png"
      alt=""
      aria-hidden="true"
      className={`h-full w-full object-contain ${float ? "animate-float" : ""}`}
      onError={() => setImageFailed(true)}
    />
  );
}

class OrbErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function HeroOrbLazy() {
  const [canRender3D, setCanRender3D] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(motionQuery.matches);
    const onMotionChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    motionQuery.addEventListener("change", onMotionChange);

    setCanRender3D(window.innerWidth >= MOBILE_BREAKPOINT_PX && supportsWebGL());

    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      motionQuery.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!canRender3D) {
    return (
      <div ref={wrapRef} className="h-full w-full">
        <StaticOrbFallback />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      {/* Static snapshot underneath until the live scene has drawn its first frame. */}
      <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-0" : "opacity-100"}`}>
        <StaticOrbFallback float={false} />
      </div>
      <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}>
        <OrbErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <HeroOrb reducedMotion={reducedMotion} active={visible && tabVisible} onReady={() => setReady(true)} />
          </Suspense>
        </OrbErrorBoundary>
      </div>
    </div>
  );
}
