import { getWsTicket } from "../auth/session";
import { NetClient } from "./client";
import { createMatchStore } from "./matchStore";

export const match = createMatchStore();

const urlFor = (ticket: string): string => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?ticket=${encodeURIComponent(ticket)}`;
};

export const net = new NetClient(
  { onMessage: (m) => match.handle(m), onStatus: (s) => match.setLink(s) },
  getWsTicket,
  urlFor,
);
