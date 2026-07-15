import {
  composeJunimo,
  JUNIMO_SHAPES,
  JUNIMO_COLORS,
  JUNIMO_ACCESSORIES,
  JUNIMO_FRAME_COUNT,
  moodFrameCount,
  type JunimoAccessoryId,
  type JunimoColorId,
  type JunimoMood,
  type JunimoShapeId,
} from "../src/junimo/compose.ts";

const app = document.getElementById("app")!;

function cell(
  spec: { shape: JunimoShapeId; color: JunimoColorId; accessory: JunimoAccessoryId; frame?: number },
  scale: number,
  caption?: string,
): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "cell";
  wrap.appendChild(composeJunimo(spec, { scale }));
  if (caption) {
    const cap = document.createElement("figcaption");
    cap.textContent = caption;
    wrap.appendChild(cap);
  }
  return wrap;
}

function section(title: string): HTMLElement {
  const s = document.createElement("section");
  const h = document.createElement("h2");
  h.textContent = title;
  s.appendChild(h);
  app.appendChild(s);
  return s;
}

function grid(parent: HTMLElement): HTMLElement {
  const g = document.createElement("div");
  g.className = "grid";
  parent.appendChild(g);
  return g;
}

// --- Shapes × colors, at 1x and 2x -----------------------------------------
for (const scale of [1, 2] as const) {
  const s = section(`Formes × couleurs — ${scale}× (${32 * scale}px)`);
  for (const shape of JUNIMO_SHAPES) {
    const g = grid(s);
    for (const color of JUNIMO_COLORS) {
      g.appendChild(
        cell(
          { shape: shape.id, color: color.id, accessory: "none" },
          scale,
          `${shape.label} · ${color.label}`,
        ),
      );
    }
  }
}

// --- Accessories -----------------------------------------------------------
{
  const s = section("Accessoires (calques) — 2×");
  const sampleColors: JunimoColorId[] = ["green", "blue", "amber", "coral", "purple"];
  for (const acc of JUNIMO_ACCESSORIES) {
    const g = grid(s);
    JUNIMO_SHAPES.forEach((shape, i) => {
      const color = sampleColors[i % sampleColors.length];
      g.appendChild(
        cell(
          { shape: shape.id, color, accessory: acc.id },
          2,
          `${acc.label} · ${shape.label}`,
        ),
      );
    });
  }
}

// --- Idle animation --------------------------------------------------------
{
  const s = section("Animation idle (frames)");
  const g = grid(s);
  const specs: { shape: JunimoShapeId; color: JunimoColorId; accessory: JunimoAccessoryId }[] = [
    { shape: "classic", color: "green", accessory: "none" },
    { shape: "round", color: "blue", accessory: "hat" },
    { shape: "star", color: "amber", accessory: "flower" },
    { shape: "classic", color: "coral", accessory: "bow" },
  ];
  const live: { host: HTMLElement; spec: (typeof specs)[number]; label: string }[] = [];
  for (const spec of specs) {
    const host = document.createElement("figure");
    host.className = "cell";
    const cap = document.createElement("figcaption");
    host.appendChild(composeJunimo({ ...spec, frame: 0 }, { scale: 3 }));
    host.appendChild(cap);
    g.appendChild(host);
    const shapeLabel = JUNIMO_SHAPES.find((x) => x.id === spec.shape)!.label;
    live.push({ host, spec, label: shapeLabel });
  }
  let frame = 0;
  setInterval(() => {
    frame = (frame + 1) % JUNIMO_FRAME_COUNT;
    for (const l of live) {
      const canvas = composeJunimo({ ...l.spec, frame }, { scale: 3 });
      l.host.replaceChild(canvas, l.host.firstChild!);
      (l.host.lastChild as HTMLElement).textContent = `${l.label} · frame ${frame}`;
    }
  }, 480);
}

// --- Moods animés (#49) : chaque état joué en boucle -----------------------
{
  const s = section("Moods animés (#49)");
  const g = grid(s);
  const moods: JunimoMood[] = [
    "idle",
    "run",
    "eat",
    "play",
    "celebrate",
    "bored",
  ];
  const live: { host: HTMLElement; mood: JunimoMood; frame: number }[] = [];
  for (const mood of moods) {
    const host = document.createElement("figure");
    host.className = "cell";
    host.appendChild(
      composeJunimo(
        { shape: "classic", color: "green", accessory: "none", mood, frame: 0 },
        { scale: 3 },
      ),
    );
    const cap = document.createElement("figcaption");
    cap.textContent = mood;
    host.appendChild(cap);
    g.appendChild(host);
    live.push({ host, mood, frame: 0 });
  }
  // Chaque mood a son propre nombre de frames ; on avance tous les sprites au
  // même tempo pour la démo (le vrai tempo par mood vit dans `JunimoSprite`).
  setInterval(() => {
    for (const l of live) {
      l.frame = (l.frame + 1) % moodFrameCount(l.mood);
      const canvas = composeJunimo(
        {
          shape: "classic",
          color: "green",
          accessory: "none",
          mood: l.mood,
          frame: l.frame,
        },
        { scale: 3 },
      );
      l.host.replaceChild(canvas, l.host.firstChild!);
      (l.host.lastChild as HTMLElement).textContent = `${l.mood} · frame ${l.frame}`;
    }
  }, 260);
}
