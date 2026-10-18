import { AsyncLocalStorage } from 'node:async_hooks';

const execution = new AsyncLocalStorage();
export function withExecution(context, action) {
  return execution.run(context, action);
}
export function waitUntil(promise) {
  const context = execution.getStore();
  if (!context) throw new Error('No active Worker execution context');
  context.waitUntil(promise);
}
