// solc-js ships without types; this covers the one call scripts/compile.ts makes.
declare module 'solc' {
  const solc: { compile(input: string): string }
  export default solc
}
