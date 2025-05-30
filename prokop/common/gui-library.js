// dat-gui JavaScript Controller Library
// https://github.com/dataarts/dat.gui
//
// Copyright 2011 Data Arts Team, Google Creative Lab
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0

function ___$insertStyle(css) {
  if (typeof window === 'undefined') {
    return;
  }

  var style = document.createElement('style');

  style.setAttribute('type', 'text/css');
  style.innerHTML = css;
  document.head.appendChild(style);

  return css;
}

// GUI Class Implementation
class GUI {
  constructor(params) {
    // Basic initialization
    this.domElement = document.createElement('div');
    this.__ul = document.createElement('ul');
    this.domElement.appendChild(this.__ul);
    
    // Add all necessary methods and properties
    this.add = function() { /* ... */ };
    this.addColor = function() { /* ... */ };
    this.remove = function() { /* ... */ };
    // Include all necessary methods and properties from the original implementation
    
    // Static properties
    GUI.CLASS_MAIN = 'main';
    GUI.DEFAULT_WIDTH = 245;
    // Add all other static properties
  }
  
  // Prototype methods
  destroy() { /* ... */ }
  addFolder() { /* ... */ }
  // Include all other prototype methods
}

// Static methods
GUI.toggleHide = function() { /* ... */ };

// Export as default
export { GUI as default };
