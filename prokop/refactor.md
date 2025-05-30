# Refactoring WebGPU Samples for Clarity and Reusability: A Summary

This guide details the process of refactoring your standalone "Game of Life" and "Compute Boids" WebGPU examples. The primary objectives are to enhance modularity, extract common functionalities, and improve code organization by moving shaders to external files. This will lead to smaller, more manageable JavaScript files for each specific example.

## Prerequisites

Ensure you have already set up standalone project folders for both "Game of Life" and "Compute Boids." These folders should contain the compiled `main.js` from the original `webgpu-samples/dist` directory and a basic `index.html` file for each.

## Step 1: Establish a Shared Directory Structure

1.  **Parent Directory**: Assume your standalone project folders (e.g., `my-gameoflife-standalone`, `my-computeboids-standalone`) reside within a common parent directory, for instance, `/home/prokop/git_SW/webgpu-samples/prokop/`.
2.  **Create `common` Directory**: Within this parent directory, create a new subdirectory named `common`. This `common` directory will house JavaScript files shared between your different WebGPU examples.
3.  **Create `shaders` Directories**: Inside each of your standalone project folders (e.g., `my-gameoflife-standalone/` and `my-computeboids-standalone/`), create a new subdirectory named `shaders`. These will store the WGSL shader files specific to each example.

Your intended directory layout should resemble:
-   A top-level directory (e.g., `/home/prokop/git_SW/webgpu-samples/prokop/`)
    -   Contains the `common` directory.
    -   Contains individual project folders like `my-gameoflife-standalone` and `my-computeboids-standalone`.
    -   The `common` directory will contain `gui-library.js` and `webgpu-utils.js`.
    -   Each project folder (e.g., `my-gameoflife-standalone`) will contain its `index.html`, its refactored `main.js`, and a `shaders` subdirectory.
    -   The `shaders` subdirectory within each project will hold the respective `.wgsl` files (e.g., `gameOfLife.compute.wgsl`, `boids.sprite.wgsl`).
    -   Optionally, your Python server script (`run_server.py`) can be placed in the top-level directory to serve all projects.

## Step 2: Extract the GUI Library (`lil-gui` or `dat.gui`)

The GUI library is currently bundled within each example's `main.js`.

1.  **Create `common/gui-library.js`**:
    *   Open the `main.js` file from either your Game of Life or Boids standalone project.
    *   Identify and copy the entire block of code that constitutes the GUI library (it often starts with a comment like "dat-gui JavaScript Controller Library" and includes numerous classes and functions related to the GUI).
    *   Paste this large block of GUI library code into a new file: `/home/prokop/git_SW/webgpu-samples/prokop/common/gui-library.js`.
2.  **Modify Example `main.js` Files**:
    *   Delete the GUI library code (the block you just copied) from both `my-gameoflife-standalone/main.js` and `my-computeboids-standalone/main.js`. This will significantly reduce their file sizes. The GUI functionality will now be accessed globally from the shared `gui-library.js`.

## Step 3: Extract Common WebGPU Utility Functions

Error handling functions and WebGPU availability checks are also duplicated.

1.  **Create `common/webgpu-utils.js`**:
    *   From one of your example `main.js` files, identify and copy the common utility functions. These typically include:
        *   Global `unhandledrejection` and `error` event listeners.
        *   Functions like `quitIfAdapterNotAvailable(adapter)`.
        *   Functions like `quitIfWebGPUNotAvailable(adapter, device)`.
        *   The `fail` function used for displaying errors.
    *   Paste these utility functions into the new file: `/home/prokop/git_SW/webgpu-samples/prokop/common/webgpu-utils.js`.
2.  **Modify Example `main.js` Files**:
    *   Delete these utility functions from both example `main.js` files.

## Step 4: Create a Shader Loading Utility

To load shaders from external files, a helper function is needed.

1.  **Add to `common/webgpu-utils.js`**:
    *   Append a new asynchronous JavaScript function named `loadShaderFromFile(path)` to your `common/webgpu-utils.js` file.
    *   This function should use the `fetch` API to retrieve the content of a shader file specified by the `path` argument.
    *   It should return a Promise that resolves with the shader code as a string.
    *   Include basic error handling for the fetch operation (e.g., if the file is not found).

## Step 5: Externalize WGSL Shaders

Move the inline WGSL shader strings into separate `.wgsl` files.

### A. For Game of Life:

1.  **Create Shader Files**:
    *   In `my-gameoflife-standalone/main.js`, locate the JavaScript string variables holding the WGSL code (e.g., `computeWGSL`, `vertWGSL`, `fragWGSL`).
    *   For each shader:
        *   Copy the WGSL code (the content within the backticks).
        *   Paste it into a new file within the `my-gameoflife-standalone/shaders/` directory. Name the files appropriately, for example:
            *   `gameOfLife.compute.wgsl`
            *   `gameOfLife.vert.wgsl`
            *   `gameOfLife.frag.wgsl`
2.  **Update `my-gameoflife-standalone/main.js`**:
    *   Remove the old JavaScript string variable definitions for the shaders.
    *   The main part of your Game of Life script will need to become an `async` function to allow the use of `await` for loading shaders.
    *   Before creating shader modules (`device.createShaderModule`), use `await loadShaderFromFile('shaders/your-shader-name.wgsl')` to get the shader code for each shader.
    *   Pass the loaded shader code string to `device.createShaderModule({ code: loadedShaderCode })`.
    *   Ensure the main logic of the script is called at the end, for example, by invoking `main_gameoflife().catch(err => console.error(err));`.

### B. For Compute Boids:

1.  **Create Shader Files**:
    *   In `my-computeboids-standalone/main.js`, find the `spriteWGSL` and `updateSpritesWGSL` string variables.
    *   Copy their WGSL content into new files within the `my-computeboids-standalone/shaders/` directory, for example:
        *   `boids.sprite.wgsl`
        *   `boids.update.wgsl`
2.  **Update `my-computeboids-standalone/main.js`**:
    *   Remove the old inline shader string definitions.
    *   Similar to Game of Life, make the main part of your Boids script an `async` function.
    *   Use `await loadShaderFromFile('shaders/your-boid-shader.wgsl')` to load each shader before creating the shader modules.
    *   Call the main async function at the end of the script with error handling.

## Step 6: Update `index.html` Files

Modify the `index.html` file in *both* `my-gameoflife-standalone` and `my-computeboids-standalone` to include the newly created shared JavaScript files.

1.  **Script Tags**:
    *   Add `<script>` tags to include `gui-library.js` and `webgpu-utils.js`.
    *   The paths should be relative to the `index.html` file (e.g., `../common/gui-library.js` and `../common/webgpu-utils.js`, assuming `common` is a sibling to your project folders).
    *   **Order is important**: Load `gui-library.js` first, then `webgpu-utils.js`, and finally your example-specific `main.js` (which should be marked with `type="module"` and `defer`).

## Step 7: Final Review of Example `main.js` Files

After completing the refactoring:
*   Confirm that the large block of GUI library code has been completely removed from your example-specific `main.js` files.
*   Verify that the common error handling functions (like `fail`, `quitIfAdapterNotAvailable`) are also removed from the example `main.js` files.
*   The GUI instantiation (e.g., `new GUI$1()`) will now rely on the globally available GUI library.
*   The `loadShaderFromFile` function will be available from `webgpu-utils.js`.
*   The core logic within each example's `main.js` should now be cleaner, primarily focused on the specific WebGPU setup and rendering loop for that demo, and wrapped in an `async` function.

## Conclusion

These refactoring steps will result in a more organized project structure. Each example's JavaScript will be significantly smaller and more focused. The shared `gui-library.js` and `webgpu-utils.js` can be reused across future WebGPU demos. Storing shaders in separate `.wgsl` files improves readability and aligns with common development practices. When running your local Python server, ensure it's started from a directory that allows access to both the example project folder and the `common` directory (e.g., from `/home/prokop/git_SW/webgpu-samples/prokop/`).
