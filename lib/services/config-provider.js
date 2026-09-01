import { Service } from '@deepseek-ai/cordis';
import { readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { mergeConfig, computeSources, projectEditable, validateConfig, diffOverride, } from '../domain/config-override.js';
export class ConfigProvider extends Service {
    baseline;
    overrideFile;
    auditFile;
    override;
    effective;
    sources;
    constructor(ctx, baseline, storageDir) {
        super(ctx, 'swarmConfig');
        this.baseline = baseline;
        this.overrideFile = join(storageDir, 'config-override.json');
        this.auditFile = join(storageDir, 'config-audit.log');
        this.override = this.readOverride();
        this.effective = mergeConfig(baseline, this.override);
        this.sources = computeSources(this.override);
    }
    getEffective() { return this.effective; }
    getSources() { return this.sources; }
    get mode() { return (this.effective.wikiVault?.baseUrl ?? '').trim() ? 'remote' : 'local'; }
    snapshot() {
        return { effective: projectEditable(this.effective), sources: this.sources };
    }
    applyOverride(snapshot) {
        const errors = validateConfig(snapshot);
        if (errors.length)
            return { ok: false, errors };
        const next = diffOverride(this.baseline, snapshot);
        const changed = this.diffKeys(this.override, next);
        this.writeOverride(next);
        if (changed.length)
            this.appendAudit(changed);
        this.override = next;
        this.effective = mergeConfig(this.baseline, next);
        this.sources = computeSources(next);
        return { ok: true, effective: projectEditable(this.effective), sources: this.sources, changed };
    }
    reset() {
        const next = {};
        this.writeOverride(next);
        this.override = next;
        this.effective = mergeConfig(this.baseline, next);
        this.sources = computeSources(next);
        return { effective: projectEditable(this.effective), sources: this.sources };
    }
    readOverride() {
        try {
            if (!existsSync(this.overrideFile))
                return {};
            const raw = JSON.parse(readFileSync(this.overrideFile, 'utf8'));
            return raw ?? {};
        }
        catch (err) {
            console.warn('[dsh-swarm] config-override.json 损坏，回退基线: ' + String(err));
            return {};
        }
    }
    writeOverride(next) {
        mkdirSync(dirname(this.overrideFile), { recursive: true });
        const tmp = this.overrideFile + '.tmp-' + Date.now();
        writeFileSync(tmp, JSON.stringify(next, null, 2));
        renameSync(tmp, this.overrideFile);
    }
    appendAudit(changed) {
        const line = new Date().toISOString() + ' | ' + changed.join(', ') + '\n';
        try {
            mkdirSync(dirname(this.auditFile), { recursive: true });
            appendFileSync(this.auditFile, line);
        }
        catch { /* 审计失败不阻断 */ }
    }
    diffKeys(prev, next) {
        const keys = new Set();
        for (const k of ['baseUrl', 'pagePrefix']) {
            if (prev.wikiVault?.[k] !== next.wikiVault?.[k])
                keys.add('wikiVault.' + k);
        }
        for (const role of ['v', 'p', 'w', 'd', 'pt', 'dt']) {
            for (const f of ['provider', 'model', 'reasoningEffort']) {
                const a = prev.roles?.models?.[role]?.[f];
                const b = next.roles?.models?.[role]?.[f];
                if (a !== b)
                    keys.add(`roles.models.${role}.${f}`);
            }
        }
        return [...keys];
    }
}
