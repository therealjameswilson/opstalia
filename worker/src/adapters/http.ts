export async function readBoundedUtf8Body(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  label: string
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel(`${label} exceeded ${maxBytes} bytes`);
        throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`${label} was not valid UTF-8`, { cause: error });
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJsonResponse(
  response: Response,
  sourceName: string,
  maxBytes: number
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase().includes("application/json")) {
    throw new Error(`${sourceName} did not return JSON`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maxBytes
  ) {
    throw new Error(`${sourceName} response exceeds the ${maxBytes}-byte limit`);
  }
  const text = await readBoundedUtf8Body(
    response.body,
    maxBytes,
    `${sourceName} response`
  );
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${sourceName} returned malformed JSON`);
  }
}
