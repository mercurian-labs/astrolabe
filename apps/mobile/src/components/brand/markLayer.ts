/** One layer of a duotone mark: shapes on the mark's canvas, each node under its own transform. */
export interface MarkLayer {
  readonly viewBox: string;
  readonly nodes: ReadonlyArray<{
    readonly transform: string | null;
    readonly children: ReadonlyArray<
      | { readonly d: string; readonly evenOdd: boolean }
      | { readonly circle: readonly [cx: number, cy: number, r: number] }
    >;
  }>;
}
