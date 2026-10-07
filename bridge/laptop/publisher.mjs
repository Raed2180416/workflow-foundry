// Mailbox publisher: keeps bridge-state/endpoint.json current and the trusted keys fresh.
//  - every tunnel poll (default 15 s): look up the tunnel URL; a change publishes at once
//  - every refresh (default 5 min): git fetch the mailbox, reload keys, apply the KILL switch
//  - heartbeat (default and minimum 15 min): republish endpoint.json with a new heartbeatAt
// The publisher's own steps run on one promise chain; the git work inside them is serialized with
// every other user of the clone by the mailbox lock (mailbox.mjs). Failures back off and never stop
// the daemon.
import { buildEndpoint } from '../mailbox.mjs';

export class Publisher {
  #chain = Promise.resolve(); #timer = null; #stopped = false;
  #lastRefresh = 0; #lastPublish = 0; #dirty = true; #failures = 0; #nextAttempt = 0;
  constructor({ mailbox, refresh, snapshot, discoverTunnel, heartbeatMs = 15 * 60_000, refreshMs = 5 * 60_000, pollMs = 15_000, log = () => {}, daemonVersion, startedAt, now = () => Date.now() }) {
    Object.assign(this, { mailbox, refresh, snapshot, discoverTunnel, heartbeatMs, refreshMs, pollMs, log, daemonVersion, startedAt, now });
    this.tunnel = { url: null, source: null };
    this.lastError = null;
  }
  start() {
    this.#enqueue(() => this.#tick());
    this.#timer = setInterval(() => this.#enqueue(() => this.#tick()), this.pollMs);
    this.#timer.unref?.();
    return this;
  }
  poke() { this.#dirty = true; this.#enqueue(() => this.#tick()); }
  idle() { return this.#chain; }
  #enqueue(fn) { if (this.#stopped) return this.#chain; this.#chain = this.#chain.then(fn).catch(error => this.log(`publisher: ${error.message}`)); return this.#chain; }

  async #tick() {
    const now = this.now();
    try {
      const t = await this.discoverTunnel();
      if (t.url !== this.tunnel.url) { this.log(`tunnel URL ${t.url ?? '(none)'} via ${t.source ?? '-'}`); this.tunnel = t; this.#dirty = true; }
    } catch (error) { this.log(`tunnel discovery failed: ${error.message}`); }
    if (!this.#lastRefresh || now - this.#lastRefresh >= this.refreshMs) {
      this.#lastRefresh = now;
      try { await this.refresh(); } catch (error) { this.lastError = `refresh: ${error.message}`; this.log(`mailbox refresh failed: ${error.message}`); }
    }
    const due = this.#dirty || now - this.#lastPublish >= this.heartbeatMs;
    if (due && now >= this.#nextAttempt) await this.#publish('up');
  }

  async #publish(state) {
    const snap = await this.snapshot();
    const endpoint = buildEndpoint({ url: state === 'stopped' ? null : this.tunnel.url, tunnelSource: this.tunnel.source, tunnelReadyConnections: state === 'stopped' ? null : snap.tunnelReadyConnections, daemonVersion: this.daemonVersion, startedAt: this.startedAt, heartbeatAt: new Date(this.now()).toISOString(), gpu: snap.gpu, services: state === 'stopped' ? [] : snap.services, state });
    try {
      const r = await this.mailbox.publishEndpoint(endpoint);
      this.#lastPublish = this.now(); this.#dirty = false; this.#failures = 0; this.#nextAttempt = 0; this.lastError = null;
      this.lastPublished = { at: endpoint.heartbeatAt, url: endpoint.url, head: r.head, pushed: r.pushed };
      this.log(`endpoint published (${state}, url ${endpoint.url ?? 'none'}, ${r.pushed ? `pushed ${r.head.slice(0, 8)}` : 'unchanged'})`);
    } catch (error) {
      this.#failures++;
      const backoff = Math.min(15 * 60_000, 30_000 * 2 ** (this.#failures - 1));
      this.#nextAttempt = this.now() + backoff;
      this.lastError = `publish: ${error.message}`;
      this.log(`endpoint publish failed (${this.#failures}x, retry in ${Math.round(backoff / 1000)} s): ${error.message}`);
    }
  }

  async stop({ timeoutMs = 20_000 } = {}) {
    clearInterval(this.#timer);
    await this.#chain;
    this.#stopped = true;
    await Promise.race([this.#publish('stopped'), new Promise(r => setTimeout(r, timeoutMs).unref())]);
  }
}
