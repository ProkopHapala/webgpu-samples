# WebGPU Samples

* Try GPU parameters [here](https://webgpureport.org/)

**Please visit the [WebGPU Samples website](//webgpu.github.io/webgpu-samples/) to run the samples!**

The WebGPU Samples are a set of samples and demos
demonstrating the use of the [WebGPU API](//webgpu.dev). Please see the current
implementation status and how to run WebGPU in your browser at
[webgpu.io](//webgpu.io).

## Building
`webgpu-samples` is built with [Typescript](https://www.typescriptlang.org/)
and bundled using [Rollup](https://rollupjs.org/). Building the project
requires an installation of [Node.js](https://nodejs.org/en/).

- Install dependencies: `npm ci`.
- For development, start the dev server which will watch and recompile
  sources: `npm start`. You can navigate to http://localhost:8080 to view the project.
- For production, compile the project: `npm run build`.
- To run a production server to serve the built assets, do `npm run serve`.


## Chosen Samples

### DONE

* [Bitonic Sort](https://webgpu.github.io/webgpu-samples/?sample=bitonicSort)
* [Compute Boids](https://webgpu.github.io/webgpu-samples/?sample=computeBoids)
* [Game of Life](https://webgpu.github.io/webgpu-samples/?sample=gameOfLife)

### TODO
* [Deferred Rendering](https://webgpu.github.io/webgpu-samples/?sample=deferredRendering)
* [Particles](https://webgpu.github.io/webgpu-samples/?sample=particles)
* [Points](https://webgpu.github.io/webgpu-samples/?sample=points) - This example shows how to render points of various sizes using a quad and instancing.[see](https://webgpufundamentals.org/webgpu/lessons/webgpu-points.html)
* [Cornell Box](https://webgpu.github.io/webgpu-samples/?sample=cornellBox)
* [Text Rendering Msdf](https://webgpu.github.io/webgpu-samples/?sample=textRenderingMsdf) - This example uses multichannel signed distance fields (MSDF) to render text. [see](https://github.com/Chlumsky/msdfgen)
* [Volume Rendering Texture3D](https://webgpu.github.io/webgpu-samples/?sample=volumeRenderingTexture3D)
* [Wireframe](https://webgpu.github.io/webgpu-samples/?sample=wireframe)
* [Metaballs](https://webgpu.github.io/webgpu-samples/?sample=metaballs)
* [Marching Cubes](https://webgpu.github.io/webgpu-samples/?sample=marchingCubes)
