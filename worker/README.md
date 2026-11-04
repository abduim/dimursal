# Приёмник трекеров «Табун»

Cloudflare Worker `tabun` (tabun.mursalovabduim.workers.dev).
Cloudflare сам собирает и выкладывает этот код после каждого изменения в репозитории.

- `/globalstar/<KEY>` — XML от Globalstar (SmartOne C).
- `/lingo/<KEY>` — JSON от Ground Control (Cloudloop / Lingo).
- `/test/<KEY>` — проверка связи с базой.

Секреты SA и KEY хранятся только в Cloudflare.
