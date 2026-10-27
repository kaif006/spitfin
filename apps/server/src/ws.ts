import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { TICK_HZ, type ClientMsg, type ServerMsg } from "@spitfin/shared";

export function attachWs(server: Server): WebSocketServer {
  // maxPayload mirrors the 1 KB cap from the security plan.
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 });

  const send = (ws: WebSocket, m: ServerMsg) => ws.send(JSON.stringify(m));

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
