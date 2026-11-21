"use client";
// WebGL part of the intro: the procedural mosquito (components/mosquito3d) flying a wandering path, curious about the pointer but
// dodging when it gets close; after the swat it tumbles and falls. Loaded lazily so it never delays the dashboard.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { Mosquito } from "./mosquito3d";

export interface FlightState { px: number; py: number; pointer: boolean; swatted: boolean }

function Flyer({ s }: { s: React.MutableRefObject<FlightState> }) {
  const g = useRef<THREE.Group>(null);
  const { viewport } = useThree();
  const pos = useRef(new THREE.Vector3(-viewport.width * 0.2, viewport.height * 0.1, 0.8));   // composed first frame: visible, left of centre
  const vel = useRef(new THREE.Vector3(1.6, 0.35, 0));
  const fall = useRef(0);
  const tmp = useRef({ target: new THREE.Vector3(), p: new THREE.Vector3(), look: new THREE.Vector3() });
  useFrame(({ clock }, dtRaw) => {
    const grp = g.current; if (!grp) return;
    const dt = Math.min(dtRaw, 0.05), t = clock.elapsedTime, { target, p, look } = tmp.current;
    if (s.current.swatted) {                                         // impact: tumble and fall out of frame
      fall.current += dt;
      grp.position.y -= dt * (2 + fall.current * 14);
      grp.rotation.z += dt * 9; grp.rotation.x += dt * 4;
      grp.scale.setScalar(Math.max(0.05, 0.62 * (1 - fall.current * 0.9)));          // keep proportions; shrink as it drops away
      return;
    }
    const w = viewport.width * 0.36, h = viewport.height * 0.3;
    target.set(Math.sin(t * 0.52) * w + Math.sin(t * 1.9) * 0.5, Math.sin(t * 0.83 + 1) * h + Math.sin(t * 2.6) * 0.25, Math.sin(t * 0.61) * 1.4);
    if (s.current.pointer) {
      p.set(s.current.px * viewport.width / 2, s.current.py * viewport.height / 2, 0);
      const d = p.distanceTo(pos.current);
      target.lerp(p, d < 1.3 ? -0.9 : 0.4);                          // curious approach, quick dodge when the hand gets close
    }
    target.sub(pos.current).multiplyScalar(1.7);
    vel.current.lerp(target, 1 - Math.exp(-dt * 2.8));
    pos.current.addScaledVector(vel.current, dt);
    grp.position.copy(pos.current);
    look.copy(pos.current).add(vel.current.clone().setLength(1));
    grp.lookAt(look);                                                // nose (+z) follows the flight direction
    grp.rotateZ(THREE.MathUtils.clamp(-vel.current.x * 0.08, -0.5, 0.5));   // bank into turns
  });
  return (<group ref={g} scale={0.62}>
    <Mosquito active={null} onHover={() => {}} animate flapSpeed={88} flapAmp={0.55} hover={false} />
    {/* stroke envelope: faint discs suggesting wing blur at high beat frequency */}
    {[-1, 1].map((sd) => (<mesh key={sd} position={[sd * 0.55, 0.44, 0.3]} rotation={[0, 0, sd * 0.5]} scale={[0.85, 0.02, 0.3]}>
      <sphereGeometry args={[1, 20, 6]} /><meshBasicMaterial color="#d8efff" transparent opacity={0.13} depthWrite={false} /></mesh>))}
  </group>);
}

export default function IntroScene({ state }: { state: React.MutableRefObject<FlightState> }) {
  return (<Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 8], fov: 40 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }} style={{ position: "absolute", inset: 0 }}>
    <ambientLight intensity={0.45} />
    <directionalLight position={[4, 6, 5]} intensity={2.2} color="#fff4e0" />
    <directionalLight position={[-5, -2, -4]} intensity={1.1} color="#3fe0a8" />
    <pointLight position={[0, 0, 4]} intensity={6} distance={14} color="#9fe7c2" />
    <Flyer s={state} />
  </Canvas>);
}
