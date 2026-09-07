export declare function packageSkillDir(): string;
export declare function userSkillsRoot(): string;
export declare function installLlWikiSkill(opts?: {
    src?: string;
    dstRoot?: string;
}): 'installed' | 'exists' | 'skipped';
