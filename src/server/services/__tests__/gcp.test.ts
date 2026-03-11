import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectGcpDefaults, defaultVertexLocation } from "../gcp.js";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof fs>("node:fs");
  return { ...actual, existsSync: vi.fn(() => false) };
});

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof fsPromises>("node:fs/promises");
  return { ...actual, readFile: vi.fn() };
});

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFile = vi.mocked(fsPromises.readFile);

describe("detectGcpDefaults", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all GCP-related env vars
    for (const key of [
      "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "ANTHROPIC_VERTEX_PROJECT_ID",
      "CLOUD_SDK_PROJECT", "GOOGLE_VERTEX_PROJECT",
      "GOOGLE_CLOUD_LOCATION", "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]) {
      delete process.env[key];
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── Project ID priority ──

  it("returns null when no env vars are set", async () => {
    const result = await detectGcpDefaults();
    expect(result.projectId).toBeNull();
    expect(result.location).toBeNull();
    expect(result.serviceAccountJson).toBeNull();
    expect(result.sources).toEqual({});
  });

  it("picks GOOGLE_CLOUD_PROJECT first", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
    process.env.GCLOUD_PROJECT = "proj-2";
    process.env.ANTHROPIC_VERTEX_PROJECT_ID = "proj-3";

    const result = await detectGcpDefaults();
    expect(result.projectId).toBe("proj-1");
    expect(result.sources.projectId).toBe("GOOGLE_CLOUD_PROJECT");
  });

  it("falls back to GCLOUD_PROJECT", async () => {
    process.env.GCLOUD_PROJECT = "proj-2";
    process.env.ANTHROPIC_VERTEX_PROJECT_ID = "proj-3";

    const result = await detectGcpDefaults();
    expect(result.projectId).toBe("proj-2");
    expect(result.sources.projectId).toBe("GCLOUD_PROJECT");
  });

  it("falls back to ANTHROPIC_VERTEX_PROJECT_ID", async () => {
    process.env.ANTHROPIC_VERTEX_PROJECT_ID = "proj-3";
    process.env.CLOUD_SDK_PROJECT = "proj-4";

    const result = await detectGcpDefaults();
    expect(result.projectId).toBe("proj-3");
    expect(result.sources.projectId).toBe("ANTHROPIC_VERTEX_PROJECT_ID");
  });

  it("falls back to CLOUD_SDK_PROJECT", async () => {
    process.env.CLOUD_SDK_PROJECT = "proj-4";
    process.env.GOOGLE_VERTEX_PROJECT = "proj-5";

    const result = await detectGcpDefaults();
    expect(result.projectId).toBe("proj-4");
    expect(result.sources.projectId).toBe("CLOUD_SDK_PROJECT");
  });

  it("falls back to GOOGLE_VERTEX_PROJECT", async () => {
    process.env.GOOGLE_VERTEX_PROJECT = "proj-5";

    const result = await detectGcpDefaults();
    expect(result.projectId).toBe("proj-5");
    expect(result.sources.projectId).toBe("GOOGLE_VERTEX_PROJECT");
  });

  // ── Location priority ──

  it("picks GOOGLE_CLOUD_LOCATION first", async () => {
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
    process.env.GOOGLE_VERTEX_LOCATION = "us-east1";

    const result = await detectGcpDefaults();
    expect(result.location).toBe("us-central1");
    expect(result.sources.location).toBe("GOOGLE_CLOUD_LOCATION");
  });

  it("falls back to GOOGLE_VERTEX_LOCATION", async () => {
    process.env.GOOGLE_VERTEX_LOCATION = "us-east1";

    const result = await detectGcpDefaults();
    expect(result.location).toBe("us-east1");
    expect(result.sources.location).toBe("GOOGLE_VERTEX_LOCATION");
  });

  // ── Credentials file detection ──

  it("reads SA JSON from GOOGLE_APPLICATION_CREDENTIALS", async () => {
    const saJson = JSON.stringify({ project_id: "from-sa", client_email: "sa@test.iam" });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/sa.json";
    mockExistsSync.mockImplementation((p) => p === "/path/to/sa.json");
    mockReadFile.mockResolvedValue(saJson);

    const result = await detectGcpDefaults();
    expect(result.serviceAccountJson).toBe(saJson);
    expect(result.serviceAccountJsonPath).toBe("/path/to/sa.json");
    expect(result.sources.credentials).toContain("GOOGLE_APPLICATION_CREDENTIALS");
  });

  it("extracts project_id from SA JSON when no env var project ID is set", async () => {
    const saJson = JSON.stringify({ project_id: "from-sa-json" });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/sa.json";
    mockExistsSync.mockImplementation((p) => p === "/path/to/sa.json");
    mockReadFile.mockResolvedValue(saJson);

    const result = await detectGcpDefaults();
    expect(result.projectId).toBe("from-sa-json");
    expect(result.sources.projectId).toContain("project_id field");
  });

  it("env var project ID takes precedence over SA JSON project_id", async () => {
    const saJson = JSON.stringify({ project_id: "from-sa-json" });
    process.env.GOOGLE_CLOUD_PROJECT = "from-env";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/sa.json";
    mockExistsSync.mockImplementation((p) => p === "/path/to/sa.json");
    mockReadFile.mockResolvedValue(saJson);

    const result = await detectGcpDefaults();
    expect(result.projectId).toBe("from-env");
    expect(result.sources.projectId).toBe("GOOGLE_CLOUD_PROJECT");
  });

  it("detects credential type from SA JSON", async () => {
    const saJson = JSON.stringify({ type: "service_account", project_id: "proj" });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/sa.json";
    mockExistsSync.mockImplementation((p) => p === "/path/to/sa.json");
    mockReadFile.mockResolvedValue(saJson);

    const result = await detectGcpDefaults();
    expect(result.credentialType).toBe("service_account");
  });

  it("detects authorized_user credential type", async () => {
    const adcJson = JSON.stringify({ type: "authorized_user", client_id: "xxx" });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/adc.json";
    mockExistsSync.mockImplementation((p) => p === "/path/to/adc.json");
    mockReadFile.mockResolvedValue(adcJson);

    const result = await detectGcpDefaults();
    expect(result.credentialType).toBe("authorized_user");
  });

  it("returns null credentialType when no credentials found", async () => {
    const result = await detectGcpDefaults();
    expect(result.credentialType).toBeNull();
  });

  it("skips invalid JSON credential files", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/bad.json";
    mockExistsSync.mockImplementation((p) => p === "/path/to/bad.json");
    mockReadFile.mockResolvedValue("not valid json {{{");

    const result = await detectGcpDefaults();
    expect(result.serviceAccountJson).toBeNull();
  });

  it("skips non-existent credential files", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/does/not/exist.json";
    mockExistsSync.mockReturnValue(false);

    const result = await detectGcpDefaults();
    expect(result.serviceAccountJson).toBeNull();
  });

  // ── Combined scenarios ──

  it("detects all three: project, location, and credentials", async () => {
    const saJson = JSON.stringify({ project_id: "sa-proj", client_email: "sa@test.iam" });
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    process.env.GOOGLE_CLOUD_LOCATION = "europe-west1";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/sa.json";
    mockExistsSync.mockImplementation((p) => p === "/sa.json");
    mockReadFile.mockResolvedValue(saJson);

    const result = await detectGcpDefaults();
    expect(result.projectId).toBe("my-project");
    expect(result.location).toBe("europe-west1");
    expect(result.serviceAccountJson).toBe(saJson);
    expect(result.sources.projectId).toBe("GOOGLE_CLOUD_PROJECT");
    expect(result.sources.location).toBe("GOOGLE_CLOUD_LOCATION");
    expect(result.sources.credentials).toContain("GOOGLE_APPLICATION_CREDENTIALS");
  });
});

describe("defaultVertexLocation", () => {
  it("returns us-east5 for anthropic provider", () => {
    expect(defaultVertexLocation("anthropic")).toBe("us-east5");
  });

  it("returns us-central1 for google provider", () => {
    expect(defaultVertexLocation("google")).toBe("us-central1");
  });

  it("returns us-central1 for unknown providers", () => {
    expect(defaultVertexLocation("other")).toBe("us-central1");
  });
});
