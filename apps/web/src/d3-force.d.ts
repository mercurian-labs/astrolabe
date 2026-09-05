declare module "d3-force" {
  interface Simulation {
    force(name: string, force: unknown): this;
    stop(): this;
    tick(iterations?: number): this;
  }

  interface LinkForce {
    id<NodeDatum>(accessor: (node: NodeDatum) => string): this;
    distance(distance: number): this;
  }

  interface ManyBodyForce {
    strength(strength: number): this;
  }

  interface PositioningForce {
    strength(strength: number): this;
  }

  export function forceSimulation<NodeDatum extends object>(nodes: Array<NodeDatum>): Simulation;
  export function forceLink<LinkDatum extends object>(links: Array<LinkDatum>): LinkForce;
  export function forceManyBody(): ManyBodyForce;
  export function forceCenter(x?: number, y?: number): unknown;
  export function forceCollide(radius?: number): unknown;
  export function forceX(x?: number): PositioningForce;
  export function forceY(y?: number): PositioningForce;
}
