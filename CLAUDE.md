@AGENTS.md
# Glocal Platform — AI Assistance Guidelines

## System Overview
Glocal is an AI-driven, autonomous marketing platform designed for local businesses. It automates ad creation, champion-vs-challenger performance testing, and budget optimization across ad platforms.

## Core Tech Stack
- **Framework:** Next.js (App Router), React, TypeScript (Strict Mode)
- **Backend & Database:** Node.js, Supabase (PostgreSQL), Edge Functions
- **Styling:** Tailwind CSS, Lucide Icons
- **AI / LLM Integration:** Anthropic Claude API / Fal.ai for creative assets

## Engineering Standards & Constraints
1. **Type Safety:** Maintain strict TypeScript interfaces for all API inputs, outputs, and database models. Never use `any`.
2. **Error Handling & Resilience:** Upstream LLM calls must have retry fallback logic and default safety states. Never expose unhandled model errors to the frontend.
3. **Security:** Abstract all secret API keys via `.env`. Adhere strictly to GDPR and local compliance rules.
4. **Architectural Separation:** Keep business logic, AI prompt templates, and UI components in separate modular layers (`/src/lib/`, `/src/components/`).

## Preferred Prompt Engineering Pattern
- **Role:** Senior Full-Stack AI Engineer
- **Structure:** Context -> Task Objective -> Strict Constraints -> JSON/Typed Output Format
