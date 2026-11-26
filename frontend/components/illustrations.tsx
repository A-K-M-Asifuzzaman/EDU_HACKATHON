// Cartoon illustration set (DESIGN.md §4): one drawing language for every page. 3 px aubergine ink outlines, flat Royal Monsoon fills,
// small white highlights and a hard offset shadow (CSS drop-shadow on the <svg>). Decorative only: aria-hidden, never carries data.
const INK = "#1a1438", V = "#6a45f0", VD = "#4a2bd0", G = "#ffc23d", M = "#3dd598", C = "#f2545b", CY = "#1597c9", CYL = "#8ce3ff", L = "#efe7ff", W = "#ffffff", O = "#ff9a52";
const base = { fill: "none", stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Svg({ children, className = "", vb = "0 0 200 150", shadow = true }: { children: React.ReactNode; className?: string; vb?: string; shadow?: boolean }) {
  return <svg viewBox={vb} className={className} aria-hidden="true" focusable="false" style={shadow ? { filter: `drop-shadow(4px 4px 0 ${INK})` } : undefined}>{children}</svg>;
}
const Drop = ({ x, y, s = 1, fill = CY }: { x: number; y: number; s?: number; fill?: string }) => (
  <path d={`M${x} ${y} q${-7 * s} ${11 * s} 0 ${16 * s} q${7 * s} ${-5 * s} 0 ${-16 * s}z`} {...base} fill={fill} />);
const Spark = ({ x, y, s = 1, fill = G }: { x: number; y: number; s?: number; fill?: string }) => (
  <path d={`M${x} ${y - 9 * s} q${2 * s} ${7 * s} ${9 * s} ${9 * s} q${-7 * s} ${2 * s} ${-9 * s} ${9 * s} q${-2 * s} ${-7 * s} ${-9 * s} ${-9 * s} q${7 * s} ${-2 * s} ${9 * s} ${-9 * s}z`} {...base} strokeWidth={2.4} fill={fill} />);

/** "Bristi", the rain-cloud guide. mood: happy | thinking | sad */
export function Cloud({ className, mood = "happy", rain = true }: { className?: string; mood?: "happy" | "thinking" | "sad"; rain?: boolean }) {
  return (<Svg className={className}>
    <path d="M52 108 Q26 108 26 86 Q26 64 50 62 Q54 34 86 34 Q112 34 122 54 Q130 48 142 50 Q170 54 168 82 Q182 86 180 100 Q178 108 164 108 Z" {...base} fill={W} />
    <path d="M60 56 Q70 44 84 44" {...base} stroke={L} strokeWidth={4} />
    <ellipse cx="88" cy="80" rx="5.5" ry="7.5" fill={INK} /><ellipse cx="118" cy="80" rx="5.5" ry="7.5" fill={INK} />
    <circle cx="90" cy="77" r="2" fill={W} /><circle cx="120" cy="77" r="2" fill={W} />
    <circle cx="76" cy="92" r="5" fill={C} opacity=".55" /><circle cx="130" cy="92" r="5" fill={C} opacity=".55" />
    {mood === "happy" && <path d="M95 92 Q103 100 111 92" {...base} />}
    {mood === "thinking" && <path d="M96 95 H110" {...base} />}
    {mood === "sad" && <path d="M95 98 Q103 90 111 98" {...base} />}
    {rain && <><Drop x={70} y={116} /><Drop x={100} y={122} /><Drop x={130} y={116} /></>}
  </Svg>);
}

/** Command: a shield carrying a rising forecast line */
export function ShieldChart({ className }: { className?: string }) {
  return (<Svg className={className}>
    <path d="M100 16 L152 32 V70 C152 104 130 124 100 138 C70 124 48 104 48 70 V32 Z" {...base} fill={V} />
    <path d="M100 30 L138 42 V70 C138 96 122 112 100 123 C78 112 62 96 62 70 V42 Z" {...base} fill={W} />
    <path d="M70 98 L86 84 L98 92 L116 68 L130 74" {...base} stroke={VD} strokeWidth={4} />
    <circle cx="116" cy="68" r="5" {...base} fill={G} /><path d="M70 104 H130" {...base} strokeWidth={2} />
    <Spark x={162} y={30} /><Spark x={36} y={52} s={0.7} fill={M} />
  </Svg>);
}

/** Forecast Lab: a flask of model output with rain bubbles */
export function Flask({ className }: { className?: string }) {
  return (<Svg className={className}>
    <path d="M86 18 H114 M90 18 V54 L58 112 A12 12 0 0 0 69 130 H131 A12 12 0 0 0 142 112 L110 54 V18" {...base} fill={W} />
    <path d="M73 86 H127 L142 112 A12 12 0 0 1 131 130 H69 A12 12 0 0 1 58 112 Z" {...base} fill={V} />
    <circle cx="88" cy="108" r="6" {...base} fill={CYL} strokeWidth={2.4} /><circle cx="110" cy="100" r="4" {...base} fill={CYL} strokeWidth={2.4} /><circle cx="118" cy="116" r="5" {...base} fill={L} strokeWidth={2.4} />
    <path d="M78 96 Q100 90 122 96" {...base} stroke={W} strokeWidth={3} opacity=".7" />
    <Drop x={150} y={26} s={1.1} /><Drop x={164} y={50} s={0.8} /><Spark x={44} y={40} />
  </Svg>);
}

/** Ward Risk Explorer: three homes with risk-coloured roofs */
export function Houses({ className }: { className?: string }) {
  const H = ({ x, w, h, roof }: { x: number; w: number; h: number; roof: string }) => (<g>
    <rect x={x} y={130 - h} width={w} height={h} rx="3" {...base} fill={W} />
    <path d={`M${x - 8} ${130 - h} L${x + w / 2} ${130 - h - 30} L${x + w + 8} ${130 - h} Z`} {...base} fill={roof} />
    <rect x={x + w / 2 - 7} y={130 - 22} width="14" height="22" rx="2" {...base} fill={L} />
    <rect x={x + 8} y={130 - h + 12} width="12" height="12" rx="2" {...base} fill={CYL} strokeWidth={2.4} /></g>);
  return (<Svg className={className}>
    <path d="M14 130 H186" {...base} />
    <H x={22} w={44} h={52} roof={M} /><H x={80} w={50} h={70} roof={C} /><H x={142} w={40} h={46} roof={G} />
    <Spark x={104} y={20} fill={G} />
  </Svg>);
}

/** Model Evidence: a magnifier over a bar chart */
export function Magnifier({ className }: { className?: string }) {
  return (<Svg className={className}>
    <rect x="22" y="30" width="112" height="96" rx="8" {...base} fill={W} />
    <rect x="38" y="80" width="16" height="32" rx="2" {...base} fill={V} /><rect x="62" y="62" width="16" height="50" rx="2" {...base} fill={G} /><rect x="86" y="92" width="16" height="20" rx="2" {...base} fill={M} />
    <path d="M36 112 H122" {...base} strokeWidth={2} />
    <circle cx="132" cy="70" r="30" {...base} fill={L} fillOpacity=".55" /><path d="M118 56 Q126 48 138 50" {...base} stroke={W} strokeWidth={4} />
    <path d="M153 92 L178 120" {...base} strokeWidth={9} stroke={INK} /><path d="M153 92 L178 120" {...base} strokeWidth={4} stroke={VD} />
  </Svg>);
}

/** Response Intelligence: a checklist clipboard */
export function Clipboard({ className }: { className?: string }) {
  return (<Svg className={className}>
    <rect x="52" y="22" width="96" height="116" rx="10" {...base} fill={W} />
    <rect x="76" y="14" width="48" height="18" rx="6" {...base} fill={G} />
    {[50, 76, 102].map((y, i) => (<g key={y}><rect x="66" y={y} width="16" height="16" rx="3" {...base} fill={i < 2 ? M : W} strokeWidth={2.4} />
      {i < 2 && <path d={`M69 ${y + 8} l4 4 l7 -8`} {...base} strokeWidth={2.6} />}<path d={`M92 ${y + 8} H${i === 2 ? 118 : 134}`} {...base} strokeWidth={2.6} /></g>))}
    <path d="M160 34 V82 M160 34 L182 42 L160 50" {...base} fill={C} /><Spark x={34} y={44} s={0.8} fill={M} />
  </Svg>);
}

/** Map and routing: a folded map with a route to a hospital */
export function MapPin({ className }: { className?: string }) {
  return (<Svg className={className}>
    <path d="M24 40 L70 28 L120 42 L170 30 V116 L120 128 L70 114 L24 126 Z" {...base} fill={W} />
    <path d="M70 28 V114 M120 42 V128" {...base} strokeWidth={2.4} /><path d="M70 28 L120 42 V128 L70 114 Z" fill={L} />
    <path d="M44 100 Q60 70 92 84 T142 64" {...base} stroke={VD} strokeWidth={3.5} strokeDasharray="7 7" />
    <circle cx="44" cy="100" r="7" {...base} fill={G} />
    <path d="M142 70 C126 50 132 26 146 24 C160 26 166 50 150 70 L146 78 Z" {...base} fill={C} /><circle cx="146" cy="44" r="7" {...base} fill={W} strokeWidth={2.4} />
    <path d="M146 40 V48 M142 44 H150" {...base} stroke={C} strokeWidth={2.6} />
  </Svg>);
}

/** Climate Observatory: sun, cloud and a thermometer */
export function SunCloud({ className }: { className?: string }) {
  return (<Svg className={className}>
    {Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return <path key={i} d={`M${120 + Math.cos(a) * 36} ${56 + Math.sin(a) * 36} L${120 + Math.cos(a) * 48} ${56 + Math.sin(a) * 48}`} {...base} />; })}
    <circle cx="120" cy="56" r="26" {...base} fill={G} />
    <path d="M44 120 Q24 120 24 104 Q24 88 42 86 Q46 66 70 66 Q90 66 98 82 Q120 80 122 100 Q134 104 132 114 Q130 120 120 120 Z" {...base} fill={W} />
    <rect x="152" y="70" width="14" height="46" rx="7" {...base} fill={W} /><circle cx="159" cy="120" r="10" {...base} fill={C} /><path d="M159 82 V114" {...base} stroke={C} strokeWidth={5} />
    <Drop x={58} y={128} s={0.8} /><Drop x={84} y={128} s={0.8} />
  </Svg>);
}

/** Copilot: Bristi with a speech bubble */
export function ChatCloud({ className }: { className?: string }) {
  return (<Svg className={className} vb="0 0 220 150">
    <g transform="translate(-8 14) scale(.86)"><Cloud mood="happy" rain={false} /></g>
    <path d="M132 18 H196 A10 10 0 0 1 206 28 V62 A10 10 0 0 1 196 72 H160 L146 86 L148 72 H132 A10 10 0 0 1 122 62 V28 A10 10 0 0 1 132 18 Z" {...base} fill={G} />
    <circle cx="146" cy="45" r="4.5" fill={INK} /><circle cx="164" cy="45" r="4.5" fill={INK} /><circle cx="182" cy="45" r="4.5" fill={INK} />
  </Svg>);
}

/** Data Profiling: stacked data cylinders */
export function Database({ className }: { className?: string }) {
  const Cyl = ({ y, fill }: { y: number; fill: string }) => (<g>
    <path d={`M54 ${y} V${y + 26} A46 12 0 0 0 146 ${y + 26} V${y}`} {...base} fill={fill} /><ellipse cx="100" cy={y} rx="46" ry="12" {...base} fill={W} /></g>);
  return (<Svg className={className}>
    <Cyl y={94} fill={V} /><Cyl y={64} fill={L} /><Cyl y={34} fill={G} />
    <circle cx="70" cy="76" r="3" fill={INK} /><circle cx="70" cy="106" r="3" fill={W} /><Spark x={168} y={36} fill={M} />
  </Svg>);
}

/** Learn: the Aedes life cycle, egg to larva to adult */
export function Lifecycle({ className }: { className?: string }) {
  return (<Svg className={className}>
    <path d="M10 112 Q40 104 70 112 T130 112 T190 112 V140 H10 Z" {...base} fill={CYL} />
    <ellipse cx="30" cy="104" rx="5" ry="3" {...base} fill={W} strokeWidth={2} /><ellipse cx="42" cy="104" rx="5" ry="3" {...base} fill={W} strokeWidth={2} />
    <path d="M70 124 q8 -10 16 0 q8 10 16 0" {...base} stroke={INK} strokeWidth={4} />
    <path d="M58 92 L80 92 M120 92 L142 92" {...base} strokeWidth={2.4} /><path d="M76 88 L82 92 L76 96 M138 88 L144 92 L138 96" {...base} strokeWidth={2.4} />
    <g transform="translate(150 52)"><MosquitoBody /></g><Spark x={100} y={40} />
  </Svg>);
}

function MosquitoBody() {
  return (<g>
    <ellipse cx="-8" cy="-14" rx="16" ry="7" {...base} fill={L} fillOpacity=".85" transform="rotate(-25 -8 -14)" />
    <ellipse cx="10" cy="-16" rx="16" ry="7" {...base} fill={L} fillOpacity=".85" transform="rotate(25 10 -16)" />
    <ellipse cx="0" cy="4" rx="22" ry="10" {...base} fill={INK} /><path d="M-8 -5 V13 M0 -6 V14 M8 -5 V13" stroke={W} strokeWidth={2.6} />
    <circle cx="22" cy="0" r="9" {...base} fill={INK} /><circle cx="25" cy="-2" r="3.5" fill={W} /><circle cx="26" cy="-2" r="1.6" fill={INK} />
    <path d="M30 4 L46 12" {...base} /><path d="M-6 12 L-14 30 M4 13 L2 32 M12 12 L20 30" {...base} strokeWidth={2.2} />
  </g>);
}

/** A cartoon Aedes (friendly villain), for empty states and chapters */
export function Mosquito({ className }: { className?: string }) {
  return <Svg className={className} vb="-60 -50 130 100"><MosquitoBody /></Svg>;
}

/** System & Provenance: a folder sealed with a check */
export function Folder({ className }: { className?: string }) {
  return (<Svg className={className}>
    <path d="M28 40 H78 L90 52 H170 A8 8 0 0 1 178 60 V124 A8 8 0 0 1 170 132 H30 A8 8 0 0 1 22 124 V46 A6 6 0 0 1 28 40 Z" {...base} fill={G} />
    <path d="M22 64 H178" {...base} strokeWidth={2.4} />
    <path d="M100 74 L126 82 V98 C126 112 116 120 100 126 C84 120 74 112 74 98 V82 Z" {...base} fill={M} />
    <path d="M89 99 l8 8 l14 -16" {...base} strokeWidth={3.4} /><Spark x={160} y={28} fill={V} />
  </Svg>);
}

/** Officer workspace: a badge with a star */
export function Badge({ className }: { className?: string }) {
  return (<Svg className={className}>
    <path d="M100 18 L118 30 L140 28 L146 50 L164 62 L154 82 L160 104 L138 110 L126 130 L106 122 L86 132 L72 114 L50 110 L52 88 L38 70 L54 54 L56 32 L78 30 Z" {...base} fill={G} />
    <circle cx="100" cy="76" r="34" {...base} fill={V} />
    <path d="M100 52 L107 68 L124 69 L111 80 L115 97 L100 88 L85 97 L89 80 L76 69 L93 68 Z" {...base} fill={W} strokeWidth={2.6} />
  </Svg>);
}

/** Administration: a key */
export function KeyArt({ className }: { className?: string }) {
  return (<Svg className={className}>
    <circle cx="66" cy="74" r="34" {...base} fill={G} /><circle cx="66" cy="74" r="12" {...base} fill={W} />
    <path d="M98 74 H176 V92 H160 V80 H146 V96 H132 V80 H98 Z" {...base} fill={G} /><Spark x={162} y={40} fill={V} /><Spark x={30} y={30} s={0.7} fill={M} />
  </Svg>);
}

/** Dhaka-style skyline with monsoon water, for the bottom of the hero band and the boot sequence */
export function Skyline({ className, tone = "night" }: { className?: string; tone?: "night" | "day" }) {
  const b = tone === "night" ? ["#5b3be6", "#4a2bd0", "#3b20b0"] : [L, "#ddd0ff", "#cbb8ff"];
  const blocks: [number, number, number, number][] = [[0, 70, 60, 0], [60, 110, 44, 1], [104, 54, 70, 2], [174, 92, 50, 0], [224, 130, 36, 1], [260, 76, 64, 2], [324, 104, 48, 0], [372, 60, 72, 1],
    [444, 120, 40, 2], [484, 84, 60, 0], [544, 140, 34, 1], [578, 70, 66, 2], [644, 98, 50, 0], [694, 64, 70, 1], [764, 116, 42, 2], [806, 80, 64, 0], [870, 128, 38, 1], [908, 72, 70, 2],
    [978, 100, 48, 0], [1026, 66, 70, 1], [1096, 112, 44, 2], [1140, 82, 60, 0]];
  return (<svg viewBox="0 0 1200 170" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden="true" focusable="false">
    {blocks.map(([x, h, w, k], i) => (<g key={i}>
      <rect x={x} y={150 - h} width={w} height={h + 20} fill={b[k]} stroke={INK} strokeWidth={3} />
      {Array.from({ length: Math.floor(h / 24) }, (_, r) => Array.from({ length: Math.max(1, Math.floor(w / 20)) }, (_, c) => (
        <rect key={`${r}-${c}`} x={x + 7 + c * 18} y={150 - h + 10 + r * 24} width="8" height="10" rx="1.5" fill={(r * 7 + c * 3 + i) % 5 === 0 ? G : "#8f78ff"} opacity={(r * 7 + c * 3 + i) % 5 === 0 ? 1 : 0.55} />)))}
    </g>))}
    <path d="M300 92 Q300 62 330 58 Q360 62 360 92 Z" fill="#6a45f0" stroke={INK} strokeWidth={3} /><path d="M330 58 V44" stroke={INK} strokeWidth={3} /><circle cx="330" cy="42" r="4" fill={G} stroke={INK} strokeWidth={2} />
    <path d="M0 152 Q60 144 120 152 T240 152 T360 152 T480 152 T600 152 T720 152 T840 152 T960 152 T1080 152 T1200 152 V170 H0 Z" fill="#8ce3ff" stroke={INK} strokeWidth={3} />
  </svg>);
}
