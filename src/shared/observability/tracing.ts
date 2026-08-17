import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';

let initialized = false;

/**
 * Starts the OpenTelemetry SDK only when an OTLP endpoint is configured.
 * Without it, `trace.getTracer()` returns a no-op tracer, so the rest of the
 * code can instrument freely without crashing in local/dev.
 */
export function initTracing(serviceName = 'order-api'): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  console.log(`OpenTelemetry tracing initialised (exporting to ${endpoint})`);
}
