import { vi, describe, it, expect, beforeEach } from "vitest";
import { GitLabApiError } from "../gitlab-client.js";
import type { GitLabClient } from "../gitlab-client.js";
import {
  handleListProjects,
  handleGetProject,
  handleCreateProject,
} from "./projects.js";

function makeMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
  };
}

const baseProject = {
  id: 3,
  name: "Software Factory",
  path: "software-factory",
  path_with_namespace: "root/software-factory",
  namespace: { id: 1, name: "Root", path: "root", kind: "user" },
  description: "Automated dev pipeline",
  visibility: "private",
  web_url: "http://gitlab/root/software-factory",
  http_url_to_repo: "http://gitlab/root/software-factory.git",
  default_branch: "main",
  created_at: "2024-01-01T00:00:00Z",
};

describe("handleListProjects()", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
  });

  it("returns projects with no filters", async () => {
    client.get.mockResolvedValue([baseProject]);
    const result = await handleListProjects(client as unknown as GitLabClient, {});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(3);
    expect(parsed[0].name).toBe("Software Factory");
    expect(parsed[0].path_with_namespace).toBe("root/software-factory");
    expect(parsed[0].visibility).toBe("private");
    expect(parsed[0].web_url).toBe("http://gitlab/root/software-factory");
    expect(parsed[0].default_branch).toBe("main");
    expect(client.get).toHaveBeenCalledWith("/projects", { per_page: 100 });
  });

  it("forwards membership, search, visibility, and page filters", async () => {
    client.get.mockResolvedValue([baseProject]);
    await handleListProjects(client as unknown as GitLabClient, {
      membership: true,
      search: "factory",
      visibility: "private",
      page: 2,
    });
    expect(client.get).toHaveBeenCalledWith("/projects", {
      per_page: 100,
      membership: true,
      search: "factory",
      visibility: "private",
      page: 2,
    });
  });

  it("returns isError on GitLabApiError", async () => {
    client.get.mockRejectedValue(
      new GitLabApiError("Forbidden", 403, "GITLAB_AUTH_ERROR")
    );
    const result = await handleListProjects(client as unknown as GitLabClient, {});
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("GITLAB_AUTH_ERROR");
    expect(parsed.error.statusCode).toBe(403);
  });
});

describe("handleGetProject()", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
  });

  it("returns full project details by numeric ID", async () => {
    client.get.mockResolvedValue(baseProject);
    const result = await handleGetProject(client as unknown as GitLabClient, {
      project_id: "3",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(3);
    expect(parsed.name).toBe("Software Factory");
    expect(parsed.namespace.kind).toBe("user");
    expect(parsed.description).toBe("Automated dev pipeline");
    expect(parsed.http_url_to_repo).toBe("http://gitlab/root/software-factory.git");
    expect(parsed.created_at).toBe("2024-01-01T00:00:00Z");
    expect(client.get).toHaveBeenCalledWith("/projects/3");
  });

  it("URL-encodes namespace/path project_id", async () => {
    client.get.mockResolvedValue(baseProject);
    await handleGetProject(client as unknown as GitLabClient, {
      project_id: "root/software-factory",
    });
    expect(client.get).toHaveBeenCalledWith("/projects/root%2Fsoftware-factory");
  });

  it("returns isError on GitLabApiError (not found)", async () => {
    client.get.mockRejectedValue(
      new GitLabApiError("Not found", 404, "GITLAB_NOT_FOUND")
    );
    const result = await handleGetProject(client as unknown as GitLabClient, {
      project_id: "999",
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("GITLAB_NOT_FOUND");
    expect(parsed.error.statusCode).toBe(404);
  });
});

describe("handleCreateProject()", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
  });

  it("creates a project with name only", async () => {
    client.post.mockResolvedValue({ ...baseProject, id: 42, name: "new-proj" });
    const result = await handleCreateProject(client as unknown as GitLabClient, {
      name: "new-proj",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(42);
    expect(parsed.name).toBe("new-proj");
    expect(client.post).toHaveBeenCalledWith("/projects", { name: "new-proj" });
  });

  it("passes all optional fields to the API", async () => {
    client.post.mockResolvedValue(baseProject);
    await handleCreateProject(client as unknown as GitLabClient, {
      name: "full-proj",
      namespace_id: 5,
      visibility: "public",
      description: "A test project",
    });
    expect(client.post).toHaveBeenCalledWith("/projects", {
      name: "full-proj",
      namespace_id: 5,
      visibility: "public",
      description: "A test project",
    });
  });

  it("returns isError on GitLabApiError (forbidden)", async () => {
    client.post.mockRejectedValue(
      new GitLabApiError("Forbidden", 403, "GITLAB_AUTH_ERROR")
    );
    const result = await handleCreateProject(client as unknown as GitLabClient, {
      name: "denied-proj",
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("GITLAB_AUTH_ERROR");
    expect(parsed.error.statusCode).toBe(403);
  });
});
