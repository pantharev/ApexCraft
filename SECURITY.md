# Security Policy

Thanks for helping keep ApexCraft and its players safe.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.** Public
reports can expose other users before a fix is available.

Instead, report privately using **one** of:

- **GitHub** — open a private advisory via the repository's
  **Security → Report a vulnerability** tab
  ([Privately reporting a security vulnerability](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
- **Email** — <apexcraftgame@gmail.com> with the subject line `SECURITY`.

Please include, as best you can:

- a description of the issue and its impact,
- steps to reproduce (a minimal example or proof of concept),
- affected version/commit and browser/environment,
- any suggested fix or mitigation.

## What to expect

ApexCraft is a small, volunteer-run open-source project, so timelines are
best-effort:

- **Acknowledgement:** within about 7 days.
- **Assessment & fix:** we'll investigate, keep you updated, and aim to release a
  fix for confirmed issues as soon as is practical.
- **Disclosure:** please give us a reasonable chance to ship a fix before any
  public disclosure. We're happy to credit you in the advisory unless you'd
  prefer to stay anonymous.

## Scope

ApexCraft is a client-side, browser-based game with no official backend; play
data is stored locally in your browser (IndexedDB). Reports we're most
interested in include, for example:

- cross-site scripting (XSS) or code injection through game data, save files, or
  world/seed input,
- supply-chain issues in our dependencies that affect this project,
- anything that could let a malicious save, share link, or mod run unintended
  code in another player's browser.

Out of scope: vulnerabilities in third-party hosting/CDN platforms themselves,
and issues that require an already-compromised machine.

Thank you for reporting responsibly!
