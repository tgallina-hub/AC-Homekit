import {existsSync, readFileSync, writeFileSync, renameSync} from 'node:fs';

/** Persist absolute deadlines so a bridge restart does not reset a countdown. */
export class LocalScheduler {
    constructor({file, execute, changed = () => {}, log = console, now = Date.now, timers = globalThis}) {
        Object.assign(this, {file, execute, changed, log, now, timers});
        this.handles = new Map();
        this.running = new Set();
        this.jobs = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    }
    save() {
        if (this.file) {
            const temporary = `${this.file}.tmp`;
            writeFileSync(temporary, JSON.stringify(this.jobs, null, 2), {mode: 0o600});
            renameSync(temporary, this.file);
        }
        this.changed();
    }
    resume() { for (const kind of Object.keys(this.jobs)) this.arm(kind); }
    schedule(kind, power, milliseconds, label) {
        if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw Error('Invalid timer duration');
        this.cancel(kind);
        this.jobs[kind] = {id: `${this.now()}-${Math.random()}`, power, deadline: this.now() + milliseconds, label};
        this.save(); this.arm(kind);
    }
    arm(kind, retryDelay) {
        if (this.handles.has(kind)) this.timers.clearTimeout(this.handles.get(kind));
        const job = this.jobs[kind];
        if (!job) return;
        this.handles.set(kind, this.timers.setTimeout(() => this.run(kind), retryDelay ?? Math.max(0, job.deadline - this.now())));
        this.handles.get(kind)?.unref?.();
    }
    async run(kind) {
        const job = this.jobs[kind];
        if (!job || this.running.has(kind)) return;
        this.running.add(kind);
        try {
            await this.execute(job, kind);
            if (this.jobs[kind]?.id === job.id) this.cancel(kind);
        } catch (error) {
            this.log.error(`Timer ${kind} failed; retrying in 30 seconds: ${error}`);
            if (this.jobs[kind]?.id === job.id) this.arm(kind, 30000);
        } finally { this.running.delete(kind); }
    }
    cancel(kind) {
        this.timers.clearTimeout(this.handles.get(kind));
        this.handles.delete(kind);
        delete this.jobs[kind];
        this.save();
    }
    cancelAll() { for (const kind of Object.keys(this.jobs)) this.cancel(kind); }
    stop() { for (const handle of this.handles.values()) this.timers.clearTimeout(handle); this.handles.clear(); }
}
