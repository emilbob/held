// solc-js ships without types; this covers the calls scripts/compile.ts makes.
declare module 'solc' {
  const solc: { compile(input: string): string, version(): string }
  export default solc
}
