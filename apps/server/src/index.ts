import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { TICK_HZ, type ClientMsg, type ServerMsg } from "@spitfin/shared";

const port = Number(process.env.PORT ?? 8080);

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  res.writeHead(404).end();
});

// maxPayload mirrors the 1 KB cap from the security plan.
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 1024 });

const send = (ws: import("ws").WebSocket, m: ServerMsg) => ws.send(JSON.stringify(m));

wss.on("connection", (ws) => {
  send(ws, { t: "welcome", tickHz: TICK_HZ });
  ws.on("message", (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(data.toString()); } catch { return ws.close(1003); }
    if (msg?.t === "ping" && Number.isFinite(msg.n)) send(ws, { t: "pong", n: msg.n });
    else ws.close(1008, "bad message");
  });
});

http.listen(port, () => console.log(`[spitfin] listening on :${port}`));
