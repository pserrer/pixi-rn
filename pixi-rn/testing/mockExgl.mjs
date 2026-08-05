// ── An EXGL-faithful mock WebGL context ──────────────────────────────────────
// Not a WebGL implementation: nothing rasterizes. It reproduces the SHAPE of
// expo-gl's JS surface precisely enough that pixi's renderer construction and
// first frame execute the same branches they do on device. The three things it
// is deliberately faithful about are the ones that have actually broken this
// game:
//
//  1. THE PROTOTYPE CHAIN. expo-gl makes `WebGL2RenderingContext` extend
//     `WebGLRenderingContext` (EXWebGLRenderer.cpp: "gives `instanceof
//     WebGLRenderingContext` the right answer for WebGL2 instances"), which a
//     browser does NOT — there the two interfaces are unrelated. Pixi v8 asks
//     `gl instanceof DOMAdapter.get().getWebGLRenderingContext()` to mean "is
//     this a WebGL1 context", so on expo-gl that question answers YES for a
//     WebGL2 context unless the adapter compensates.
//  2. `getExtension()` RETURNS A BARE `{}`. EXGL has no extension objects: it
//     returns an empty object for any name in `getSupportedExtensions()`
//     (EXWebGLMethodsDraw.cpp). So `OES_vertex_array_object` is truthy but has
//     no `createVertexArrayOES`, and pixi's WebGL1 path installs
//     `gl.createVertexArray = () => ext.createVertexArrayOES()` from it — a
//     TypeError on the first draw, long after construction "succeeded".
//  3. `getParameter()` THROWS for the object-binding pnames EXGL never
//     implemented, and a list of methods throw "isn't implemented yet!".
//
// Everything else is a plausible stand-in. Shader reflection is real, though:
// programs are reflected by PARSING the GLSL that was attached to them, so the
// uniform/attribute names pixi looks up are the ones its shader generator
// actually emitted.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GL = require('./glConstants.json');

// getParameter pnames EXGL rejects outright — every one is a "which object is
// bound" query (EXWebGLMethods.cpp's "Unimplemented..." case list).
const GET_PARAMETER_UNSUPPORTED = [
  'COPY_READ_BUFFER_BINDING', 'COPY_WRITE_BUFFER_BINDING', 'DRAW_FRAMEBUFFER_BINDING',
  'READ_FRAMEBUFFER_BINDING', 'RENDERBUFFER_BINDING', 'SAMPLER_BINDING',
  'TEXTURE_BINDING_2D_ARRAY', 'TEXTURE_BINDING_2D', 'TEXTURE_BINDING_3D',
  'TEXTURE_BINDING_CUBE_MAP', 'TRANSFORM_FEEDBACK_BINDING',
  'TRANSFORM_FEEDBACK_BUFFER_BINDING', 'UNIFORM_BUFFER_BINDING', 'VERTEX_ARRAY_BINDING',
];

// UNIMPL_NATIVE_METHOD in expo-gl's common/*.cpp — these throw when called.
const UNIMPLEMENTED_METHODS = [
  'clientWaitSync', 'compressedTexImage2D', 'compressedTexImage3D', 'compressedTexSubImage2D',
  'compressedTexSubImage3D', 'deleteSync', 'fenceSync', 'getActiveUniformBlockParameter',
  'getBufferSubData', 'getFramebufferAttachmentParameter', 'getRenderbufferParameter',
  'getSyncParameter', 'getTexParameter', 'getUniform', 'getVertexAttrib',
  'getVertexAttribOffset', 'isSync', 'renderbufferStorageMultisample', 'waitSync',
];

// What an Adreno/Mali ES3 device reports, after the two transforms EXGL applies
// (EXGLNativeContext.cpp `maybeReadAndCacheSupportedExtensions`): the driver's
// `GL_` prefix is stripped, and `OES_vertex_array_object` is EXPLICITLY removed
// from the set even when the driver advertises it. That omission is why pixi's
// WebGL1 path cannot work here at all — it hard-requires that extension object.
const SUPPORTED_EXTENSIONS = [
  'ANGLE_instanced_arrays',
  'OES_element_index_uint', 'OES_texture_float', 'OES_texture_half_float',
  'OES_texture_float_linear', 'OES_texture_half_float_linear',
  'EXT_texture_filter_anisotropic', 'WEBGL_compressed_texture_etc',
  'WEBGL_compressed_texture_astc',
  'EXT_sRGB', 'WEBGL_depth_texture', 'WEBGL_draw_buffers',
];

const PARAMETER_VALUES = {
  MAX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
  MAX_VERTEX_ATTRIBS: 16,
  MAX_TEXTURE_SIZE: 8192,
  MAX_UNIFORM_BUFFER_BINDINGS: 24,
  MAX_SAMPLES: 4,
  VERSION: 'OpenGL ES 3.2 v1.r32p1',
  SHADING_LANGUAGE_VERSION: 'OpenGL ES GLSL ES 3.20',
  VENDOR: 'ARM',
  RENDERER: 'Mali-G78',
  SCISSOR_BOX: new Int32Array([0, 0, 1080, 2340]),
  VIEWPORT: new Int32Array([0, 0, 1080, 2340]),
};

const GL_TYPE_BY_GLSL = {
  float: 'FLOAT', vec2: 'FLOAT_VEC2', vec3: 'FLOAT_VEC3', vec4: 'FLOAT_VEC4',
  int: 'INT', ivec2: 'INT_VEC2', ivec3: 'INT_VEC3', ivec4: 'INT_VEC4',
  uint: 'UNSIGNED_INT', uvec2: 'UNSIGNED_INT_VEC2', uvec3: 'UNSIGNED_INT_VEC3', uvec4: 'UNSIGNED_INT_VEC4',
  bool: 'BOOL', mat2: 'FLOAT_MAT2', mat3: 'FLOAT_MAT3', mat4: 'FLOAT_MAT4',
  sampler2D: 'SAMPLER_2D', samplerCube: 'SAMPLER_CUBE', sampler2DArray: 'SAMPLER_2D_ARRAY',
};

const nameByValue = new Map(Object.entries(GL).map(([name, value]) => [value, name]));

/** Strip comments and preprocessor lines so declarations parse cleanly. */
function stripGlslNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/^[ \t]*#[^\n]*$/gm, '');
}

/**
 * Reflect a linked program by reading the GLSL that was attached to it, the way
 * a driver would. Handles both shapes pixi emits: ES 3.00 (`in`/`out`) and the
 * WebGL1 fallback, which still writes `in` and remaps it with `#define`.
 */
function reflectProgram(vertexSrc, fragmentSrc) {
  const attributes = [];
  const uniforms = [];
  const seenUniform = new Set();

  const declRe = /\b(attribute|in|uniform)\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*(\[\s*(\d+)\s*\])?\s*;/g;
  const scan = (src, isVertex) => {
    const clean = stripGlslNoise(src);
    for (const match of clean.matchAll(declRe)) {
      const [, qualifier, glslType, name, , arraySize] = match;
      const type = GL_TYPE_BY_GLSL[glslType];
      if (!type) continue;                 // struct / interface block member
      const size = arraySize ? Number(arraySize) : 1;
      if (qualifier === 'uniform') {
        if (seenUniform.has(name)) continue;
        seenUniform.add(name);
        uniforms.push({ name: arraySize ? `${name}[0]` : name, type: GL[type], size });
      } else if (isVertex && qualifier !== 'uniform') {
        attributes.push({ name, type: GL[type], size });
      }
    }
  };
  scan(vertexSrc, true);
  scan(fragmentSrc, false);
  return { attributes, uniforms };
}

class GlObject {
  constructor(kind, id) { this.kind = kind; this.id = id; }
}

export function createMockExglContext(options = {}) {
  const {
    supportsWebGL2 = true,
    drawingBufferWidth = 1080,
    drawingBufferHeight = 2340,
    onCall = null,
  } = options;

  // expo-gl installs these as real globals before any context callback runs,
  // WITH the spec's static constants on the constructor, and with WebGL2
  // extending WebGL1 (see the header note).
  class WebGLRenderingContext {}
  class WebGL2RenderingContext extends WebGLRenderingContext {}
  for (const [name, value] of Object.entries(GL)) {
    WebGLRenderingContext[name] = value;
    WebGLRenderingContext.prototype[name] = value;
  }
  globalThis.WebGLRenderingContext = WebGLRenderingContext;
  globalThis.WebGL2RenderingContext = WebGL2RenderingContext;

  const calls = [];
  let nextId = 1;
  const shaderSources = new Map();
  const programShaders = new Map();
  const programReflection = new Map();

  const record = (name, args) => {
    calls.push({ name, args });
    onCall?.(name, args);
  };

  const gl = new (supportsWebGL2 ? WebGL2RenderingContext : WebGLRenderingContext)();
  gl.drawingBufferWidth = drawingBufferWidth;
  gl.drawingBufferHeight = drawingBufferHeight;
  gl.supportsWebGL2 = supportsWebGL2;
  gl.contextId = 1;

  const reflect = (program) => {
    let data = programReflection.get(program);
    if (!data) {
      const attached = programShaders.get(program) ?? [];
      const vertex = attached.map((s) => shaderSources.get(s) ?? '').find((_, i) => attached[i].kind === 'vertex') ?? '';
      const fragment = attached.map((s) => shaderSources.get(s) ?? '').find((_, i) => attached[i].kind === 'fragment') ?? '';
      data = reflectProgram(vertex, fragment);
      programReflection.set(program, data);
    }
    return data;
  };

  const impl = {
    getContextAttributes: () => ({
      alpha: true, antialias: false, depth: true, stencil: true,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false, powerPreference: 'default',
    }),
    isContextLost: () => false,
    getError: () => GL.NO_ERROR,
    getSupportedExtensions: () => [...SUPPORTED_EXTENSIONS],
    getExtension: (name) => {
      if (!SUPPORTED_EXTENSIONS.includes(name)) return null;
      // EXGL returns a BARE object — no extension entry points on it.
      if (name === 'EXT_texture_filter_anisotropic') {
        return {
          TEXTURE_MAX_ANISOTROPY_EXT: GL.TEXTURE_MAX_ANISOTROPY_EXT,
          MAX_TEXTURE_MAX_ANISOTROPY_EXT: GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
        };
      }
      return {};
    },
    getParameter: (pname) => {
      const name = nameByValue.get(pname);
      if (name && GET_PARAMETER_UNSUPPORTED.includes(name)) {
        throw new Error(`EXGL: getParameter() doesn't support gl.${pname} yet!`);
      }
      if (name && name in PARAMETER_VALUES) return PARAMETER_VALUES[name];
      return 0;
    },

    createShader: (type) => new GlObject(type === GL.VERTEX_SHADER ? 'vertex' : 'fragment', nextId++),
    shaderSource: (shader, source) => { shaderSources.set(shader, source); },
    compileShader: () => {},
    getShaderParameter: (_shader, pname) => (pname === GL.COMPILE_STATUS ? true : 0),
    getShaderInfoLog: () => '',
    getShaderSource: (shader) => shaderSources.get(shader) ?? '',
    deleteShader: () => {},

    createProgram: () => new GlObject('program', nextId++),
    attachShader: (program, shader) => {
      const list = programShaders.get(program) ?? [];
      list.push(shader);
      programShaders.set(program, list);
    },
    linkProgram: () => {},
    getProgramParameter: (program, pname) => {
      if (pname === GL.LINK_STATUS) return true;
      if (pname === GL.ACTIVE_UNIFORMS) return reflect(program).uniforms.length;
      if (pname === GL.ACTIVE_ATTRIBUTES) return reflect(program).attributes.length;
      if (pname === GL.ACTIVE_UNIFORM_BLOCKS) return 0;
      return 0;
    },
    getProgramInfoLog: () => '',
    getActiveUniform: (program, index) => reflect(program).uniforms[index] ?? null,
    getActiveAttrib: (program, index) => reflect(program).attributes[index] ?? null,
    getUniformLocation: (_program, name) => new GlObject(`uniform:${name}`, nextId++),
    getAttribLocation: (program, name) => {
      const index = reflect(program).attributes.findIndex((a) => a.name === name);
      return index;
    },

    createBuffer: () => new GlObject('buffer', nextId++),
    createTexture: () => new GlObject('texture', nextId++),
    createFramebuffer: () => new GlObject('framebuffer', nextId++),
    createRenderbuffer: () => new GlObject('renderbuffer', nextId++),
    createVertexArray: () => new GlObject('vao', nextId++),
    createSampler: () => new GlObject('sampler', nextId++),
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE,
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
  };

  // Everything EXGL exposes but that returns nothing interesting — installed as
  // recorded no-ops so a call to a method the real context lacks still fails
  // exactly the way it would on device (undefined is not a function).
  const NO_OP_METHODS = [
    'activeTexture', 'attachShader', 'bindAttribLocation', 'bindBuffer', 'bindBufferBase',
    'bindBufferRange', 'bindFramebuffer', 'bindRenderbuffer', 'bindSampler', 'bindTexture',
    'bindTransformFeedback', 'bindVertexArray', 'blendColor', 'blendEquation',
    'blendEquationSeparate', 'blendFunc', 'blendFuncSeparate', 'blitFramebuffer', 'bufferData',
    'bufferSubData', 'clear', 'clearBufferfi', 'clearBufferfv', 'clearBufferiv', 'clearBufferuiv',
    'clearColor', 'clearDepth', 'clearStencil', 'colorMask', 'copyBufferSubData', 'copyTexImage2D',
    'copyTexSubImage2D', 'copyTexSubImage3D', 'cullFace', 'deleteBuffer', 'deleteFramebuffer',
    'deleteProgram', 'deleteQuery', 'deleteRenderbuffer', 'deleteSampler', 'deleteTexture',
    'deleteTransformFeedback', 'deleteVertexArray', 'depthFunc', 'depthMask', 'depthRange',
    'detachShader', 'disable', 'disableVertexAttribArray', 'drawArrays', 'drawArraysInstanced',
    'drawBuffers', 'drawElements', 'drawElementsInstanced', 'drawRangeElements', 'enable',
    'enableVertexAttribArray', 'endFrameEXP', 'finish', 'flush', 'flushEXP',
    'framebufferRenderbuffer', 'framebufferTexture2D', 'framebufferTextureLayer', 'frontFace',
    'generateMipmap', 'hint', 'invalidateFramebuffer', 'invalidateSubFramebuffer', 'lineWidth',
    'pixelStorei', 'polygonOffset', 'readBuffer', 'readPixels', 'renderbufferStorage',
    'sampleCoverage', 'samplerParameterf', 'samplerParameteri', 'scissor', 'stencilFunc',
    'stencilFuncSeparate', 'stencilMask', 'stencilMaskSeparate', 'stencilOp', 'stencilOpSeparate',
    'texImage2D', 'texImage3D', 'texParameterf', 'texParameteri', 'texStorage2D', 'texStorage3D',
    'texSubImage2D', 'texSubImage3D', 'transformFeedbackVaryings', 'uniform1f', 'uniform1fv',
    'uniform1i', 'uniform1iv', 'uniform1ui', 'uniform1uiv', 'uniform2f', 'uniform2fv', 'uniform2i',
    'uniform2iv', 'uniform2ui', 'uniform2uiv', 'uniform3f', 'uniform3fv', 'uniform3i', 'uniform3iv',
    'uniform3ui', 'uniform3uiv', 'uniform4f', 'uniform4fv', 'uniform4i', 'uniform4iv', 'uniform4ui',
    'uniform4uiv', 'uniformBlockBinding', 'uniformMatrix2fv', 'uniformMatrix3fv',
    'uniformMatrix4fv', 'useProgram', 'validateProgram', 'vertexAttrib1f', 'vertexAttrib1fv',
    'vertexAttrib2f', 'vertexAttrib2fv', 'vertexAttrib3f', 'vertexAttrib3fv', 'vertexAttrib4f',
    'vertexAttrib4fv', 'vertexAttribDivisor', 'vertexAttribIPointer', 'vertexAttribPointer',
    'viewport',
  ];

  for (const name of NO_OP_METHODS) {
    if (impl[name]) continue;
    impl[name] = () => {};
  }
  for (const name of ['isBuffer', 'isEnabled', 'isFramebuffer', 'isProgram', 'isQuery',
    'isRenderbuffer', 'isSampler', 'isShader', 'isTexture', 'isTransformFeedback', 'isVertexArray']) {
    impl[name] = () => true;
  }
  for (const name of UNIMPLEMENTED_METHODS) {
    impl[name] = () => { throw new Error(`EXGL: ${name}() isn't implemented yet!`); };
  }

  for (const [name, fn] of Object.entries(impl)) {
    gl[name] = (...args) => {
      record(name, args);
      return fn(...args);
    };
  }

  return { gl, calls, GL, WebGLRenderingContext, WebGL2RenderingContext };
}
