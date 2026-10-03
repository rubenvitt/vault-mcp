# Vault MCP — Design

Remote-MCP-Server für einen Obsidian-Vault, gedacht für claude.ai / Claude Desktop.
Beispielnamen unten: `mcp.example.com` (dieser Server), `id.example.com` (Pocket ID).

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Clients | nur claude.ai / Claude Desktop |
| Rechte | Lesen + Capture (nur neue Dateien in `00-inbox/quick-capture/`) |
| Suche | SQLite FTS5, lokaler Index, kein externer Dienst |
| Auth | **Reiner Resource Server**, Pocket ID ist der Authorization Server |
| Client-Registrierung | **CIMD** (Client ID Metadata Documents), nicht DCR |
| Laufzeit | Node 26, `node:sqlite` (FTS5 verifiziert), keine nativen Module |
| Deployment | Docker-Image aus GitHub Actions (`ghcr.io`), hinter Traefik |

## Auth-Architektur

```
Claude ──(1) POST /mcp ──────────────────────► 401 + WWW-Authenticate(resource_metadata)
Claude ──(2) GET  /.well-known/oauth-protected-resource/mcp ─► PRM: authorization_servers = [id.example.com]
Claude ──(3) GET  id.example.com/.well-known/oauth-authorization-server ─► AS-Metadata
Browser ─(4) GET  id.example.com/authorize
              client_id=https://claude.ai/oauth/mcp-oauth-client-metadata   ← CIMD statt DCR
              resource=https://mcp.example.com/mcp                           ← RFC 8707
              PKCE S256
Browser ─(5) Passkey-Login ───────────────────► claude.ai/api/mcp/auth_callback?code=…
Claude ──(6) POST id.example.com/api/oidc/token ─► RFC-9068-JWT, aud = https://mcp.example.com/mcp
Claude ──(7) POST /mcp mit Bearer ────────────► wir prüfen Signatur, iss, aud, exp
```

**Wir stellen keine Tokens aus.** Alles rund um Login, Consent, Refresh und
Widerruf liegt bei Pocket ID. Unser Anteil ist die Protected Resource Metadata
und die Token-Prüfung — das entspricht der Arbeitsteilung, die die MCP-Spec
2026-07-28 vorsieht und die auch das offizielle `pocket-id/mcp-oauth-demo` zeigt.

### Warum nicht mehr der eigene Authorization Server

Die erste Fassung war ein eigener AS mit Dynamic Client Registration. Drei
Gründe sprechen dagegen, belegt durch Recherche:

- Das MCP-SDK v2 hat seine AS-Helfer eingefroren („Use a dedicated identity
  provider for new servers; this page only covers the resource-server half").
- **DCR gilt in der Spec 2026-07-28 als deprecated**, Nachfolger ist CIMD.
  Pocket ID hat DCR bewusst abgelehnt (Issue #1517, `not_planned`).
- Pocket ID 2.14 kann RFC 8707 nativ. Die Audience-Bindung, wegen der der
  eigene AS ursprünglich nötig schien, entsteht dort korrekt von selbst.

Ergebnis: gut 400 Zeilen sicherheitskritischer OAuth-Code entfallen ersatzlos.

### Audience-Bindung — der entscheidende Punkt

Pocket ID setzt `aud` abhängig vom `resource`-Parameter:

| Anfrage | `aud` im Token |
|---|---|
| ohne `resource` | die `client_id` — ein reines Login-Token |
| mit `resource=https://mcp.example.com/mcp` | unsere Resource (+ Issuer bei Identity-Scopes) |

Der Verifier akzeptiert **nur** Tokens, deren `aud` unsere Resource enthält. Ein
Login-Token für einen anderen Dienst kommt damit nicht durch — das ist der von
der Spec geforderte Schutz gegen Token-Passthrough.

### Zugriffskontrolle

Der `groups`-Claim steckt bei Pocket ID **nicht** im Access Token, sondern nur
im ID-Token und in `/userinfo`. Die Gruppenprüfung gehört deshalb dorthin, wo
sie hingehört: an den Client in Pocket ID (`isGroupRestricted` + eine eigene Gruppe).
Verifiziert im Quellcode: die Prüfung `IsUserGroupAllowedToAuthorize` ist
generisch und greift auch für CIMD-Clients, und ein Metadaten-Refresh setzt sie
nicht zurück (`store.go:279` aktualisiert die Felder nicht).

Optional zusätzlich: `ALLOWED_SUBJECTS` schränkt auf einzelne `sub`-Werte ein.

## Schreibrecht-Design

Der Container mountet den Vault **read-only** und blendet nur
`00-inbox/quick-capture/` schreibbar darüber. Capture kann damit ausschließlich
neue Dateien in genau diesem Ordner anlegen — auf Dateisystemebene erzwungen,
nicht nur im Code.

## Limits, die die Tools einhalten

- Tool-Ergebnis ≤ 150.000 Zeichen (Claude.ai/Desktop); wir kappen bei 120.000
- Tool-Name ≤ 64 Zeichen
- Jedes Tool trägt `title` und `readOnlyHint` bzw. `destructiveHint`
- Große Treffermengen werden paginiert

## Vertrauliche Ordner und Ausschlüsse

Welche Ordner vertraulich sind, steht **nicht im Code**, sondern in einer
JSON-Datei, die nur auf dem Server liegt (`POLICY_FILE`, Vorlage
`policy.example.json`). Die Ordnernamen selbst verraten sonst, wo die
schützenswerten Notizen liegen.

- `exclude` — Regex auf den relativen Pfad; Treffer kommen nie in den Index.
- `sensitive` — indexiert, aber nur mit `include_sensitive` / `allow_sensitive`
  ausgeliefert, und `vault_list` zeigt sie nie.
- `readwise` — importierte Fremdtexte als eigene Indexklasse, standardmäßig nicht
  durchsucht; ihre `[[…]]` gelten nicht als Links.
- `layoutHint` — erklärt Claude in `vault_list` die Ordnerstruktur.

Ohne `POLICY_FILE` ist nichts vertraulich und nichts ausgeschlossen (außer
`.obsidian/`, `.git/`, `node_modules/`) — der Server warnt beim Start.
