// libheif-js ships types for its CommonJS entry only; the ESM WASM bundle exports a factory.
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: () => unknown;
  export default factory;
}
