import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "../app/capabilities";
import {
  HUBS,
  SERVICES,
  auditRegistry,
  isRunnable,
  searchServices,
  servicesForHub,
} from "./serviceRegistry";

const hubIds = new Set(HUBS.map((hub) => hub.id));

describe("canonical service registry", () => {
  it("passes its own honesty audit", () => {
    expect(auditRegistry()).toEqual([]);
  });

  it("has unique service identifiers", () => {
    const ids = SERVICES.map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("attaches every service to a real hub", () => {
    for (const service of SERVICES) {
      expect(hubIds.has(service.hub), service.id).toBe(true);
    }
  });

  it("gives every hub a route that exists in the capability registry", () => {
    for (const hub of HUBS) {
      expect(CAPABILITIES[hub.route], hub.id).toBeDefined();
      expect(servicesForHub(hub.id).length, hub.id).toBeGreaterThan(1);
    }
  });

  it("never advertises a runnable service without a destination", () => {
    for (const service of SERVICES.filter(isRunnable)) {
      expect(service.route, service.id).toBeTruthy();
    }
  });

  it("keeps blocked work out of the runnable set", () => {
    const blocked = SERVICES.filter(
      (service) => service.status === "BLOCKED" || service.status === "NOT-IMPLEMENTED",
    );
    expect(blocked.length).toBeGreaterThan(10);
    for (const service of blocked) {
      expect(isRunnable(service), service.id).toBe(false);
      expect(service.needs, service.id).toBeTruthy();
    }
  });

  it("keeps model-backed work out of the verified column", () => {
    for (const service of SERVICES) {
      if (service.mode === "MODEL-LOCAL" || service.mode === "ONLINE" || service.mode === "UNAVAILABLE") {
        expect(service.status, `${service.id} is ${service.mode} but ${service.status}`).not.toBe(
          "VERIFIED",
        );
      }
    }
  });

  it("does not claim a verified service inside a hub that cannot open", () => {
    for (const service of SERVICES.filter((entry) => entry.status === "VERIFIED")) {
      if (!service.route) continue;
      const capability = CAPABILITIES[service.route];
      expect(
        ["NOT_IMPLEMENTED", "BLOCKED", "MISSING_ENGINE"].includes(capability.state),
        `${service.id} claims VERIFIED inside ${service.route} (${capability.state})`,
      ).toBe(false);
    }
  });

  it("only offers the Live Studio shortcut for work that can actually run", () => {
    for (const service of SERVICES.filter((entry) => entry.studio)) {
      expect(isRunnable(service), service.id).toBe(true);
    }
  });

  it("searches English labels, Arabic labels and blockers", () => {
    expect(searchServices("watermark").some((service) => service.id === "el-marks")).toBe(true);
    expect(searchServices("تمويه").length).toBeGreaterThan(0);
    expect(searchServices("segmentation").every((service) => Boolean(service.needs))).toBe(true);
    expect(searchServices("").length).toBe(SERVICES.length);
    expect(searchServices("zzzz-no-such-service").length).toBe(0);
  });

  it("covers both ends of the execution modes", () => {
    const modes = new Set(SERVICES.map((service) => service.mode));
    expect(modes.has("LOCAL")).toBe(true);
    expect(modes.has("MODEL-LOCAL")).toBe(true);
    expect(modes.has("ONLINE")).toBe(true);
  });
});
