type Subscriber = {
  send: (data: unknown) => void;
};

// Simple in-memory pub/sub for SSE streaming. Survives within a single Next.js
// server instance (dev or production) but not across server restarts.
const subscribers = new Set<Subscriber>();

export const addSubscriber = (send: Subscriber["send"]) => {
  const sub = { send };
  subscribers.add(sub);
  return () => subscribers.delete(sub);
};

export const broadcast = (payload: unknown) => {
  for (const sub of subscribers) {
    try {
      sub.send(payload);
    } catch {
      // Drop dead listeners quietly
      subscribers.delete(sub);
    }
  }
};

export const subscriberCount = () => subscribers.size;
