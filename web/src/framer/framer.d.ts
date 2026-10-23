// The slice of Framer's "framer" module that HeldPayButton.tsx uses, so our typecheck covers the component.
// The real module only exists inside Framer; this app never imports the component as code (only as ?raw text).
declare module 'framer' {
  export const ControlType: { String: 'string', Enum: 'enum', Boolean: 'boolean', Number: 'number' }
  export const RenderTarget: { current(): string, canvas: string, preview: string, export: string, thumbnail: string }
  export function addPropertyControls(component: unknown, controls: Record<string, Record<string, unknown>>): void
}
