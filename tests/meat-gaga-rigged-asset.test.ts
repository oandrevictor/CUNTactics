import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GLB_URL = new URL(
  "../public/characters/meat-gaga/meat-gaga-animated.glb",
  import.meta.url,
);

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

type GltfAccessor = {
  bufferView?: number;
  count?: number;
  type?: string;
  min?: number[];
  max?: number[];
};

type GltfJson = {
  asset?: { version?: string; generator?: string };
  accessors?: GltfAccessor[];
  animations?: Array<{
    name?: string;
    channels?: Array<{ sampler?: number; target?: { node?: number; path?: string } }>;
    samplers?: Array<{ input?: number; output?: number }>;
  }>;
  buffers?: Array<{ byteLength?: number; uri?: string }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
  images?: Array<{ bufferView?: number; mimeType?: string; uri?: string }>;
  materials?: unknown[];
  meshes?: Array<{
    primitives?: Array<{
      attributes?: Record<string, number>;
      indices?: number;
    }>;
  }>;
  nodes?: Array<{
    name?: string;
    mesh?: number;
    skin?: number;
    translation?: number[];
    scale?: number[];
  }>;
  scenes?: Array<{ nodes?: number[] }>;
  skins?: Array<{ inverseBindMatrices?: number; joints?: number[] }>;
  textures?: unknown[];
};

function parseGlb(bytes: Buffer) {
  assert.ok(bytes.byteLength >= 20, "GLB should include a header and JSON chunk");
  assert.equal(bytes.readUInt32LE(0), GLB_MAGIC);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.byteLength);

  let offset = 12;
  let json: GltfJson | null = null;
  const chunkTypes: number[] = [];
  while (offset < bytes.byteLength) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    offset += 8;
    assert.ok(offset + chunkLength <= bytes.byteLength, "chunk payload should stay inside the GLB");
    const payload = bytes.subarray(offset, offset + chunkLength);
    chunkTypes.push(chunkType);
    if (chunkType === JSON_CHUNK) {
      json = JSON.parse(payload.toString("utf8").replace(/[\u0000\u0020]+$/u, "")) as GltfJson;
    }
    offset += chunkLength;
  }
  assert.equal(offset, bytes.byteLength);
  assert.ok(json);
  return { json, chunkTypes };
}

test("ships Meat Gaga as a self-contained skinned GLB with all authored clips", async () => {
  const bytes = await readFile(GLB_URL);
  const { json: gltf, chunkTypes } = parseGlb(bytes);

  assert.ok(bytes.byteLength > 10 * 1024 * 1024, "the complete skinned mesh and animations should remain embedded");
  assert.ok(bytes.byteLength < 25 * 1024 * 1024, "the deployed GLB must stay under the static-asset limit");
  assert.equal(chunkTypes[0], JSON_CHUNK);
  assert.ok(chunkTypes.includes(BIN_CHUNK));
  assert.equal(gltf.asset?.version, "2.0");
  assert.equal(gltf.scenes?.length, 1);
  assert.equal(gltf.meshes?.length, 1);
  assert.equal(gltf.materials?.length, 1);
  assert.equal(gltf.skins?.length, 1);
  assert.equal(gltf.images?.length, 1);
  assert.equal(gltf.textures?.length, 2);
  assert.ok(gltf.buffers?.every((buffer) => !buffer.uri), "all geometry should remain embedded");
  assert.ok(gltf.images?.every((image) => !image.uri && image.mimeType === "image/jpeg" && typeof image.bufferView === "number"));
  const embeddedBufferLength = gltf.buffers?.[0]?.byteLength ?? 0;
  for (const view of gltf.bufferViews ?? []) {
    assert.ok((view.byteOffset ?? 0) + (view.byteLength ?? 0) <= embeddedBufferLength, "every optimized buffer view should remain in bounds");
  }
  const imageView = gltf.bufferViews?.[gltf.images![0].bufferView!];
  assert.ok((imageView?.byteLength ?? Infinity) < 3 * 1024 * 1024, "the board texture should stay web-sized");

  const skin = gltf.skins![0];
  const joints = skin.joints ?? [];
  assert.equal(joints.length, 24);
  assert.equal(new Set(joints).size, 24);
  const nodes = gltf.nodes ?? [];
  const armature = nodes.find((node) => node.name === "Armature");
  const hips = nodes.find((node) => node.name === "Hips");
  assert.ok(armature?.scale?.every((value) => Math.abs(value - 0.01) < 1e-6));
  assert.ok((hips?.translation?.[1] ?? 0) > 90, "the authored rest pose keeps centimeter-scale joint coordinates");
  const jointNames = joints.map((jointIndex) => nodes[jointIndex]?.name);
  assert.ok(jointNames.every((name) => typeof name === "string" && name.length > 0));
  assert.equal(new Set(jointNames).size, 24);
  assert.equal(typeof skin.inverseBindMatrices, "number");
  const inverseBindAccessor = gltf.accessors?.[skin.inverseBindMatrices!];
  assert.equal(inverseBindAccessor?.type, "MAT4");
  assert.equal(inverseBindAccessor?.count, 24);

  const skinnedMesh = nodes.find((node) => node.skin === 0 && typeof node.mesh === "number");
  assert.ok(skinnedMesh);
  const primitive = gltf.meshes?.[skinnedMesh.mesh!]?.primitives?.[0];
  assert.ok(primitive);
  for (const attribute of ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]) {
    assert.equal(typeof primitive.attributes?.[attribute], "number", `${attribute} should be present`);
  }
  assert.equal(typeof primitive.indices, "number");
  assert.equal(gltf.accessors?.[primitive.attributes!.POSITION]?.count, 219269);
  assert.equal(gltf.accessors?.[primitive.indices!]?.count, 308508);

  const expectedDurations = new Map([
    ["Alert", 4],
    ["Female_Crouch_Pick_Throw_Forward", 4.9],
    ["Running", 0.6333333333333333],
    ["Walking", 1.0333333333333334],
  ]);
  assert.deepEqual(gltf.animations?.map((animation) => animation.name), [...expectedDurations.keys()]);
  for (const animation of gltf.animations ?? []) {
    assert.equal(animation.channels?.length, 72, `${animation.name} should animate all joint transforms`);
    assert.equal(animation.samplers?.length, 72);
    const paths = new Set(animation.channels?.map((channel) => channel.target?.path));
    assert.deepEqual(paths, new Set(["translation", "rotation", "scale"]));
    const animatedNodes = new Set(animation.channels?.map((channel) => channel.target?.node));
    assert.equal(animatedNodes.size, 24);
    const duration = Math.max(...(animation.samplers ?? []).map((sampler) => {
      assert.equal(typeof sampler.input, "number");
      assert.equal(typeof sampler.output, "number");
      return gltf.accessors?.[sampler.input!]?.max?.[0] ?? 0;
    }));
    assert.ok(Math.abs(duration - expectedDurations.get(animation.name!)!) < 1e-9);
  }
});
