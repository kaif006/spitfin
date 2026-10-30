import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { TICK_HZ, type ClientMsg, type ServerMsg } from "@spitfin/shared";
import { originAllowed } from "./security/csrf.js";
import { consumeTicket, type TicketStore } from "./security/ticket.js";

export type WsDeps = { tickets: TicketStore };

/** A socket whose ticket was accepted. `userId` is who the ticket was issued for. */
export type AuthedSocket = WebSocket & { userId: string };

// Answers the upgrade request with a plain HTTP error and closes the connection.
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWs(server: Server, deps: WsDeps): WebSocketServer {
  // noServer: we run the upgrade ourselves so the ticket is checked before a socket exists.
  // maxPayload mirrors the 1 KB cap from the security plan.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  const send = (ws: WebSocket, m: ServerMsg) => ws.send(JSON.stringify(m));

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

    const verified = userId;
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as AuthedSocket).userId = verified;
      wss.emit("connection", ws, req);
    });
  }

  server.on("upgrade", (req, socket, head) => {
    upgrade(req, socket, head).catch(() => refuse(socket, 500, "Internal Server Error"));
  });

  wss.on("connection", (ws) => {
    send(ws, { t: "welcome", tickHz: TICK_HZ });
    ws.on("message", (data) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(data.toString()); } catch { return ws.close(1003); }
      if (msg?.t === "ping" && Number.isFinite(msg.n)) send(ws, { t: "pong", n: msg.n });
      else ws.close(1008, "bad message");
    });
  });

  return wss;
}
