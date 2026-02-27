import { addSubscriber } from "@/lib/streamBus";

export const runtime = "nodejs";

export async function GET() {
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const unsubscribe = addSubscriber(send);
      send({ type: "hello", ts: Date.now() });
      const heartbeat = setInterval(() => send({ type: "ping", ts: Date.now() }), 20000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
