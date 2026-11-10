# Hermione AI Agent

> A comprehensive AI assistant with productivity integrations, smart context engine, and development tools.

Built on **Next.js 16 + React 19 + TypeScript**, integrating with Google Workspace, Telegram, GitHub, and local/cloud AI providers.

---

## ✨ Features

### 🤖 Models — any provider, automatic failover
- **Auto-detection**: local runtimes (Ollama, LM Studio, llama.cpp, vLLM, Jan, KoboldCpp…) found on their default ports; API keys in `.env` show up as ready-to-add providers
- **One-click presets**: OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Fireworks — paste a key, models load
- **One picker** for every model on every provider; non-chat models (embeddings, TTS, image, agent-only…) are hidden automatically
- **Failover**: when a provider runs out of quota / credit or is rate-limited, the turn continues on the next model or provider (local first) and the exhausted one is skipped until it resets

### 🎬 Content Forge
- Separate **Chat** and **Content Forge** workspaces, each with its own session history
- **Trending in your country**: today's and tomorrow's viral topics from live Google Trends data, one AI call cached for 48 h
- A content-strategist prompt and a research-only tool set for short-form video work

### 🌐 Web Research
- `web_search`, `web_fetch`, `site_inspect`, `page_open` run **without approval** on the public internet (never localhost / LAN)
- Keyless search (DuckDuckGo → Bing), optional **Chrome profile** search for fewer bot checks, optional Google API / own SearXNG

### 🎯 Token Optimization
- **History compaction**: last 6 exchanges in full, older ones summarised, old tool output trimmed (~77% fewer tokens per request in long research sessions)
- **Real token usage**: counts reported by the provider, shown per chat and per day under the composer
- **RTK Compression**: 60-90% token reduction on terminal output (git/grep/ls/tree/logs)
- **Lazy Senior Dev Mode**: YAGNI-biased coding with auto-detection

### 📧 Communication Hub
- **Gmail**: Multi-account support, search, send, read
- **Google Calendar**: Event management and scheduling
- **Google Tasks**: Task lists with subtasks
- **Google Drive**: Filename + full-text content search
- **Telegram Bot**: Message sending and chat monitoring
- **Documents Auto-sync**: Bi-directional sync with Google Drive

### 🧠 Smart Context Engine
- **Unified Search**: Query across Gmail, Calendar, Tasks, Drive, GitHub in one call
- **Session Restoration**: Resume where you left off (24-hour window)
- **Agent Memory**: Learns user preferences, communication style, domain expertise
- **Context Suggestions**: Auto-suggest relevant resources from conversation

### 💾 Session Management & Persistence
- **Session History**: Browse and resume recent sessions from sidebar
- **Persistent Storage**: Sessions automatically saved to disk (`.hermione/sessions/`)
- **Session Continuity**: Resume existing sessions without welcome screen—only show welcome for new sessions
- **Auto-restore**: Sessions load from disk on server restart
- **Session Metadata**: Track message count, last activity, creation time

### 🧠 Thinking & Extended Reasoning
- **Thinking Effort Dropdown**: Control AI reasoning depth (off/low/medium/high)
- **Token Budgets**: 0K / 2K / 5K / 10K tokens per level to prevent slow inference
- **Extended Thinking**: Extended thinking mode when enabled
- **Performance Optimized**: Prevents slowness from token budget caps

### ⚡ Smart Caching System
- **Multi-layer Caching**: UI state, providers, models, sessions, preferences
- **TTL-based Expiration**: 
  - UI state: 5 minutes
  - Providers/models: 1-24 hours
  - Sessions: 24 hours
  - User preferences: 7 days
- **localStorage Backend**: Fast, local, persistent cache
- **Auto-cleanup**: Expired entries automatically removed
- **Zero-cost Restarts**: Cold start with warm cache = instant availability

### 💻 Development Tools
- **GitHub Integration**: Issues, PRs, CI status monitoring, snippet library
- **Document Generation**: Auto-generate README, API docs, setup guides
- **Deployment Monitoring**: Track GitHub Actions, Vercel, Railway, health checks
- **Workflow Templates**: PR templates, issue templates, pre-commit hooks, CI/CD configs

### 🎨 User Interface
- **Live2D Avatar**: Interactive companion with personality (see SOUL.md)
- **Context Search Modal**: Unified search UI with source filtering
- **Memory Dashboard**: View user profile and agent learnings
- **Integrations Panel**: Configure all services from one place
- **Deployment Status**: Real-time deployment health monitoring

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ (pnpm via `corepack`, bundled with Node)
- At least one model source: [Ollama](https://ollama.com) or an API key (free tiers: Groq, OpenRouter, Mistral, Gemini)
- Optional: Google Chrome, for searching through a Chrome profile

### Installation

```bash
git clone <your-repo-url>
cd Hermione-withAvatar
corepack pnpm install
cp .env.example .env
corepack pnpm dev
```

Every setting is documented in [`.env.example`](./.env.example).

Open [http://localhost:3000](http://localhost:3000)

---

## 🔧 Configuration

### Environment Variables

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback

TELEGRAM_BOT_TOKEN=your_bot_token

GITHUB_TOKEN=ghp_your_token
GITHUB_OWNER=your_username
```

### First Run Setup

1. **Startup Modal**: Configure AI provider and TTS
2. **Integrations**: Set up Google, Telegram, GitHub
3. **Agent Name**: Customize personality

---

## 📁 Project Structure

```
lib/
├── compression/    # RTK token compression
├── modes/          # Lazy Dev mode
├── google/         # Google APIs (6 modules)
├── telegram/       # Telegram bot
├── github/         # GitHub client
├── context/        # Search + session restoration
├── memory/         # Agent learnings + user profile
├── cache/          # Multi-layer caching system (NEW)
├── storage/        # Session persistence
└── dev/            # Document gen + deployment

components/
├── ContextSearch.tsx      # Unified search
├── MemoryDashboard.tsx    # Memory viewer
├── IntegrationsPanel.tsx  # Settings
└── DeploymentStatus.tsx   # Deployment monitor

app/api/
├── context/        # Search + restoration
├── google/         # OAuth + operations
├── telegram/       # Bot endpoints
├── github/         # Issues, PRs, snippets
├── memory/         # Profile + learnings
├── sessions/       # Session list & load (NEW)
└── dev/            # Documents, workflows, deployments
```

---

## 🎭 Personality

See [SOUL.md](./SOUL.md) for complete specification.

**Core**: Technically sharp, warm, curious, honest. Dry humor. Never pretends to emotions.

---

## 🔌 Integrations

### Google Workspace
- **Gmail**: Multi-account, search, send
- **Calendar**: Events CRUD
- **Tasks**: Task lists, subtasks
- **Drive**: Filename + content search, auto-sync

### Telegram
- Send messages
- Monitor updates
- Forward messages

### GitHub
- Issues & PRs
- CI/CD monitoring
- Code snippets

### Deployment
- GitHub Actions
- Vercel
- Railway
- Health checks

---

## 🧪 Development

```bash
corepack pnpm dev            # Start dev server
corepack pnpm check          # typecheck + lint + tests + publish (secret) check
corepack pnpm test           # vitest (unit + integration, never touches .hermione)
corepack pnpm lint           # ESLint (Next 16 flat config)
corepack pnpm format         # Prettier
corepack pnpm build          # Production build
```

Tests live in `tests/`; the failover integration test runs two fake providers in-process.

---

## 📊 Token Efficiency

**RTK Compression reduces tokens by 60-90%**:
- Git logs: ~90% reduction
- File listings: Filenames + sizes only
- Tree structures: 2-level collapse
- Log files: Grouped by level

**Real-world**: 10,000-token git log → 1,000 tokens

---

## 🎯 Lazy Senior Dev Mode

Auto-detects coding tasks, YAGNI-biased prompting:
- Reuse stdlib
- No premature abstraction
- Minimal code

---

## 🔐 Security

- **Approval gates**: file writes/deletes, shell and terminal commands, and clicking/typing on websites (`page_act` click/fill/submit/scroll) always ask first
- **Public-internet-only automatic tools**: every request and redirect hop must resolve to a public address — no localhost, LAN or cloud-metadata access
- **Sandboxed preview**: pages render with an opaque origin (CSP `sandbox` + iframe `sandbox`), so their scripts can't reach Hermione
- **API guard** (`proxy.ts`): loopback hosts only (DNS-rebinding safe), refuses `Origin: null`, cross-origin writes and cross-site background requests
- **Validated input**: state-changing API routes check request bodies with zod; approvals require an explicit `approve`/`deny`
- **Prompt-injection screening**: page text is scanned for instruction-shaped content and always treated as data
- **Secrets**: API keys stay server-side and are never returned to the browser; keys can live in `.env` (referenced by name) instead of `.hermione/providers.json`. Note: `.hermione/` (provider keys, Google OAuth tokens) is stored **unencrypted** — keep it private
- Root-locked filesystem and allowlist-based shell

---

## 📝 License

MIT

---

## 📊 Implementation

- **18 libraries** (~11K+ lines)
- **10 React components**
- **15 API routes**
- **7 storage modules**
- **All typecheck ✅ passing**

### Phases Completed
✅ Phase 1: RTK compression + Lazy Dev Mode
✅ Phase 2: Google multi-account integration
✅ Phase 3: Telegram + GitHub
✅ Phase 4: Smart context engine + memory
✅ Phase 5: Development tools
✅ Phase 6: UI components
✅ Phase 7: Session persistence + thinking controls + caching system

---

**Note**: Hermione is designed for personal use with your own API keys. No telemetry or data collection.
