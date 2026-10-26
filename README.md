# Hermione AI Agent

> A comprehensive AI assistant with productivity integrations, smart context engine, and development tools.

Built on **Next.js 16 + React 19 + TypeScript**, integrating with Google Workspace, Telegram, GitHub, and local/cloud AI providers.

---

## ✨ Features

### 🎯 Token Optimization
- **RTK Compression**: 60-90% token reduction on tool outputs (git/grep/ls/tree/logs)
- **Lazy Senior Dev Mode**: YAGNI-biased coding with auto-detection
- **Real-time Token Counter**: Monitor usage and compression savings

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
- Node.js 18+
- npm 8+
- Ollama (for local models) or API keys for cloud providers

### Installation

```bash
git clone <your-repo-url>
cd Hermione-withAvatar
npm install
cp .env.example .env.local
npm run dev
```

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
npm run dev          # Start dev server
npm run typecheck    # Type check
npm run build        # Build for production
npm start            # Start production
```

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

- API keys server-side only (`.hermione/` directory)
- OAuth tokens encrypted
- Permission gates for file system & web
- Root-locked filesystem
- Allowlist-based shell security

---

## 📝 License

MIT

---

## 📊 Implementation

- **17 libraries** (~10K+ lines)
- **10 React components**
- **13 API routes**
- **6 storage modules**
- **All typecheck ✅ passing**

### Phases Completed
✅ Phase 1: RTK compression + Lazy Dev Mode
✅ Phase 2: Google multi-account integration
✅ Phase 3: Telegram + GitHub
✅ Phase 4: Smart context engine + memory
✅ Phase 5: Development tools
✅ Phase 6: UI components

---

**Note**: Hermione is designed for personal use with your own API keys. No telemetry or data collection.
