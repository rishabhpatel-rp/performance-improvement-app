# App Tracking API - Quick Start Guide

## What Was Created

A complete Node.js/Express API for tracking Shopify app installations and uninstallations with PostgreSQL database storage.

### Created Files:

1. **Database Model** (`prisma/schema.prisma`)
   - Updated to use PostgreSQL
   - Added `AppTracking` model with fields: store_name, email, domain, location, timezone, installation_time, uninstallation_time

2. **Service Layer** (`app/lib/appTracking.server.js`)
   - Database operations: Create, Read, Update, Delete, Find by ID/Domain
   - Reusable functions for all CRUD operations
   - Error handling and validation

3. **API Routes**:
   - `app/routes/api.app-tracking.jsx` - Main CRUD endpoints (GET all, POST create, PUT update, DELETE remove)
   - `app/routes/api.app-tracking.get.jsx` - Specific retrieval (by ID or domain)
   - `app/routes/api.app-tracking.uninstall.jsx` - Record uninstallation

4. **Documentation**:
   - `APP_TRACKING_API.md` - Complete API reference with examples
   - `DATABASE_SETUP.md` - Step-by-step database setup instructions

## Quick Start (5 Minutes)

### Step 1: Configure Database
```bash
# Create .env file
cat > .env << 'EOF'
DATABASE_URL="postgresql://username:password@localhost:5432/shopify_app_db"
EOF
```

### Step 2: Setup PostgreSQL
```bash
# Option A: Using local PostgreSQL
createdb shopify_app_db

# Option B: Using Docker
docker run --name postgres \
  -e POSTGRES_DB=shopify_app_db \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 -d postgres:15
```

### Step 3: Run Migrations
```bash
npm run setup
# Or: npx prisma migrate dev --name add_app_tracking
```

### Step 4: Start App
```bash
npm run dev
```

## API Usage Examples

### Create Tracking Record
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

### Get All Records
```bash
curl http://localhost:3000/api/app-tracking
```

### Get by Domain
```bash
curl "http://localhost:3000/api/app-tracking/get?domain=mystore.myshopify.com"
```

### Record Uninstallation
```bash
curl -X POST http://localhost:3000/api/app-tracking/uninstall \
  -H "Content-Type: application/json" \
  -d '{"domain": "mystore.myshopify.com"}'
```

## File Structure

```
performance-improvement-app/
├── prisma/
│   └── schema.prisma                    # Database schema (updated)
├── app/
│   ├── lib/
│   │   └── appTracking.server.js       # ✨ NEW - Database operations
│   └── routes/
│       ├── api.app-tracking.jsx        # ✨ NEW - Main CRUD endpoints
│       ├── api.app-tracking.get.jsx    # ✨ NEW - Specific retrieval
│       └── api.app-tracking.uninstall.jsx  # ✨ NEW - Uninstall tracking
├── .env                                # ✨ NEW - Environment config
├── APP_TRACKING_API.md                 # ✨ NEW - Full API docs
└── DATABASE_SETUP.md                   # ✨ NEW - Database setup guide
```

## Database Schema

| Column | Type | Notes |
|--------|------|-------|
| id | INT | Primary Key, Auto-increment |
| store_name | VARCHAR | Store name |
| email | VARCHAR | Store owner email |
| domain | VARCHAR | Store domain (UNIQUE) |
| location | VARCHAR | Store location (optional) |
| timezone | VARCHAR | Store timezone (optional) |
| installation_time | TIMESTAMP | Install date (default: now) |
| uninstallation_time | TIMESTAMP | Uninstall date (nullable) |
| createdAt | TIMESTAMP | Record created (auto) |
| updatedAt | TIMESTAMP | Record updated (auto) |

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/app-tracking` | Get all records (with optional filters) |
| POST | `/api/app-tracking` | Create new tracking record |
| GET | `/api/app-tracking/get?id=1` | Get record by ID |
| GET | `/api/app-tracking/get?domain=...` | Get record by domain |
| PUT | `/api/app-tracking` | Update tracking record |
| DELETE | `/api/app-tracking` | Delete tracking record |
| POST | `/api/app-tracking/uninstall` | Record uninstallation |

## Integration with Webhooks

Hook into Shopify's `app/uninstalled` webhook:

```javascript
// app/routes/webhooks.app.uninstalled.jsx
import { recordUninstallation } from '../lib/appTracking.server';

export async function action({ request }) {
  const { domain } = JSON.parse(await request.text());
  await recordUninstallation(domain);
  return new Response(null, { status: 204 });
}
```

## Common Tasks

### Check Database
```bash
# View database in Prisma Studio
npx prisma studio

# Or use psql
psql shopify_app_db
\dt  # List tables
SELECT * FROM "AppTracking";  # View records
```

### Reset Database (Development)
```bash
npx prisma migrate reset
```

### View Schema
```bash
npx prisma db push
```

## Troubleshooting

### Connection Error
```bash
# Check DATABASE_URL in .env
# Make sure PostgreSQL is running
sudo systemctl status postgresql

# Or for Docker
docker ps | grep postgres
```

### Migration Error
```bash
npx prisma migrate status
npx prisma migrate resolve --rolled-back "migration_name"
```

### Prisma Client Error
```bash
npx prisma generate
npx prisma db push
```

## Next Steps

1. Read [APP_TRACKING_API.md](./APP_TRACKING_API.md) for complete API documentation
2. Read [DATABASE_SETUP.md](./DATABASE_SETUP.md) for detailed setup instructions
3. Test endpoints with provided cURL/JavaScript examples
4. Integrate with Shopify webhooks for automatic tracking
5. Add authentication/authorization as needed

## Support

- **Prisma Docs**: https://www.prisma.io/docs/
- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **React Router**: https://reactrouter.com/

---

## Summary of Changes

✅ **Prisma Schema**: Updated to PostgreSQL with new `AppTracking` model  
✅ **Database Layer**: Complete service with CRUD operations  
✅ **API Routes**: Three endpoint files for all operations  
✅ **Documentation**: Complete setup and API reference  
✅ **Examples**: cURL and JavaScript usage examples  

**Ready to use!** Test with the quick examples above.
