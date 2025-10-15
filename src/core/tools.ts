import { FastMCP } from "fastmcp";
import { z } from "zod";
import * as services from "./services/index.js";
import { AzureDevOpsService } from "./services/azure-devops-service.js";

/**
 * Register all tools with the MCP server
 * 
 * @param server The FastMCP server instance
 */
export function registerTools(server: FastMCP) {
  // Greeting tool
  server.addTool({
    name: "hello_world",
    description: "A simple hello world tool",
    parameters: z.object({
      name: z.string().describe("Name to greet")
    }),
    execute: async (params) => {
      const greeting = services.GreetingService.generateGreeting(params.name);
      return greeting;
    }
  });

  // Farewell tool
  server.addTool({
    name: "goodbye",
    description: "A simple goodbye tool",
    parameters: z.object({
      name: z.string().describe("Name to bid farewell to")
    }),
    execute: async (params) => {
      const farewell = services.GreetingService.generateFarewell(params.name);
      return farewell;
    }
  });

  server.addTool({
    name: "azure_devops_reviewer",
    description:
      "Interact with Azure DevOps pull requests for the current repository.",
    parameters: z.object({
      action: z.union([
        z.literal("list_prs"),
        z.literal("get_pr"),
        z.literal("get_diff"),
        z.literal("get_comments"),
        z.literal("post_comment"),
        z.literal("reply_comment"),
        z.literal("resolve_thread")
      ]),
      pullRequestId: z
        .number()
        .int()
        .optional()
        .describe("Pull request ID to operate on"),
      threadId: z
        .number()
        .int()
        .optional()
        .describe("Thread ID for comment operations"),
      content: z
        .string()
        .optional()
        .describe("Comment content for posting or replying"),
      status: z
        .string()
        .optional()
        .describe("Thread status to apply when resolving"),
      threadContext: z
        .object({
          filePath: z.string().optional(),
          leftFileStart: z
            .object({ line: z.number(), offset: z.number() })
            .optional(),
          leftFileEnd: z
            .object({ line: z.number(), offset: z.number() })
            .optional(),
          rightFileStart: z
            .object({ line: z.number(), offset: z.number() })
            .optional(),
          rightFileEnd: z
            .object({ line: z.number(), offset: z.number() })
            .optional()
        })
        .optional()
        .describe(
          "Context for new comment threads (file path and positional info)"
        )
    }),
    execute: async (params) => {
      const service = await AzureDevOpsService.getInstance();
      switch (params.action) {
        case "list_prs": {
          const prs = await service.listPullRequests();
          return prs;
        }
        case "get_pr": {
          const prId = requireParam(params.pullRequestId, "pullRequestId");
          return service.getPullRequest(prId);
        }
        case "get_diff": {
          const prId = requireParam(params.pullRequestId, "pullRequestId");
          return service.getPullRequestDiff(prId);
        }
        case "get_comments": {
          const prId = requireParam(params.pullRequestId, "pullRequestId");
          return service.getPullRequestThreads(prId);
        }
        case "post_comment": {
          const prId = requireParam(params.pullRequestId, "pullRequestId");
          const content = requireParam(params.content, "content");
          return service.postComment(prId, {
            content,
            threadContext: params.threadContext
          });
        }
        case "reply_comment": {
          const prId = requireParam(params.pullRequestId, "pullRequestId");
          const threadId = requireParam(params.threadId, "threadId");
          const content = requireParam(params.content, "content");
          return service.replyToThread(prId, threadId, { content });
        }
        case "resolve_thread": {
          const prId = requireParam(params.pullRequestId, "pullRequestId");
          const threadId = requireParam(params.threadId, "threadId");
          const status = params.status ?? "closed";
          return service.updateThreadStatus(prId, threadId, status);
        }
        default: {
          const exhaustive: never = params.action;
          throw new Error(`Unsupported action: ${exhaustive}`);
        }
      }
    }
  });
}

function requireParam<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || (typeof value === "string" && !value.length)) {
    throw new Error(`Missing required parameter: ${name}`);
  }

  return value;
}