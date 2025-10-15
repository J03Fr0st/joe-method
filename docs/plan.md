# Azure DevOps PR Reviewer

## Approach

1. Inspect `git remote` info in a new `src/core/services/azure-devops-service.ts` to derive organization, project, and repo; fetch repo metadata via Azure DevOps REST using `ADO_PAT`.
2. Implement helper methods for listing PRs, retrieving details/diffs/comments, posting replies, creating threads, and resolving comment threads; export them from `src/core/services/index.ts`.
3. Extend `registerTools` with an `azure_devops_reviewer` tool exposing actions (`list_prs`, `get_pr`, `get_diff`, `get_comments`, `reply_comment`, `post_comment`, `resolve_thread`) so MCP clients can drive reviews interactively.

## Todos

- service-setup: Create Azure DevOps service utilities (auth, remote parsing, REST helpers).
- tool-integration: Register the new MCP tool and wire it to the service helpers.

## Future Enhancements

See `docs/azure-devops-reviewer-features.md` for a running list of feature ideas such as auto triage, status updates, review metrics, diff highlighting, and more.