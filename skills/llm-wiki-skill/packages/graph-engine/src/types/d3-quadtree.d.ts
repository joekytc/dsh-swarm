declare module "d3-quadtree" {
  export interface QuadtreeLeaf<T> {
    data: T;
    next?: QuadtreeLeaf<T>;
  }

  export type QuadtreeNode<T> =
    | QuadtreeLeaf<T>
    | Array<QuadtreeNode<T> | undefined>;

  export interface Quadtree<T> {
    addAll(data: Iterable<T>): this;
    find(x: number, y: number, radius?: number): T | undefined;
    visit(callback: (node: QuadtreeNode<T>, x0: number, y0: number, x1: number, y1: number) => boolean | void): this;
  }

  export function quadtree<T>(
    data?: Iterable<T> | null,
    x?: (datum: T) => number,
    y?: (datum: T) => number
  ): Quadtree<T>;
}
