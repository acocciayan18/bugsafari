Use multiple agents from yourself or from the /.claude/agents file if necessary and relevant

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Avoid use of em dash (—) in frontend pacing sentences or character

Read this document entirely before suggesting refactors or generating code. Prioritize these absolute project constraints over generalized best practices.

Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.

If any requirement, execution sequence, or architectural decision is unnecessary or suboptimal, explain why and implement a better solution instead.

Provide complete production-ready TypeScript implementations with no placeholders or omitted code.

Follow clean architecture, SOLID principles, and existing project conventions.

Do not follow this prompt blindly. Prioritize correctness, maintainability, scalability, reliability, and compatibility with the existing codebase.

Treat this prompt as a design objective rather than a fixed specification, and implement the best engineering solution after analyzing the repository.


Generate concise, short solutions for new modules or code.

never generate a multi-line comments

Watch for over-engineering, oversized files needing refactor.

Watch for weird syntax/style mismatching rest of codebase.

Watch for obvious bugs.

Prioritize concise, precise code and docs changes.

ig you would Comment codes, comment only in one liner

Review existing files before refactor or change.

Right data structures and algorithms for problem.

Don't expose data needlessly (least privilege).

No external libraries unless absolutely necessary.

Use project dependency file for correct versions.

Avoid redundancy unless improves usability.

##  1. System Context
BugSafari is an Autonomous Exploratory Testing Engine for SPAs. 
- Tech: React 19/Vite, Node.js/Express, Playwright, Socket.IO, MongoDB Atlas, Podman.
- Mechanics: It traverses the DOM via Playwright, scores elements using a Single-Layer Perceptron (Delta Rule), prevents loops using Structural DOM Hashing, applies heuristic data fuzzing, and records crashes via a 20-step Circular Action Buffer.

## ️ 2. Architecture (Monorepo)
1. `developer-dashboard/`: Frontend Watchtower (Port `5173`).
2. `testing-core/`: Backend Engine & Scenarios (Port `3000`).
3. `shared/`: Strict TypeScript data contracts bridging both sides.

BugSafari System Context
Definition and Purpose
BugSafari is an autonomous, scriptless, adaptive exploratory testing engine built specifically for modern Single-Page Applications (SPAs). It addresses the predictability gap of traditional testing tools by substituting static scripts with an intelligent agent that actively explores, interacts with, and stress-tests application interfaces to discover critical regressions, logic loops, and backend security loopholes without human intervention.

System Architecture
The Watchtower Layer
The frontend operator console provides developers with real-time insight into the testing execution flow. It streams element interaction decisions, machine learning target ratings, live sensory frame captures, and unhandled interface crash details into a centralized dashboard view.

The Intelligence and Arsenal Layer
The backend execution environment coordinates the automated sensory scanning and testing routines. It includes the cognitive machine learning models that analyze the application layout, a battery of automated attack scenarios that target boundary state vulnerabilities, and multi-channel telemetry monitors that catch unhandled script faults and api loop errors.

The Security and Storage Model
The full-stack data platform handles authenticated operator sessions through a secure, stateless configuration using local token parsing. Individual tracking histories are completely isolated under a multi-tenant query database format, while unauthenticated users are seamlessly routed to a guest configuration that permits active application testing but blocks permanent database saves.

# Tool Usage Guidelines
- Always use the codemap skill to visualize dependencies before modifying core architecture, components, or writing analysis reports.
- Do not blindly read individual files to guess the structure; rely on the codemap output first.

