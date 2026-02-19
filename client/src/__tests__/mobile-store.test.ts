import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../stores/useStore";

// Reset store between tests
function resetStore() {
  useStore.setState({
    isMobile: false,
    forceDesktop: false,
    mobileView: "dashboard",
    mobileSessionId: null,
    mobileStatusFilter: "all",
    mobileSearchQuery: "",
  });
}

describe("mobile store state", () => {
  beforeEach(resetStore);

  it("defaults isMobile to false", () => {
    expect(useStore.getState().isMobile).toBe(false);
  });

  it("setIsMobile(true) updates isMobile", () => {
    useStore.getState().setIsMobile(true);
    expect(useStore.getState().isMobile).toBe(true);
  });

  it("mobileView defaults to dashboard", () => {
    expect(useStore.getState().mobileView).toBe("dashboard");
  });

  it("setMobileView updates mobileView", () => {
    useStore.getState().setMobileView("detail");
    expect(useStore.getState().mobileView).toBe("detail");
  });

  it("setMobileView to terminal works", () => {
    useStore.getState().setMobileView("terminal");
    expect(useStore.getState().mobileView).toBe("terminal");
  });

  it("mobileStatusFilter defaults to all", () => {
    expect(useStore.getState().mobileStatusFilter).toBe("all");
  });

  it("setMobileStatusFilter updates filter", () => {
    useStore.getState().setMobileStatusFilter("waiting_input");
    expect(useStore.getState().mobileStatusFilter).toBe("waiting_input");
  });

  it("mobileSearchQuery defaults to empty string", () => {
    expect(useStore.getState().mobileSearchQuery).toBe("");
  });

  it("setMobileSearchQuery updates query", () => {
    useStore.getState().setMobileSearchQuery("foo");
    expect(useStore.getState().mobileSearchQuery).toBe("foo");
  });

  it("setForceDesktop persists to localStorage", () => {
    useStore.getState().setForceDesktop(true);
    expect(useStore.getState().forceDesktop).toBe(true);
    expect(localStorage.getItem("openui-force-desktop")).toBe("true");
  });

  it("mobileSessionId defaults to null", () => {
    expect(useStore.getState().mobileSessionId).toBe(null);
  });

  it("setMobileSessionId sets the id", () => {
    useStore.getState().setMobileSessionId("node-abc");
    expect(useStore.getState().mobileSessionId).toBe("node-abc");
  });
});
