---
name: user-environment
description: "Vamsy's workstation — corporate Windows 11 Staples laptop, Ollama local models, no Rust/admin toolchain"
metadata: 
  node_type: memory
  type: user
  originSessionId: 807ed764-822c-4241-a302-1caa1037b88f
---

Corporate Windows 11 Enterprise laptop (Staples). Node 22 + npm 10 + git installed; NO Rust/MSVC toolchain (assume no admin rights — prefer pure-JS deps, per-user installers, no native modules).

Ollama 0.30.11 running at http://localhost:11434 with models: `qwen2.5:3b` (primary, ~4.6s warm structured parse, ~32 tok/s), `qwen2.5:1.5b`, `gemma2:2b`. These models are shared with his "vibeflow" speech-to-text app — don't remove them; pulling new models needs his approval.

Everything must stay 100% offline for office work (privacy constraint). Related: [[project-todo-intelligence]]
