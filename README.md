# Frontend Overview

A Dynatrace platform app that compares and contrasts every web app in the tenant. Built for web developers and web app owners.

Tabs:

- **Executive Summary** — Fleet-wide letter grade + per-web-app grade table (weighted CWV + error rate + bounce)
- **Web Vitals** — LCP / INP / CLS / TTFB per web app (Google thresholds)
- **Performance** — Session duration, actions per session, fastest / slowest ranking
- **Errors & Reliability** — Error rate per web app + top JavaScript errors
- **Navigation & Flows** — Top pages + actual page-to-page transitions per web app
- **Resource Consumption** — Bytes / requests per web app (who is the heaviest, chattiest)
- **Cost & Ranking** — Adjustable cost model (bandwidth + requests + RUM) to rank web apps by spend
- **Traffic & Engagement** — Sessions, users, new-user rate, bounce
- **Geo & Devices** — Country + browser / OS / device breakdown
- **Perf Budgets** — Live budget compliance per web app; adjust budgets and rows re-evaluate
- **Problems** — Davis problems affecting web-app services

## Develop

```powershell
npm install --legacy-peer-deps
npx dt-app dev
```

## Deploy

```powershell
# bump version in app.config.json first, then:
npx dt-app deploy
```
