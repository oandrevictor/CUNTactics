"use client";

import { useEffect, useRef } from "react";
import type {
  Bone,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Quaternion,
  SkinnedMesh,
  Texture,
  Vector2,
  WebGLRenderer,
} from "three";
import { BOARD_COLUMNS, BOARD_ROWS, type CombatEvent, type GameState } from "./game-engine";
import { combatEventProgress } from "./combat-playback";
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
  currentEvents: readonly CombatEvent[];
  previousSnapshotEvent: CombatEvent | null;
  phase: GameState["phase"];
  playing: boolean;
  combatTime: number;
  boardHeightRatio: number;
  onReady?: () => void;
  onFallback?: (reason: BoitataRendererFallbackReason) => void;
  onReducedMotionChange?: (reduced: boolean) => void;
}

type LatestProps = Omit<Boitata3DLayerProps, "onReady" | "onFallback" | "onReducedMotionChange">;

interface SharedAssets {
  ringGeometry: BufferGeometry;
  innerRingGeometry: BufferGeometry;
  flameGeometry: BufferGeometry;
  groundGeometry: BufferGeometry;
}

interface BoitataEntity {
  root: Group;
  modelPivot: Group;
  model: Group;
  bones: Bone[];
  baseBoneQuaternions: Quaternion[];
  bodyMaterials: MeshStandardMaterial[];
  wall: Group;
  wallRings: Mesh[];
  flames: Mesh[];
  wallMaterial: MeshBasicMaterial;
  flameMaterial: MeshBasicMaterial;
  groundMaterial: MeshBasicMaterial;
  visual: BoitataVisualState;
  bodyCueKey: string;
  shieldCueKey: string;
  moveFrom: Vector2;
  moveTo: Vector2;
  currentPosition: Vector2;
  facing: number;
  seed: number;
  level: number;
  side: "player" | "enemy";
}

const BOITATA_MODEL_URL = "/characters/boitata/boitata-rigged.glb";
const BOITATA_MODEL_VERTICAL_ANCHOR_BIAS = 0.08;
const BOITATA_MODEL_YAW_FLIP_RADIANS = Math.PI;
const BOITATA_MODEL_FORWARD_TILT_RADIANS = (8 * Math.PI) / 180;

function isBone(object: Object3D): object is Bone {
  return (object as Bone).isBone === true;
}

function isSkinnedMesh(object: Object3D): object is SkinnedMesh {
  return (object as SkinnedMesh).isSkinnedMesh === true;
}

function isTexture(value: unknown): value is Texture {
  return typeof value === "object" && value !== null && (value as Texture).isTexture === true;
}

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

function authoredProgress(
  startTime: number | null,
  durationSeconds: number,
  combatTime: number,
): number {
  if (startTime === null) return 1;
  return combatEventProgress({ timestamp: startTime, durationSeconds }, combatTime);
}

/**
 * One decorative WebGL surface shared by every deployed Boitata. The DOM board
 * remains the sole interaction and accessibility layer.
 */
export function Boitata3DLayer({
  units,
  currentEvents,
  previousSnapshotEvent,
  phase,
  playing,
  combatTime,
  boardHeightRatio,
  onReady,
  onFallback,
  onReducedMotionChange,
}: Boitata3DLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestRef = useRef<LatestProps>({
    units,
    currentEvents,
    previousSnapshotEvent,
    phase,
    playing,
    combatTime,
    boardHeightRatio,
  });
  const callbacksRef = useRef({ onReady, onFallback, onReducedMotionChange });

  useEffect(() => {
    latestRef.current = { units, currentEvents, previousSnapshotEvent, phase, playing, combatTime, boardHeightRatio };
    callbacksRef.current = { onReady, onFallback, onReducedMotionChange };
  });

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
        const [THREE, { GLTFLoader }, SkeletonUtils] = await Promise.all([
          import("three"),
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three/examples/jsm/utils/SkeletonUtils.js"),
        ]);
        if (cancelled) return;

        const rigTemplate = (await new GLTFLoader().loadAsync(BOITATA_MODEL_URL)).scene;
        if (cancelled) return;
        rigTemplate.rotation.set(
          BOITATA_MODEL_FORWARD_TILT_RADIANS,
          BOITATA_MODEL_YAW_FLIP_RADIANS,
          0,
        );
        rigTemplate.updateMatrixWorld(true);
        const rigBounds = new THREE.Box3().setFromObject(rigTemplate);
        const rigSize = rigBounds.getSize(new THREE.Vector3());
        const rigCenter = rigBounds.getCenter(new THREE.Vector3());
        const rigLongestSide = Math.max(rigSize.x, rigSize.y, rigSize.z);
        if (!Number.isFinite(rigLongestSide) || rigLongestSide <= 0) {
          throw new Error("Boitata rig has invalid bounds");
        }
        const templateBones: Bone[] = [];
        let templateHasSkinnedMesh = false;
        rigTemplate.traverse((object) => {
          if (isBone(object)) templateBones.push(object);
          if (isSkinnedMesh(object)) templateHasSkinnedMesh = true;
        });
        if (!templateHasSkinnedMesh || templateBones.length < 2) {
          throw new Error("Boitata rig has no usable skinned bone chain");
        }
        const rigNormalizationScale = 3.2 / rigLongestSide;

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
          ringGeometry: new THREE.TorusGeometry(1.7, 0.075, 7, 52),
          innerRingGeometry: new THREE.TorusGeometry(1.45, 0.035, 6, 42),
          flameGeometry: new THREE.ConeGeometry(0.11, 0.46, 6),
          groundGeometry: new THREE.RingGeometry(1.25, 1.62, 48),
        };

        const entities = new Map<string, BoitataEntity>();

        const createEntity = (unit: BoitataRenderUnit, visual: BoitataVisualState): BoitataEntity => {
          const root = new THREE.Group();
          root.name = `boitata-${unit.id}`;
          const seed = [...unit.id].reduce((total, character) => total + character.charCodeAt(0), 0) * 0.017;
          const modelPivot = new THREE.Group();
          modelPivot.name = `boitata-rig-${unit.id}`;
          const model = SkeletonUtils.clone(rigTemplate) as Group;
          model.name = `boitata-model-${unit.id}`;
          model.scale.setScalar(rigNormalizationScale);
          model.position.set(
            -rigCenter.x * rigNormalizationScale,
            (-rigCenter.y + rigSize.y * BOITATA_MODEL_VERTICAL_ANCHOR_BIAS) * rigNormalizationScale,
            -rigCenter.z * rigNormalizationScale,
          );

          const allBones: Bone[] = [];
          const bodyMaterials: MeshStandardMaterial[] = [];
          model.traverse((object) => {
            if (isBone(object)) allBones.push(object);
            if (isSkinnedMesh(object)) {
              const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
              const clonedMaterials = sourceMaterials.map((material) => {
                if (material instanceof THREE.MeshStandardMaterial) {
                  const clone = material.clone();
                  clone.emissiveIntensity = 0.82;
                  bodyMaterials.push(clone);
                  return clone;
                }
                const fallbackMaterial = new THREE.MeshStandardMaterial({
                  color: 0x7d2113,
                  emissive: 0xff2a00,
                  emissiveIntensity: 0.82,
                  roughness: 0.48,
                  metalness: 0.06,
                });
                bodyMaterials.push(fallbackMaterial);
                return fallbackMaterial;
              });
              object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
              object.frustumCulled = false;
              object.renderOrder = 3;
            }
          });
          const boneSet = new Set(allBones);
          const rootBones = allBones.filter((bone) => !bone.parent || !boneSet.has(bone.parent as Bone));
          const bones: Bone[] = [];
          const collectBoneChain = (bone: Bone) => {
            bones.push(bone);
            for (const child of bone.children) {
              if (isBone(child)) collectBoneChain(child);
            }
          };
          for (const bone of rootBones) collectBoneChain(bone);
          if (bones.length < 2) throw new Error("Boitata clone has no usable bone chain");
          const baseBoneQuaternions = bones.map((bone) => bone.quaternion.clone());

          modelPivot.add(model);
          root.add(modelPivot);

          const wallMaterial = new THREE.MeshBasicMaterial({
            color: 0xff6b21,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthTest: false,
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
          ground.position.z = -1.72;
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
            modelPivot,
            model,
            bones,
            baseBoneQuaternions,
            bodyMaterials,
            wall,
            wallRings,
            flames,
            wallMaterial,
            flameMaterial,
            groundMaterial,
            visual,
            bodyCueKey: visual.bodyCueKey,
            shieldCueKey: visual.shieldCueKey,
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
          entity.bodyMaterials.forEach((material) => material.dispose());
          entity.wallMaterial.dispose();
          entity.flameMaterial.dispose();
          entity.groundMaterial.dispose();
        };

        const updateEntityCues = (entity: BoitataEntity, unit: BoitataRenderUnit, visual: BoitataVisualState) => {
          if (entity.bodyCueKey !== visual.bodyCueKey) {
            entity.bodyCueKey = visual.bodyCueKey;
          }
          if (entity.shieldCueKey !== visual.shieldCueKey) {
            entity.shieldCueKey = visual.shieldCueKey;
          }
          const [fromX, fromY] = boardPoint(
            visual.motion === "move" ? visual.fromPosition : visual.position,
            latestRef.current.boardHeightRatio,
          );
          entity.moveFrom.set(fromX, fromY);
          const [toX, toY] = boardPoint(visual.position, latestRef.current.boardHeightRatio);
          entity.moveTo.set(toX, toY);
          entity.visual = visual;
          entity.level = unit.level;
          entity.side = unit.side;
        };

        const boneEuler = new THREE.Euler();
        const boneDelta = new THREE.Quaternion();
        const updateBody = (
          entity: BoitataEntity,
          elapsed: number,
          actionProgress: number,
          hitProgress: number,
        ) => {
          const motion = entity.visual.motion;
          const attackStretch = motion === "attack" ? Math.sin(actionProgress * Math.PI) : 0;
          const castLift = motion === "cast" ? Math.sin(actionProgress * Math.PI) : 0;
          const hitShake = entity.visual.isHit
            ? Math.sin(hitProgress * Math.PI * 7) * (1 - hitProgress) * 0.17
            : 0;
          const deathProgress = motion === "death" ? smoothStep(actionProgress) : 0;
          const waveSpeed = motion === "move" ? 5.8 : 2.5;
          const waveAmplitude = reducedMotion ? 0 : motion === "move" ? 0.038 : 0.018;
          const lastBoneIndex = Math.max(1, entity.bones.length - 1);

          entity.bones.forEach((bone, index) => {
            const chainProgress = index / lastBoneIndex;
            const tailWeight = 0.3 + chainProgress * 0.7;
            let bendX = Math.cos(elapsed * waveSpeed * 0.72 + index * 0.57 + entity.seed) * waveAmplitude * 0.42 * tailWeight;
            let bendY = 0;
            let bendZ = Math.sin(elapsed * waveSpeed + index * 0.72 + entity.seed) * waveAmplitude * tailWeight;

            if (motion === "attack") {
              const headWeight = (1 - chainProgress) ** 2;
              bendX -= attackStretch * headWeight * 0.045;
              bendZ += attackStretch * Math.sin(chainProgress * Math.PI) * 0.055;
            } else if (motion === "cast") {
              bendX += castLift * Math.cos(index * 0.9) * 0.035 * tailWeight;
              bendY += castLift * Math.sin(index * 0.84) * 0.042 * tailWeight;
              bendZ += castLift * Math.sin(index * 1.08) * 0.052 * tailWeight;
            } else if (motion === "hit") {
              bendX += Math.abs(hitShake) * chainProgress * 0.22;
              bendZ += hitShake * chainProgress * 0.52;
            } else if (motion === "death") {
              bendX += deathProgress * chainProgress * 0.075;
              bendY += deathProgress * chainProgress * 0.055;
              bendZ += deathProgress * chainProgress * 0.105;
            }

            boneEuler.set(bendX, bendY, bendZ);
            boneDelta.setFromEuler(boneEuler);
            bone.quaternion.copy(entity.baseBoneQuaternions[index]).multiply(boneDelta);
          });

          const breathing = reducedMotion ? 0 : Math.sin(elapsed * 2.1 + entity.seed) * 0.012;
          entity.modelPivot.position.set(0, attackStretch * 0.56, castLift * 0.18);
          entity.modelPivot.rotation.set(
            -attackStretch * 0.07 + deathProgress * 0.46,
            hitShake * 0.48,
            hitShake * 0.8,
          );
          entity.modelPivot.scale.set(
            1 + breathing + castLift * 0.08,
            1 - breathing * 0.42 + castLift * 0.05 - deathProgress * 0.28,
            1 + breathing * 0.35 + castLift * 0.08,
          );
          entity.bodyMaterials.forEach((material) => {
            material.emissiveIntensity = 0.82 + castLift * 0.68 + Math.abs(hitShake) * 0.62;
          });

          entity.root.position.x = entity.currentPosition.x + Math.cos(entity.facing) * hitShake * 0.1;
          entity.root.position.y = entity.currentPosition.y + Math.sin(entity.facing) * hitShake * 0.1;
          entity.root.rotation.x = deathProgress * 0.28;
          entity.root.rotation.y = deathProgress * -0.22;
          entity.root.rotation.z = entity.facing + deathProgress * 0.78;
          const baseScale = 0.22 + Math.min(0.025, Math.max(0, entity.level - 1) * 0.005);
          entity.root.scale.setScalar(baseScale);

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
        let ambientElapsed = 0;
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
            const visual = deriveBoitataVisualState(unit, latest.currentEvents, latest.previousSnapshotEvent);
            return visual.motion !== "idle" || visual.isHit || (visual.shieldMotion !== "hidden" && visual.shieldMotion !== "active");
          });
          const fps = reducedMotion ? 12 : hasAction && latest.playing ? 60 : 30;
          if (now - lastRender < 1000 / fps) return;

          const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
          lastFrame = now;
          lastRender = now;
          if (!reducedMotion && latest.phase !== "combat") ambientElapsed += delta;
          const elapsed = latest.phase === "combat" ? latest.combatTime : ambientElapsed;

          if (Math.abs(lastRatio - latest.boardHeightRatio) > 0.001) resize();

          const seen = new Set<string>();
          for (const unit of latest.units) {
            if (unit.heroId !== "boitata" || unit.position === null) continue;
            seen.add(unit.id);
            const visual = deriveBoitataVisualState(unit, latest.currentEvents, latest.previousSnapshotEvent);
            let entity = entities.get(unit.id);
            if (!entity) {
              entity = createEntity(unit, visual);
              entities.set(unit.id, entity);
            }
            updateEntityCues(entity, unit, visual);

            const bodyProgress = authoredProgress(
              visual.startTime,
              visual.durationSeconds,
              latest.combatTime,
            );
            const hitProgress = authoredProgress(
              visual.hitStartTime,
              visual.hitDurationSeconds,
              latest.combatTime,
            );
            const shieldProgress = authoredProgress(
              visual.shieldStartTime,
              visual.shieldDurationSeconds,
              latest.combatTime,
            );

            if (visual.motion === "move") {
              const travel = smoothStep(bodyProgress);
              entity.currentPosition.lerpVectors(entity.moveFrom, entity.moveTo, travel);
            } else {
              entity.currentPosition.copy(entity.moveTo);
            }

            const defaultFacing = unit.side === "player" ? 0 : Math.PI;
            const targetFacing = visual.facingPosition === null
              ? defaultFacing
              : facingAngle(
                  entity.currentPosition,
                  new THREE.Vector2(...boardPoint(visual.facingPosition, latest.boardHeightRatio)),
                  defaultFacing,
                );
            entity.facing = targetFacing;
            entity.root.position.z = Math.floor(unit.position / BOARD_COLUMNS) * 0.015;

            updateBody(entity, elapsed, bodyProgress, hitProgress);
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
            assets.ringGeometry,
            assets.innerRingGeometry,
            assets.flameGeometry,
            assets.groundGeometry,
          ];
          sharedGeometries.forEach((geometry) => geometry.dispose());
          const templateTextures = new Set<Texture>();
          rigTemplate.traverse((object) => {
            if (!isSkinnedMesh(object)) return;
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
              Object.values(material).forEach((value) => {
                if (isTexture(value)) templateTextures.add(value);
              });
              material.dispose();
            });
          });
          templateTextures.forEach((texture) => texture.dispose());
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
