# OpenClaw Installer

> **WIP — The local (this machine) deployer works. Cluster and SSH modes are not yet implemented.**

A web-based installer and fleet manager for [OpenClaw](https://github.com/openclaw). Deploy and manage OpenClaw instances from a browser — on your laptop, on a remote machine, or across a fleet.

## Deployment Modes

| Mode | Status | What It Does |
|------|--------|-------------|
| **This Machine** | Working | Runs OpenClaw in podman/docker on localhost |
| **Kubernetes / OpenShift** | Planned | Deploys to a cluster via K8s API |
| **Remote Host** | Planned | Deploys via SSH to a Linux machine |
| **Edge Fleet** | Planned | Multi-host orchestration |

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:3001
```

The UI opens in your browser. Pick "This Machine", fill in your prefix and agent name, configure your model provider, and hit Deploy. The installer pulls the OpenClaw image, starts a container, and streams logs in real time.

For remote access (e.g., running on a NUC over SSH):

```bash
# On the remote machine
npm install && npm run dev

# On your laptop
ssh -L 3001:localhost:3001 user@remote-host
# Open http://localhost:3001
```

## Features

- **Deploy** — Pull image, create volume, start container with one click
- **Instance discovery** — Finds all OpenClaw containers (including manually launched ones) via podman/docker labels and image name
- **Stop / Start** — Lifecycle management; volumes preserve state across restarts
- **Gateway token** — View and copy the gateway auth token from the UI
- **Run command** — See the exact podman/docker command used to launch each instance
- **Delete data** — Remove the data volume when you're done
- **Model providers** — Anthropic API, OpenAI-compatible endpoints, Google Vertex AI (Gemini or Claude)
- **.env upload** — Upload a `.env` file to pre-fill the deploy form (handy for fleet provisioning)
- **Instance config saved** — Each deploy saves `.env` and `gateway-token` to `~/.openclaw-installer/<container-name>/`
- **Server env fallback** — API keys set on the server (e.g., `ANTHROPIC_API_KEY`) are used automatically if not provided in the form

## Architecture

```
┌─────────────────────────────────────────┐
│           Browser (React + Vite)        │
│  ┌────────────┬──────────┬───────────┐  │
│  │ DeployForm │ LogStream│ Instances │  │
│  └─────┬──────┴────┬─────┴─────┬─────┘  │
│        │ REST      │ WebSocket │ REST    │
└────────┼───────────┼───────────┼────────┘
         ▼           ▼           ▼
┌─────────────────────────────────────────┐
│        Express + WebSocket Server       │
│  ┌──────────┐  ┌──────────────────────┐ │
│  │ Deployers│  │ Services             │ │
│  │  local   │  │  container discovery │ │
│  │  k8s  *  │  │  (podman / docker)   │ │
│  │  ssh  *  │  │                      │ │
│  └──────────┘  └──────────────────────┘ │
└─────────────────────────────────────────┘
              * = planned
```

Instances are discovered directly from podman/docker — no state files needed. Running containers are found via `podman ps` (filtered by label `openclaw.managed=true` or image name). Stopped instances are discovered via orphaned `openclaw-*-data` volumes.

## API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Runtime detection, version, server environment defaults |
| `/api/deploy` | POST | Start a deployment (returns deployId, streams logs via WS) |
| `/api/instances` | GET | List all discovered instances with live status |
| `/api/instances/:name/start` | POST | Start a stopped instance (re-creates container from volume) |
| `/api/instances/:name/stop` | POST | Stop and remove container (volume preserved) |
| `/api/instances/:name/token` | GET | Get the gateway auth token |
| `/api/instances/:name/command` | GET | Get the podman/docker run command |
| `/api/instances/:name/data` | DELETE | Delete the data volume |
| `/api/agents/local` | GET | List agents from a local repo |
| `/api/agents/browse?repo=...` | GET | List agents from a public git repo |
| `/ws` | WebSocket | Subscribe to deploy logs by deployId |

## Container Details

The installer launches OpenClaw containers with:

- `--network host` — Gateway binds to `127.0.0.1` by default; host networking makes it accessible
- `--rm` — Container is removed on stop; the volume preserves all state
- Labels: `openclaw.managed=true`, `openclaw.prefix=<prefix>`, `openclaw.agent=<name>`
- Volume: `openclaw-<prefix>-data` mounted at `/home/node/.openclaw`
- Image: `quay.io/sallyom/openclaw:latest`

## Running as a Container

Build and run the installer itself as a container. The installer needs access to the host's container runtime socket so it can manage OpenClaw containers on your behalf.

```bash
# Build
podman build -t claw-installer .

# Run (podman)
podman run -p 3000:3000 \
  -v /run/user/$(id -u)/podman/podman.sock:/run/podman/podman.sock \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  claw-installer

# Run (docker)
docker run -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  claw-installer
```

Then open `http://localhost:3000`.

You can pass server-side defaults as environment variables:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Pre-fill API key (users can leave the field blank) |
| `MODEL_ENDPOINT` | Default model endpoint |
| `OPENCLAW_IMAGE` | Default container image |
| `OPENCLAW_PREFIX` | Default name prefix |

## Project Structure

```
claw-installer/
├── src/
│   ├── server/
│   │   ├── index.ts              # Express + WS server, serves static frontend
│   │   ├── ws.ts                 # WebSocket log streaming
│   │   ├── routes/
│   │   │   ├── deploy.ts         # POST /api/deploy
│   │   │   ├── status.ts         # Instance discovery and lifecycle
│   │   │   └── agents.ts         # Agent browsing (local + git)
│   │   ├── deployers/
│   │   │   ├── types.ts          # Deployer interface
│   │   │   └── local.ts          # podman/docker deployer
│   │   └── services/
│   │       └── container.ts      # Runtime detection, container/volume discovery
│   └── client/
│       ├── App.tsx               # Tabs: Deploy | Instances | Agents
│       ├── components/
│       │   ├── DeployForm.tsx     # Mode selector + config form + .env upload
│       │   ├── LogStream.tsx      # Real-time deploy output
│       │   ├── InstanceList.tsx   # Manage running instances
│       │   └── AgentBrowser.tsx   # Browse agents from local repo or git
│       └── styles/theme.css      # Dark theme matching OpenClaw UI
├── Dockerfile
└── package.json
```

## Roadmap

- [x] Local deployer (podman/docker on this machine)
- [x] Instance discovery and lifecycle (stop, start, delete data)
- [x] Gateway token access from UI
- [x] .env file upload and per-instance export
- [x] Vertex AI / multi-provider support
- [ ] Agent/job import from git repos (markdown-based)
- [ ] Kubernetes deployer (K8s API)
- [ ] SSH deployer (remote host)
- [ ] Fleet deployer (multi-host orchestration)
- [ ] Private git repo auth (PAT)
- [ ] In-cluster self-service portal
