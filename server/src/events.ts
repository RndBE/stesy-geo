// Server-Sent Events untuk pembaruan dashboard mendekati real-time (latensi < 5 menit, PRD 10).
import type { Response } from 'express';

const clients = new Set<Response>();

export function subscribe(res: Response) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: hello\ndata: {}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(`: ping\n\n`), 25e3);
  res.on('close', () => { clearInterval(ping); clients.delete(res); });
}

export function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
