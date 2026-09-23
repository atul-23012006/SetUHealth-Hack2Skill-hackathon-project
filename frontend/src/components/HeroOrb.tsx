// The "Setu grid" hero: a liquid-gold core wrapped in a lattice of connected
// facility nodes, with glowing supply packets travelling along arcs that bridge
// distant nodes ("setu" means bridge). Decorative only; carries no data.
// Marketing-surface only — see HeroOrbLazy.tsx for the code-splitting,
// accessibility and visibility-pausing wrapper that keeps this out of the
// Officer Console entirely.
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, MeshDistortMaterial, Sparkles } from "@react-three/drei";
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  MathUtils,
  Object3D,
  QuadraticBezierCurve3,
  Vector3,
  WireframeGeometry,
  type Group,
  type Mesh,
} from "three";

const CORE_RADIUS = 1.15;
const CAGE_RADIUS = 1.95;
const ARC_COUNT = 9;
const PACKETS_PER_ARC = 2;

const GOLD = "#f2b632";
const TEAL = "#2dd4bf";
const NODE_COLORS = ["#38bdf8", "#2dd4bf", "#60a5fa", "#fbbf24"];

// Deterministic PRNG so every render (and the static fallback capture) is identical.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Unique vertices of a subdivided icosahedron: evenly spread, no pole clumping.
function cageVertices(): Vector3[] {
  const geo = new IcosahedronGeometry(CAGE_RADIUS, 1);
  const pos = geo.attributes.position;
  const seen = new Map<string, Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const v = new Vector3().fromBufferAttribute(pos, i);
    seen.set(`${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`, v);
  }
  geo.dispose();
  return [...seen.values()];
}

function glowTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255, 214, 102, 0.95)");
  g.addColorStop(0.3, "rgba(242, 182, 50, 0.3)");
  g.addColorStop(0.75, "rgba(242, 182, 50, 0)");
  g.addColorStop(1, "rgba(242, 182, 50, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

interface Bridge {
  curve: QuadraticBezierCurve3;
  geometry: BufferGeometry;
  speeds: number[];
  offsets: number[];
}

function OrbScene({ reducedMotion, onFirstFrame }: { reducedMotion: boolean; onFirstFrame?: () => void }) {
  const pointerGroup = useRef<Group>(null);
  const cageGroup = useRef<Group>(null);
  const ringA = useRef<Group>(null);
  const ringB = useRef<Group>(null);
  const shellRef = useRef<Mesh>(null);
  const nodesRef = useRef<InstancedMesh>(null);
  const packetRefs = useRef<(Mesh | null)[]>([]);
  const dummy = useMemo(() => new Object3D(), []);
  const announced = useRef(false);

  const vertices = useMemo(() => cageVertices(), []);
  const cageGeometry = useMemo(() => new WireframeGeometry(new IcosahedronGeometry(CAGE_RADIUS, 1)), []);
  const halo = useMemo(() => glowTexture(), []);
  const nodePhases = useMemo(() => {
    const rnd = mulberry32(11);
    return vertices.map(() => rnd() * Math.PI * 2);
  }, [vertices]);

  // Arcs join well-separated node pairs and bow outward, like bridges.
  const bridges = useMemo<Bridge[]>(() => {
    const rnd = mulberry32(42);
    const out: Bridge[] = [];
    const used = new Set<number>();
    let guard = 0;
    while (out.length < ARC_COUNT && guard++ < 400) {
      const i = Math.floor(rnd() * vertices.length);
      const j = Math.floor(rnd() * vertices.length);
      if (i === j || used.has(i) || used.has(j)) continue;
      const a = vertices[i];
      const b = vertices[j];
      const cos = a.clone().normalize().dot(b.clone().normalize());
      if (cos > 0.35 || cos < -0.55) continue; // far enough to read as a span, never antipodal
      used.add(i);
      used.add(j);
      const control = a.clone().add(b).normalize().multiplyScalar(CAGE_RADIUS * 1.55);
      const curve = new QuadraticBezierCurve3(a.clone(), control, b.clone());
      out.push({
        curve,
        geometry: new BufferGeometry().setFromPoints(curve.getPoints(56)),
        speeds: Array.from({ length: PACKETS_PER_ARC }, () => 0.1 + rnd() * 0.09),
        offsets: Array.from({ length: PACKETS_PER_ARC }, (_, k) => (k / PACKETS_PER_ARC + rnd() * 0.2) % 1),
      });
    }
    return out;
  }, [vertices]);

  const arcLines = useMemo(
    () =>
      bridges.map(
        (b) =>
          new Line(
            b.geometry,
            new LineBasicMaterial({ color: "#fcd34d", transparent: true, opacity: 0.5, toneMapped: false }),
          ),
      ),
    [bridges],
  );

  // Seed node colours once.
  const colorsApplied = useRef(false);
  const applyNodeColors = (mesh: InstancedMesh) => {
    const c = new Color();
    vertices.forEach((_, i) => {
      c.set(NODE_COLORS[i % NODE_COLORS.length]);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    colorsApplied.current = true;
  };

  const writeNodes = (t: number) => {
    const mesh = nodesRef.current;
    if (!mesh) return;
    if (!colorsApplied.current) applyNodeColors(mesh);
    vertices.forEach((v, i) => {
      const pulse = reducedMotion ? 1 : 1 + 0.55 * Math.max(0, Math.sin(t * 1.8 + nodePhases[i]));
      dummy.position.copy(v);
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  const writePackets = (t: number) => {
    let n = 0;
    const p = new Vector3();
    bridges.forEach((b) => {
      b.speeds.forEach((speed, k) => {
        const mesh = packetRefs.current[n++];
        if (!mesh) return;
        const u = reducedMotion ? 0.3 + k * 0.4 : (t * speed + b.offsets[k]) % 1;
        b.curve.getPoint(u, p);
        mesh.position.copy(p);
        mesh.scale.setScalar(0.35 + 0.65 * Math.sin(Math.PI * u)); // swell mid-span, fade at the ends
      });
    });
  };

  // First frame + reduced motion: pose everything once.
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    writeNodes(t);
    writePackets(t);
    if (!announced.current) {
      announced.current = true;
      onFirstFrame?.();
    }
    if (reducedMotion) return;

    const px = MathUtils.clamp(state.pointer.x, -1, 1);
    const py = MathUtils.clamp(state.pointer.y, -1, 1);
    if (pointerGroup.current) {
      pointerGroup.current.rotation.x = MathUtils.damp(pointerGroup.current.rotation.x, -py * 0.32, 3, dt);
      pointerGroup.current.rotation.y = MathUtils.damp(pointerGroup.current.rotation.y, px * 0.45, 3, dt);
    }
    if (cageGroup.current) cageGroup.current.rotation.y += dt * 0.11;
    if (ringA.current) ringA.current.rotation.z += dt * 0.25;
    if (ringB.current) ringB.current.rotation.z -= dt * 0.18;
    if (shellRef.current) shellRef.current.scale.setScalar(1 + Math.sin(t * 1.3) * 0.014);
  });

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 4, 5]} intensity={1.6} color="#fff4d6" />
      <pointLight position={[-4, 2, -3]} intensity={38} color={TEAL} />

      <Environment resolution={256} frames={1}>
        {/* Mid-tone dome: without it the metal reflects black and renders as a dark ball. */}
        <mesh scale={60}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshBasicMaterial color="#8a7a5a" side={BackSide} toneMapped={false} />
        </mesh>
        <Lightformer form="rect" intensity={1.6} position={[0, -5, 2]} scale={[12, 3, 1]} color="#ffcf70" />
        <Lightformer form="rect" intensity={4} position={[0, 5, 3]} scale={[10, 3, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2.6} position={[-6, 0, 2]} rotation-y={Math.PI / 2} scale={[8, 4, 1]} color="#5eead4" />
        <Lightformer form="rect" intensity={3} position={[6, 1, 2]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} color="#ffd98a" />
        <Lightformer form="ring" intensity={2} position={[0, 0, -6]} scale={10} color="#ffffff" />
      </Environment>

      {/* Soft additive halo behind everything, standing in for bloom. */}
      <sprite scale={[5.4, 5.4, 1]} renderOrder={-1}>
        <spriteMaterial map={halo} transparent opacity={0.55} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>

      <Sparkles count={70} scale={[5.6, 5.6, 5.6]} size={2.2} speed={reducedMotion ? 0 : 0.25} opacity={0.8} color="#fde68a" />

      <group ref={pointerGroup}>
        {/* Liquid-gold core */}
        <mesh ref={shellRef}>
          <sphereGeometry args={[CORE_RADIUS, 128, 128]} />
          <MeshDistortMaterial
            color={GOLD}
            emissive="#7a4a04"
            emissiveIntensity={0.35}
            metalness={0.92}
            roughness={0.26}
            distort={0.3}
            speed={reducedMotion ? 0 : 1.1}
            clearcoat={1}
            clearcoatRoughness={0.08}
            envMapIntensity={1.9}
          />
        </mesh>

        {/* Lattice of facilities + the bridges between them */}
        <group ref={cageGroup}>
          <lineSegments geometry={cageGeometry}>
            <lineBasicMaterial color={TEAL} transparent opacity={0.22} toneMapped={false} />
          </lineSegments>

          <instancedMesh ref={nodesRef} args={[undefined, undefined, vertices.length]}>
            <sphereGeometry args={[0.052, 14, 14]} />
            <meshBasicMaterial toneMapped={false} />
          </instancedMesh>

          {arcLines.map((line, i) => (
            <primitive key={i} object={line} />
          ))}

          {bridges.flatMap((_, bi) =>
            Array.from({ length: PACKETS_PER_ARC }, (_, k) => {
              const idx = bi * PACKETS_PER_ARC + k;
              return (
                <mesh key={idx} ref={(m) => { packetRefs.current[idx] = m; }}>
                  <sphereGeometry args={[0.05, 12, 12]} />
                  <meshBasicMaterial color="#fff3c4" toneMapped={false} />
                </mesh>
              );
            }),
          )}
        </group>

        {/* Orbit rings with a satellite each */}
        <group ref={ringA} rotation={[Math.PI / 2.25, 0.35, 0]}>
          <mesh>
            <torusGeometry args={[2.38, 0.006, 8, 180]} />
            <meshBasicMaterial color="#5eead4" transparent opacity={0.4} toneMapped={false} />
          </mesh>
          <mesh position={[2.38, 0, 0]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshBasicMaterial color="#5eead4" toneMapped={false} />
          </mesh>
        </group>
        <group ref={ringB} rotation={[Math.PI / 1.7, -0.5, 0.3]}>
          <mesh>
            <torusGeometry args={[2.2, 0.005, 8, 180]} />
            <meshBasicMaterial color="#fcd34d" transparent opacity={0.3} toneMapped={false} />
          </mesh>
          <mesh position={[-2.2, 0, 0]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshBasicMaterial color="#fcd34d" toneMapped={false} />
          </mesh>
        </group>
      </group>
    </>
  );
}

interface Props {
  reducedMotion?: boolean;
  /** false pauses rendering entirely (off-screen or hidden tab). */
  active?: boolean;
  onReady?: () => void;
}

export default function HeroOrb({ reducedMotion = false, active = true, onReady }: Props) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 7.2], fov: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      frameloop={!active ? "never" : reducedMotion ? "demand" : "always"}
      // Track the cursor across the whole page, not only over the canvas.
      eventSource={typeof document !== "undefined" ? document.body : undefined}
      eventPrefix="client"
    >
      <OrbScene reducedMotion={reducedMotion} onFirstFrame={onReady} />
    </Canvas>
  );
}
