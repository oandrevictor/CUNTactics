"use client";

import { useEffect, useRef } from "react";
import type {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Vector2,
  WebGLRenderer,
} from "three";
import { BOARD_COLUMNS, BOARD_ROWS, type CombatEvent, type GameState } from "./game-engine";
import {
  chooseBoitataRenderMode,
  deriveBoitataVisualState,
  type BoitataRenderUnit,
  type BoitataRendererFallbackReason,
  type BoitataVisualState,
} from "./boitata-3d-state";

declare global {
  interface Navigator {
    readonly connection?: {
      readonly saveData?: boolean;
    };
  }
}

export interface Boitata3DLayerProps {
  units: readonly BoitataRenderUnit[];
  currentEvent: CombatEvent | null;
  previousEvent: CombatEvent | null;
  phase: GameState["phase"];
  playing: boolean;
  speed: number;
  boardHeightRatio: number;
  onReady?: () => void;
  onFallback?: (reason: BoitataRendererFallbackReason) => void;
  onReducedMotionChange?: (reduced: boolean) => void;
}

type LatestProps = Omit<Boitata3DLayerProps, "onReady" | "onFallback" | "onReducedMotionChange">;

interface SharedAssets {
  segmentGeometry: BufferGeometry;
  headGeometry: BufferGeometry;
  snoutGeometry: BufferGeometry;
  eyeGeometry: BufferGeometry;
  fangGeometry: BufferGeometry;
  crestGeometry: BufferGeometry;
  ringGeometry: BufferGeometry;
  innerRingGeometry: BufferGeometry;
  flameGeometry: BufferGeometry;
  groundGeometry: BufferGeometry;
  bodyMaterial: Material;
  headMaterial: Material;
  snoutMaterial: Material;
  eyeMaterial: Material;
  fangMaterial: Material;
  crestMaterial: Material;
}

interface BoitataEntity {
  root: Group;
  body: Mesh[];
  head: Group;
  crest: Mesh[];
  wall: Group;
  wallRings: Mesh[];
  flames: Mesh[];
  wallMaterial: MeshBasicMaterial;
  flameMaterial: MeshBasicMaterial;
  groundMaterial: MeshBasicMaterial;
  visual: BoitataVisualState;
  bodyCueKey: string;
  shieldCueKey: string;
  bodyElapsed: number;
  shieldElapsed: number;
  moveFrom: Vector2;
  moveTo: Vector2;
  currentPosition: Vector2;
  facing: number;
  seed: number;
  level: number;
  side: "player" | "enemy";
}

const ACTION_SECONDS = 0.68;
const BODY_SEGMENTS = 19;

function smoothStep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function easeOutBack(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (clamped - 1) ** 3 + c1 * (clamped - 1) ** 2;
}

function boardPoint(position: number | null, boardHeightRatio: number): [number, number] {
  if (position === null) return [0, 0];
  const column = position % BOARD_COLUMNS;
  const row = Math.floor(position / BOARD_COLUMNS);
  const boardHeight = BOARD_COLUMNS * boardHeightRatio;
  return [
    column + 0.5 - BOARD_COLUMNS / 2,
    boardHeight / 2 - ((row + 0.5) * boardHeight) / BOARD_ROWS,
  ];
}

function facingAngle(from: Vector2, to: Vector2, fallback: number): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 0.001) return fallback;
  return Math.atan2(-dx, dy);
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta;
}

/**
 * One decorative WebGL surface shared by every deployed Boitata. The DOM board
 * remains the sole interaction and accessibility layer.
 */
export function Boitata3DLayer({
  units,
  currentEvent,
  previousEvent,
  phase,
  playing,
  speed,
  boardHeightRatio,
  onReady,
  onFallback,
  onReducedMotionChange,
}: Boitata3DLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestRef = useRef<LatestProps>({
    units,
    currentEvent,
    previousEvent,
    phase,
    playing,
    speed,
    boardHeightRatio,
  });
  const callbacksRef = useRef({ onReady, onFallback, onReducedMotionChange });

  latestRef.current = { units, currentEvent, previousEvent, phase, playing, speed, boardHeightRatio };
  callbacksRef.current = { onReady, onFallback, onReducedMotionChange };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let frame = 0;
    let renderer: WebGLRenderer | null = null;
    let camera: OrthographicCamera | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let reducedMotion = false;
    let contextLost = false;
    let removeReducedMotionListener = () => {};
    let disposeScene = () => {};

    const fallback = (reason: BoitataRendererFallbackReason) => {
      if (!cancelled) callbacksRef.current.onFallback?.(reason);
    };

    const initialize = async () => {
      const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotion = motionQuery.matches;
      callbacksRef.current.onReducedMotionChange?.(reducedMotion);
      const handleReducedMotion = (event: MediaQueryListEvent) => {
        reducedMotion = event.matches;
        callbacksRef.current.onReducedMotionChange?.(reducedMotion);
      };
      motionQuery.addEventListener("change", handleReducedMotion);
      removeReducedMotionListener = () => motionQuery.removeEventListener("change", handleReducedMotion);

      const saveData = navigator.connection?.saveData === true;
      const capabilityDecision = chooseBoitataRenderMode({
        webglAvailable: typeof window.WebGL2RenderingContext !== "undefined",
        reducedMotion,
        saveData,
      });
      if (capabilityDecision.mode === "fallback-image") {
        fallback(capabilityDecision.fallbackReason ?? "webgl-unavailable");
        return;
      }

      try {
        const THREE = await import("three");
        if (cancelled) return;

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: window.devicePixelRatio <= 2,
          powerPreference: "high-performance",
          premultipliedAlpha: true,
        });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.22;

        const scene = new THREE.Scene();
        camera = new THREE.OrthographicCamera(-4, 4, 2.7, -2.7, 0.1, 40);
        camera.position.set(0, 0, 14);
        camera.lookAt(0, 0, 0);

        scene.add(new THREE.HemisphereLight(0xffd6a0, 0x1c1430, 2.35));
        const keyLight = new THREE.DirectionalLight(0xff8a4a, 4.4);
        keyLight.position.set(-3, 5, 8);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x65dddb, 2.3);
        rimLight.position.set(5, -2, 6);
        scene.add(rimLight);

        const assets: SharedAssets = {
          segmentGeometry: new THREE.SphereGeometry(1, 14, 10),
          headGeometry: new THREE.SphereGeometry(1, 18, 12),
          snoutGeometry: new THREE.SphereGeometry(1, 14, 9),
          eyeGeometry: new THREE.SphereGeometry(1, 10, 8),
          fangGeometry: new THREE.ConeGeometry(0.07, 0.3, 7),
          crestGeometry: new THREE.ConeGeometry(0.13, 0.56, 7),
          ringGeometry: new THREE.TorusGeometry(1.7, 0.075, 7, 52),
          innerRingGeometry: new THREE.TorusGeometry(1.45, 0.035, 6, 42),
          flameGeometry: new THREE.ConeGeometry(0.11, 0.46, 6),
          groundGeometry: new THREE.RingGeometry(1.25, 1.62, 48),
          bodyMaterial: new THREE.MeshStandardMaterial({
            color: 0x671b12,
            emissive: 0x280500,
            emissiveIntensity: 0.72,
            roughness: 0.46,
            metalness: 0.08,
          }),
          headMaterial: new THREE.MeshStandardMaterial({
            color: 0x9f321d,
            emissive: 0x3d0900,
            emissiveIntensity: 0.9,
            roughness: 0.4,
            metalness: 0.1,
          }),
          snoutMaterial: new THREE.MeshStandardMaterial({
            color: 0xd85b28,
            emissive: 0x4a1203,
            emissiveIntensity: 0.78,
            roughness: 0.5,
          }),
          eyeMaterial: new THREE.MeshBasicMaterial({ color: 0xfff1a8 }),
          fangMaterial: new THREE.MeshStandardMaterial({ color: 0xffe8c8, roughness: 0.32 }),
          crestMaterial: new THREE.MeshBasicMaterial({
            color: 0xff8b2e,
            transparent: true,
            opacity: 0.92,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        };

        const entities = new Map<string, BoitataEntity>();

        const createEntity = (unit: BoitataRenderUnit, visual: BoitataVisualState): BoitataEntity => {
          const root = new THREE.Group();
          root.name = `boitata-${unit.id}`;
          const seed = [...unit.id].reduce((total, character) => total + character.charCodeAt(0), 0) * 0.017;
          const body: Mesh[] = [];

          for (let index = 0; index < BODY_SEGMENTS; index += 1) {
            const segment = new THREE.Mesh(assets.segmentGeometry, assets.bodyMaterial);
            segment.renderOrder = 2 + index * 0.001;
            body.push(segment);
            root.add(segment);
          }

          const head = new THREE.Group();
          const skull = new THREE.Mesh(assets.headGeometry, assets.headMaterial);
          skull.scale.set(0.53, 0.62, 0.46);
          head.add(skull);

          const snout = new THREE.Mesh(assets.snoutGeometry, assets.snoutMaterial);
          snout.position.set(0, 0.39, 0.11);
          snout.scale.set(0.37, 0.3, 0.35);
          head.add(snout);

          for (const x of [-0.27, 0.27]) {
            const eye = new THREE.Mesh(assets.eyeGeometry, assets.eyeMaterial);
            eye.position.set(x, 0.2, 0.4);
            eye.scale.setScalar(0.105);
            head.add(eye);

            const fang = new THREE.Mesh(assets.fangGeometry, assets.fangMaterial);
            fang.position.set(x * 0.55, 0.61, 0.16);
            fang.rotation.z = Math.PI;
            head.add(fang);
          }

          const crest: Mesh[] = [];
          for (let index = 0; index < 5; index += 1) {
            const flame = new THREE.Mesh(assets.crestGeometry, assets.crestMaterial);
            flame.position.set((index - 2) * 0.15, -0.25 + Math.abs(index - 2) * 0.04, -0.2);
            flame.rotation.z = (index - 2) * -0.13;
            flame.scale.setScalar(1 - Math.abs(index - 2) * 0.09);
            crest.push(flame);
            head.add(flame);
          }
          root.add(head);

          const wallMaterial = new THREE.MeshBasicMaterial({
            color: 0xff6b21,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const flameMaterial = wallMaterial.clone();
          flameMaterial.color.setHex(0xffc24f);
          const wall = new THREE.Group();
          const wallRings = [
            new THREE.Mesh(assets.ringGeometry, wallMaterial),
            new THREE.Mesh(assets.innerRingGeometry, flameMaterial),
          ];
          wallRings[0].position.z = 0.22;
          wallRings[1].position.z = 0.27;
          wallRings.forEach((ring) => {
            ring.renderOrder = 6;
            wall.add(ring);
          });

          const flames: Mesh[] = [];
          for (let index = 0; index < 12; index += 1) {
            const angle = (index / 12) * Math.PI * 2;
            const flame = new THREE.Mesh(assets.flameGeometry, flameMaterial);
            flame.position.set(Math.cos(angle) * 1.62, Math.sin(angle) * 1.62, 0.3);
            flame.rotation.z = angle - Math.PI / 2;
            flame.renderOrder = 7;
            flames.push(flame);
            wall.add(flame);
          }
          root.add(wall);

          const groundMaterial = new THREE.MeshBasicMaterial({
            color: unit.side === "player" ? 0x62d7cb : 0xe56879,
            transparent: true,
            opacity: 0.32,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const ground = new THREE.Mesh(assets.groundGeometry, groundMaterial);
          ground.position.z = -0.42;
          ground.renderOrder = 1;
          root.add(ground);

          const [startX, startY] = boardPoint(visual.fromPosition ?? visual.position, latestRef.current.boardHeightRatio);
          const moveFrom = new THREE.Vector2(startX, startY);
          const [targetX, targetY] = boardPoint(visual.position, latestRef.current.boardHeightRatio);
          const moveTo = new THREE.Vector2(targetX, targetY);
          root.position.set(startX, startY, visual.position === null ? 0 : Math.floor(visual.position / BOARD_COLUMNS) * 0.015);
          const scale = 0.22 + Math.min(0.025, Math.max(0, unit.level - 1) * 0.005);
          root.scale.setScalar(scale);
          scene.add(root);

          return {
            root,
            body,
            head,
            crest,
            wall,
            wallRings,
            flames,
            wallMaterial,
            flameMaterial,
            groundMaterial,
            visual,
            bodyCueKey: visual.bodyCueKey,
            shieldCueKey: visual.shieldCueKey,
            bodyElapsed: 0,
            shieldElapsed: 0,
            moveFrom,
            moveTo,
            currentPosition: moveFrom.clone(),
            facing: unit.side === "player" ? 0 : Math.PI,
            seed,
            level: unit.level,
            side: unit.side,
          };
        };

        const disposeEntity = (entity: BoitataEntity) => {
          scene.remove(entity.root);
          entity.wallMaterial.dispose();
          entity.flameMaterial.dispose();
          entity.groundMaterial.dispose();
        };

        const updateEntityCues = (entity: BoitataEntity, unit: BoitataRenderUnit, visual: BoitataVisualState) => {
          if (entity.bodyCueKey !== visual.bodyCueKey) {
            entity.bodyCueKey = visual.bodyCueKey;
            entity.bodyElapsed = 0;
            if (visual.motion === "move") {
              const [fromX, fromY] = boardPoint(visual.fromPosition, latestRef.current.boardHeightRatio);
              entity.moveFrom.set(fromX, fromY);
            } else {
              entity.moveFrom.copy(entity.currentPosition);
            }
          }
          if (entity.shieldCueKey !== visual.shieldCueKey) {
            entity.shieldCueKey = visual.shieldCueKey;
            entity.shieldElapsed = 0;
          }
          const [toX, toY] = boardPoint(visual.position, latestRef.current.boardHeightRatio);
          entity.moveTo.set(toX, toY);
          entity.visual = visual;
          entity.level = unit.level;
          entity.side = unit.side;
        };

        const updateBody = (
          entity: BoitataEntity,
          elapsed: number,
          actionProgress: number,
          motionScale: number,
        ) => {
          const motion = entity.visual.motion;
          const idleWave = reducedMotion ? 0 : Math.sin(elapsed * 2.1 + entity.seed) * 0.045;
          const attackStretch = motion === "attack" ? Math.sin(actionProgress * Math.PI) : 0;
          const castLift = motion === "cast" ? Math.sin(actionProgress * Math.PI) : 0;
          const hitShake = motion === "hit"
            ? Math.sin(actionProgress * Math.PI * 7) * (1 - actionProgress) * 0.17
            : 0;
          const deathProgress = motion === "death" ? smoothStep(actionProgress) : 0;

          let headX = 0;
          let headY = 1.16;
          let headZ = 0.34;
          for (let index = 0; index < BODY_SEGMENTS; index += 1) {
            const unitProgress = index / (BODY_SEGMENTS - 1);
            let x: number;
            let y: number;
            let z: number;
            if (unitProgress < 0.72) {
              const coilProgress = unitProgress / 0.72;
              const angle = coilProgress * Math.PI * 2.18 + Math.PI * 0.68;
              const radius = 1.72 - coilProgress * 0.54;
              const ripple = reducedMotion ? 0 : Math.sin(elapsed * 2.7 + index * 0.58 + entity.seed) * 0.035;
              x = Math.cos(angle) * (radius + ripple);
              y = Math.sin(angle) * (radius * 0.43 + ripple) - 0.18;
              z = Math.sin(angle * 1.12) * 0.15;
            } else {
              const neckProgress = (unitProgress - 0.72) / 0.28;
              const joinAngle = Math.PI * 2.18 + Math.PI * 0.68;
              const joinX = Math.cos(joinAngle) * 1.18;
              const joinY = Math.sin(joinAngle) * (1.18 * 0.43) - 0.18;
              const curve = Math.sin(neckProgress * Math.PI);
              x = joinX * (1 - neckProgress) + curve * 0.18;
              y = joinY * (1 - neckProgress) + neckProgress * (1.16 + idleWave + castLift * 0.38);
              z = 0.15 * (1 - neckProgress) + neckProgress * (0.34 + attackStretch * 0.1);
              x += hitShake * neckProgress;
              y += attackStretch * neckProgress * 0.52;
            }

            y -= deathProgress * unitProgress * 0.86;
            const thickness = index === 0
              ? 0.16
              : 0.31 + Math.sin(Math.min(1, unitProgress * 1.8) * Math.PI) * 0.08;
            const segment = entity.body[index];
            segment.position.set(x, y, z);
            segment.scale.set(thickness * 1.08, thickness, thickness * 0.96);
            if (index === BODY_SEGMENTS - 1) {
              headX = x;
              headY = y;
              headZ = z;
            }
          }

          entity.head.position.set(headX + hitShake * 0.35, headY, headZ + 0.04);
          entity.head.rotation.z = hitShake * 0.5 + Math.sin(elapsed * 1.7 + entity.seed) * (reducedMotion ? 0 : 0.025);
          entity.head.scale.setScalar(1 + castLift * 0.07);
          entity.crest.forEach((flame, index) => {
            const flutter = reducedMotion ? 1 : 0.8 + Math.sin(elapsed * 8 + index * 1.7 + entity.seed) * 0.2;
            flame.scale.y = flutter * (1 + castLift * 0.55);
            flame.scale.x = 0.92 + castLift * 0.18;
          });

          const lunge = attackStretch * 0.18;
          entity.root.position.x = entity.currentPosition.x + hitShake * 0.035;
          entity.root.position.y = entity.currentPosition.y + lunge;
          entity.root.rotation.x = deathProgress * 0.28;
          entity.root.rotation.y = deathProgress * -0.22;
          entity.root.rotation.z = entity.facing + deathProgress * 0.78;
          const baseScale = 0.22 + Math.min(0.025, Math.max(0, entity.level - 1) * 0.005);
          const castScale = 1 + castLift * 0.07;
          entity.root.scale.set(baseScale * castScale, baseScale * castScale * (1 - deathProgress * 0.3), baseScale);

          if (motionScale === 0 && motion !== "idle" && !reducedMotion) {
            entity.head.rotation.z += motion === "hit" ? 0.08 : 0;
          }
        };

        const updateWall = (entity: BoitataEntity, elapsed: number, actionProgress: number) => {
          const shieldMotion = entity.visual.shieldMotion;
          let opacity = 0;
          let scale = 1;
          if (shieldMotion === "active") {
            opacity = 0.72;
          } else if (shieldMotion === "cast") {
            opacity = Math.min(1, actionProgress * 3.4) * 0.94;
            scale = 0.42 + easeOutBack(actionProgress) * 0.58;
          } else if (shieldMotion === "shield-hit") {
            const pulse = Math.sin(actionProgress * Math.PI);
            opacity = 0.76 + pulse * 0.24;
            scale = 1 + pulse * Math.min(0.2, 0.08 + entity.visual.shieldDamage / 700);
          } else if (shieldMotion === "shield-break") {
            opacity = Math.max(0, 1 - smoothStep(actionProgress));
            scale = 1 + actionProgress * 0.48;
          }

          entity.wall.visible = opacity > 0.01;
          entity.wall.scale.setScalar(scale);
          entity.wallMaterial.opacity = opacity * 0.82;
          entity.flameMaterial.opacity = opacity;
          entity.wallRings[0].rotation.z = elapsed * 0.64 + entity.seed;
          entity.wallRings[1].rotation.z = -elapsed * 0.88 - entity.seed;
          entity.flames.forEach((flame, index) => {
            const flutter = reducedMotion ? 1 : 0.7 + Math.sin(elapsed * 9.4 + index * 1.91 + entity.seed) * 0.28;
            flame.scale.set(0.82 + flutter * 0.14, flutter * (1 + (scale - 1) * 0.8), 1);
          });
        };

        let lastFrame = performance.now();
        let lastRender = 0;
        let elapsed = 0;
        let ready = false;
        let lastRatio = latestRef.current.boardHeightRatio;

        const resize = () => {
          if (!renderer || !camera) return;
          const width = Math.max(1, canvas.clientWidth);
          const height = Math.max(1, canvas.clientHeight);
          renderer.setSize(width, height, false);
          const ratio = latestRef.current.boardHeightRatio;
          const boardHeight = BOARD_COLUMNS * ratio;
          camera.left = -BOARD_COLUMNS / 2;
          camera.right = BOARD_COLUMNS / 2;
          camera.top = boardHeight / 2;
          camera.bottom = -boardHeight / 2;
          camera.updateProjectionMatrix();
          lastRatio = ratio;
        };

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        resize();

        const renderFrame = (now: number) => {
          frame = window.requestAnimationFrame(renderFrame);
          if (cancelled || contextLost || !renderer || !camera) return;
          if (document.hidden) {
            lastFrame = now;
            return;
          }

          const latest = latestRef.current;
          const hasAction = latest.units.some((unit) => {
            const visual = deriveBoitataVisualState(unit, latest.currentEvent, latest.previousEvent);
            return visual.motion !== "idle" || (visual.shieldMotion !== "hidden" && visual.shieldMotion !== "active");
          });
          const fps = reducedMotion ? 12 : hasAction && latest.playing ? 60 : 30;
          if (now - lastRender < 1000 / fps) return;

          const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
          lastFrame = now;
          lastRender = now;
          const motionScale = reducedMotion
            ? 0
            : latest.phase === "combat"
              ? latest.playing ? latest.speed : 0
              : 1;
          elapsed += delta * motionScale;

          if (Math.abs(lastRatio - latest.boardHeightRatio) > 0.001) resize();

          const seen = new Set<string>();
          for (const unit of latest.units) {
            if (unit.heroId !== "boitata" || unit.position === null) continue;
            seen.add(unit.id);
            const visual = deriveBoitataVisualState(unit, latest.currentEvent, latest.previousEvent);
            let entity = entities.get(unit.id);
            if (!entity) {
              entity = createEntity(unit, visual);
              entities.set(unit.id, entity);
            }
            updateEntityCues(entity, unit, visual);

            entity.bodyElapsed += delta * motionScale;
            entity.shieldElapsed += delta * motionScale;
            const bodyProgress = latest.phase === "combat" && !latest.playing && visual.motion !== "idle"
              ? visual.motion === "death" ? 0.72 : 0.46
              : Math.min(1, entity.bodyElapsed / ACTION_SECONDS);
            const shieldProgress = latest.phase === "combat" && !latest.playing && visual.shieldMotion !== "active" && visual.shieldMotion !== "hidden"
              ? visual.shieldMotion === "shield-break" ? 0.72 : 0.46
              : Math.min(1, entity.shieldElapsed / ACTION_SECONDS);

            if (visual.motion === "move") {
              const travel = smoothStep(bodyProgress);
              entity.currentPosition.lerpVectors(entity.moveFrom, entity.moveTo, travel);
            } else {
              const settle = reducedMotion ? 1 : 1 - Math.exp(-delta * Math.max(1, motionScale) * 10);
              entity.currentPosition.lerp(entity.moveTo, settle);
            }

            const defaultFacing = unit.side === "player" ? 0 : Math.PI;
            const targetFacing = visual.facingPosition === null
              ? defaultFacing
              : facingAngle(
                  entity.currentPosition,
                  new THREE.Vector2(...boardPoint(visual.facingPosition, latest.boardHeightRatio)),
                  defaultFacing,
                );
            entity.facing = THREE.MathUtils.lerp(
              entity.facing,
              shortestAngle(entity.facing, targetFacing),
              reducedMotion ? 1 : 1 - Math.exp(-delta * Math.max(1, motionScale) * 12),
            );
            entity.root.position.z = Math.floor(unit.position / BOARD_COLUMNS) * 0.015;

            updateBody(entity, elapsed, bodyProgress, motionScale);
            updateWall(entity, elapsed, shieldProgress);
          }

          for (const [id, entity] of entities) {
            if (!seen.has(id)) {
              disposeEntity(entity);
              entities.delete(id);
            }
          }

          renderer.render(scene, camera);
          if (!ready) {
            ready = true;
            callbacksRef.current.onReady?.();
          }
        };

        const handleContextLost = (event: Event) => {
          event.preventDefault();
          contextLost = true;
          ready = false;
          fallback("context-lost");
        };
        canvas.addEventListener("webglcontextlost", handleContextLost);
        frame = window.requestAnimationFrame(renderFrame);

        disposeScene = () => {
          canvas.removeEventListener("webglcontextlost", handleContextLost);
          for (const entity of entities.values()) disposeEntity(entity);
          entities.clear();
          const sharedGeometries = [
            assets.segmentGeometry,
            assets.headGeometry,
            assets.snoutGeometry,
            assets.eyeGeometry,
            assets.fangGeometry,
            assets.crestGeometry,
            assets.ringGeometry,
            assets.innerRingGeometry,
            assets.flameGeometry,
            assets.groundGeometry,
          ];
          sharedGeometries.forEach((geometry) => geometry.dispose());
          const sharedMaterials = [
            assets.bodyMaterial,
            assets.headMaterial,
            assets.snoutMaterial,
            assets.eyeMaterial,
            assets.fangMaterial,
            assets.crestMaterial,
          ];
          sharedMaterials.forEach((material) => material.dispose());
          renderer?.dispose();
        };
      } catch {
        fallback("initialization-failed");
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      removeReducedMotionListener();
      disposeScene();
    };
  }, []);

  return (
    <div
      className="boitata-3d-layer"
      data-testid="boitata-3d-layer"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      <canvas
        ref={canvasRef}
        data-testid="boitata-3d-canvas"
        role="presentation"
        tabIndex={-1}
      />
    </div>
  );
}
