// Show an error dialog if there's any uncaught exception or promise rejection.
globalThis.addEventListener('unhandledrejection', (ev) => {
    fail(`unhandled promise rejection, please report a bug!
  https://github.com/webgpu/webgpu-samples/issues/new\n${ev.reason}`);
});

globalThis.addEventListener('error', (ev) => {
    fail(`uncaught exception, please report a bug!
  https://github.com/webgpu/webgpu-samples/issues/new\n${ev.error}`);
});

function fail(error) {
  const errorInfo = {
    message: error?.message || String(error),
    stack: error?.stack || new Error().stack,
    type: error?.constructor?.name || typeof error
  };
  console.error('[WebGPU Fatal]', errorInfo);
  throw typeof error === 'object' ? error : new Error(error);
}

/** Shows an error dialog if getting an adapter wasn't successful. */
function quitIfAdapterNotAvailable(adapter) {
    if (!('gpu' in navigator)) {
        fail('navigator.gpu is not defined - WebGPU not available in this browser');
    }
    if (!adapter) {
        fail("requestAdapter returned null - this sample can't run on this system");
    }
}

/**
 * Shows an error dialog if getting a adapter or device wasn't successful,
 * or if/when the device is lost or has an uncaptured error.
 */
function quitIfWebGPUNotAvailable(adapter, device) {
    if (!device) {
        quitIfAdapterNotAvailable(adapter);
        fail('Unable to get a device for an unknown reason');
        return;
    }
    device.lost.then((reason) => {
        fail(`Device lost ("${reason.reason}"):\n${reason.message}`);
    });
    device.addEventListener('uncapturederror', (ev) => {
        fail(`Uncaptured error:\n${ev.error.message}`);
    });
}

/** Load shader from external WGSL file */
async function loadShaderFromFile(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to load shader: ${path}`);
        }
        return await response.text();
    } catch (error) {
        fail(`Error loading shader from ${path}: ${error.message}`);
        throw error;
    }
}

// Helper to map WGSL types to WebGPU formats
function typeToFormat(type) {
  const typeMap = {
    'f32': 'float32',
    'vec2f': 'float32x2',
    'vec3f': 'float32x3',
    'vec4f': 'float32x4',
    'i32': 'sint32',
    'vec2i': 'sint32x2',
    'vec3i': 'sint32x3',
    'vec4i': 'sint32x4',
    'u32': 'uint32',
    'vec2u': 'uint32x2',
    'vec3u': 'uint32x3',
    'vec4u': 'uint32x4'
  };
  return typeMap[type] || 'float32';
}

// Helper to calculate format size in bytes
function formatSize(format) {
  const match = format.match(/(\d+)x(\d+)/);
  if (match) {
    return parseInt(match[1]) * parseInt(match[2]) * 4;
  }
  return 4; // Default to 4 bytes for single values
}

// Helper function to get type sizes
function typeToSize(type) {
  const sizes = {
    'f32': 4,
    'vec2f': 8,
    'vec3f': 12,
    'vec4f': 16
  };
  return sizes[type] || 0;
}

// Parse shader code to extract vertex input attributes only
function parseShaderLocations(shaderCode) {
  console.log('[Pipeline Utils] Parsing @vertex function parameters');
  
  // Improved regex to capture full parameter list
  const vertexFnMatch = /@vertex[\s\S]*?fn\s+\w+\s*\(([\s\S]*?)\)\s*(?:->|\{)/m.exec(shaderCode);
  
  if (!vertexFnMatch) {
    console.warn('[Pipeline Utils] ⚠️ No @vertex function found');
    return [];
  }
  
  const rawParams = vertexFnMatch[1].replace(/\/\*.*?\*\//gs, ''); // Remove comments
  console.log('[Pipeline Utils] Raw parameters:\n' + rawParams);

  // Enhanced parameter parsing
  const paramRegex = /@location\((\d+)\)\s+([a-zA-Z_][\w]*)\s*:\s*([a-zA-Z0-9_]+)/g;
  const locations = [];
  
  let match;
  while ((match = paramRegex.exec(rawParams)) !== null) {
    const loc = parseInt(match[1]);
    locations.push({
      location: loc,
      name: match[2],
      type: match[3],
      bytesPerElement: typeToSize(match[3])
    });
    console.log(`📍 Found attribute: loc=${loc}, name=${match[2]}, type=${match[3]}`);
  }
  
  console.log('[Pipeline Utils][Debug] Complete extracted attributes:', JSON.stringify(locations, null, 2));
  
  if (locations.length === 0) {
    console.warn('[Pipeline Utils] ❌ No @location attributes found');
  }
  
  return locations.sort((a, b) => a.location - b.location);
}

// Generate buffer layouts based solely on parsed vertex attributes
function generateBufferLayouts(locations) {
  console.log('[Pipeline Utils] Generating buffer layouts from:', 
    locations.map(l => `${l.name}@${l.location}`));

  // Validate we have exactly 3 locations (0,1,2)
  const expectedLocations = [0, 1, 2];
  const actualLocations = locations.map(l => l.location);
  if (!expectedLocations.every(l => actualLocations.includes(l))) {
    throw new Error(`Missing required vertex attributes. Expected locations ${expectedLocations}, found ${actualLocations}`);
  }

  // Instance buffer (locations 0-1)
  const instanceAttrs = locations.filter(l => l.location < 2);
  const instanceBuffer = {
    arrayStride: 16, // 2 x vec2f
    stepMode: 'instance',
    attributes: instanceAttrs.map(attr => ({
      shaderLocation: attr.location,
      offset: attr.location * 8, // 8 bytes per vec2f
      format: 'float32x2'
    }))
  };

  // Vertex buffer (location 2)
  const vertexBuffer = {
    arrayStride: 8, // 1 x vec2f
    stepMode: 'vertex',
    attributes: [{
      shaderLocation: 2,
      offset: 0,
      format: 'float32x2'
    }]
  };

  console.log('[Pipeline Utils] Generated buffers:', {
    instance: instanceBuffer,
    vertex: vertexBuffer
  });
  
  return [instanceBuffer, vertexBuffer];
}

// Store metadata for pipelines without modifying them
const pipelineMetadata = new WeakMap();

// Helper to get pipeline type
function getPipelineType(pipeline) {
  return pipelineMetadata.get(pipeline)?.type || 'unknown';
}

// Helper to get pipeline buffers safely
function getPipelineBuffers(pipeline) {
  return pipelineMetadata.get(pipeline)?.buffers || [];
}

// Parse shader code to find entry point names for each stage
function parseEntryPoints(shaderCode, type) {
  const vertexMatch = type === 'render' ? /@vertex\s+fn\s+([^\s(]+)/.exec(shaderCode) : null;
  const fragmentMatch = type === 'render' ? /@fragment\s+fn\s+([^\s(]+)/.exec(shaderCode) : null;
  const computeMatch = type === 'compute' ? /@compute[^]*?fn\s+([^\s(]+)/.exec(shaderCode) : null;

  if (type === 'compute' && !computeMatch) {
    console.error('[Pipeline Utils] Compute shader code:', shaderCode);
    throw new Error('Compute shader must contain @compute entry point');
  }
  if (type === 'render' && (!vertexMatch || !fragmentMatch)) {
    throw new Error('Render shader must contain both @vertex and @fragment entry points');
  }

  return {
    vertex: vertexMatch?.[1] || null,
    fragment: fragmentMatch?.[1] || null,
    compute: computeMatch?.[1] || null
  };
}

async function createPipeline(device, { type, shaderPath, presentationFormat }) {
  try {
    const code = await loadShaderFromFile(shaderPath);
    console.log(`[Pipeline Utils] Loaded shader from ${shaderPath}`);

    const entries = parseEntryPoints(code, type);
    
    const shaderModule = device.createShaderModule({ 
      code,
      label: `${type} shader module`
    });

    if (type === 'compute') {
      // Create compute pipeline (return original WebGPU object)
      const pipeline = await device.createComputePipelineAsync({
        layout: 'auto',
        label: `${shaderPath} compute pipeline`,
        compute: {
          module: shaderModule,
          entryPoint: entries.compute
        }
      });
      
      console.log('[Pipeline Utils][Compute] Pipeline created successfully');
      
      // Store metadata separately
      pipelineMetadata.set(pipeline, { type: 'compute' });
      
      // Return original pipeline object
      return pipeline;
    }
    
    // Render pipeline specific setup
    console.log('[Pipeline Utils][Render] Creating pipeline with entries:', 
      `${entries.vertex} (vertex), ${entries.fragment} (fragment)`);
    
    const locations = parseShaderLocations(code);
    if (!locations.length) {
      throw new Error('No vertex attributes found in shader');
    }
    
    const buffers = generateBufferLayouts(locations);
    if (!buffers || !buffers.length) {
      throw new Error('Failed to generate buffer layouts');
    }

    // Create render pipeline (return original WebGPU object)
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: entries.vertex,
        buffers
      },
      fragment: {
        module: shaderModule,
        entryPoint: entries.fragment,
        targets: [{ format: presentationFormat }]
      },
      primitive: { topology: 'triangle-list' }
    });
    
    // Store metadata separately
    pipelineMetadata.set(pipeline, { 
      type: 'render',
      buffers: buffers 
    });
    
    // Return original pipeline object
    return pipeline;
  } catch (error) {
    console.error('[Pipeline Utils] PIPELINE CREATION FAILED:', {
      timestamp: new Date().toISOString(),
      shader: shaderPath,
      type,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        deviceLost: error instanceof GPUDeviceLostError
      },
      deviceState: device?.lost?.then ? 'pending loss' : 'valid'
    });
    throw error;
  }
}

export { 
  quitIfAdapterNotAvailable, 
  quitIfWebGPUNotAvailable, 
  loadShaderFromFile,
  createPipeline,
  getPipelineType,
  getPipelineBuffers,
  fail 
};
