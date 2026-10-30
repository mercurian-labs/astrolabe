/** The slice of d3-force-3d the layout uses; the package ships no types. */
declare module "d3-force-3d" {
  export interface SimulationNode3D {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface Force3D<Node extends SimulationNode3D> {
    (alpha: number): void;
    initialize?: (nodes: Array<Node>, random: () => number, dimensions: number) => void;
  }

  export interface Simulation3D<Node extends SimulationNode3D> {
    tick(iterations?: number): this;
    stop(): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaTarget(): number;
    alphaTarget(target: number): this;
    alphaDecay(decay: number): this;
    force(name: string, force: Force3D<Node> | null): this;
    nodes(): Array<Node>;
  }

  export function forceSimulation<Node extends SimulationNode3D>(
    nodes?: Array<Node>,
    dimensions?: 1 | 2 | 3,
  ): Simulation3D<Node>;

  export interface LinkForce3D<
    Node extends SimulationNode3D,
    Link = unknown,
  > extends Force3D<Node> {
    id(id: (node: Node) => string): this;
    /** A distance for every link, or one per link (called with the link as given). */
    distance(distance: number | ((link: Link, index: number) => number)): this;
    strength(strength: number | ((link: Link, index: number) => number)): this;
  }
  export function forceLink<Node extends SimulationNode3D, Link>(
    links: Array<Link>,
  ): LinkForce3D<Node, Link>;

  export interface ManyBodyForce3D<Node extends SimulationNode3D> extends Force3D<Node> {
    /** A strength for every node, or one per node. */
    strength(strength: number | ((node: Node, index: number) => number)): this;
    theta(theta: number): this;
  }
  export function forceManyBody<Node extends SimulationNode3D>(): ManyBodyForce3D<Node>;

  export interface PositionForce3D<Node extends SimulationNode3D> extends Force3D<Node> {
    strength(strength: number): this;
  }
  export function forceX<Node extends SimulationNode3D>(x?: number): PositionForce3D<Node>;
  export function forceY<Node extends SimulationNode3D>(y?: number): PositionForce3D<Node>;
  export function forceZ<Node extends SimulationNode3D>(z?: number): PositionForce3D<Node>;

  export interface CollideForce3D<Node extends SimulationNode3D> extends Force3D<Node> {
    iterations(iterations: number): this;
    radius(radius: (node: Node) => number): this;
  }
  export function forceCollide<Node extends SimulationNode3D>(
    radius: (node: Node) => number,
  ): CollideForce3D<Node>;
}
