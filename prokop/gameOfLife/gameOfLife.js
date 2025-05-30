import { quitIfAdapterNotAvailable, quitIfWebGPUNotAvailable, loadShaderFromFile } from '../common/webgpu-utils.js';

/**
 * Minimal WebGPU implementation of Conway's Game of Life
 */
async function init() {
    try {
        // Get the canvas element
        const canvas = document.querySelector('canvas');

        // Request WebGPU adapter and device
        const adapter = await navigator.gpu?.requestAdapter();
        quitIfAdapterNotAvailable(adapter);
        const device = await adapter.requestDevice();
        quitIfWebGPUNotAvailable(adapter, device);

        // Configure WebGPU context
        const context = canvas.getContext('webgpu');
        const devicePixelRatio = window.devicePixelRatio;
        canvas.width = canvas.clientWidth * devicePixelRatio;
        canvas.height = canvas.clientHeight * devicePixelRatio;

        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
            device,
            format: presentationFormat
        });

        // Create bind group layout for compute shader
        const computeBindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'storage' }
                }
            ]
        });

        // Create compute pipeline for Game of Life rules
        const computePipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [computeBindGroupLayout]
            }),
            compute: {
                module: device.createShaderModule({
                    code: await loadShaderFromFile('./compute.wgsl')
                }),
                entryPoint: 'main'
            }
        });

        // Initialize game state (random starting pattern)
        const gridSize = 64;
        const cellData = new Uint32Array(gridSize * gridSize);
        for (let i = 0; i < cellData.length; ++i) {
            cellData[i] = Math.random() > 0.7 ? 1 : 0;
        }

        // Create double-buffered storage for cell states
        const cellBuffers = [
            device.createBuffer({
                size: cellData.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true
            }),
            device.createBuffer({
                size: cellData.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            })
        ];
        new Uint32Array(cellBuffers[0].getMappedRange()).set(cellData);
        cellBuffers[0].unmap();

        // Create buffer for grid size
        const sizeBuffer = device.createBuffer({
            size: 8,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(sizeBuffer, 0, new Uint32Array([gridSize, gridSize]));

        // Create bind groups for compute shader
        const bindGroups = [
            device.createBindGroup({
                layout: computeBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: sizeBuffer } },
                    { binding: 1, resource: { buffer: cellBuffers[0] } },
                    { binding: 2, resource: { buffer: cellBuffers[1] } }
                ]
            }),
            device.createBindGroup({
                layout: computeBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: sizeBuffer } },
                    { binding: 1, resource: { buffer: cellBuffers[1] } },
                    { binding: 2, resource: { buffer: cellBuffers[0] } }
                ]
            })
        ];

        // Create uniform buffer for grid size
        const uniformBuffer = device.createBuffer({
            size: 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Uint32Array(uniformBuffer.getMappedRange()).set([gridSize, gridSize]);
        uniformBuffer.unmap();

        // Create render bind group
        const renderBindGroupLayout = device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform' }
            }]
        });

        const renderBindGroup = device.createBindGroup({
            layout: renderBindGroupLayout,
            entries: [{
                binding: 0,
                resource: { buffer: uniformBuffer }
            }]
        });

        // Create render pipeline
        const renderPipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [renderBindGroupLayout]
            }),
            vertex: {
                module: device.createShaderModule({
                    code: await loadShaderFromFile('./vert.wgsl')
                }),
                entryPoint: 'main',
                // Instance buffer (cell states) then vertex buffer (square positions)
                buffers: [
                    {
                        arrayStride: 4,
                        stepMode: 'instance',
                        attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32' }]
                    },
                    {
                        arrayStride: 8,
                        stepMode: 'vertex',
                        attributes: [{ shaderLocation: 1, offset: 0, format: 'uint32x2' }]
                    }
                ]
            },
            fragment: {
                module: device.createShaderModule({
                    code: await loadShaderFromFile('./frag.wgsl')
                }),
                entryPoint: 'main',
                targets: [{ format: presentationFormat }]
            },
            primitive: { topology: 'triangle-strip' }
        });

        // Create square vertex buffer
        // Triangle-strip order: bottom-left, bottom-right, top-left, top-right
        const squareVertices = new Uint32Array([0, 0, 1, 0, 0, 1, 1, 1]);
        const squareBuffer = device.createBuffer({
            size: squareVertices.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true
        });
        new Uint32Array(squareBuffer.getMappedRange()).set(squareVertices);
        squareBuffer.unmap();

        // Animation loop
        let step = 0;
        function frame() {
            const commandEncoder = device.createCommandEncoder();
            
            // Compute pass
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(computePipeline);
            computePass.setBindGroup(0, bindGroups[step % 2]);
            computePass.dispatchWorkgroups(gridSize/8, gridSize/8);
            computePass.end();

            // Render pass
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    clearValue: [0, 0, 0, 1],
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });
            renderPass.setPipeline(renderPipeline);
            renderPass.setBindGroup(0, renderBindGroup);
            renderPass.setVertexBuffer(0, cellBuffers[step % 2]);
            renderPass.setVertexBuffer(1, squareBuffer);
            renderPass.draw(4, gridSize * gridSize); // 4 vertices per cell
            renderPass.end();

            device.queue.submit([commandEncoder.finish()]);
            step = 1 - step;
            requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
    } catch (error) {
        console.error('Initialization failed:', error);
    }
}

init();