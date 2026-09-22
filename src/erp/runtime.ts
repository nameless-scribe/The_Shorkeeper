import type { ErpConnectionInfo } from '../shared/types';
import type { ErpReadContext } from './read-client';

export interface ErpTimeEntryInput {
  origin: string;
  taskId: string;
  taskName: string;
  workDate: string;
  workMinutes: number;
  workContent: string;
}

export interface ErpSubmitDispatchResult {
  status: 'accepted' | 'known_not_written' | 'outcome_unknown';
  message?: string;
}

export interface ErpRuntimePort {
  connect(): Promise<ErpConnectionInfo>;
  status(): ErpConnectionInfo;
  readContext(workDate: string): Promise<ErpReadContext>;
  submitTimeEntry(input: ErpTimeEntryInput, signal?: AbortSignal): Promise<ErpSubmitDispatchResult>;
}

let runtime: ErpRuntimePort | null = null;

export function setErpRuntime(port: ErpRuntimePort | null): void { runtime = port; }

export function getErpRuntime(): ErpRuntimePort {
  if (!runtime) throw new Error('ERP 运行时尚未初始化');
  return runtime;
}
