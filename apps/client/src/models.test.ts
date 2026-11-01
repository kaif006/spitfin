import { describe, expect, it } from "vitest";
import { bugFloatingGeo, bugFlyingGeo, fishBodyGeo, fishEyeGeo, makeFishSkin } from "./models";

describe("models", () => {
  it("gives every vertex a position and a colour", () => {
    for (const g of [fishBodyGeo, fishEyeGeo, bugFlyingGeo, bugFloatingGeo]) {
      const pos = g.getAttribute("position");
      expect(pos.count).toBeGreaterThan(0);
      expect(g.getAttribute("color").count).toBe(pos.count);
      expect(g.getAttribute("normal").count).toBe(pos.count);
    }
  });

  it("has wings on a flying bug and none on a floating one", () => {
    expect(bugFlyingGeo.getAttribute("position").count).toBeGreaterThan(bugFloatingGeo.getAttribute("position").count);
  });

  it("feeds the swim phase and amplitude into the shader", () => {
    const skin = makeFishSkin(0xff0000);
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: "#include <common>\n#include <begin_vertex>",
    };
    skin.material.onBeforeCompile(shader as never, {} as never);
    skin.setSwim(2, 0.5);
    expect(shader.uniforms.uPhase!.value).toBe(2);
    expect(shader.uniforms.uAmp!.value).toBe(0.5);
    expect(shader.vertexShader).toContain("uPhase");
  });
});
