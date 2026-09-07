import type {
  GraphRenderer,
  GraphRendererOptions,
  StaticGraphRenderer,
  StaticRendererOptions
} from "./index";

type AssertAssignable<T extends true> = T;
type SameType<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2)
  ? true
  : false;

type _StaticRendererAlias = AssertAssignable<SameType<StaticGraphRenderer, GraphRenderer>>;
type _StaticRendererOptionsAlias = AssertAssignable<SameType<StaticRendererOptions, GraphRendererOptions>>;
