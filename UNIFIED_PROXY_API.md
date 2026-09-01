# Unified Proxy API Documentation

## Overview

The Unified Proxy API consolidates all application endpoints (app-tracking and audit logging) into a single entry point through the Shopify app proxy. This maintains consistency in API architecture and simplifies Shopify admin integration.

**Base URL**: `https://rishabh-appdev-store.myshopify.com/apps/my-first-custom-app/`

## Architecture

### Route Structure
- **File**: `/app/routes/api.$.jsx`
- **Pattern**: `/api/*` (catch-all route using React Router's `$` parameter)
- **Port**: localhost:3000 (development)

### Request Routing
All requests to `/api/*` are routed based on the first path segment:
- `/api/app-tracking` → App Tracking API
- `/api/audit` → Audit Logging API

### Response Format
All endpoints return consistent JSON structure:

```json
{
  "success": true,
  "data": { /* resource data */ },
  "message": "Success message (for non-data responses)",
  "error": "Error message (if success is false)"
}
```

## API Endpoints

### App Tracking API

#### 1. Create App Installation Record
**Endpoint**: `POST /api/app-tracking`

**Request**:
```bash
curl -X POST http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{
    "store_name": "My Store",
    "email": "owner@store.com",
    "domain": "mystore.myshopify.com",
    "location": "San Francisco, USA",
    "timezone": "PST"
  }'
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "id": 1,
    "store_name": "My Store",
    "email": "owner@store.com",
    "domain": "mystore.myshopify.com",
    "location": "San Francisco, USA",
    "timezone": "PST",
    "installation_time": "2026-09-01T07:13:18.297Z",
    "uninstallation_time": null,
    "createdAt": "2026-09-01T07:13:18.338Z",
    "updatedAt": "2026-09-01T07:13:18.338Z"
  }
}
```

**Fields**:
- `store_name` (string, required) - Name of the store
- `email` (string, required) - Store owner email
- `domain` (string, required, unique) - Store domain
- `location` (string, optional) - Store location
- `timezone` (string, optional) - Store timezone

**Errors**:
- `400` - Missing required fields or validation error
- `409` - Domain already exists (unique constraint)

---

#### 2. Get All App Tracking Records
**Endpoint**: `GET /api/app-tracking`

**Query Parameters** (all optional):
- `domain` - Filter by exact domain match
- `store_name` - Filter by store name (case-insensitive contains)
- `location` - Filter by exact location
- `timezone` - Filter by exact timezone

**Request**:
```bash
# Get all records
curl http://localhost:3000/api/app-tracking

# Filter by domain
curl http://localhost:3000/api/app-tracking?domain=mystore.myshopify.com

# Filter by location
curl http://localhost:3000/api/app-tracking?location=San%20Francisco
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "store_name": "My Store",
      "email": "owner@store.com",
      "domain": "mystore.myshopify.com",
      "location": "San Francisco, USA",
      "timezone": "PST",
      "installation_time": "2026-09-01T07:13:18.297Z",
      "uninstallation_time": null,
      "createdAt": "2026-09-01T07:13:18.338Z",
      "updatedAt": "2026-09-01T07:13:18.338Z"
    }
  ]
}
```

---

#### 3. Update App Tracking Record
**Endpoint**: `PUT /api/app-tracking`

**Request**:
```bash
curl -X PUT http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{
    "id": 1,
    "location": "New York, USA",
    "timezone": "EST",
    "store_name": "My Updated Store"
  }'
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": 1,
    "store_name": "My Updated Store",
    "email": "owner@store.com",
    "domain": "mystore.myshopify.com",
    "location": "New York, USA",
    "timezone": "EST",
    "installation_time": "2026-09-01T07:13:18.297Z",
    "uninstallation_time": null,
    "createdAt": "2026-09-01T07:13:18.338Z",
    "updatedAt": "2026-09-01T07:20:00.000Z"
  }
}
```

**Updateable Fields**:
- `store_name`
- `email`
- `location`
- `timezone`
- `uninstallation_time`

**Errors**:
- `400` - Missing ID for update

---

#### 4. Delete App Tracking Record
**Endpoint**: `DELETE /api/app-tracking`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{"id": 1}'
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Record deleted successfully"
}
```

**Errors**:
- `400` - Missing ID for deletion

---

### Audit Logging API

#### 1. Create Audit Log
**Endpoint**: `POST /api/audit`

**Request**:
```bash
curl -X POST http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "mystore.myshopify.com",
    "audit_type": "installation",
    "audit_data": {
      "plan": "premium",
      "features": ["analytics", "insights"]
    },
    "details": "App installed successfully"
  }'
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "id": 1,
    "domain": "mystore.myshopify.com",
    "audit_type": "installation",
    "audit_data": {
      "plan": "premium",
      "features": ["analytics", "insights"]
    },
    "timestamp": "2026-09-01T07:13:18.297Z",
    "status": "completed",
    "details": "App installed successfully"
  }
}
```

**Fields**:
- `domain` (string, required) - Store domain
- `audit_type` (string, default: "general") - Type of audit event
- `audit_data` (JSON, optional) - Additional audit metadata
- `timestamp` (ISO 8601, default: now) - Event timestamp
- `status` (string, default: "completed") - Audit status
- `details` (string, optional) - Additional details

**Errors**:
- `400` - Missing required domain
- `500` - Database error

---

#### 2. Get Audit Logs
**Endpoint**: `GET /api/audit`

**Query Parameters** (all optional):
- `domain` - Filter by domain
- `type` - Filter by audit_type

**Request**:
```bash
# Get all audit logs
curl http://localhost:3000/api/audit

# Filter by domain
curl http://localhost:3000/api/audit?domain=mystore.myshopify.com

# Filter by type
curl http://localhost:3000/api/audit?type=installation

# Combine filters
curl http://localhost:3000/api/audit?domain=mystore.myshopify.com&type=installation
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "domain": "mystore.myshopify.com",
      "audit_type": "installation",
      "audit_data": {
        "plan": "premium"
      },
      "timestamp": "2026-09-01T07:13:18.297Z",
      "status": "completed",
      "details": "App installed"
    }
  ]
}
```

**Note**: Returns up to 100 most recent records (ordered by timestamp DESC)

---

## Configuration

### Shopify Configuration
File: `shopify.app.toml`

```toml
[app_proxy]
url = "/api"
subpath = "my-first-custom-app"
prefix = "apps"
```

This exposes the API at:
```
https://rishabh-appdev-store.myshopify.com/apps/my-first-custom-app/{path}
```

### Database
- **Type**: PostgreSQL
- **Connection**: Via PrismaClient
- **Models**: AppTracking, AuditLog, Session

---

## Error Handling

All errors follow consistent format:

```json
{
  "success": false,
  "error": "Description of what went wrong"
}
```

### Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | GET, PUT, DELETE successful |
| 201 | Created | POST successful (new resource) |
| 400 | Bad Request | Validation error or missing required field |
| 404 | Not Found | Resource does not exist |
| 405 | Method Not Allowed | Incorrect HTTP method for endpoint |
| 409 | Conflict | Constraint violation (e.g., duplicate domain) |
| 500 | Server Error | Database or internal server error |

---

## Implementation Details

### Route File Structure
```javascript
// /app/routes/api.$.jsx
export async function loader({ request, params }) {
  // Handles GET requests
  // Routes based on params["*"] path segments
}

export async function action({ request, params }) {
  // Handles POST/PUT/DELETE requests
  // Routes based on method + path segments
}
```

### Request Parsing
- Uses `params["*"]` to get remaining path after `/api/`
- Splits path by "/" to determine API type and action
- Uses `request.json()` for body parsing
- Uses `URL.searchParams` for query parameters

### Database Operations
- Direct PrismaClient instantiation in each route
- No external server-only imports (React Router compatibility)
- Transaction-based operations for consistency

---

## Examples

### JavaScript (Browser/Node.js)

```javascript
// Create app tracking record
async function trackAppInstallation(storeData) {
  const response = await fetch('/apps/my-first-custom-app/api/app-tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(storeData)
  });
  return response.json();
}

// Get all tracking records
async function getAllTracking() {
  const response = await fetch('/apps/my-first-custom-app/api/app-tracking');
  return response.json();
}

// Create audit log
async function logAuditEvent(domain, eventData) {
  const response = await fetch('/apps/my-first-custom-app/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain,
      audit_type: eventData.type,
      audit_data: eventData.data,
      details: eventData.details
    })
  });
  return response.json();
}
```

### cURL

```bash
# Track installation
curl -X POST http://localhost:3000/api/proxy/app-tracking \
  -H "Content-Type: application/json" \
  -d '{
    "store_name": "Store Name",
    "email": "owner@store.com",
    "domain": "store.myshopify.com",
    "timezone": "EST"
  }'

# Get all tracked apps
curl http://localhost:3000/api/app-tracking

# Log audit event
curl -X POST http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "store.myshopify.com",
    "audit_type": "feature_enabled",
    "details": "Analytics enabled"
  }'

# Get audit logs for store
curl http://localhost:3000/api/audit?domain=store.myshopify.com
```

---

## Migration from Individual Routes

### Before (Separate routes)
- `/api/app-tracking` - App tracking CRUD
- `/api/app-tracking/get` - Get by ID/domain
- `/api/app-tracking/uninstall` - Record uninstall
- `/api/audit` - Audit CRUD

### After (Unified)
- `/api/app-tracking` - App tracking (same CRUD operations)
- `/api/audit` - Audit logging (same operations)

All functionality preserved, simplified routing structure.

---

## Deployment

1. Build the app:
   ```bash
   npm run build
   ```

2. Start the server:
   ```bash
   npm run start
   ```

3. Server runs on localhost:3000 in development

4. For Shopify admin access, ensure the app is deployed and the proxy URL is configured

---

## Testing

Run the included test commands:

```bash
# Create tracking record
curl -X POST http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{"store_name":"Test","email":"test@example.com","domain":"test.myshopify.com","timezone":"UTC"}'

# List all records
curl http://localhost:3000/api/app-tracking

# Create audit log
curl -X POST http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{"domain":"test.myshopify.com","audit_type":"test"}'

# Get audit logs
curl http://localhost:3000/api/audit?domain=test.myshopify.com
```

---

## Support

For issues or questions:
1. Check the error message for specific details
2. Verify all required fields are present
3. Ensure database connection is active
4. Check server logs for additional context
