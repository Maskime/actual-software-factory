import axios, { type AxiosInstance, type AxiosError } from "axios";
import axiosRetry from "axios-retry";

export class GitLabAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "GitLabAuthError";
  }
}

export class GitLabApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = "GitLabApiError";
  }
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
}

function getRetryDelay(retryCount: number, error: AxiosError): number {
  const retryAfterHeader = error.response?.headers["retry-after"];
  if (retryAfterHeader) {
    const seconds = parseInt(String(retryAfterHeader), 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }
  return axiosRetry.exponentialDelay(retryCount);
}

export class GitLabClient {
  private readonly http: AxiosInstance;

  constructor() {
    const token = process.env.GITLAB_API_TOKEN;
    const baseURL = process.env.GITLAB_API_URL;

    if (!token) {
      throw new Error(
        "Missing required environment variable: GITLAB_API_TOKEN\n" +
          "Set a GitLab personal access token with scopes: api, read_repository"
      );
    }
    if (!baseURL) {
      throw new Error(
        "Missing required environment variable: GITLAB_API_URL\n" +
          "Example: http://localhost/api/v4"
      );
    }

    this.http = axios.create({
      baseURL,
      timeout: 10_000,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    axiosRetry(this.http, {
      retries: 3,
      retryCondition: (error) => {
        const status = error.response?.status;
        return status === 429 || (status !== undefined && status >= 500);
      },
      retryDelay: getRetryDelay,
    });
  }

  async validateAuth(): Promise<GitLabUser> {
    try {
      const { data } = await this.http.get<GitLabUser>("/user");
      return { id: data.id, username: data.username, name: data.name };
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 401) {
        throw new GitLabAuthError(
          "GitLab authentication failed: token is invalid or expired. " +
            "Verify GITLAB_API_TOKEN has scopes: api, read_repository.",
          401
        );
      }
      if (axiosErr.response?.status === 403) {
        throw new GitLabAuthError(
          "GitLab authentication failed: token lacks required permissions. " +
            "Ensure the token has scopes: api, read_repository.",
          403
        );
      }
      throw new GitLabAuthError(
        `GitLab connection failed: ${axiosErr.message}. ` +
          "Verify GITLAB_API_URL is reachable and GitLab is running."
      );
    }
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const { data } = await this.http.get<T>(path, { params });
      return data;
    } catch (err) {
      throw this.wrapError(err as AxiosError, path);
    }
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    try {
      const { data } = await this.http.post<T>(path, body);
      return data;
    } catch (err) {
      throw this.wrapError(err as AxiosError, path);
    }
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    try {
      const { data } = await this.http.put<T>(path, body);
      return data;
    } catch (err) {
      throw this.wrapError(err as AxiosError, path);
    }
  }

  async delete<T>(path: string): Promise<T> {
    try {
      const { data } = await this.http.delete<T>(path);
      return data;
    } catch (err) {
      throw this.wrapError(err as AxiosError, path);
    }
  }

  private wrapError(err: AxiosError, path: string): GitLabApiError {
    const status = err.response?.status ?? 0;
    const responseData = err.response?.data as Record<string, unknown> | undefined;
    const detail =
      (responseData?.message as string) ||
      (responseData?.error as string) ||
      err.message;

    if (status === 401 || status === 403) {
      return new GitLabApiError(
        `GitLab auth error on ${path}: ${detail}`,
        status,
        "GITLAB_AUTH_ERROR"
      );
    }
    if (status === 404) {
      return new GitLabApiError(
        `GitLab resource not found: ${path}`,
        status,
        "GITLAB_NOT_FOUND"
      );
    }
    if (status === 429) {
      return new GitLabApiError(
        `GitLab rate limit exceeded on ${path}`,
        status,
        "GITLAB_RATE_LIMIT"
      );
    }
    return new GitLabApiError(
      `GitLab API error on ${path} (HTTP ${status}): ${detail}`,
      status,
      "GITLAB_API_ERROR"
    );
  }
}
