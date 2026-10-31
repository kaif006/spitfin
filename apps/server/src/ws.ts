import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { TICK_HZ, decodeClient, encodeServer } from "@spitfin/shared";
import { rewindFromRtt, smoothRtt } from "./rooms/lag.js";
import type { Connection, Lobby } from "./rooms/lobby.js";
import { originAllowed } from "./security/csrf.js";
import { TokenBucket } from "./security/bucket.js";
import { consumeTicket, type TicketStore } from "./security/ticket.js";

/** The part of the lobby the socket layer uses, so tests can pass a fake. */
export type WsLobby = Pick<Lobby, "connect" | "disconnect" | "join" | "leave" | "input" | "setRewind">;

export type WsDeps = {
  tickets: TicketStore;
  lobby: WsLobby;
  /** The display name for a user id, or null if the user no longer exists. */
  findName: (userId: string) => Promise<string | null>;
  /** Cap on messages per socket. Defaults to WS_MSG_RATE and WS_MSG_BURST. */
  rate?: { perSecond: number; burst: number };
  /** How often the server pings each socket to measure latency, in ms. Defaults to WS_PING_MS. */
  pingMs?: number;
};

/** About 40 messages per second per socket (Section 10). The client sends 30 inputs a second plus pings. */
export const WS_MSG_RATE = 40;
export const WS_MSG_BURST = 80;
/** Latency is measured with a WebSocket ping frame this often. */
export const WS_PING_MS = 2000;

/** A socket whose ticket was accepted. `userId` is who the ticket was issued for. */
export type AuthedSocket = WebSocket & { userId: string; displayName: string };

// Answers the upgrade request with a plain HTTP error and closes the connection.
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWs(server: Server, deps: WsDeps): WebSocketServer {
  // noServer: we run the upgrade ourselves so the ticket is checked before a socket exists.
  // maxPayload mirrors the 1 KB cap from the security plan.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const rate = deps.rate ?? { perSecond: WS_MSG_RATE, burst: WS_MSG_BURST };
  const pingMs = deps.pingMs ?? WS_PING_MS;

  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // A client that vanishes mid-handshake is not an error worth crashing for.
    socket.on("error", () => { });

    const [path, query = ""] = (req.url ?? "").split("?", 2);
    if (path !== "/ws") return refuse(socket, 404, "Not Found");

    // Checked first, so a cross-site page cannot burn someone's ticket.
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      return refuse(socket, 403, "Forbidden");
    }

    const ticket = new URLSearchParams(query).get("ticket");
    let userId: string | null = null;
    try {
      if (ticket !== null) userId = await consumeTicket(deps.tickets, ticket);
    } catch {
      return refuse(socket, 503, "Service Unavailable");
    }
    if (userId === null) return refuse(socket, 401, "Unauthorized");

    // The name is looked up here, before the socket exists, so the message handler
    // never has to wait for it.
    let name: string | null;
    try {
      name = await deps.findName(userId);
    } catch {
      return refuse(socket, 503, "Service Unavailable");
    }
    if (name === null) return refuse(socket, 401, "Unauthorized");

    const verified = userId;
    const displayName = name;
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as AuthedSocket).userId = verified;
      (ws as AuthedSocket).displayName = displayName;
      wss.emit("connection", ws, req);
    });
  }

  server.on("upgrade", (req, socket, head) => {
    upgrade(req, socket, head).catch(() => refuse(socket, 500, "Internal Server Error"));
  });

  wss.on("connection", (raw) => {
    const ws = raw as AuthedSocket;
    const { userId, displayName } = ws;
    const lobby = deps.lobby;
    const bucket = new TokenBucket(rate.perSecond, rate.burst);

    const send = (data: string) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    };
    const conn: Connection = {
      send,
      close: (code, reason) => ws.close(code, reason),
    };

    // Latency: ping frames are answered by the browser itself, so the client needs no code for this.
    let pingSentAt = 0; // 0 means no ping is waiting for its pong
    let rtt: number | null = null;
    const pinger = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      pingSentAt = performance.now();
      ws.ping();
    }, pingMs);
    ws.on("pong", () => {
      if (pingSentAt === 0) return; // not an answer to one of our pings
      rtt = smoothRtt(rtt, performance.now() - pingSentAt);
      pingSentAt = 0;
      lobby.setRewind(userId, rewindFromRtt(rtt));
    });

    // A socket error is always followed by a close, which does the cleanup.
    ws.on("error", () => { });
    ws.on("close", () => {
      clearInterval(pinger);
      lobby.disconnect(userId, conn);
    });

    send(encodeServer({ t: "welcome", tickHz: TICK_HZ }));
    lobby.connect(userId, displayName, conn);

    ws.on("message", (data, isBinary) => {
      // After we have asked a socket to close, more messages may still arrive. Ignore them.
      if (ws.readyState !== ws.OPEN) return;
      if (isBinary) return ws.close(1003, "text only");
      if (!bucket.take()) return ws.close(1008, "rate");

      const msg = decodeClient(data.toString());
      if (msg === null) return ws.close(1008, "bad message");

      switch (msg.t) {
        case "ping":
          send(encodeServer({ t: "pong", n: msg.n }));
          break;
        case "join":
          lobby.join(userId);
          break;
        case "leave":
          lobby.leave(userId);
          break;
        case "input":
          lobby.input(userId, msg);
          break;
      }
    });
  });

  return wss;
}
