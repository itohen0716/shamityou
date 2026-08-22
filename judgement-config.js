(() => {
  "use strict";

  const config = Object.freeze({
    toleranceCents: 7,
    stableDurationMs: 1000,
    sequenceAdvanceDelayMs: 500
  });

  Object.defineProperty(window, "ShianJudgementConfig", {
    value: config,
    writable: false,
    configurable: false,
    enumerable: true
  });
})();
