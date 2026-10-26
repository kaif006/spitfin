export type ServerMsg = { t: "welcome"; tickHz: number } | { t: "pong"; n: number };
export type ClientMsg = { t: "ping"; n: number };
