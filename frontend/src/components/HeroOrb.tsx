// Owkin-style hero orb — a soft, lumpy sphere with small surface "receptor"
// nodes and a rotating inner wireframe network, visible through the outer
// shell. Purely decorative; carries no data. Marketing-surface only (see
// HeroOrbLazy.tsx for the code-splitting/accessibility wrapper that keeps
// this out of the Officer Console entirely).
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial, Sphere, Instances, Instance } from "@react-three/drei";
import type { Group } from "three";

const OUTER_COLOR = "#e8b930"; // warm gold, matching the Owkin-style reference
const RECEPTOR_COLOR = "#2b7fd6"; // blue surface nodes
const NETWORK_COLOR = "#0d9488"; // brand teal for the inner wireframe (SetuHealth's own accent, not a copy of Owkin's pink/teal)
const RECEPTOR_COUNT = 40;
const RECEPTOR_RADIUS = 1.42;

// Evenly distributes `count` points on a unit sphere — the standard
// Fibonacci-sphere construction, so the receptor dots don't clump at the
// poles the way naive random placement would.
function fibonacciSpherePoints(count: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;
    points.push([x * RECEPTOR_RADIUS, y * RECEPTOR_RADIUS, z * RECEPTOR_RADIUS]);
  }
  return points;
}

function OrbScene({ reducedMotion }: { reducedMotion: boolean }) {
  const outerGroupRef = useRef<Group>(null);
  const innerGroupRef = useRef<Group>(null);
  const receptorPoints = useMemo(() => fibonacciSpherePoints(RECEPTOR_COUNT), []);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    if (outerGroupRef.current) outerGroupRef.current.rotation.y += delta * 0.15;
    // Inner network rotates slightly slower and the opposite way, for depth.
    if (innerGroupRef.current) innerGroupRef.current.rotation.y -= delta * 0.08;
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 3, 3]} intensity={1} />

      <group ref={outerGroupRef}>
        {/* Outer blob — the distort material alone gets ~80% of the look */}
        <Sphere args={[1.4, 64, 64]}>
          <MeshDistortMaterial
            color={OUTER_COLOR}
            distort={0.35}
            speed={reducedMotion ? 0 : 1.2}
            roughness={0.4}
            metalness={0.1}
          />
        </Sphere>

        {/* Surface receptor dots */}
        <Instances limit={RECEPTOR_COUNT}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshStandardMaterial color={RECEPTOR_COLOR} roughness={0.3} />
          {receptorPoints.map((position, i) => (
            <Instance key={i} position={position} />
          ))}
        </Instances>
      </group>

      {/* Inner network — a smaller wireframe sphere visible through the outer shell */}
      <group ref={innerGroupRef}>
        <Sphere args={[0.9, 16, 16]}>
          <meshBasicMaterial color={NETWORK_COLOR} wireframe transparent opacity={0.4} />
        </Sphere>
      </group>
    </>
  );
}

export default function HeroOrb({ reducedMotion = false }: { reducedMotion?: boolean }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 4.5], fov: 40 }} gl={{ antialias: true }}>
      <OrbScene reducedMotion={reducedMotion} />
    </Canvas>
  );
}
