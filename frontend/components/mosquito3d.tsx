"use client";
// Procedural, stylised Aedes-like mosquito built from primitives (no external model, no licence concerns). NOT an anatomical reconstruction.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useState } from "react";
import * as THREE from "three";

export type Part = "head" | "proboscis" | "thorax" | "wings" | "abdomen" | "legs";
export const HOTSPOTS: Record<Part, [number, number, number]> = { head: [0, 0.05, 1.05], proboscis: [0, -0.1, 1.75], thorax: [0, 0.12, 0.35], wings: [0.75, 0.38, 0.3], abdomen: [0, 0, -0.85], legs: [0.5, -0.5, 0.2] };
export const VIEWS: Record<string, [number, number, number]> = { side: [4.2, 0.6, 0.2], front: [0.2, 0.7, 4.4], top: [0.2, 4.4, 0.4], "3/4": [3.0, 1.6, 3.0] };
const DARK = "#2a2e33", BAND = "#f3efe3";

function Leg({ side, i }: { side: 1 | -1; i: number }) {
  const z = 0.6 - i * 0.32, spread = 0.55 + i * 0.08;
  return (<group position={[side * 0.12, -0.12, z]} rotation={[0, side * (0.25 - i * 0.28), side * 0.4]}>
    <mesh position={[side * 0.3, -0.12, 0]} rotation={[0, 0, side * -1.1]}><cylinderGeometry args={[0.018, 0.018, 0.65, 6]} /><meshStandardMaterial color={DARK} roughness={0.7} /></mesh>
    <mesh position={[side * spread, -0.55, 0]} rotation={[0, 0, side * 0.35]}><cylinderGeometry args={[0.014, 0.012, 0.8, 6]} /><meshStandardMaterial color={DARK} roughness={0.7} /></mesh>
    <mesh position={[side * (spread + 0.1), -0.48, 0]} rotation={[0, 0, side * 0.35]}><cylinderGeometry args={[0.017, 0.017, 0.1, 6]} /><meshStandardMaterial color={BAND} /></mesh>
    <mesh position={[side * (spread + 0.2), -0.78, 0]} rotation={[0, 0, side * 0.35]}><cylinderGeometry args={[0.015, 0.015, 0.1, 6]} /><meshStandardMaterial color={BAND} /></mesh></group>);
}

function Mosquito({ active, onHover, animate }: { active: Part | null; onHover: (p: Part | null) => void; animate: boolean }) {
  const wl = useRef<THREE.Mesh>(null), wr = useRef<THREE.Mesh>(null), body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.elapsedTime, f = Math.sin(t * 18) * 0.16;           // subtle flutter, not a flight simulation
    if (wl.current) wl.current.rotation.z = 0.5 + f;
    if (wr.current) wr.current.rotation.z = -0.5 - f;
    if (body.current) body.current.position.y = Math.sin(t * 1.4) * 0.04;
  });
  const glow = (p: Part) => (active === p ? 0.55 : 0);
  const hit = (p: Part) => ({ onPointerOver: (e: any) => { e.stopPropagation(); onHover(p); document.body.style.cursor = "pointer"; }, onPointerOut: () => { onHover(null); document.body.style.cursor = ""; } });
  return (<group ref={body} rotation={[0, 0, 0]}>
    <mesh position={[0, 0, -0.85]} scale={[0.34, 0.3, 1.0]} {...hit("abdomen")}><sphereGeometry args={[1, 28, 20]} /><meshStandardMaterial color={DARK} roughness={0.6} emissive="#0e8f66" emissiveIntensity={glow("abdomen")} /></mesh>
    {[-0.35, -0.6, -0.85, -1.1, -1.35].map((z) => (<mesh key={z} position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 1]}><torusGeometry args={[0.3 * Math.sqrt(Math.max(0.05, 1 - ((z + 0.85) / 1.0) ** 2)) + 0.012, 0.022, 8, 28]} /><meshStandardMaterial color={BAND} roughness={0.5} /></mesh>))}
    <mesh position={[0, 0.12, 0.35]} scale={[0.4, 0.38, 0.5]} {...hit("thorax")}><sphereGeometry args={[1, 28, 20]} /><meshStandardMaterial color="#3a3f45" roughness={0.55} emissive="#0e8f66" emissiveIntensity={glow("thorax")} /></mesh>
    <mesh position={[0, 0.3, 0.38]} scale={[0.07, 0.015, 0.36]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={BAND} /></mesh>
    <mesh position={[0, 0.05, 1.0]} scale={[0.22, 0.22, 0.26]} {...hit("head")}><sphereGeometry args={[1, 24, 18]} /><meshStandardMaterial color={DARK} emissive="#0e8f66" emissiveIntensity={glow("head")} /></mesh>
    {[-1, 1].map((s) => (<mesh key={s} position={[s * 0.15, 0.1, 1.12]}><sphereGeometry args={[0.075, 14, 12]} /><meshStandardMaterial color="#111" metalness={0.3} roughness={0.2} /></mesh>))}
    <mesh position={[0, -0.08, 1.55]} rotation={[Math.PI / 2, 0, 0]} {...hit("proboscis")}><cylinderGeometry args={[0.022, 0.012, 0.95, 8]} /><meshStandardMaterial color="#1c1f22" emissive="#0e8f66" emissiveIntensity={glow("proboscis")} /></mesh>
    {[-1, 1].map((s) => (<mesh key={s} position={[s * 0.1, 0.34, 1.32]} rotation={[0.9, 0, s * 0.35]}><cylinderGeometry args={[0.008, 0.008, 0.5, 5]} /><meshStandardMaterial color="#444" /></mesh>))}
    <mesh ref={wl} position={[0.5, 0.42, 0.3]} rotation={[0.1, 0.15, 0.5]} scale={[0.75, 0.012, 0.22]} {...hit("wings")}><sphereGeometry args={[1, 24, 8]} /><meshStandardMaterial color="#cfe9ff" transparent opacity={active === "wings" ? 0.75 : 0.42} roughness={0.2} side={THREE.DoubleSide} /></mesh>
    <mesh ref={wr} position={[-0.5, 0.42, 0.3]} rotation={[0.1, -0.15, -0.5]} scale={[0.75, 0.012, 0.22]} {...hit("wings")}><sphereGeometry args={[1, 24, 8]} /><meshStandardMaterial color="#cfe9ff" transparent opacity={active === "wings" ? 0.75 : 0.42} roughness={0.2} side={THREE.DoubleSide} /></mesh>
    <group {...hit("legs")}>{[-1, 1].flatMap((s) => [0, 1, 2].map((i) => <Leg key={`${s}${i}`} side={s as 1 | -1} i={i} />))}</group>
  </group>);
}

function CameraRig({ view }: { view: string }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(...VIEWS[view]));
  target.current.set(...VIEWS[view]);
  useFrame(() => { camera.position.lerp(target.current, 0.06); camera.lookAt(0, 0.1, 0.2); });
  return null;
}

export default function Mosquito3D({ active, onHover, view, reduce, visible }: { active: Part | null; onHover: (p: Part | null) => void; view: string; reduce: boolean; visible: boolean }) {
  const [ready, setReady] = useState(false);
  return (<Canvas dpr={[1, 1.5]} frameloop={visible ? "always" : "never"} camera={{ position: VIEWS["3/4"], fov: 38 }} gl={{ antialias: true, powerPreference: "low-power" }} onCreated={() => setReady(true)} aria-label="Interactive stylised mosquito model">
    <color attach="background" args={["#0b3b2c"]} /><ambientLight intensity={0.8} /><directionalLight position={[3, 5, 4]} intensity={1.6} /><directionalLight position={[-4, -2, -3]} intensity={0.5} color="#9fe7c2" />
    <Mosquito active={active} onHover={onHover} animate={!reduce && ready} /><CameraRig view={view} />
    <OrbitControls enablePan={false} enableZoom={false} autoRotate={!reduce && !active} autoRotateSpeed={0.9} minPolarAngle={0.5} maxPolarAngle={2.4} /></Canvas>);
}
