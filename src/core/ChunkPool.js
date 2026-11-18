// A small pool of chunk workers (core/chunkWorker.js) for one World.
//
// Jobs are not queued here. The World walks its chunks nearest-first every
// frame and hands out a job only while the pool has a free slot, so what runs
// next is always decided against where the player is *now* — a queue would
// keep working through chunks the player has already left behind.
//
// Results are collected, not applied: the World drains `gens` and `meshes`
// at the start of its update, so the scene only ever changes inside the frame
// loop.

// Workers, leaving cores for the page, the GPU process and the browser.
function poolSize() {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(4, cores - 2));
}

// Jobs in flight per worker. More than one, so a worker that finishes
// mid-frame has the next job waiting instead of idling until the page's next
// update; three filled a fresh load disc about 30% sooner than two, and past
// that the page's own per-frame mesh limit is what holds things up.
const PER_WORKER = 3;

export class ChunkPool {
  // init: { seed, genMode, map, tables } — see chunkWorker.js. Throws if
  // workers are unavailable; the World then builds chunks on the main thread.
  constructor(init) {
    this.workers = [];
    this.load = [];       // jobs in flight, per worker
    this.gens = [];       // finished generation results: { id, blocks, lights }
    this.meshes = [];     // finished mesh results: { id, mesh, vol } (vol = the job's snapshot, to reuse)
    this.failed = false;  // a worker died — the World abandons the pool
    this._owner = new Map(); // job id -> worker index
    this._nextId = 1;
    const size = poolSize();
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this._done(e.data);
      w.onerror = (e) => {
        if (!this.failed) console.warn('[chunks] worker failed, building on the main thread instead:', e.message || e);
        this.failed = true;
      };
      w.postMessage({ type: 'init', ...init });
      this.workers.push(w);
      this.load.push(0);
    }
    this.slots = size * PER_WORKER;
  }

  // Slots open for new jobs. Finished meshes the World has not drawn yet
  // count against it, so workers cannot run ahead of the page.
  get free() {
    let busy = this.meshes.length;
    for (let i = 0; i < this.load.length; i++) busy += this.load[i];
    return this.slots - busy;
  }

  _send(msg, transfer) {
    let wi = 0;
    for (let i = 1; i < this.load.length; i++) if (this.load[i] < this.load[wi]) wi = i;
    msg.id = this._nextId++;
    this._owner.set(msg.id, wi);
    this.load[wi]++;
    this.workers[wi].postMessage(msg, transfer);
    return msg.id;
  }

  // Generate chunk (cx, cz). Returns the job id.
  gen(cx, cz) {
    return this._send({ type: 'gen', cx, cz }, []);
  }

  // Mesh chunk (cx, cz) from its snapshot, which is handed over to the worker.
  mesh(cx, cz, vol) {
    return this._send({ type: 'mesh', cx, cz, vol }, [vol.buffer]);
  }

  _done(msg) {
    const wi = this._owner.get(msg.id);
    if (wi === undefined) return;
    this._owner.delete(msg.id);
    this.load[wi]--;
    (msg.mesh ? this.meshes : this.gens).push(msg);
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.load.length = 0;
    this.gens.length = 0;
    this.meshes.length = 0;
    this._owner.clear();
    this.slots = 0;
  }
}
