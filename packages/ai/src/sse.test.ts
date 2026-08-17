import { describe, expect, it } from "vitest";
import { readNDJSON, readSSE } from "./sse";

const encoder = new TextEncoder();

describe("readSSE", () => {
  it("yields CRLF-delimited events before the response closes", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const iterator = readSSE(new Response(stream));

    controller.enqueue(encoder.encode('data: {"value":1}\r\n\r\n'));
    const result = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("event was not streamed")), 100)),
    ]);

    expect(result.value).toEqual({ value: 1 });
    controller.close();
  });

  it("handles LF delimiters split across network chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"value":'));
        controller.enqueue(encoder.encode("2}\n"));
        controller.enqueue(encoder.encode("\n"));
        controller.close();
      },
    });

    const values = [];
    for await (const value of readSSE(new Response(stream))) values.push(value);
    expect(values).toEqual([{ value: 2 }]);
  });
});

describe("readNDJSON", () => {
  it("parses the final record without a trailing newline", async () => {
    const response = new Response(encoder.encode('{"value":3}'));
    const values = [];
    for await (const value of readNDJSON(response)) values.push(value);
    expect(values).toEqual([{ value: 3 }]);
  });
});