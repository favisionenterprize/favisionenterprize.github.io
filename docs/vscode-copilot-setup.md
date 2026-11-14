# VS Code Copilot setup

This repository includes Copilot workspace instructions in `.github/copilot-instructions.md` and reusable skills under `.github/skills/`. They apply to Copilot sessions opened in this repository; they do not change your VS Code settings for other workspaces.

## 21st.dev MCP

The workspace `.mcp.json` is configured for the official 21st.dev MCP endpoint and exposes only its `search` tool. Searches are sent to 21st.dev, so use generic UI requirements and do not include private project code, customer data, or credentials.

To connect it:

1. Obtain an API key from [21st.dev MCP](https://21st.dev/mcp) and make it available to the VS Code process as `API_KEY_21ST` using an approved local secret-management method. Do not put the key in this repository, `settings.json`, or shell history.
2. Restart VS Code after setting the environment variable.
3. If workspace-root MCP configuration is not enabled, enable `chat.mcp.workspaceRootConfig.enabled` in VS Code Settings.
4. In a Copilot session, run **Chat: Open Customizations** and review **MCP Servers**. Approve the 21st server only if you accept sending generic search queries to the service.
5. Start a new Copilot session and use `/21st-ui-research` or ask for a generic component search. Confirm the `search` tool was called.

Component retrieval and hosted generation are not enabled in the workspace config. Review 21st.dev's usage and pricing before enabling additional tools.

## Reel claims not installed

- **Claude-Mem:** its current project documentation says Copilot CLI can search memory, but its sessions are not recorded. It does not provide the reel's claimed session capture for VS Code Copilot Chat. This repository's instructions and skills provide project context without installing a background observer.
- **Claude Code Setup:** it targets Claude Code. The supported VS Code equivalent is the repository's Copilot instructions and Agent Skills.
- **FreeLLMAPI:** not configured. A multi-provider API router would send prompts to external providers and requires separately managed credentials; do not use it with private business code unless you have vetted and approved the data handling.
- **“Elephant Goldfish Model”:** no official Google model by that name was verified, so it was not installed or selected.

For official VS Code guidance, see [custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions), [Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills), and [MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).
