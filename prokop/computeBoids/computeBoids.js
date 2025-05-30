import { 
  quitIfAdapterNotAvailable, 
  quitIfWebGPUNotAvailable, 
  loadShaderFromFile,
  createPipeline,
  getPipelineBuffers,
  fail 
} from './common/webgpu-utils.js';

/**
 * Initialize the WebGPU application.
 */
async function init() {
    // Declare all variables at function scope
    let animationId;
    let shouldContinueRendering = true;
    let errorOccurred = false;
    let device, context;
    let particleBuffers, spriteVertexBuffer, simParamBuffer; 
    let renderPipeline, computePipeline;

    // Global error handler
    const handleCriticalError = (error) => {
        if (errorOccurred) return;
        errorOccurred = true;
        
        shouldContinueRendering = false;
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        
        // Cleanup all resources safely
        const resources = [
            context,
            device,
            ...(particleBuffers || []),
            spriteVertexBuffer,
            simParamBuffer,
            renderPipeline,
            computePipeline
        ].filter(Boolean);
        
        resources.forEach(resource => {
            try {
                if (resource?.destroy) resource.destroy();
                if (resource?.unconfigure) resource.unconfigure();
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        });
        
        fail(`Fatal error: ${error.message}`);
        console.error('Application stopped:', error);
    };

    // Setup global error handlers
    window.addEventListener('error', (event) => {
        handleCriticalError(event.error);
        event.preventDefault();
    });

    window.addEventListener('unhandledrejection', (event) => {
        handleCriticalError(event.reason);
        event.preventDefault();
    });

    function validateBuffers(buffers) {
        if (!buffers || !buffers.length) {
            throw new Error('Render pipeline buffers not initialized');
        }
        console.log('[Init] Validated render pipeline buffers');
    }

    try {
        // Get the canvas element
        const canvas = document.querySelector('canvas');

        // Request a WebGPU adapter and device
        const adapter = await navigator.gpu?.requestAdapter();
        quitIfAdapterNotAvailable(adapter);
        const device = await adapter.requestDevice({
          requiredLimits: {
            maxComputeWorkgroupSizeX: 256
          },
          defaultQueue: { label: 'default queue' }
        });
        quitIfWebGPUNotAvailable(adapter, device);

        // Add GPU validation error logging
        device.pushErrorScope('validation');
        device.addEventListener('uncapturederror', (event) => {
          console.error('[WebGPU Validation Error]', {
            error: event.error,
            message: event.error.message,
            type: event.error.constructor.name
          });
        });

        // Create a WebGPU context
        context = canvas.getContext('webgpu');
        const devicePixelRatio = window.devicePixelRatio;
        canvas.width = canvas.clientWidth * devicePixelRatio;
        canvas.height = canvas.clientHeight * devicePixelRatio;

        // Configure the context
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
            device,
            format: presentationFormat
        });

        // Create pipelines
        try {
            renderPipeline = await createPipeline(device, {
                type: 'render',
                shaderPath: './boids_sprite.wgsl',
                presentationFormat
            });

            computePipeline = await createPipeline(device, {
                type: 'compute',
                shaderPath: './boids_update.wgsl'
            });
        } catch (error) {
            handleCriticalError(error);
            return;
        }

        // Get and validate render pipeline buffers
        const renderBuffers = getPipelineBuffers(renderPipeline);
        validateBuffers(renderBuffers);

        // Create render pass descriptor
        const renderPassDescriptor = {
            colorAttachments: [{
                view: undefined, // Assigned later
                loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }],
            // Use validated render buffers
            vertexBuffers: renderBuffers
        };

        // Create sprite vertex buffer
        const spriteVertices = new Float32Array([
          -0.01, -0.02, 
           0.01, -0.02,
           0.00, 0.02
        ]);
        
        // Create buffer with proper stride-aligned size (512 bytes stride * 3 vertices)
        spriteVertexBuffer = device.createBuffer({
          size: 512 * 3, // 1536 bytes total
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true
        });
        
        // Only fill the first 24 bytes with actual vertex data
        new Float32Array(spriteVertexBuffer.getMappedRange()).set(spriteVertices, 0);
        spriteVertexBuffer.unmap();
        
        console.log(`Sprite vertex buffer created with size: ${spriteVertexBuffer.size} bytes`);

        // Simulation parameters - could be moved to a config object
        const simParams = {
            deltaT:        0.04,
            rule1Distance: 0.1,
            rule2Distance: 0.025,
            rule3Distance: 0.025,
            rule1Scale:    0.02,
            rule2Scale:    0.05,
            rule3Scale:    0.005
        };

        // Create uniform buffer for simulation parameters
        const simParamBufferSize = 7 * Float32Array.BYTES_PER_ELEMENT;
        simParamBuffer = device.createBuffer({
            size: simParamBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(simParamBuffer, 0, new Float32Array(Object.values(simParams)));

        // Initialize particle data (pos.xy, vel.xy) per reference
        const numParticles = 1500;
        const initialParticleData = new Float32Array(numParticles * 4);
        for (let i = 0; i < numParticles; ++i) {
            initialParticleData[4 * i + 0] = 2 * (Math.random() - 0.5);
            initialParticleData[4 * i + 1] = 2 * (Math.random() - 0.5);
            initialParticleData[4 * i + 2] = 2 * (Math.random() - 0.5) * 0.1;
            initialParticleData[4 * i + 3] = 2 * (Math.random() - 0.5) * 0.1;
        }
        // Create double-buffered storage
        const bufferSize = initialParticleData.byteLength;
        particleBuffers = [0,1].map(() => {
            const buf = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                mappedAtCreation: true
            });
            new Float32Array(buf.getMappedRange()).set(initialParticleData);
            buf.unmap();
            return buf;
        });

        console.log('Particle buffers created:', { size: particleBuffers[0].size });

        // Create bind groups for compute shader
        const particleBindGroups = [];
        try {
            for (let i = 0; i < 2; ++i) {
                particleBindGroups.push(device.createBindGroup({
                  layout: computePipeline.getBindGroupLayout(0),
                  entries: [
                    { binding: 0, resource: { buffer: simParamBuffer,               offset: 0, size: simParamBufferSize } },
                    { binding: 1, resource: { buffer: particleBuffers[i],           offset: 0 } },
                    { binding: 2, resource: { buffer: particleBuffers[(i + 1) % 2], offset: 0 } }
                  ]
                }));
            }
        } catch (error) {
            console.error('Failed to create bind groups:', {
                error: error.message,
                pipelineType: getPipelineType(computePipeline),
                pipeline: computePipeline
            });
            throw error;
        }

        // Frame-rate counter
        let lastTime = performance.now();
        let frameCount = 0;
        function logFPS() {
            const now = performance.now();
            frameCount++;
            if (now - lastTime >= 1000) {
                const fps = (frameCount * 1000) / (now - lastTime);
                console.log(`FPS: ${fps.toFixed(1)}`);
                frameCount = 0;
                lastTime = now;
            }
        }
        
        function frame() {
            logFPS();
            if (!shouldContinueRendering || errorOccurred) return;
            
            try {
                // Update render target view
                renderPassDescriptor.colorAttachments[0].view = context
                    .getCurrentTexture()
                    .createView();

                const commandEncoder = device.createCommandEncoder();
                
                // Compute pass
                {
                    const passEncoder = commandEncoder.beginComputePass();
                    passEncoder.setPipeline(computePipeline);
                    passEncoder.setBindGroup(0, particleBindGroups[t % 2]);
                    passEncoder.dispatchWorkgroups(Math.ceil(numParticles / 64));
                    passEncoder.end();
                }
                
                // Render pass
                {
                    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
                    passEncoder.setPipeline(renderPipeline);
                    passEncoder.setVertexBuffer(0, particleBuffers[(t + 1) % 2]);
                    passEncoder.setVertexBuffer(1, spriteVertexBuffer);
                    passEncoder.draw(3, numParticles, 0, 0);
                    passEncoder.end();
                }
                
                device.queue.submit([commandEncoder.finish()]);
                t++;
                
                if (shouldContinueRendering && !errorOccurred) {
                    animationId = requestAnimationFrame(frame);
                }
            } catch (error) {
                handleCriticalError(error);
            }
        }

        let t = 0;
        frame();

        // Cleanup on window unload
        window.addEventListener('beforeunload', () => {
            handleCriticalError(new Error('Application closed'));
        });

    } catch (error) {
        handleCriticalError(error);
    }
}

init();
