"use client";

import { useEffect, useRef } from "react";
import type {
  AnimationAction,
  AnimationMixer,
  Group,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  SkinnedMesh,
  Texture,
  Vector2,
  WebGLRenderer,
} from "three";
import { BOARD_COLUMNS, BOARD_ROWS, type CombatEvent, type GameState } from "./game-engine";
import {
  MEAT_GAGA_ANIMATION_CLIPS,
  chooseMeatGagaRenderMode,
  deriveMeatGagaVisualState,
  meatGagaClipForMotion,
  type MeatGagaRenderUnit,
  type MeatGagaRendererFallbackReason,
  type MeatGagaVisualState,
} from "./meat-gaga-3d-state";

declare global {
  interface Navigator {
    readonly connection?: {
      readonly saveData?: boolean;
    };
  }
}

export interface MeatGaga3DLayerProps {
  units: readonly MeatGagaRenderUnit[];
  currentEvents: readonly CombatEvent[];
  previousSnapshotEvent: CombatEvent | null;
  phase: GameState["phase"];
  playing: boolean;
  previewing: boolean;
  speed: number;
  actionDuration: number;
  boardHeightRatio: number;
  onReady?: () => void;
  onFallback?: (reason: MeatGagaRendererFallbackReason) => void;
  onDisposed?: () => void;
}

type LatestProps = Omit<MeatGaga3DLayerProps, "onReady" | "onFallback" | "onDisposed">;

interface MaterialState {
  material: MeshStandardMaterial;
  baseEmissiveIntensity: number;
  baseOpacity: number;
}

interface MeatGagaEntity {
  root: Group;
  modelPivot: Group;
  model: Group;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  skinnedMeshes: SkinnedMesh[];
  bodyMaterials: MaterialState[];
  visual: MeatGagaVisualState;
  cueKey: string;
  bodyElapsed: number;
  clipElapsed: number;
  clipDuration: number;
  activeAction: AnimationAction | null;
  activeMotion: MeatGagaVisualState["motion"];
  moveFrom: Vector2;
  moveTo: Vector2;
  currentPosition: Vector2;
  facingYaw: number;
  level: number;
  seed: number;
  bodyDrawn: boolean;
  bodyValidated: boolean;
}

const MEAT_GAGA_MODEL_URL = "/characters/meat-gaga/meat-gaga-animated.glb";
const MODEL_TARGET_HEIGHT = 1.28;
const MODEL_FOOT_OFFSET = -0.38;
const MIN_ONE_SHOT_SECONDS = 0.56;
const IDLE_POSE_PROGRESS = 0.24;

function isSkinnedMesh(object: object): object is SkinnedMesh {
  return (object as SkinnedMesh).isSkinnedMesh === true;
}

function isTexture(value: unknown): value is Texture {
  return typeof value === "object" && value !== null && (value as Texture).isTexture === true;
}

function smoothStep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
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

function targetYaw(from: Vector2, facingPosition: number | null, boardHeightRatio: number): number {
  if (facingPosition === null) return 0;
  const [targetX] = boardPoint(facingPosition, boardHeightRatio);
  return Math.max(-0.52, Math.min(0.52, (targetX - from.x) * 0.32));
}

function poseEntity(entity: MeatGagaEntity) {
  entity.mixer.stopAllAction();
  // Sampling the authored clip preserves this GLB's 0.01 armature conversion;
  // Skeleton.pose() would apply that conversion twice and collapse the model.
  const idleAction = entity.actions.get(MEAT_GAGA_ANIMATION_CLIPS.walking);
  if (idleAction) {
    idleAction.reset();
    idleAction.play();
    idleAction.time = idleAction.getClip().duration * IDLE_POSE_PROGRESS;
    idleAction.paused = true;
    entity.mixer.update(0);
  }
  entity.model.updateMatrixWorld(true);
  entity.activeAction = idleAction ?? null;
  entity.activeMotion = "idle";
  entity.clipElapsed = 0;
  entity.clipDuration = 0;
}

/** One decorative canvas shared by every deployed Meat Gaga. */
export function MeatGaga3DLayer({
  units,
  currentEvents,
  previousSnapshotEvent,
  phase,
  playing,
  previewing,
  speed,
  actionDuration,
  boardHeightRatio,
  onReady,
  onFallback,
  onDisposed,
}: MeatGaga3DLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestRef = useRef<LatestProps>({
    units,
    currentEvents,
    previousSnapshotEvent,
    phase,
    playing,
    previewing,
    speed,
    actionDuration,
    boardHeightRatio,
  });
  const callbacksRef = useRef({ onReady, onFallback, onDisposed });

  useEffect(() => {
    latestRef.current = {
      units,
      currentEvents,
      previousSnapshotEvent,
      phase,
      playing,
      previewing,
      speed,
      actionDuration,
      boardHeightRatio,
    };
    callbacksRef.current = { onReady, onFallback, onDisposed };
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
    let renderFailed = false;
    let removeReducedMotionListener = () => {};
    let disposeScene = () => {};

    const fallback = (reason: MeatGagaRendererFallbackReason) => {
      if (!cancelled) callbacksRef.current.onFallback?.(reason);
    };

    const initialize = async () => {
      let cleanupFailedInitialization = () => {};
      const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotion = motionQuery.matches;
      const handleReducedMotion = (event: MediaQueryListEvent) => {
        reducedMotion = event.matches;
      };
      motionQuery.addEventListener("change", handleReducedMotion);
      removeReducedMotionListener = () => motionQuery.removeEventListener("change", handleReducedMotion);

      const capabilityDecision = chooseMeatGagaRenderMode({
        webglAvailable: typeof window.WebGL2RenderingContext !== "undefined",
        reducedMotion,
        saveData: navigator.connection?.saveData === true,
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

        const gltf = await new GLTFLoader().loadAsync(MEAT_GAGA_MODEL_URL);
        const rigTemplate = gltf.scene;
        const disposeRigTemplate = () => {
          const templateTextures = new Set<Texture>();
          const imageSources = new Set<{ close?: () => void }>();
          rigTemplate.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
              Object.values(material).forEach((value) => {
                if (isTexture(value)) templateTextures.add(value);
              });
              material.dispose();
            });
          });
          templateTextures.forEach((texture) => {
            const sourceData = texture.source.data as { close?: () => void } | null;
            texture.dispose();
            if (sourceData) imageSources.add(sourceData);
          });
          imageSources.forEach((sourceData) => sourceData.close?.());
        };
        cleanupFailedInitialization = disposeRigTemplate;
        if (cancelled) {
          cleanupFailedInitialization();
          cleanupFailedInitialization = () => {};
          return;
        }
        const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
        for (const requiredClip of [
          MEAT_GAGA_ANIMATION_CLIPS.alert,
          MEAT_GAGA_ANIMATION_CLIPS.throw,
          MEAT_GAGA_ANIMATION_CLIPS.walking,
        ]) {
          if (!clips.has(requiredClip)) throw new Error(`Meat Gaga is missing ${requiredClip}`);
        }

        rigTemplate.updateMatrixWorld(true);
        const rigBounds = new THREE.Box3().setFromObject(rigTemplate);
        const rigSize = rigBounds.getSize(new THREE.Vector3());
        const rigCenter = rigBounds.getCenter(new THREE.Vector3());
        if (!Number.isFinite(rigSize.y) || rigSize.y <= 0) {
          throw new Error("Meat Gaga rig has invalid bounds");
        }
        let templateHasSkinnedMesh = false;
        rigTemplate.traverse((object) => {
          if (isSkinnedMesh(object)) templateHasSkinnedMesh = true;
        });
        if (!templateHasSkinnedMesh) throw new Error("Meat Gaga rig has no skinned mesh");
        const rigNormalizationScale = MODEL_TARGET_HEIGHT / rigSize.y;

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: window.devicePixelRatio <= 1.5,
          powerPreference: "high-performance",
          premultipliedAlpha: true,
        });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.88;
        const disposeRigAfterRenderer = cleanupFailedInitialization;
        cleanupFailedInitialization = () => {
          disposeRigAfterRenderer();
          renderer?.dispose();
        };

        const scene = new THREE.Scene();
        camera = new THREE.OrthographicCamera(-4, 4, 2.7, -2.7, 0.1, 40);
        camera.position.set(0, 0, 14);
        camera.lookAt(0, 0, 0);

        scene.add(new THREE.HemisphereLight(0xffe4db, 0x1a1028, 2.25));
        const keyLight = new THREE.DirectionalLight(0xffd5c8, 3.2);
        keyLight.position.set(-3, 5, 8);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0xff637c, 2.2);
        rimLight.position.set(5, 1, 7);
        scene.add(rimLight);

        const groundGeometry = new THREE.RingGeometry(0.34, 0.49, 40);
        const entities = new Map<string, MeatGagaEntity>();

        const createEntity = (unit: MeatGagaRenderUnit, visual: MeatGagaVisualState): MeatGagaEntity => {
          const root = new THREE.Group();
          root.name = `meat-gaga-${unit.id}`;
          const modelPivot = new THREE.Group();
          modelPivot.name = `meat-gaga-rig-${unit.id}`;
          const model = SkeletonUtils.clone(rigTemplate) as Group;
          model.name = `meat-gaga-model-${unit.id}`;
          model.scale.setScalar(rigNormalizationScale);
          model.position.set(
            -rigCenter.x * rigNormalizationScale,
            -rigBounds.min.y * rigNormalizationScale + MODEL_FOOT_OFFSET,
            -rigCenter.z * rigNormalizationScale,
          );

          const skinnedMeshes: SkinnedMesh[] = [];
          const bodyMaterials: MaterialState[] = [];
          model.traverse((object) => {
            if (!isSkinnedMesh(object)) return;
            skinnedMeshes.push(object);
            const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
            const clonedMaterials = sourceMaterials.map((sourceMaterial) => {
              const material = sourceMaterial instanceof THREE.MeshStandardMaterial
                ? sourceMaterial.clone()
                : new THREE.MeshStandardMaterial({ color: 0xb52844, roughness: 0.48 });
              material.transparent = true;
              material.emissiveIntensity = Math.min(0.5, material.emissiveIntensity || 0.32);
              if ("specularColor" in material) {
                const physical = material as MeshPhysicalMaterial;
                physical.specularColor.setRGB(
                  Math.min(1, physical.specularColor.r),
                  Math.min(1, physical.specularColor.g),
                  Math.min(1, physical.specularColor.b),
                );
              }
              bodyMaterials.push({
                material,
                baseEmissiveIntensity: material.emissiveIntensity,
                baseOpacity: material.opacity,
              });
              return material;
            });
            object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
            object.frustumCulled = false;
            object.renderOrder = 3;
          });

          const mixer = new THREE.AnimationMixer(model);
          const actions = new Map<string, AnimationAction>();
          for (const [name, clip] of clips) actions.set(name, mixer.clipAction(clip, model));
          modelPivot.add(model);
          root.add(modelPivot);

          const groundMaterial = new THREE.MeshBasicMaterial({
            color: unit.side === "player" ? 0x62d7cb : 0xe56879,
            transparent: true,
            opacity: 0.28,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const ground = new THREE.Mesh(groundGeometry, groundMaterial);
          ground.position.set(0, MODEL_FOOT_OFFSET + 0.02, -0.42);
          ground.scale.set(1, 0.32, 1);
          ground.renderOrder = 1;
          root.add(ground);

          const [startX, startY] = boardPoint(visual.fromPosition ?? visual.position, latestRef.current.boardHeightRatio);
          const [targetX, targetY] = boardPoint(visual.position, latestRef.current.boardHeightRatio);
          const moveFrom = new THREE.Vector2(startX, startY);
          const moveTo = new THREE.Vector2(targetX, targetY);
          root.position.set(startX, startY, visual.position === null ? 0 : Math.floor(visual.position / BOARD_COLUMNS) * 0.015);
          root.scale.setScalar(0.9 + Math.min(0.08, Math.max(0, unit.level - 1) * 0.016));
          scene.add(root);

          const entity: MeatGagaEntity = {
            root,
            modelPivot,
            model,
            mixer,
            actions,
            skinnedMeshes,
            bodyMaterials,
            visual,
            cueKey: "",
            bodyElapsed: 0,
            clipElapsed: 0,
            clipDuration: 0,
            activeAction: null,
            activeMotion: "idle",
            moveFrom,
            moveTo,
            currentPosition: moveFrom.clone(),
            facingYaw: 0,
            level: unit.level,
            seed: [...unit.id].reduce((total, character) => total + character.charCodeAt(0), 0) * 0.031,
            bodyDrawn: false,
            bodyValidated: false,
          };
          for (const mesh of skinnedMeshes) {
            mesh.onAfterRender = () => {
              entity.bodyDrawn = true;
            };
          }
          return entity;
        };

        const hasRenderableBody = (entity: MeatGagaEntity) => {
          entity.model.updateMatrixWorld(true);
          const jointPosition = new THREE.Vector3();
          let minimumY = Infinity;
          let maximumY = -Infinity;
          for (const bone of entity.skinnedMeshes[0]?.skeleton.bones ?? []) {
            bone.getWorldPosition(jointPosition);
            minimumY = Math.min(minimumY, jointPosition.y);
            maximumY = Math.max(maximumY, jointPosition.y);
          }
          const bodyHeight = maximumY - minimumY;
          return entity.bodyDrawn
            && Number.isFinite(bodyHeight)
            && bodyHeight >= MODEL_TARGET_HEIGHT * 0.45
            && bodyHeight <= MODEL_TARGET_HEIGHT * 2.5;
        };

        const disposeEntity = (entity: MeatGagaEntity) => {
          scene.remove(entity.root);
          entity.mixer.stopAllAction();
          entity.mixer.uncacheRoot(entity.model);
          entity.bodyMaterials.forEach(({ material }) => material.dispose());
          entity.root.traverse((object) => {
            if (object instanceof THREE.Mesh && object.geometry === groundGeometry) {
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              materials.forEach((material) => material.dispose());
            }
          });
        };

        const startAuthoredAction = (
          entity: MeatGagaEntity,
          visual: MeatGagaVisualState,
          latest: LatestProps,
        ) => {
          const clipName = meatGagaClipForMotion(visual.motion);
          const shouldFinishOneShot = entity.activeAction
            && (entity.activeMotion === "throw" || entity.activeMotion === "stunned")
            && entity.clipElapsed < entity.clipDuration;
          if (!clipName) {
            if (visual.motion === "idle" && (reducedMotion || latest.previewing)) {
              poseEntity(entity);
              return;
            }
            if (visual.motion === "idle" && shouldFinishOneShot) return;
            poseEntity(entity);
            return;
          }

          const action = entity.actions.get(clipName);
          if (!action) throw new Error(`Meat Gaga action ${clipName} is unavailable`);
          const previousAction = entity.activeAction;
          const samplesAuthoredPose = reducedMotion || latest.previewing;
          action.reset();
          action.enabled = true;
          action.clampWhenFinished = visual.motion !== "move";
          if (visual.motion === "move") {
            action.setLoop(THREE.LoopRepeat, Infinity);
            entity.clipDuration = Math.max(0.08, latest.actionDuration);
            action.setDuration(entity.clipDuration);
          } else {
            action.setLoop(THREE.LoopOnce, 1);
            entity.clipDuration = Math.max(MIN_ONE_SHOT_SECONDS, latest.actionDuration);
            action.setDuration(entity.clipDuration);
          }
          action.play();
          if (samplesAuthoredPose) {
            if (previousAction && previousAction !== action) previousAction.stop();
            action.stopFading();
            action.setEffectiveWeight(1);
          } else if (previousAction === action) {
            action.stopFading();
            action.setEffectiveWeight(1);
          } else if (previousAction && previousAction !== action) {
            previousAction.crossFadeTo(action, 0.08, false);
          } else {
            action.fadeIn(0.08);
          }
          entity.activeAction = action;
          entity.activeMotion = visual.motion;
          entity.clipElapsed = 0;

          if (samplesAuthoredPose) {
            const previewProgress = visual.motion === "stunned" ? 0.34 : 0.46;
            action.time = action.getClip().duration * previewProgress;
            action.paused = true;
            entity.bodyElapsed = visual.motion === "move"
              ? Math.max(0.08, latest.actionDuration) * previewProgress
              : entity.bodyElapsed;
            entity.clipElapsed = reducedMotion
              ? entity.clipDuration
              : entity.clipDuration * previewProgress;
            entity.mixer.update(0);
          }
        };

        const updateEntityCues = (
          entity: MeatGagaEntity,
          unit: MeatGagaRenderUnit,
          visual: MeatGagaVisualState,
          latest: LatestProps,
        ) => {
          if (entity.cueKey !== visual.cueKey) {
            entity.cueKey = visual.cueKey;
            entity.bodyDrawn = false;
            entity.bodyValidated = false;
            entity.bodyElapsed = 0;
            if (visual.motion === "move") {
              const [fromX, fromY] = boardPoint(visual.fromPosition, latest.boardHeightRatio);
              entity.moveFrom.set(fromX, fromY);
            } else {
              entity.moveFrom.copy(entity.currentPosition);
            }
            startAuthoredAction(entity, visual, latest);
          }
          const [toX, toY] = boardPoint(visual.position, latest.boardHeightRatio);
          entity.moveTo.set(toX, toY);
          entity.visual = visual;
          entity.level = unit.level;
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
          if (cancelled || contextLost || renderFailed || !renderer || !camera) return;
          frame = window.requestAnimationFrame(renderFrame);
          if (document.hidden) {
            lastFrame = now;
            return;
          }

          try {
            const latest = latestRef.current;
            const hasAction = latest.units.some((unit) =>
              deriveMeatGagaVisualState(unit, latest.currentEvents, latest.previousSnapshotEvent).motion !== "idle",
            );
            const fps = reducedMotion ? 10 : hasAction && latest.playing ? 48 : 24;
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
              if (unit.heroId !== "meat-gaga" || unit.position === null) continue;
              seen.add(unit.id);
              const visual = deriveMeatGagaVisualState(unit, latest.currentEvents, latest.previousSnapshotEvent);
              let entity = entities.get(unit.id);
              if (!entity) {
                entity = createEntity(unit, visual);
                entities.set(unit.id, entity);
              }
              updateEntityCues(entity, unit, visual, latest);

              entity.bodyElapsed += delta * motionScale;
              entity.clipElapsed += delta * motionScale;
              const actionSeconds = Math.max(0.08, latest.actionDuration);
              const actionProgress = latest.phase === "combat" && !latest.playing && latest.previewing
                ? 0.46
                : Math.min(1, entity.bodyElapsed / actionSeconds);
              if (visual.motion === "move") {
                entity.currentPosition.lerpVectors(entity.moveFrom, entity.moveTo, smoothStep(actionProgress));
              } else {
                const settle = reducedMotion ? 1 : 1 - Math.exp(-delta * Math.max(1, motionScale) * 12);
                entity.currentPosition.lerp(entity.moveTo, settle);
              }

              if (entity.activeAction) {
                const movementFinished = entity.activeMotion === "move" && actionProgress >= 1;
                entity.activeAction.paused = entity.activeMotion === "idle"
                  || reducedMotion
                  || latest.previewing
                  || !latest.playing
                  || movementFinished;
                if (visual.motion === "idle" && entity.clipDuration > 0 && entity.clipElapsed >= entity.clipDuration) {
                  poseEntity(entity);
                }
              }
              entity.mixer.update(delta * motionScale);

              const nextYaw = targetYaw(entity.currentPosition, visual.facingPosition, latest.boardHeightRatio);
              entity.facingYaw = THREE.MathUtils.lerp(
                entity.facingYaw,
                nextYaw,
                reducedMotion ? 1 : 1 - Math.exp(-delta * Math.max(1, motionScale) * 10),
              );
              const pulse = Math.sin(actionProgress * Math.PI);
              const hitShake = visual.isHit ? Math.sin(actionProgress * Math.PI * 7) * (1 - actionProgress) * 0.055 : 0;
              const attackLunge = visual.motion === "attack" ? pulse * 0.12 : 0;
              const harvestPulse = visual.motion === "harvest" ? pulse : 0;
              const deathProgress = visual.motion === "death" ? smoothStep(actionProgress) : 0;
              const idleBob = reducedMotion ? 0 : Math.sin(elapsed * 2.3 + entity.seed) * 0.012;

              entity.root.position.x = entity.currentPosition.x + Math.sin(entity.facingYaw) * attackLunge + hitShake;
              entity.root.position.y = entity.currentPosition.y + idleBob - deathProgress * 0.18;
              entity.root.position.z = Math.floor(unit.position / BOARD_COLUMNS) * 0.015;
              entity.modelPivot.rotation.set(0, entity.facingYaw, deathProgress * 1.18 + hitShake * 2.6);
              entity.modelPivot.position.set(0, harvestPulse * 0.035, 0);
              const baseScale = 0.9 + Math.min(0.08, Math.max(0, entity.level - 1) * 0.016);
              entity.root.scale.setScalar(baseScale * (1 + harvestPulse * 0.06 - deathProgress * 0.12));
              entity.bodyMaterials.forEach(({ material, baseEmissiveIntensity, baseOpacity }) => {
                material.emissiveIntensity = baseEmissiveIntensity + harvestPulse * 0.7 + Math.abs(hitShake) * 2.4;
                material.opacity = baseOpacity * (1 - deathProgress * 0.72);
              });
            }

            for (const [id, entity] of entities) {
              if (!seen.has(id)) {
                disposeEntity(entity);
                entities.delete(id);
              }
            }

            renderer.render(scene, camera);
            const pendingEntities = [...entities.values()].filter((entity) => !entity.bodyValidated);
            for (const entity of pendingEntities) {
              if (!hasRenderableBody(entity)) {
                throw new Error("Meat Gaga did not produce a renderable body");
              }
              entity.bodyValidated = true;
            }
            if (!ready && entities.size > 0) {
              ready = true;
              callbacksRef.current.onReady?.();
            }
          } catch {
            renderFailed = true;
            ready = false;
            window.cancelAnimationFrame(frame);
            fallback("initialization-failed");
            try {
              renderer.clear();
            } catch {
              // The fallback portrait is already restored if the context is failing.
            }
          }
        };

        const handleContextLost = (event: Event) => {
          event.preventDefault();
          contextLost = true;
          ready = false;
          window.cancelAnimationFrame(frame);
          fallback("context-lost");
        };
        canvas.addEventListener("webglcontextlost", handleContextLost);
        frame = window.requestAnimationFrame(renderFrame);

        disposeScene = () => {
          canvas.removeEventListener("webglcontextlost", handleContextLost);
          for (const entity of entities.values()) disposeEntity(entity);
          entities.clear();
          groundGeometry.dispose();
          disposeRigTemplate();
          renderer?.dispose();
        };
        cleanupFailedInitialization = () => {};
      } catch {
        cleanupFailedInitialization();
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
      callbacksRef.current.onDisposed?.();
    };
  }, []);

  return (
    <div
      className="meat-gaga-3d-layer"
      data-testid="meat-gaga-3d-layer"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      <canvas
        ref={canvasRef}
        data-testid="meat-gaga-3d-canvas"
        role="presentation"
        tabIndex={-1}
      />
    </div>
  );
}
