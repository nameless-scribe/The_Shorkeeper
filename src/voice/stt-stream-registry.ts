import type { SttStreamSession } from './bailian-stt';

/** Owns live STT sockets and invalidates async starts when a call is restarted or ended. */
export class SttStreamRegistry {
  private readonly sessions = new Map<string, SttStreamSession>();
  private readonly generations = new Map<string, number>();

  get(callId: string): SttStreamSession | undefined {
    return this.sessions.get(callId);
  }

  take(callId: string): SttStreamSession | undefined {
    const session = this.sessions.get(callId);
    this.sessions.delete(callId);
    return session;
  }

  abort(callId: string): void {
    this.generations.set(callId, (this.generations.get(callId) ?? 0) + 1);
    const session = this.sessions.get(callId);
    if (session) {
      session.abort();
      this.sessions.delete(callId);
    }
  }

  async start(
    callId: string,
    create: () => Promise<SttStreamSession>,
    isCallValid: () => boolean,
  ): Promise<boolean> {
    this.abort(callId);
    const generation = this.generations.get(callId)!;
    const session = await create();

    if (this.generations.get(callId) !== generation || !isCallValid()) {
      session.abort();
      return false;
    }

    this.sessions.get(callId)?.abort();
    this.sessions.set(callId, session);
    return true;
  }

  abortAll(): void {
    const callIds = new Set([...this.generations.keys(), ...this.sessions.keys()]);
    for (const callId of callIds) this.abort(callId);
  }

  size(): number {
    return this.sessions.size;
  }
}
