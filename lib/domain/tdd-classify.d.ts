export declare function extOf(path: string): string;
/** 命中 *.test.* / *.spec.* / __tests__/ / tests/ 即测试文件。 */
export declare function isTestFile(path: string): boolean;
/** 需测试的源码：非测试文件且扩展名在约定集合内。 */
export declare function isTestableSource(path: string): boolean;
