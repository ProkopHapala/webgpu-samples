// Minimal WebGPU bitonic sort implementation
// Based on original TypeScript version but without compilation step

async function loadShader(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load shader: ${url}`);
    }
    return await response.text();
  }
  
  // Add fullscreen quad vertex shader
  const fullscreenTexturedQuadWGSL = `
  struct VertexOutput {
      @builtin(position) Position : vec4f,
      @location(0) fragUV : vec2f,
  }
  
  @vertex
  fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
      const pos = array(
          vec2( 1.0,  1.0), vec2( 1.0, -1.0), vec2(-1.0, -1.0),
          vec2( 1.0,  1.0), vec2(-1.0, -1.0), vec2(-1.0,  1.0)
      );
      const uv = array(
          vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0),
          vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, 0.0)
      );
      var output : VertexOutput;
      output.Position = vec4(pos[VertexIndex], 0.0, 1.0);
      output.fragUV = uv[VertexIndex];
      return output;
  }
  `;
  
  // Core bitonic sort implementation
  class BitonicSort {
    constructor() {
      this.device = null;
      this.computePipeline = null;
      this.renderPipeline = null; // Add render pipeline
      this.canvas = document.querySelector('canvas'); // Add canvas reference
      this.context = null; // Add context reference
      this.workgroupSize = 256;
      this.totalElements = 1024; // Default size
      this.elements = new Uint32Array(this.totalElements);
      
      // Initialize with random values
      for (let i = 0; i < this.totalElements; i++) {
        this.elements[i] = Math.floor(Math.random() * this.totalElements);
      }
    }
  
    async init() {
      // Check for WebGPU support
      if (!navigator.gpu) {
        throw Error('WebGPU not supported');
      }
  
      // Initialize WebGPU
      const adapter = await navigator.gpu.requestAdapter();
      this.device = await adapter.requestDevice();
  
      // Set up canvas context
      // Set canvas resolution to match display size
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = this.canvas.clientWidth * dpr;
      this.canvas.height = this.canvas.clientHeight * dpr;
      // Acquire WebGPU context
      this.context = this.canvas.getContext('webgpu');
      const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format: presentationFormat,
      });
  
      // Load fragment display shader
      const bitonicDisplayFragWGSL = await loadShader('bitonicDisplay.frag.wgsl');
      
      // Create buffers
      this.elementBuffer = this.device.createBuffer({
        size: this.elements.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
  
      this.uniformBuffer = this.device.createBuffer({
        size: 16, // width, height, algo, blockHeight (4 floats)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
  
      // Create simple compute shader to fill gradient
      const computeShaderCode = `
  @group(0) @binding(0) var<storage, read_write> data: array<u32>;
  @compute @workgroup_size(${this.workgroupSize}, 1, 1)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let idx = id.x;
    if (idx < ${this.totalElements}) {
      data[idx] = idx;
    }
  }
  `;
      this.computePipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: this.device.createShaderModule({ code: computeShaderCode }),
          entryPoint: 'main',
        },
      });
      // Create compute bind group
      this.computeBindGroup = this.device.createBindGroup({
        layout: this.computePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.elementBuffer } }],
      });
  
      // Explicit bind group layouts for rendering
      const displayBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      const fragmentBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [displayBindGroupLayout, fragmentBindGroupLayout],
      });
      this.renderPipeline = this.device.createRenderPipeline({
        label: 'bitonic-display-pipeline',
        layout: pipelineLayout,
        vertex: {
          module: this.device.createShaderModule({ code: fullscreenTexturedQuadWGSL }),
          entryPoint: 'vert_main',
        },
        fragment: {
          module: this.device.createShaderModule({ code: bitonicDisplayFragWGSL }),
          entryPoint: 'frag_main',
          targets: [{ format: presentationFormat }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
      });
  
      // Create compute uniforms buffer (width, height, algo=0, blockHeight)
      this.computeUniformBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      // Prepare mixed float and uint data
      const gridSize = Math.sqrt(this.totalElements); // display as square grid
      const uniformData = new ArrayBuffer(16);
      const f32 = new Float32Array(uniformData, 0, 2);
      f32[0] = gridSize;
      f32[1] = gridSize;
      const u32 = new Uint32Array(uniformData, 8, 2);
      u32[0] = 0; // algo (unused in display)
      u32[1] = gridSize; // blockHeight matches grid size
      this.device.queue.writeBuffer(this.computeUniformBuffer, 0, uniformData);
  
      // Create fragment uniforms buffer (highlight=0)
      this.fragmentUniformBuffer = this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(
        this.fragmentUniformBuffer,
        0,
        new Uint32Array([0]),
      );
  
      // Create display bind group (data + compute uniforms)
      this.displayBindGroup = this.device.createBindGroup({
        layout: displayBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.elementBuffer } },
          { binding: 2, resource: { buffer: this.computeUniformBuffer } },
        ],
      });
  
      // Create fragment bind group (highlight flag)
      this.fragmentBindGroup = this.device.createBindGroup({
        layout: fragmentBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: this.fragmentUniformBuffer } }],
      });
  
      // Upload initial data
      this.device.queue.writeBuffer(
        this.elementBuffer,
        0,
        this.elements.buffer
      );
    }
  
    async sort() {
      const commandEncoder = this.device.createCommandEncoder();
      
      // Compute pass for gradient fill
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroup);
      computePass.dispatchWorkgroups(
        Math.ceil(this.totalElements / this.workgroupSize)
      );
      computePass.end();
  
      // Render pass
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.displayBindGroup);
      renderPass.setBindGroup(1, this.fragmentBindGroup);
      renderPass.draw(6); // Draw the fullscreen quad
  
      renderPass.end();
  
      this.device.queue.submit([commandEncoder.finish()]);
    }
  }
  
  // Initialize and run when WebGPU is available
  async function main() {
    const bitonicSort = new BitonicSort();
    await bitonicSort.init();
    
    function frame() {
      bitonicSort.sort().then(() => {
        requestAnimationFrame(frame);
      });
    }
    
    frame();
  }
  
  main().catch(console.error);
  