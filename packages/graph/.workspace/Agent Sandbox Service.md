The Agent sandbox service is a stateless service that can programmatically run agent harnesses. This service can run in either cloud sandboxes or a user's own machine

How T3 Code supports this:

- Tunneling: They created T3 Connect as an alternative to Tailscale to let users remotely control agents on user devices
- Network Protocol: Effect rpc over websocket
- Agent Harness API: They wrap Claude Agent SDK & ACP as an Effect Service.

We have 2 options here:

- Take their implementation
- Create our own service with Tanstack AI
