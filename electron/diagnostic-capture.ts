/** A bounded, correlated handshake; transport IDs never enter the diagnostic log. */
export class DiagnosticSnapshotCapture {
  private sequence = 0;
  private pending?: { id: string; finish: (captured: boolean) => void };

  capture(send: (requestId: string) => void): Promise<boolean> {
    // Export is serialized by the caller; refuse accidental overlap without stealing its reply.
    if (this.pending) return Promise.resolve(false);
    const id = `snapshot-${++this.sequence}`;
    return new Promise(resolve => {
      const finish = (captured: boolean) => {
        if (this.pending?.id !== id) return;
        clearTimeout(timer);
        this.pending = undefined;
        resolve(captured);
      };
      // Slow/emulated renderers need more than 300 ms. A hung renderer must still export logs.
      const timer = setTimeout(() => finish(false), 5000);
      this.pending = { id, finish };
      try { send(id); } catch { finish(false); }
    });
  }

  acknowledge(requestId: unknown): void {
    if (typeof requestId === 'string' && requestId === this.pending?.id) this.pending.finish(true);
  }
}
