# Environment Setup for App Tracking API

## PostgreSQL Database Setup

### Prerequisites
- PostgreSQL installed and running
- Node.js and npm/pnpm installed
- Access to database creation privileges

### Step 1: Create PostgreSQL Database

#### Using psql CLI:
```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE shopify_app_db;

# Create user with password
CREATE USER shopify_user WITH PASSWORD 'your_secure_password';

# Grant privileges
ALTER ROLE shopify_user WITH CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE shopify_app_db TO shopify_user;

# Exit
\q
```

#### Using Docker (Alternative):
```bash
docker run --name postgres_app \
  -e POSTGRES_DB=shopify_app_db \
  -e POSTGRES_USER=shopify_user \
  -e POSTGRES_PASSWORD=your_secure_password \
  -p 5432:5432 \
  -d postgres:15
```

### Step 2: Configure Environment Variables

#### Create `.env` file:
```bash
cd /path/to/your/app
touch .env
```

#### Add PostgreSQL connection string:
```env
# PostgreSQL Connection
DATABASE_URL="postgresql://shopify_user:your_secure_password@localhost:5432/shopify_app_db"

# Optional: Additional environment variables
NODE_ENV=development
LOG_LEVEL=debug
```

**Connection String Format:**
```
postgresql://username:password@hostname:port/database_name
```

**Common Configurations:**

For local development:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/shopify_app_db"
```

For Docker:
```env
DATABASE_URL="postgresql://shopify_user:your_secure_password@localhost:5432/shopify_app_db"
```

For cloud deployment (e.g., Heroku):
```env
DATABASE_URL="postgresql://user:password@db.example.com:5432/appname"
```

### Step 3: Install Dependencies

```bash
# Using npm
npm install

# Using pnpm
pnpm install
```

### Step 4: Run Database Migrations

```bash
# Generate Prisma client and run migrations
npm run setup

# Or manually:
npx prisma generate
npx prisma migrate dev --name add_app_tracking

# Or using pnpm:
pnpm prisma migrate dev --name add_app_tracking
```

### Step 5: Verify Database Setup

```bash
# Check database connection
npx prisma db push

# Open Prisma Studio to view data
npx prisma studio
```

### Step 6: Start Development Server

```bash
# Using npm
npm run dev

# Using pnpm
pnpm dev
```

---

## Connection String Examples

### Local PostgreSQL
```
postgresql://postgres@localhost:5432/shopify_app_db
```

### PostgreSQL with Custom Port
```
postgresql://user:password@localhost:5433/database_name
```

### PostgreSQL on Remote Server
```
postgresql://user:password@db.example.com:5432/shopify_app_db
```

### PostgreSQL with SSL
```
postgresql://user:password@db.example.com:5432/shopify_app_db?sslmode=require
```

### Heroku PostgreSQL
```
postgresql://xxxxxxxxx:yyyyyyyyy@ec2-xx-xxx-xxx-xx.compute-1.amazonaws.com:5432/dbxxxxxxxxx
```

### AWS RDS PostgreSQL
```
postgresql://admin:password@mydb.xxxxxxxxxxxx.us-east-1.rds.amazonaws.com:5432/shopify_app
```

### Vercel/Edge PostgreSQL
```
postgresql://user:password@pg.vercel-storage.com:5432/verceldb?sslmode=require
```

---

## Testing Database Connection

### Using psql:
```bash
psql -U shopify_user -h localhost -d shopify_app_db

# Inside psql:
\dt  # List tables
\q   # Exit
```

### Using Node.js:
```javascript
// test-connection.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testConnection() {
  try {
    await prisma.$connect();
    console.log('✅ Database connection successful!');
    
    // Test query
    const count = await prisma.appTracking.count();
    console.log(`App Tracking records: ${count}`);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
```

Run test:
```bash
node test-connection.js
```

---

## Troubleshooting Common Issues

### Issue 1: "Cannot connect to database"
**Solution:**
```bash
# Verify PostgreSQL is running
sudo systemctl status postgresql

# Or for macOS
brew services list | grep postgres

# Or for Docker
docker ps | grep postgres
```

### Issue 2: "Database does not exist"
**Solution:**
```bash
# Recreate database
psql -U postgres -c "CREATE DATABASE shopify_app_db;"
```

### Issue 3: "Role/User does not have login privileges"
**Solution:**
```bash
psql -U postgres -c "ALTER USER shopify_user WITH LOGIN;"
```

### Issue 4: "Connection refused at localhost:5432"
**Solution:**
```bash
# Check PostgreSQL is listening on correct port
netstat -an | grep 5432

# Or restart PostgreSQL
sudo systemctl restart postgresql
```

### Issue 5: "Prisma migration fails"
**Solution:**
```bash
# Reset database (development only)
npx prisma migrate reset

# Or check migration status
npx prisma migrate status
```

---

## Environment Setup for Different Environments

### Development (.env.local)
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/shopify_app_dev"
NODE_ENV=development
DEBUG=true
```

### Testing (.env.test)
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/shopify_app_test"
NODE_ENV=test
DEBUG=false
```

### Production (.env.production)
```env
DATABASE_URL="postgresql://prod_user:secure_password@prod-db.example.com:5432/shopify_app_prod"
NODE_ENV=production
DEBUG=false
LOG_LEVEL=error
```

---

## Security Best Practices

1. **Never commit `.env` to version control**
   ```bash
   # Add to .gitignore
   echo ".env" >> .gitignore
   echo ".env.local" >> .gitignore
   ```

2. **Use strong passwords for database user**
   ```bash
   # Generate secure password
   openssl rand -base64 32
   ```

3. **Restrict database user privileges**
   ```sql
   -- Only grant necessary permissions
   GRANT CONNECT ON DATABASE shopify_app_db TO shopify_user;
   GRANT USAGE ON SCHEMA public TO shopify_user;
   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO shopify_user;
   ```

4. **Use SSL/TLS for remote connections**
   ```env
   DATABASE_URL="postgresql://user:password@db.example.com:5432/db?sslmode=require"
   ```

5. **Enable connection pooling** (Consider using PgBouncer for production)
   ```env
   DATABASE_URL="postgresql://user:password@pgbouncer:6432/shopify_app_db"
   ```

---

## Performance Optimization

### Connection Pool Settings
In your `.env`:
```env
# Prisma connection pool (Node.js process)
DATABASE_URL="postgresql://user:password@localhost/db?schema=public&connection_limit=5"
```

### Index Creation (Optional)
After running migrations, you can create additional indexes:

```sql
-- Connect to database
psql -U shopify_user -d shopify_app_db

-- Create indexes for common queries
CREATE INDEX idx_app_tracking_domain ON "AppTracking"(domain);
CREATE INDEX idx_app_tracking_email ON "AppTracking"(email);
CREATE INDEX idx_app_tracking_installation_time ON "AppTracking"(installation_time DESC);
```

---

## Backup and Restore

### Backup Database
```bash
pg_dump -U shopify_user -h localhost shopify_app_db > backup.sql
```

### Restore Database
```bash
psql -U shopify_user -h localhost shopify_app_db < backup.sql
```

### Automated Backup (Cron Job)
```bash
# Create backup script
cat > backup_db.sh << 'EOF'
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
pg_dump -U shopify_user shopify_app_db | gzip > "backups/shopify_app_db_$TIMESTAMP.sql.gz"
EOF

chmod +x backup_db.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /path/to/backup_db.sh
```

---

## Docker Compose Setup (Recommended for Development)

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: shopify_app_db
      POSTGRES_USER: shopify_user
      POSTGRES_PASSWORD: your_secure_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shopify_user"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

Start services:
```bash
docker-compose up -d

# Check status
docker-compose ps

# Stop services
docker-compose down
```

---

## Next Steps

1. ✅ Create PostgreSQL database
2. ✅ Configure `.env` file
3. ✅ Run `npm install`
4. ✅ Run database migrations
5. ✅ Start development server
6. ✅ Test API endpoints

See [APP_TRACKING_API.md](./APP_TRACKING_API.md) for detailed API documentation.
