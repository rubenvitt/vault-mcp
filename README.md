# Vault MCP

Remote-MCP-Server, der Claude (claude.ai, Claude Desktop, Claude Code) lesenden
Zugriff auf einen Obsidian-Vault gibt, plus eine eng begrenzte Schreibfunktion
für einen Posteingang. Reiner OAuth-Resource-Server: [Pocket ID](https://pocket-id.org)
ist der Authorization Server, Claude weist sich per CIMD aus.

## Was er kann

| Werkzeug | Zweck |
|---|---|
| `vault_search` | Volltextsuche (SQLite FTS5) mit Filtern auf Tag, Ordner und Frontmatter-Typ |
| `vault_read` | Notiz vollständig lesen, mit Fortsetzung bei sehr langen Notizen |
| `vault_list` | Ordner auflisten, zur Orientierung |
| `vault_links` | Backlinks und ausgehende Links einer Notiz |
| `vault_stats` | Kennzahlen des Vaults |
| `vault_capture` | Neue Notiz im Capture-Ordner ablegen (Scope `vault:capture`) |

## Betrieb

Das Image baut GitHub Actions bei jedem Push auf `main`:
`ghcr.io/rubenvitt/vault-mcp:latest` (zusätzlich `:<commit-sha>`).

1. `docker-compose.example.yml`, `.env.example` und `policy.example.json` neben
   den Stack kopieren (ohne `.example`) und anpassen.
2. In Pocket ID unter *Allowed metadata document URLs*
   `https://claude.ai/oauth/mcp-oauth-client-metadata` freischalten und eine API
   mit der Resource `<PUBLIC_URL>/mcp` anlegen.
3. `docker compose up -d`, dann in Claude einen Connector auf `<PUBLIC_URL>/mcp`.

| Variable | Bedeutung |
|---|---|
| `PUBLIC_URL` | öffentliche Adresse, Pflicht |
| `OIDC_ISSUER` | Pocket-ID-Issuer, Pflicht |
| `POLICY_FILE` | Pfad zur Policy (vertrauliche Ordner, Ausschlüsse) |
| `ALLOWED_SUBJECTS` | optionale Einschränkung auf `sub`-Werte |
| `VAULT_PATH`, `INDEX_DB`, `CAPTURE_FOLDER` | Pfade, Standard `/vault`, `/data/index.db`, `00-inbox/quick-capture` |
| `REINDEX_INTERVAL_MIN` | Abstand der Index-Neuaufbauten, Standard 15 |

Tests, ohne laufenden Container:
```bash
npm ci && npm test
```

## Aufbau

- `src/oauth/` — Token-Prüfung (RFC 9068, Audience-Bindung), Principal-Cache
- `src/vault/` — Markdown-Parser, SQLite-FTS5-Index, Link-Graph, Policy, Capture
- `src/mcp/` — MCP-Werkzeuge auf Basis von `@modelcontextprotocol/server` v2
- `src/http/` — HTTP-Schicht, Protected Resource Metadata, Host-Prüfung

## Sicherheitsentscheidungen

- **Schreibrechte auf Dateisystemebene begrenzt:** Der Vault ist read-only gemountet,
  nur der Capture-Ordner liegt beschreibbar darüber. Ein Fehler im Code kann
  keine bestehende Notiz verändern.
- **Vertrauliche Ordner** werden indexiert, aber nur auf ausdrückliche Anforderung
  ausgeliefert. Welche das sind, steht in der Policy-Datei auf dem Server, nicht
  im Code.
- **Audience-Bindung:** Akzeptiert werden nur Tokens, deren `aud` exakt
  `<PUBLIC_URL>/mcp` enthält. Ein reines Login-Token kommt damit nicht durch —
  der von der MCP-Spec geforderte Schutz gegen Token-Passthrough.
- **Kein eigener Authorization Server:** Login, Consent, Refresh und Widerruf
  liegen vollständig bei Pocket ID.
- **Readwise-Importe** sind eine eigene Indexklasse und standardmäßig aus der Suche
  ausgenommen, damit importierte Fremdtexte die eigenen Notizen nicht verdrängen.

Hintergrund und Entscheidungen: `docs/design.md`.
