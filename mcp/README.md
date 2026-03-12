# KFS MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes the **Kalisio Features Service** (KFS) to Claude and other MCP-compatible clients.

KFS implements the [OGC API Features](https://ogcapi.ogc.org/features/) standard (Part 1). This MCP server wraps every KFS endpoint as a tool so you can explore datasets, query features, apply spatial/temporal/CQL filters and retrieve individual features — all from a natural-language conversation.

---

## Prerequisites

- Node.js >= 18
- A running KFS instance (see the [KFS documentation](../README.md))
- [Claude Desktop](https://claude.ai/download) or another MCP-compatible client

---

## Installation

```bash
cd mcp
npm install
```

---

## Configuration

One environment variable controls the server:

| Variable  | Default                        | Description                                              |
|-----------|--------------------------------|----------------------------------------------------------|
| `KFS_URL` | `http://localhost:8081/api`    | Base URL of the KFS API                                  |
| `KFS_JWT` | *(unset)*                      | JWT sent as `Authorization: Bearer <token>` on every request. Required only when KFS is deployed behind authentication. |

---

## Usage with Claude Desktop

Add the server to your `claude_desktop_config.json`
(usually `~/.config/Claude/claude_desktop_config.json` on Linux,
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "kfs": {
      "command": "node",
      "args": ["/absolute/path/to/kfs/mcp/server.js"],
      "env": {
        "KFS_URL": "http://localhost:8081/api",
        "KFS_JWT": "your.jwt.token"
      }
    }
  }
}
```

Replace `/absolute/path/to/kfs` with the actual path to this repository.
Restart Claude Desktop after saving the file.

### Pointing at a remote authenticated instance

```json
"env": {
  "KFS_URL": "https://my-kfs-server.example.com/api",
  "KFS_JWT": "your.jwt.token"
}
```

`KFS_JWT` is optional — omit it entirely for unauthenticated deployments.

---

## Usage with Claude Code (CLI)

Add the server to your project or user MCP settings:

```bash
claude mcp add kfs -- node /absolute/path/to/kfs/mcp/server.js
```

Or with a custom URL and JWT:

```bash
claude mcp add kfs \
  -e KFS_URL=https://my-kfs-server.example.com/api \
  -e KFS_JWT=your.jwt.token \
  -- node /absolute/path/to/kfs/mcp/server.js
```

---

## Available Tools

### `healthcheck`
Check that the KFS service is reachable and return its version.

---

### `get_landing_page`
Retrieve the OGC API Features landing page: service title, description and links to the conformance, definition and collections endpoints.

---

### `get_conformance`
Return the list of OGC conformance classes supported by this KFS instance.

---

### `get_api_definition`
Fetch the full OpenAPI 3.0 specification of the service.

---

### `list_collections`
List all feature collections currently exposed by KFS, with their ids, titles and spatial extents.

---

### `get_collection`

Get metadata for one collection.

| Parameter  | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| `name`     | string | yes      | Collection id, e.g. `myLayer` or `myLayer~sub`   |
| `context`  | string | no       | Context segment (user/org id) for scoped layers  |

---

### `get_features`

Query features from a collection. Returns a GeoJSON FeatureCollection.

| Parameter     | Type             | Required | Description |
|---------------|------------------|----------|-------------|
| `name`        | string           | yes      | Collection id |
| `context`     | string           | no       | Context segment |
| `limit`       | integer          | no       | Max features to return |
| `offset`      | integer          | no       | Skip N features (for pagination) |
| `bbox`        | string           | no       | Spatial filter: `"minLon,minLat,maxLon,maxLat"` in WGS 84 |
| `bbox_crs`    | string           | no       | CRS of the bbox (OGC URI/URN, default WGS 84) |
| `datetime`    | string           | no       | Temporal filter (ISO 8601 instant or interval) |
| `sortby`      | string           | no       | Sort fields, e.g. `"-time,+name"` |
| `filter`      | string           | no       | CQL filter expression |
| `filter_lang` | `cql-text`\|`cql-json` | no | CQL dialect (default `cql-text`) |
| `properties`  | object           | no       | Additional property equality filters |

#### Temporal filter examples

```
# Single instant
2024-01-15T12:00:00Z

# Closed interval
2024-01-01T00:00:00Z/2024-01-31T23:59:59Z

# Open-ended (from a date onward)
2024-01-01T00:00:00Z/..
```

#### CQL filter examples (cql-text)

```
# Numeric comparison
temperature > 20

# Combined with logical operators
temperature > 20 AND status = 'active'

# Spatial filter (WKT geometry)
S_INTERSECTS(geometry, POLYGON((2.3 48.8, 2.4 48.8, 2.4 48.9, 2.3 48.9, 2.3 48.8)))

# Null check
windSpeed IS NULL

# In list
category IN ('A', 'B', 'C')
```

#### CQL filter example (cql-json)

```json
{
  "op": "and",
  "args": [
    { "op": "gt", "args": [{ "property": "temperature" }, 20] },
    { "op": "eq", "args": [{ "property": "status" }, "active"] }
  ]
}
```

#### Sorting examples

```
# Descending time (most recent first)
-time

# Multiple fields
-time,+name
```

#### Property filter examples (the `properties` parameter)

```json
{ "status": "active", "country": "FR" }
```

To avoid automatic type conversion of a numeric-looking string, wrap it in single quotes:

```json
{ "code": "'1000'" }
```

---

### `get_feature`

Retrieve a single feature by its id.

| Parameter | Type   | Required | Description           |
|-----------|--------|----------|-----------------------|
| `name`    | string | yes      | Collection id         |
| `id`      | string | yes      | Feature id            |
| `context` | string | no       | Context segment       |

---

## Example conversation

Once the MCP server is connected, you can ask Claude things like:

> *"List all available datasets in KFS."*

> *"Show me the 10 most recent features in the `weather-stations` collection."*

> *"Find weather stations in metropolitan France (bbox: -5.14,41.33,9.56,51.09) where temperature is above 30°C."*

> *"Get the details of feature `64a3f1c2b0e12d0011abcdef` from the `weather-stations` collection."*

> *"Query the `fires` collection for events that occurred between 2024-06-01 and 2024-08-31 and sort them by descending time."*

---

## Supported CQL operators

| Category    | Operators                                        |
|-------------|--------------------------------------------------|
| Logical     | `AND`, `OR`, `NOT`                               |
| Comparison  | `=`, `<`, `>`, `<=`, `>=`, `BETWEEN`, `IN`       |
| Spatial     | `S_INTERSECTS`, `S_WITHIN`                       |
| Temporal    | `T_BEFORE`, `T_AFTER`, `T_DURING`                |
| Null        | `IS NULL`                                        |

---

## Running the server manually (for testing)

```bash
# Unauthenticated
KFS_URL=http://localhost:8081/api node server.js

# Authenticated
KFS_URL=https://my-kfs-server.example.com/api KFS_JWT=your.jwt.token node server.js
```

The server communicates over stdio (standard MCP transport), so no HTTP port is opened.
