/// <reference lib="webworker" />

interface ExportRequest {
  id: string;
  sourceBytes: ArrayBuffer;
  expectedSourceSha256: string;
  ranges: import("./derivative-processor").DerivativeProcessorRange[];
}

import { processDerivativeBatch } from "./derivative-processor";

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  const request = event.data;
  try {
    const { outputs, sourceSha256 } = await processDerivativeBatch(request);
    self.postMessage(
      { id: request.id, ok: true, outputs, sourceSha256 },
      { transfer: outputs.map((item) => item.output) }
    );
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : "Unable to create the research derivative."
    });
  }
};

export {};
