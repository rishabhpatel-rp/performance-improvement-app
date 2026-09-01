# App Tracking API Documentation

## Overview
This document provides comprehensive information about the App Tracking API for storing and managing store installation data in PostgreSQL.

## Database Schema

### Table: `app_tracking`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `store_name` | VARCHAR | NOT NULL | Name of the store |
| `email` | VARCHAR | NOT NULL | Store owner email |
| `domain` | VARCHAR | NOT NULL, UNIQUE | Store domain |
| `location` | VARCHAR | NULLABLE | Store location |
| `timezone` | VARCHAR | NULLABLE | Store timezone |
| `installation_time` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | When app was installed |
| `uninstallation_time` | TIMESTAMP | NULLABLE | When app was uninstalled |
| `createdAt` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Record creation time |
| `updatedAt` | TIMESTAMP | UPDATED ON ROW CHANGE | Record last update time |

## API Endpoints

### 1. Create App Tracking Record
**Endpoint:** `POST /api/app-tracking`

**Description:** Create a new app tracking record for a store installation.

**Request Body:**
```json
{
  "store_name": "My Awesome Store",
  "email": "owner@example.com",
  "domain": "awesome-store.myshopify.com",
  "location": "New York, USA",
  "timezone": "EST"
}
```

**Required Fields:**
- `store_name` (string)
- `email` (string)
- `domain` (string) - Must be unique

**Optional Fields:**
- `location` (string)
- `timezone` (string)
- `installation_time` (ISO 8601 datetime) - Defaults to current time
- `uninstallation_time` (ISO 8601 datetime)

**Response (Success - 201):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "store_name": "My Awesome Store",
    "email": "owner@example.com",
    "domain": "awesome-store.myshopify.com",
    "location": "New York, USA",
    "timezone": "EST",
    "installation_time": "2024-12-01T10:30:00Z",
    "uninstallation_time": null,
    "createdAt": "2024-12-01T10:30:00Z",
    "updatedAt": "2024-12-01T10:30:00Z"
  }
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "error": "store_name, email, and domain are required"
}
```

---

### 2. Get All App Tracking Records
**Endpoint:** `GET /api/app-tracking`

**Description:** Fetch all app tracking records with optional filtering.

**Query Parameters (Optional):**
- `store_name` - Filter by store name (partial match)
- `email` - Filter by email (partial match)
- `domain` - Filter by domain (exact match)
- `location` - Filter by location
- `timezone` - Filter by timezone

**Examples:**
```
GET /api/app-tracking
GET /api/app-tracking?store_name=My
GET /api/app-tracking?domain=awesome-store.myshopify.com
GET /api/app-tracking?location=New%20York
GET /api/app-tracking?timezone=EST
```

**Response (Success - 200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "store_name": "My Awesome Store",
      "email": "owner@example.com",
      "domain": "awesome-store.myshopify.com",
      "location": "New York, USA",
      "timezone": "EST",
      "installation_time": "2024-12-01T10:30:00Z",
      "uninstallation_time": null,
      "createdAt": "2024-12-01T10:30:00Z",
      "updatedAt": "2024-12-01T10:30:00Z"
    }
  ]
}
```

---

### 3. Get Single Record by ID
**Endpoint:** `GET /api/app-tracking/get?id=1`

**Description:** Fetch a specific app tracking record by ID.

**Query Parameters:**
- `id` (required) - The record ID

**Response (Success - 200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "store_name": "My Awesome Store",
    "email": "owner@example.com",
    "domain": "awesome-store.myshopify.com",
    "location": "New York, USA",
    "timezone": "EST",
    "installation_time": "2024-12-01T10:30:00Z",
    "uninstallation_time": null,
    "createdAt": "2024-12-01T10:30:00Z",
    "updatedAt": "2024-12-01T10:30:00Z"
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "error": "Tracking record not found"
}
```

---

### 4. Get Single Record by Domain
**Endpoint:** `GET /api/app-tracking/get?domain=awesome-store.myshopify.com`

**Description:** Fetch a specific app tracking record by domain.

**Query Parameters:**
- `domain` (required) - The store domain

**Response:** Same as above

---

### 5. Update App Tracking Record
**Endpoint:** `PUT /api/app-tracking`

**Description:** Update an existing app tracking record.

**Request Body:**
```json
{
  "id": 1,
  "store_name": "Updated Store Name",
  "email": "newemail@example.com",
  "location": "Los Angeles, USA",
  "timezone": "PST",
  "uninstallation_time": null
}
```

**Required Fields:**
- `id` (number)

**Optional Fields (any of the following):**
- `store_name`
- `email`
- `location`
- `timezone`
- `uninstallation_time`

**Response (Success - 200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "store_name": "Updated Store Name",
    "email": "newemail@example.com",
    "domain": "awesome-store.myshopify.com",
    "location": "Los Angeles, USA",
    "timezone": "PST",
    "installation_time": "2024-12-01T10:30:00Z",
    "uninstallation_time": null,
    "createdAt": "2024-12-01T10:30:00Z",
    "updatedAt": "2024-12-01T11:45:00Z"
  }
}
```

---

### 6. Delete App Tracking Record
**Endpoint:** `DELETE /api/app-tracking`

**Description:** Delete an app tracking record.

**Request Body:**
```json
{
  "id": 1
}
```

**Required Fields:**
- `id` (number)

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Tracking record deleted successfully"
}
```

---

### 7. Record App Uninstallation
**Endpoint:** `POST /api/app-tracking/uninstall`

**Description:** Record the uninstallation time for an app.

**Request Body:**
```json
{
  "domain": "awesome-store.myshopify.com"
}
```

**Required Fields:**
- `domain` (string)

**Response (Success - 200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "store_name": "My Awesome Store",
    "email": "owner@example.com",
    "domain": "awesome-store.myshopify.com",
    "location": "New York, USA",
    "timezone": "EST",
    "installation_time": "2024-12-01T10:30:00Z",
    "uninstallation_time": "2024-12-02T15:20:00Z",
    "createdAt": "2024-12-01T10:30:00Z",
    "updatedAt": "2024-12-02T15:20:00Z"
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "error": "Tracking record not found"
}
```

---

## Setup Instructions

### 1. Environment Configuration
Create or update your `.env` file with PostgreSQL connection string:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/shopify_app_db"
```

### 2. Install Dependencies
Ensure Prisma is installed (should already be in your project):
```bash
npm install
# or
pnpm install
```

### 3. Run Database Migration
Generate Prisma client and apply migrations:

```bash
npm run prisma migrate dev --name add_app_tracking
# or
npx prisma migrate dev --name add_app_tracking
```

### 4. Generate Prisma Client
```bash
npm run prisma generate
# or
npx prisma generate
```

### 5. Start Your Application
```bash
npm run dev
# or
pnpm dev
```

---

## Usage Examples

### cURL Examples

#### Create a tracking record
```bash
curl -X POST http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{
    "store_name": "My Store",
    "email": "owner@example.com",
    "domain": "mystore.myshopify.com",
    "location": "USA",
    "timezone": "EST"
  }'
```

#### Get all records
```bash
curl http://localhost:3000/api/app-tracking
```

#### Get records by domain filter
```bash
curl "http://localhost:3000/api/app-tracking?domain=mystore.myshopify.com"
```

#### Get single record by ID
```bash
curl "http://localhost:3000/api/app-tracking/get?id=1"
```

#### Update a record
```bash
curl -X PUT http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{
    "id": 1,
    "timezone": "PST"
  }'
```

#### Delete a record
```bash
curl -X DELETE http://localhost:3000/api/app-tracking \
  -H "Content-Type: application/json" \
  -d '{"id": 1}'
```

#### Record uninstallation
```bash
curl -X POST http://localhost:3000/api/app-tracking/uninstall \
  -H "Content-Type: application/json" \
  -d '{"domain": "mystore.myshopify.com"}'
```

### JavaScript/Fetch Examples

```javascript
// Create a tracking record
async function createTracking() {
  const response = await fetch('/api/app-tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      store_name: 'My Store',
      email: 'owner@example.com',
      domain: 'mystore.myshopify.com',
      location: 'USA',
      timezone: 'EST'
    })
  });
  return response.json();
}

// Get all records
async function getAllRecords() {
  const response = await fetch('/api/app-tracking');
  return response.json();
}

// Get record by domain
async function getByDomain(domain) {
  const response = await fetch(`/api/app-tracking/get?domain=${domain}`);
  return response.json();
}

// Update a record
async function updateRecord(id, updates) {
  const response = await fetch('/api/app-tracking', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates })
  });
  return response.json();
}

// Delete a record
async function deleteRecord(id) {
  const response = await fetch('/api/app-tracking', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  return response.json();
}

// Record uninstallation
async function recordUninstall(domain) {
  const response = await fetch('/api/app-tracking/uninstall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain })
  });
  return response.json();
}
```

---

## Error Handling

All endpoints follow a consistent error response format:

```json
{
  "success": false,
  "error": "Error description"
}
```

### Common HTTP Status Codes
- **200 OK** - Request successful
- **201 Created** - Resource created successfully
- **400 Bad Request** - Missing or invalid required fields
- **404 Not Found** - Resource not found
- **405 Method Not Allowed** - Incorrect HTTP method
- **500 Internal Server Error** - Server error

---

## Best Practices

1. **Always include required fields** when creating records
2. **Use domain queries** for production lookups (domain is unique)
3. **Handle timestamps properly** - They're returned as ISO 8601 strings
4. **Check the success flag** in responses before accessing data
5. **Implement rate limiting** for production deployments
6. **Use database transactions** for critical multi-step operations
7. **Maintain audit logs** of install/uninstall events
8. **Keep database backups** of tracking data

---

## Integration with Webhooks

You can integrate this API with Shopify webhooks for automatic tracking:

```javascript
// Example webhook handler in your routes
export async function handleAppUninstalledWebhook(data) {
  const { shop } = data;
  const result = await recordUninstallation(shop);
  return result;
}
```

---

## Performance Considerations

- **Indexes:** The `domain` field has a UNIQUE index for fast lookups
- **Query Optimization:** Queries are ordered by `createdAt` descending
- **Connection Pool:** Uses Prisma's connection pooling for efficiency
- **Pagination:** Consider adding pagination for large result sets

For improvements to handle large datasets, consider:
- Adding pagination
- Creating composite indexes
- Archiving old records
- Implementing caching strategies

---

## Troubleshooting

### Database Connection Issues
```env
# Verify your DATABASE_URL format:
postgresql://username:password@host:port/database
```

### Migration Errors
```bash
# Reset database (development only)
npx prisma migrate reset

# Check migration status
npx prisma migrate status
```

### Prisma Client Issues
```bash
# Regenerate Prisma client
npx prisma generate

# Clear cache
rm -rf node_modules/.prisma
npm install
```

---

## Support
For issues or questions, refer to:
- [Prisma Documentation](https://www.prisma.io/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [React Router Documentation](https://reactrouter.com/)
