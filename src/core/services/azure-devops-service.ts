import { exec as execCallback } from "node:child_process";
import { Buffer } from "node:buffer";
import { promisify } from "node:util";

const exec = promisify(execCallback);

const ADO_API_VERSION = "7.1-preview.1";

export interface AzureDevOpsRepositoryInfo {
  organization: string;
  project: string;
  repository: string;
}

interface AzureDevOpsListResponse<T> {
  value: T[];
  count?: number;
}

interface AzureDevOpsIteration {
  id: number;
  createdDate: string;
  author?: unknown;
}

export interface AzureDevOpsPullRequestChange {
  changeType: string;
  item?: Record<string, unknown> & { path?: string };
  originalPath?: string;
  status?: string;
  mergeSources?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface AzureDevOpsPullRequestThreadContext {
  filePath?: string;
  leftFileStart?: { line: number; offset: number };
  leftFileEnd?: { line: number; offset: number };
  rightFileStart?: { line: number; offset: number };
  rightFileEnd?: { line: number; offset: number };
}

export interface AzureDevOpsPullRequestComment {
  id: number;
  content: string;
  commentType: string;
  publishedDate?: string;
  lastUpdatedDate?: string;
  author?: Record<string, unknown>;
  isDeleted?: boolean;
  [key: string]: unknown;
}

export interface AzureDevOpsPullRequestThread {
  id: number;
  status: string;
  threadContext?: AzureDevOpsPullRequestThreadContext;
  comments: AzureDevOpsPullRequestComment[];
  properties?: Record<string, unknown>;
  isDeleted?: boolean;
  publishedDate?: string;
  lastUpdatedDate?: string;
  [key: string]: unknown;
}

export interface AzureDevOpsPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: string;
  createdBy: Record<string, unknown>;
  creationDate?: string;
  completionOptions?: Record<string, unknown>;
  reviewers?: Array<Record<string, unknown>>;
  supportsIterations?: boolean;
  url: string;
  [key: string]: unknown;
}

export interface PostCommentOptions {
  content: string;
  threadContext?: AzureDevOpsPullRequestThreadContext;
}

export interface ReplyCommentOptions {
  content: string;
  commentType?: string;
}

export class AzureDevOpsService {
  private static serviceInstance: Promise<AzureDevOpsService> | null = null;

  static async getInstance(): Promise<AzureDevOpsService> {
    if (!this.serviceInstance) {
      this.serviceInstance = AzureDevOpsService.initialize();
    }
    return this.serviceInstance;
  }

  private static async initialize(): Promise<AzureDevOpsService> {
    const pat = process.env.ADO_PAT?.trim();
    if (!pat) {
      throw new Error("ADO_PAT environment variable is not set");
    }

    const remoteUrl = await getGitRemoteUrl();
    const repoInfo = parseAzureRemote(remoteUrl);

    if (!repoInfo) {
      throw new Error(
        `Unable to determine Azure DevOps repository details from git remote: ${remoteUrl}`
      );
    }

    const service = new AzureDevOpsService(repoInfo, pat);
    await service.ensureRepositoryMetadata();
    return service;
  }

  private readonly pat: string;
  private readonly repoInfo: AzureDevOpsRepositoryInfo;
  private readonly baseApiUrl: string;
  private readonly authHeader: string;
  private repositoryId: string | null = null;

  private constructor(repoInfo: AzureDevOpsRepositoryInfo, pat: string) {
    this.repoInfo = repoInfo;
    this.pat = pat;
    this.baseApiUrl = `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}/${encodeURIComponent(repoInfo.project)}/_apis/git/`;
    this.authHeader = `Basic ${Buffer.from(`:${this.pat}`).toString("base64")}`;
  }

  async listPullRequests(status: "active" | "completed" | "abandoned" = "active") {
    await this.ensureRepositoryMetadata();
    const url = `repositories/${this.repositoryId}/pullRequests?searchCriteria.status=${status}`;
    const result = await this.request<AzureDevOpsListResponse<AzureDevOpsPullRequest>>(url);
    return result.value;
  }

  async getPullRequest(pullRequestId: number) {
    await this.ensureRepositoryMetadata();
    const url = `repositories/${this.repositoryId}/pullRequests/${pullRequestId}`;
    return this.request<AzureDevOpsPullRequest>(url);
  }

  async getPullRequestThreads(pullRequestId: number) {
    await this.ensureRepositoryMetadata();
    const url = `repositories/${this.repositoryId}/pullRequests/${pullRequestId}/threads`;
    const result = await this.request<AzureDevOpsListResponse<AzureDevOpsPullRequestThread>>(url);
    return result.value;
  }

  async getPullRequestDiff(pullRequestId: number) {
    await this.ensureRepositoryMetadata();
    const latestIteration = await this.getLatestIterationId(pullRequestId);

    if (latestIteration === null) {
      return [] as AzureDevOpsPullRequestChange[];
    }

    const url = `repositories/${this.repositoryId}/pullRequests/${pullRequestId}/iterations/${latestIteration}/changes`;
    const result = await this.request<AzureDevOpsListResponse<AzureDevOpsPullRequestChange>>(url);
    return result.value;
  }

  async postComment(pullRequestId: number, options: PostCommentOptions) {
    await this.ensureRepositoryMetadata();
    const url = `repositories/${this.repositoryId}/pullRequests/${pullRequestId}/threads`;
    const payload = {
      status: "active",
      threadContext: options.threadContext,
      comments: [
        {
          parentCommentId: 0,
          content: options.content,
          commentType: "text"
        }
      ]
    };

    return this.request<AzureDevOpsPullRequestThread>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  async replyToThread(pullRequestId: number, threadId: number, options: ReplyCommentOptions) {
    await this.ensureRepositoryMetadata();
    const url = `repositories/${this.repositoryId}/pullRequests/${pullRequestId}/threads/${threadId}/comments`;
    const payload = {
      parentCommentId: 0,
      content: options.content,
      commentType: options.commentType ?? "text"
    };

    return this.request<AzureDevOpsPullRequestComment>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  async updateThreadStatus(pullRequestId: number, threadId: number, status: string) {
    await this.ensureRepositoryMetadata();
    const url = `repositories/${this.repositoryId}/pullRequests/${pullRequestId}/threads/${threadId}`;
    const payload = { status };

    return this.request<AzureDevOpsPullRequestThread>(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  private async getLatestIterationId(pullRequestId: number) {
    const url = `repositories/${this.repositoryId}/pullRequests/${pullRequestId}/iterations`;
    const iterations = await this.request<AzureDevOpsListResponse<AzureDevOpsIteration>>(url);
    if (!iterations.value.length) {
      return null;
    }

    const sorted = [...iterations.value].sort((a, b) => a.id - b.id);
    return sorted[sorted.length - 1]?.id ?? null;
  }

  private async ensureRepositoryMetadata() {
    if (this.repositoryId) {
      return;
    }

    const url = `repositories/${encodeURIComponent(this.repoInfo.repository)}`;
    const repository = await this.request<Record<string, unknown>>(url);
    const repositoryId = repository?.["id"];

    if (typeof repositoryId !== "string" || !repositoryId.length) {
      throw new Error("Unable to fetch Azure DevOps repository metadata");
    }

    this.repositoryId = repositoryId;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(path, this.baseApiUrl);
    if (!url.searchParams.has("api-version")) {
      url.searchParams.set("api-version", ADO_API_VERSION);
    }

    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", this.authHeader);
    headers.set("Accept", "application/json;api-version=" + ADO_API_VERSION);

    const response = await fetch(url, {
      ...init,
      headers
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Azure DevOps request failed (${response.status} ${response.statusText}): ${text}`
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json()) as T;
    return data;
  }
}

async function getGitRemoteUrl() {
  const { stdout } = await exec("git remote get-url origin");
  return stdout.trim();
}

export function parseAzureRemote(remoteUrl: string): AzureDevOpsRepositoryInfo | null {
  const httpsPattern = /https:\/\/dev\.azure\.com\/(.+?)\/(.+?)\/_git\/(.+?)(?:\.git)?$/i;
  const httpsWithUserPattern = /https:\/\/[\w.-]+@dev\.azure\.com\/(.+?)\/(.+?)\/_git\/(.+?)(?:\.git)?$/i;
  const sshPattern = /git@ssh\.dev\.azure\.com:v3\/(.+?)\/(.+?)\/(.+?)(?:\.git)?$/i;

  const candidates = [httpsPattern, httpsWithUserPattern, sshPattern];

  for (const pattern of candidates) {
    const match = remoteUrl.match(pattern);
    if (match) {
      const [, organization, project, repository] = match;
      return {
        organization,
        project,
        repository
      };
    }
  }

  const legacyVisualStudioPattern = /https:\/\/(.+?)\.visualstudio\.com\/(.+?)\/_git\/(.+?)(?:\.git)?$/i;
  const legacyMatch = remoteUrl.match(legacyVisualStudioPattern);

  if (legacyMatch) {
    const [, organization, project, repository] = legacyMatch;
    return {
      organization,
      project,
      repository
    };
  }

  return null;
}

