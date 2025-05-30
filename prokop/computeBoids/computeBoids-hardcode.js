import { quitIfAdapterNotAvailable, quitIfWebGPUNotAvailable, loadShaderFromFile } from './common/webgpu-utils.js';

/**
 * Initialize the WebGPU application.
 */
async function init() {
    try {
        // Get the canvas element
        const canvas = document.querySelector('canvas');

        // Request a WebGPU adapter and device
        const adapter = await navigator.gpu?.requestAdapter();
        quitIfAdapterNotAvailable(adapter);
        const device = await adapter.requestDevice();
        quitIfWebGPUNotAvailable(adapter, device);

        // Create a WebGPU context
        const context = canvas.getContext('webgpu');
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
        const spriteShaderModule = device.createShaderModule({ 
            code: await loadShaderFromFile('./boids_sprite.wgsl') 
        });

        const renderPipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: spriteShaderModule,
                buffers: [
                    {
                        // Instanced particles buffer
                        arrayStride: 4 * 4,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x2' },
                            { shaderLocation: 1, offset: 2 * 4, format: 'float32x2' }
                        ]
                    },
                    {
                        // Vertex buffer
                        arrayStride: 2 * 4,
                        stepMode: 'vertex',
                        attributes: [
                            { shaderLocation: 2, offset: 0, format: 'float32x2' }
                        ]
                    }
                ]
            },
            fragment: {
                module: spriteShaderModule,
                targets: [{ format: presentationFormat }]
            },
            primitive: { topology: 'triangle-list' }
        });

        const computePipeline = device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: device.createShaderModule({
                    code: await loadShaderFromFile('./boids_update.wgsl'),
                }),
                entryPoint: 'main'
            },
        });

        // Create render pass descriptor
        const renderPassDescriptor = {
            colorAttachments: [{
                view: undefined, // Assigned later
                clearValue: [0, 0, 0, 1],
                loadOp: 'clear',
                storeOp: 'store'
            }]
        };

        // Create sprite vertex buffer
        const vertexBufferData = new Float32Array([-0.01, -0.02, 0.01, -0.02, 0.0, 0.02]);
        const spriteVertexBuffer = device.createBuffer({
            size: vertexBufferData.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true
        });
        new Float32Array(spriteVertexBuffer.getMappedRange()).set(vertexBufferData);
        spriteVertexBuffer.unmap();

        // Simulation parameters - could be moved to a config object
        const simParams = {
            deltaT: 0.04,
            rule1Distance: 0.1,
            rule2Distance: 0.025,
            rule3Distance: 0.025,
            rule1Scale: 0.02,
            rule2Scale: 0.05,
            rule3Scale: 0.005
        };

        // Create uniform buffer for simulation parameters
        // Could be generalized into createUniformBuffer() helper
        const simParamBufferSize = 7 * Float32Array.BYTES_PER_ELEMENT;
        const simParamBuffer = device.createBuffer({
            size: simParamBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(simParamBuffer, 0, new Float32Array(Object.values(simParams)));

        // Initialize particle data - could be moved to initializeParticles()
        const numParticles = 1500;
        const initialParticleData = new Float32Array(numParticles * 4);
        for (let i = 0; i < numParticles; ++i) {
            // Position (x,y) and Velocity (z,w)
            initialParticleData[4 * i + 0] = 2 * (Math.random() - 0.5);
            initialParticleData[4 * i + 1] = 2 * (Math.random() - 0.5);
            initialParticleData[4 * i + 2] = 2 * (Math.random() - 0.5) * 0.1;
            initialParticleData[4 * i + 3] = 2 * (Math.random() - 0.5) * 0.1;
        }

        // Create double-buffered particle storage - could be createDoubleBuffers() helper
        const particleBuffers = [
            device.createBuffer({
                size: initialParticleData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
                mappedAtCreation: true
            }),
            device.createBuffer({
                size: initialParticleData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
                mappedAtCreation: true
            })
        ];
        
        // Initialize buffers with particle data
        new Float32Array(particleBuffers[0].getMappedRange()).set(initialParticleData);
        particleBuffers[0].unmap();
        new Float32Array(particleBuffers[1].getMappedRange()).set(initialParticleData);
        particleBuffers[1].unmap();

        // Create bind groups for compute shader - could be createBindGroups() helper
        const particleBindGroups = [];
        for (let i = 0; i < 2; ++i) {
            particleBindGroups.push(device.createBindGroup({
                layout: computePipeline.getBindGroupLayout(0),
                entries: [
                    // Uniform buffer with simulation parameters
                    {
                        binding: 0,
                        resource: {
                            buffer: simParamBuffer,
                            offset: 0,
                            size: simParamBufferSize
                        }
                    },
                    // Input particle buffer (current state)
                    {
                        binding: 1,
                        resource: {
                            buffer: particleBuffers[i],
                            offset: 0,
                            size: initialParticleData.byteLength
                        }
                    },
                    // Output particle buffer (next state)
                    {
                        binding: 2,
                        resource: {
                            buffer: particleBuffers[(i + 1) % 2],
                            offset: 0,
                            size: initialParticleData.byteLength
                        }
                    }
                ]
            }));
        }

        // Animation loop - could be moved to separate runSimulation() function
        let t = 0;
        function frame() {
            // Update render target view for current frame
            renderPassDescriptor.colorAttachments[0].view = context
                .getCurrentTexture()
                .createView();

            const commandEncoder = device.createCommandEncoder();
            
            // Compute pass: update particle positions
            {
                const passEncoder = commandEncoder.beginComputePass();
                passEncoder.setPipeline(computePipeline);
                passEncoder.setBindGroup(0, particleBindGroups[t % 2]);
                passEncoder.dispatchWorkgroups(Math.ceil(numParticles / 64));
                passEncoder.end();
            }
            
            // Render pass: draw particles
            {
                const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
                passEncoder.setPipeline(renderPipeline);
                passEncoder.setVertexBuffer(0, particleBuffers[(t + 1) % 2]);
                passEncoder.setVertexBuffer(1, spriteVertexBuffer);
                passEncoder.draw(3, numParticles, 0, 0);
                passEncoder.end();
            }
            
            // Submit commands to GPU
            device.queue.submit([commandEncoder.finish()]);
            t++;
            requestAnimationFrame(frame);
        }
        
        requestAnimationFrame(frame);
    } catch (error) {
        console.error('Initialization failed:', error);
    }
}

init();
