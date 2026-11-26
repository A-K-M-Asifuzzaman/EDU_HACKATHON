"use client";
// Procedural Aedes aegypti for the boot sequence (no model files). Field marks that make it recognisable: the white lyre on the
// thorax, white basal bands on the abdomen, white-banded tarsi with the hind legs raised, pale-tipped palps, a long proboscis, glossy
// compound eyes and veined, iridescent wings. Body axis is +z (head forward). Wings beat around the body axis at `flap` rad/s.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const DARK = "#131317", WHITE = "#e9e7df";

function stripes(w: number, h: number, bands: [number, number][], vertical: boolean) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d")!;
  g.fillStyle = DARK; g.fillRect(0, 0, w, h); g.fillStyle = WHITE;
  for (const [a, b] of bands) vertical ? g.fillRect(a * w, 0, (b - a) * w, h) : g.fillRect(0, a * h, w, (b - a) * h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function veins() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 160; const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 160); g.strokeStyle = "rgba(25,25,35,0.55)"; g.lineWidth = 2.2;
  for (const y of [0.32, 0.45, 0.55, 0.66, 0.76]) { g.beginPath(); g.moveTo(6, 80); g.quadraticCurveTo(220, 160 * y, 500, 160 * (y * 0.9 + 0.05)); g.stroke(); }
  g.lineWidth = 1.4; for (const x of [150, 260, 360]) { g.beginPath(); g.moveTo(x, 50); g.lineTo(x + 30, 112); g.stroke(); }
  g.strokeStyle = "rgba(25,25,35,0.7)"; g.lineWidth = 3; g.beginPath(); g.ellipse(256, 80, 250, 58, 0, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** a point on the thorax ellipsoid surface (used to lay the lyre marking on it) */
function onThorax(x: number, z: number, c: THREE.Vector3, r: THREE.Vector3) {
  const k = 1 - (x / r.x) ** 2 - (z / r.z) ** 2; return new THREE.Vector3(c.x + x, c.y + Math.sqrt(Math.max(0, k)) * r.y * 1.012, c.z + z);
}

export function Aedes({ flap = 70, amp = 0.62, swatted }: { flap?: number; amp?: number; swatted?: React.MutableRefObject<boolean> }) {
  const wl = useRef<THREE.Group>(null), wr = useRef<THREE.Group>(null), legs = useRef<THREE.Group>(null);
  const m = useMemo(() => {
    const body = new THREE.MeshPhysicalMaterial({ color: DARK, roughness: 0.55, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.5, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color("#5c58b8") });
    const white = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.5, emissive: new THREE.Color("#3a3950"), emissiveIntensity: 0.25 });
    const eye = new THREE.MeshPhysicalMaterial({ color: "#08080b", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1, iridescence: 0.35, iridescenceIOR: 1.4 });
    const membrane = new THREE.MeshPhysicalMaterial({ color: "#cfd6ff", transparent: true, opacity: 0.22, roughness: 0.12, iridescence: 1, iridescenceIOR: 1.32, iridescenceThicknessRange: [180, 520], side: THREE.DoubleSide, depthWrite: false });
    const vt = veins(); vt.repeat.set(1 / 1.3, 1 / 0.42); vt.offset.set(0, 0.5);
    const vein = new THREE.MeshBasicMaterial({ map: vt, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    // abdomen: tapered lathe with white basal bands on each segment
    const prof: THREE.Vector2[] = []; for (let i = 0; i <= 40; i++) { const t = i / 40; prof.push(new THREE.Vector2(0.001 + 0.25 * Math.pow(Math.sin(Math.PI * (0.12 + 0.86 * t)), 0.75) * (1 - 0.35 * t), t * 1.55)); }
    const abd = new THREE.LatheGeometry(prof, 36);
    const abdTex = stripes(8, 512, Array.from({ length: 7 }, (_, k) => [0.12 + k * 0.118, 0.12 + k * 0.118 + 0.016] as [number, number]), false);
    const abdMat = new THREE.MeshPhysicalMaterial({ map: abdTex, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5, sheen: 0.2, sheenColor: new THREE.Color("#5c58b8") });
    // thorax and its lyre (two curved lateral lines and two thin median lines, laid on the surface)
    const tc = new THREE.Vector3(0, 0.12, 0.25), tr = new THREE.Vector3(0.42, 0.4, 0.52);
    const lyre = [1, -1].flatMap((s) => [
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => { const z = 0.34 - i * 0.085; return onThorax(s * (0.2 - 0.09 * Math.sin((i / 8) * Math.PI)), z, tc, tr); })), 24, 0.022, 6),
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 6 }, (_, i) => onThorax(s * 0.035, 0.22 - i * 0.07, tc, tr))), 12, 0.01, 5)]);
    // legs: femur+tibia (dark, white knee) and a long banded tarsus; hind legs raised behind, as Aedes holds them
    const legTex = stripes(512, 8, [[0.0, 0.05], [0.3, 0.35], [0.6, 0.65], [0.9, 1]], true);
    const legMat = new THREE.MeshPhysicalMaterial({ map: legTex, roughness: 0.5, clearcoat: 0.4 });
    const L = (pts: number[][]) => new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const legSpec = (s: number) => [
      { upper: L([[s * 0.14, -0.1, 0.46], [s * 0.45, 0.12, 0.85], [s * 0.62, 0.05, 1.2]]), tarsus: L([[s * 0.62, 0.05, 1.2], [s * 0.82, -0.35, 1.55], [s * 0.95, -0.85, 1.75]]) },
      { upper: L([[s * 0.16, -0.12, 0.26], [s * 0.62, 0.14, 0.32], [s * 0.95, 0.02, 0.3]]), tarsus: L([[s * 0.95, 0.02, 0.3], [s * 1.25, -0.45, 0.25], [s * 1.38, -1.05, 0.15]]) },
      { upper: L([[s * 0.14, -0.12, 0.06], [s * 0.55, 0.15, -0.35], [s * 0.72, 0.42, -0.85]]), tarsus: L([[s * 0.72, 0.42, -0.85], [s * 0.82, 0.85, -1.25], [s * 0.78, 1.25, -1.45]]) }];
    const legGeo = [1, -1].flatMap((s) => legSpec(s).map((l) => ({ u: new THREE.TubeGeometry(l.upper, 24, 0.022, 6), t: new THREE.TubeGeometry(l.tarsus, 32, 0.012, 5), knee: l.upper.getPoint(1) })));
    // wing outline: narrow root, rounded tip
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(0.3, 0.17, 1.0, 0.2, 1.28, 0.03); sh.bezierCurveTo(1.32, -0.06, 1.0, -0.15, 0.32, -0.1); sh.bezierCurveTo(0.12, -0.07, 0.03, -0.03, 0, 0);
    const wing = new THREE.ShapeGeometry(sh, 24);
    const tube = (a: number[], b: number[], r: number) => new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(...a), new THREE.Vector3(...b)), 4, r, 6);
    return { body, white, eye, membrane, vein, abd, abdMat, lyre, legMat, legGeo, wing,
      proboscis: new THREE.TubeGeometry(L([[0, -0.02, 1.08], [0, -0.1, 1.55], [0, -0.2, 2.1]]), 20, 0.017, 6),
      palps: [1, -1].map((s) => ({ g: tube([s * 0.04, 0.0, 1.08], [s * 0.06, -0.04, 1.42], 0.016), tip: new THREE.Vector3(s * 0.06, -0.04, 1.44) })),
      antennae: [1, -1].map((s) => new THREE.TubeGeometry(L([[s * 0.06, 0.12, 1.05], [s * 0.18, 0.28, 1.28], [s * 0.3, 0.38, 1.5]]), 12, 0.007, 4)) };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime, down = swatted?.current;
    const a = down ? 0.05 : amp * (0.55 + 0.45 * Math.sin(t * flap));
    if (wl.current) wl.current.rotation.z = a; if (wr.current) wr.current.rotation.z = -a;
    if (legs.current) legs.current.rotation.x = down ? 0.4 : Math.sin(t * 2.2) * 0.05;     // legs trail and sway a little in flight
  });

  return (<group>
    <mesh geometry={m.abd} material={m.abdMat} position={[0, 0.02, -0.12]} rotation={[-Math.PI / 2 - 0.12, 0, 0]} />
    <mesh position={[0, 0.12, 0.25]} scale={[0.42, 0.4, 0.52]} material={m.body}><sphereGeometry args={[1, 40, 28]} /></mesh>
    {m.lyre.map((g, i) => <mesh key={i} geometry={g} material={m.white} />)}
    <mesh position={[0, 0.04, 0.94]} scale={[0.2, 0.2, 0.22]} material={m.body}><sphereGeometry args={[1, 28, 20]} /></mesh>
    {[1, -1].map((s) => <mesh key={s} position={[s * 0.1, 0.06, 1.0]} scale={[0.12, 0.13, 0.11]} material={m.eye}><sphereGeometry args={[1, 24, 18]} /></mesh>)}
    <mesh geometry={m.proboscis} material={m.body} />
    {m.palps.map((p, i) => <group key={i}><mesh geometry={p.g} material={m.body} /><mesh position={p.tip} material={m.white}><sphereGeometry args={[0.024, 10, 8]} /></mesh></group>)}
    {m.antennae.map((g, i) => <mesh key={i} geometry={g} material={m.body} />)}
    <group ref={legs}>{m.legGeo.map((l, i) => (<group key={i}><mesh geometry={l.u} material={m.body} /><mesh geometry={l.t} material={m.legMat} /><mesh position={l.knee} material={m.white}><sphereGeometry args={[0.03, 10, 8]} /></mesh></group>))}</group>
    {/* halteres */}
    {[1, -1].map((s) => <mesh key={s} position={[s * 0.36, 0.2, -0.12]} material={m.white}><sphereGeometry args={[0.035, 10, 8]} /></mesh>)}
    {/* wings: hinge at the thorax, beat around the body axis, swept back */}
    {[1, -1].map((s) => (<group key={s} ref={s === 1 ? wl : wr} position={[s * 0.28, 0.44, 0.3]}>
      <group rotation={[-Math.PI / 2, 0, 0]} scale={[s, 1, 1]}><group rotation={[0, 0, 0.42]}>
        <mesh geometry={m.wing} material={m.membrane} /><mesh geometry={m.wing} material={m.vein} position={[0, 0, 0.002]} /></group></group>
    </group>))}
  </group>);
}
