import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GLB_URL = new URL(
  "../public/characters/boitata/boitata-rigged.glb",
  import.meta.url,
);

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

type GltfNode = {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
};

type GltfJson = {
  asset?: { version?: string; generator?: string };
  accessors?: Array<{ count?: number; type?: string }>;
  buffers?: Array<{ byteLength?: number }>;
  images?: Array<{ bufferView?: number; mimeType?: string }>;
  materials?: Array<{
    emissiveTexture?: { index?: number };
    normalTexture?: { index?: number };
    pbrMetallicRoughness?: {
      baseColorTexture?: { index?: number };
      metallicRoughnessTexture?: { index?: number };
    };
  }>;
  meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }>;
  nodes?: GltfNode[];
  scenes?: Array<{ nodes?: number[] }>;
  skins?: Array<{
    name?: string;
    inverseBindMatrices?: number;
    joints?: number[];
    skeleton?: number;
  }>;
  textures?: Array<{ source?: number }>;
};

type ParsedGlb = {
  json: GltfJson;
  chunkTypes: number[];
  declaredLength: number;
  actualLength: number;
};

function parseGlb(bytes: Buffer): ParsedGlb {
  assert.ok(bytes.byteLength >= 20, "GLB should contain a header and JSON chunk");
  assert.equal(bytes.readUInt32LE(0), GLB_MAGIC, "GLB magic should be `glTF`");
  assert.equal(bytes.readUInt32LE(4), 2, "asset should use the GLB 2.0 container");

  const declaredLength = bytes.readUInt32LE(8);
  assert.equal(declaredLength, bytes.byteLength, "header length should match the shipped file");

  let offset = 12;
  let json: GltfJson | null = null;
  const chunkTypes: number[] = [];
  while (offset < bytes.byteLength) {
    assert.ok(offset + 8 <= bytes.byteLength, "chunk header should fit within the GLB");
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    offset += 8;
    assert.ok(offset + chunkLength <= bytes.byteLength, "chunk payload should fit within the GLB");
    const payload = bytes.subarray(offset, offset + chunkLength);
    chunkTypes.push(chunkType);
    if (chunkType === JSON_CHUNK) {
      const text = payload.toString("utf8").replace(/[\u0000\u0020]+$/u, "");
      json = JSON.parse(text) as GltfJson;
    }
    offset += chunkLength;
  }

  assert.equal(offset, bytes.byteLength, "all GLB bytes should belong to declared chunks");
  assert.ok(json, "GLB should contain a JSON metadata chunk");
  return { json, chunkTypes, declaredLength, actualLength: bytes.byteLength };
}

test("ships the updated textured GLB 2.0 with one fourteen-joint skin", async () => {
  const parsed = parseGlb(await readFile(GLB_URL));
  const gltf = parsed.json;

  assert.equal(parsed.declaredLength, parsed.actualLength);
  assert.equal(parsed.chunkTypes[0], JSON_CHUNK, "JSON metadata should be the first chunk");
  assert.ok(parsed.chunkTypes.includes(BIN_CHUNK), "geometry should be embedded in the GLB binary chunk");
  assert.equal(gltf.asset?.version, "2.0");
  assert.equal(gltf.skins?.length, 1, "Boitata should ship as one coherent rig");
  assert.ok((gltf.meshes?.length ?? 0) >= 1, "Boitata should contain renderable geometry");
  assert.ok((gltf.scenes?.length ?? 0) >= 1, "Boitata should expose a default scene graph");

  const skin = gltf.skins![0];
  const joints = skin.joints ?? [];
  assert.equal(joints.length, 14, "the updated production rig should expose fourteen joints");
  assert.equal(new Set(joints).size, 14, "every skin joint should be unique");

  const nodes = gltf.nodes ?? [];
  const jointNames = joints.map((jointIndex) => {
    assert.ok(jointIndex >= 0 && jointIndex < nodes.length, `joint ${jointIndex} should reference a node`);
    return nodes[jointIndex].name;
  });
  assert.ok(jointNames.every((name) => typeof name === "string" && name.length > 0), "all joints should be named for runtime lookup");
  assert.equal(new Set(jointNames).size, 14, "joint names should be unique");

  assert.equal(typeof skin.inverseBindMatrices, "number", "skin should reference inverse bind matrices");
  const inverseBindAccessor = gltf.accessors?.[skin.inverseBindMatrices!];
  assert.equal(inverseBindAccessor?.type, "MAT4");
  assert.equal(inverseBindAccessor?.count, 14);

  assert.equal(gltf.materials?.length, 1, "the updated creature should retain its authored material");
  assert.equal(gltf.textures?.length, 4, "base color, emissive, normal, and surface maps should be embedded");
  assert.equal(gltf.images?.length, 4);
  assert.ok(gltf.images?.every((image) => image.mimeType === "image/jpeg" && typeof image.bufferView === "number"));
  const material = gltf.materials![0];
  assert.equal(material.pbrMetallicRoughness?.baseColorTexture?.index, 2);
  assert.equal(material.emissiveTexture?.index, 0);
  assert.equal(material.normalTexture?.index, 1);
  assert.equal(material.pbrMetallicRoughness?.metallicRoughnessTexture?.index, 3);

  const skinnedMeshNodes = nodes.filter((node) => node.skin === 0 && typeof node.mesh === "number");
  assert.ok(skinnedMeshNodes.length >= 1, "a scene node should bind the mesh to the fourteen-joint skin");
  for (const node of skinnedMeshNodes) {
    const mesh = gltf.meshes?.[node.mesh!];
    assert.ok(mesh, "skinned node should reference an existing mesh");
    assert.ok((mesh.primitives?.length ?? 0) >= 1, "mesh should contain at least one primitive");
    assert.ok(mesh.primitives?.some((primitive) => typeof primitive.attributes?.POSITION === "number"), "mesh should provide vertex positions");
  }
});

test("the shared board renderer loads and safely clones the rigged GLB", async () => {
  const source = await readFile(new URL("../app/boitata-3d-layer.tsx", import.meta.url), "utf8");

  assert.match(source, /GLTFLoader/);
  assert.match(source, /three\/examples\/jsm\/loaders\/GLTFLoader\.js/);
  assert.match(source, /SkeletonUtils/);
  assert.match(source, /three\/examples\/jsm\/utils\/SkeletonUtils\.js/);
  assert.match(source, /\/characters\/boitata\/boitata-rigged\.glb/);
  assert.match(source, /(?:loadAsync|\.load\s*\()/);
  assert.match(source, /(?:SkeletonUtils\.)?clone\s*\(/);
  assert.match(source, /material instanceof THREE\.MeshStandardMaterial/);
  assert.match(source, /material\.clone\(\)/, "the renderer should preserve the GLB's embedded texture maps");
  assert.match(source, /templateTextures/);
  assert.match(source, /texture\.dispose\(\)/, "embedded texture memory should be released when the layer unmounts");

  assert.equal(source.match(/<canvas\b/g)?.length, 1, "all Boitatas should share one transparent canvas");
});

test("the rig is driven by combat cues while retaining the PNG fallback", async () => {
  const [layer, client, engine] = await Promise.all([
    readFile(new URL("../app/boitata-3d-layer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8"),
  ]);

  assert.match(layer, /deriveBoitataVisualState/);
  assert.match(layer, /(?:isBone|\bBone\b)/);
  assert.match(layer, /\b(?:rigBones|bones|joints)\b/);
  assert.match(layer, /\b(?:bone|joint)\w*\.(?:rotation|quaternion|position)\b/);
  assert.match(layer, /visual\.motion/);
  for (const cue of ["move", "attack", "cast", "hit", "death"]) {
    assert.match(layer, new RegExp(`["']${cue}["']`), `rig should respond to the ${cue} body cue`);
  }

  assert.equal(client.match(/<Boitata3DLayer\b/g)?.length, 1, "GameClient should mount one shared 3D layer");
  assert.match(client, /onReady=\{\(\) => setBoitata3DReady\(true\)\}/);
  assert.match(client, /onFallback=\{\(\) => setBoitata3DReady\(false\)\}/);
  assert.match(client, /boitata3DReady/);
  assert.match(engine, /portrait:\s*["']\/characters\/boitata\.png["']/);
  assert.match(layer, /onFallback\?/);
  assert.match(layer, /webglcontextlost/);
});
