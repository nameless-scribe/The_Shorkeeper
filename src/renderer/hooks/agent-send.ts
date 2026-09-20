export interface AgentSendResponse {
  ok: boolean;
  error?: string;
  runId?: string | null;
}

/**
 * Renderer IPC transport failures must resolve through the UI rollback path instead of
 * escaping as an unhandled rejection. Domain failures remain normal response values.
 */
export async function sendAgentRequestSafely(
  send: () => Promise<AgentSendResponse>,
  onTransportFailure: (message: string) => void,
): Promise<AgentSendResponse | null> {
  try {
    return await send();
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : '消息发送失败，请重试';
    onTransportFailure(message);
    return null;
  }
}
