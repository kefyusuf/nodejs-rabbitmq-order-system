/**
 * Crash-safe defaults: a Node process that hits an uncaught exception or an
 * unhandled promise rejection is in an undefined state, so we log and exit
 * (the orchestrator restarts the process). Call once per entrypoint.
 */
export function registerFaultHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    console.error('Uncaught exception, exiting:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    console.error('Unhandled rejection, exiting:', reason);
    process.exit(1);
  });
}
