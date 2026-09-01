# Unified Proxy API - Quick Reference

## Quick Start

**Unified Entry Point**: `/api/*`

All APIs now accessible through a single entry point that routes to app-tracking and audit services.

### Endpoints Summary

| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| POST | `/api/app-tracking` | Create app installation | 201 |
| GET | `/api/app-tracking` | List all installations | 200 |
| PUT | `/api/app-tracking` | Update installation | 200 |
| DELETE | `/api/app-tracking` | Delete installation | 200 |
| POST | `/api/audit` | Create audit log | 201 |
| GET | `/api/audit` | List audit logs | 200 |

## Common Tasks

### 1. Track a New Installation
```bash
curl -X POST http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{
    "store_name": "My Store",
    "email": "owner@example.com",
    "domain": "mystore.myshopify.com",
    "timezone": "EST"
  }'
```

### 2. Get All Tracked Stores
```bash
curl http://localhost:3000/api/app-tracking
```

### 3. Find Store by Domain
```bash
curl http://localhost:3000/api/app-tracking?domain=mystore.myshopify.com
```

### 4. Record Uninstallation
```bash
curl -X PUT http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{
    "id": 1,
    "uninstallation_time": "'$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')'
  }'
```

### 5. Log Audit Event
```bash
curl -X POST http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "mystore.myshopify.com",
    "audit_type": "installation",
    "details": "App installed successfully"
  }'
```

### 6. Get Store Audit Logs
```bash
curl http://localhost:3000/api/audit?domain=mystore.myshopify.com
```

## Response Format

All responses are JSON with consistent structure:

```json
{
  "success": true|false,
  "data": {...},
  "message": "...",
  "error": "..."
}
```

## Shopify Integration

**Proxy URL** (in shopify.app.toml):
```toml
[app_proxy]
url = "/api/proxy"
subpath = "my-first-custom-app"
prefix = "apps"
```

**Accessed from Shopify Admin** at:
```
https://rishabh-appdev-store.myshopify.com/apps/my-first-custom-app/*
```

## Database Models

### AppTracking
- `id` - Unique identifier
- `store_name` - Store name
- `email` - Owner email
- `domain` - Store domain (UNIQUE)
- `location` - Store location
- `timezone` - Store timezone
- `installation_time` - When app was installed
- `uninstallation_time` - When app was uninstalled (nullable)
- `createdAt`, `updatedAt` - Timestamps

### AuditLog
- `id` - Unique identifier
- `domain` - Store domain
- `audit_type` - Type of audit event
- `audit_data` - JSON audit data
- `timestamp` - Event time
- `status` - Event status
- `details` - Additional details

## Status Codes

- `200` - Success (GET, PUT, DELETE)
- `201` - Created (POST)
- `400` - Validation error
- `404` - Not found
- `409` - Conflict (duplicate domain)
- `500` - Server error

## File Reference

- **Route**: `/app/routes/api.proxy.$.jsx` (212 lines)
- **Config**: `shopify.app.toml`
- **Schema**: `prisma/schema.prisma`
- **Full Docs**: `UNIFIED_PROXY_API.md`

## Development Server

```bash
# Start server
npm run start

# Server runs on http://localhost:3000
# API accessible at http://localhost:3000/api/*
```

## Need Help?

See `UNIFIED_PROXY_API.md` for complete API documentation with examples in JavaScript and cURL.
