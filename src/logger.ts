import pino from "pino";
import { config } from "./config.js";
import { errorsTotal } from "./metrics.js";

/** Structured JSON logger; every error-level (or higher) event increments errors_total. */
export const logger = pino({
  level: config.LOG_LEVEL,
  hooks: {
    logMethod(args, method, level) {
      if (level >= pino.levels.values.error) {
        errorsTotal.inc();
      }
      method.apply(this, args);
    },
  },
});
