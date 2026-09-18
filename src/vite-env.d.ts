/// <reference types="vite/client" />

// The fill routine is shipped as raw text into the generated extension, so the
// import has to be typed as a string rather than as a module.
declare module '*?raw' {
  const content: string;
  export default content;
}
