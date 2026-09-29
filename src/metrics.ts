import client from "prom-client";

client.collectDefaultMetrics();

/** Incremented by the logger on every error-level log event. */
export const errorsTotal = new client.Counter({
  name: "errors_total",
  help: "Total number of error-level log events",
});

export const metricsRegistry = client.register;
