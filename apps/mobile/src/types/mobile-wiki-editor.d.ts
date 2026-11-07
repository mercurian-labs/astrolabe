declare module "@t3tools/mobile-wiki-editor" {
  /** The wiki editor page: one HTML document with its script and styles inline. */
  const html: string;
  export default html;
}

declare module "@t3tools/mobile-wiki-editor/diagrams" {
  /** Each diagram type's chunks by file, as function text, and the files each type needs. */
  export const chunks: Readonly<Record<string, string>>;
  export const diagrams: Readonly<Record<string, ReadonlyArray<string>>>;
}
