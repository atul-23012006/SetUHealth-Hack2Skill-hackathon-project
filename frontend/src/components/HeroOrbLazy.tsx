// Performance/accessibility wrapper around HeroOrb — see
// SETUHEALTH_VISUAL_DESIGN_AND_3D_HERO.md Phase B3. Three.js is heavy
// (~150kb+ gzipped with react-three-fiber), so:
//   1. It's code-split via React.lazy — never in the Officer Console's bundle,
//      since nothing there imports this module.
//   2. prefers-reduced-motion freezes the rotation/distort animation but
//      still renders one static 3D frame (a real render, just not moving).
//   3. Narrow viewports and browsers without WebGL get a static fallback
//      image instead of ever mounting the Canvas at all.
import { lazy, Suspense, useEffect, useState } from "react";

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

// A static, pre-rendered snapshot of the orb (captured once from the live
// component) for devices that shouldn't pay the cost of mounting Three.js
// at all: below the mobile breakpoint, or no WebGL support. Never used for
// prefers-reduced-motion alone — that case still renders one real static
// 3D frame instead (see HeroOrb's `reducedMotion` prop).
//
// If the pre-rendered asset is ever missing, degrades to a CSS
// approximation — tracked as React state (not an imperative DOM mutation
// in the onError handler) so the swap participates in normal reconciliation
// and can never leave an orphaned node behind when this component unmounts.
function StaticOrbFallback() {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
    return (
      <div
        aria-hidden="true"
        className="w-full h-full rounded-full"
        style={{
          background: "radial-gradient(circle at 35% 30%, #f3d675, #e8b930 45%, #c9971f 75%, #a97c15 100%)",
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
      className="w-full h-full object-contain"
      onError={() => setImageFailed(true)}
    />
  );
}

export default function HeroOrbLazy() {
  const [canRender3D, setCanRender3D] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(motionQuery.matches);
    const onMotionChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    motionQuery.addEventListener("change", onMotionChange);

    setCanRender3D(window.innerWidth >= MOBILE_BREAKPOINT_PX && supportsWebGL());

    return () => motionQuery.removeEventListener("change", onMotionChange);
  }, []);

  // Still checking (first paint) — show the static image rather than a
  // layout flash from mounting/unmounting the Canvas.
  if (canRender3D === null || !canRender3D) {
    return <StaticOrbFallback />;
  }

  return (
    <Suspense fallback={<StaticOrbFallback />}>
      <HeroOrb reducedMotion={reducedMotion} />
    </Suspense>
  );
}
