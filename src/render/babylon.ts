// The slice of Babylon.js the game uses, imported by path so the bundle only
// carries what it needs. Side-effect imports register scene components.
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Layers/effectLayerSceneComponent';

export { Engine } from '@babylonjs/core/Engines/engine';
export { Scene } from '@babylonjs/core/scene';
export { Camera } from '@babylonjs/core/Cameras/camera';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { PointLight } from '@babylonjs/core/Lights/pointLight';
export { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
export { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export { Effect } from '@babylonjs/core/Materials/effect';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
export { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
export type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
