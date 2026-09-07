import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 className 的工具函数（shadcn 标准）
 * 用法：cn("base-class", condition && "extra-class", className)
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
