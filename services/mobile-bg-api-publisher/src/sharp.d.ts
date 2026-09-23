// `sharp` is an optional dependency: the picture conversion needs it, but the
// service must still run without it, because a native module can fail to build
// on a machine that is otherwise fine. It is imported dynamically inside a
// try/catch, so a missing module is a reported skip rather than a crash.
//
// This declaration is what lets that dynamic import type-check without the
// package being installed.
declare module 'sharp' {
  interface SharpInstance {
    rotate(angle?: number): SharpInstance;
    jpeg(options?: { quality?: number; mozjpeg?: boolean }): SharpInstance;
    toBuffer(): Promise<Buffer>;
  }
  function sharp(input?: Buffer | string): SharpInstance;
  export default sharp;
}
