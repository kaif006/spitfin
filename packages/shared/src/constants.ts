export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;
export const FISH_SPEED = 4.0;
export const FISH_ACCEL_TIME = 0.15;
export const ARENA = { w: 24, h: 16 } as const;

// ---- Milestone 1: match, spit, nip, bugs ----
export const MATCH_DURATION = 150; // seconds

// Spit
export const SPIT_RANGE = 8.0;
export const SPIT_COOLDOWN = 0.7;

// Nip
export const NIP_DURATION = 0.25;
export const NIP_RANGE = 1.5;
export const NIP_COOLDOWN = 3.0;
export const NIP_IMMUNITY = 2.0;
export const NIP_CONE_DEG = 60;

// Bugs
export const BUG_SPAWN_INTERVAL = 1.0;
export const BUG_MAX_ALIVE = 10;
export const BUG_LIFETIME = 10; // unshot bug despawns after this many seconds
export const BUG_HEIGHT_MIN = 1;
export const BUG_HEIGHT_MAX = 3;
export const BUG_HIT_RADIUS = 0.3;
export const PERCHED_CHANCE = 0.25; // fraction of bugs that sit on reeds

// Falling and floating
export const BUG_FALL_MIN = 0.6; // seconds
export const BUG_FALL_MAX = 1.2;
export const BUG_FLOAT_LIFETIME = 6;
export const MOUTH_RADIUS = 0.6;

// Obstacles
export const OBSTACLE_MIN = 6;
export const OBSTACLE_MAX = 8;
export const OBSTACLE_MARGIN = 1.5; // keep obstacle centres this far from the arena edge
export const OBSTACLE_GAP = 0.8; // minimum free space between two obstacles
export const SPAWN_CLEAR_RADIUS = 3.0; // keep the middle of the pond open
export const REED_RADIUS = 0.4;
export const ROCK_RADIUS = 0.9;
export const REED_HEIGHT = 1.8; // perched bugs sit at this height

// Flying bug paths
export const FLIGHT_MARGIN = 1.0; // flying bugs stay this far inside the arena edge

// Falling and floating details
export const BUG_HIT_POP = 1.0; // small upward kick (u/s) when a jet hits a bug
export const BUG_FALL_DRIFT = 0.8; // max sideways distance a bug drifts while falling
export const FLOAT_DRIFT_SPEED = 0.15; // max drift speed of a floating bug (u/s)
export const FLOAT_EDGE_MARGIN = 0.2; // floating bugs stay this far inside the arena edge
