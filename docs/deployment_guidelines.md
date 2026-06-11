# DOCNOW - Deployment Guidelines

This document outlines the standard operating procedure (SOP) for deploying updates to the DOCNOW production environment. 

## 1. Prerequisites
Before deploying, ensure you have the following:
- **SSH Access:** You need the private SSH key (`.pem` file) and the public IP address of the EC2 instance (currently `52.66.144.127`).
- **Local Environment:** Ensure your local code is tested, committed, and ready for production.

---

## 2. Pushing Code to the Server (rsync)
The EC2 server does not currently pull directly from GitHub. Instead, we use `rsync` to securely copy our local files to the server, intentionally ignoring massive folders like `node_modules` and compiled files.

Run these commands from the root of the DOCNOW project on your local machine:

**Push the Server Code:**
```bash
rsync -avz --delete --exclude='node_modules' --exclude='.next' --exclude='dist' --exclude='.env' --exclude='server.log' --exclude='storage' -e "ssh -i /path/to/your-key.pem -o StrictHostKeyChecking=no" ./server/ ubuntu@52.66.144.127:~/server/
```

**Push the Client Code:**
```bash
rsync -avz --delete --exclude='node_modules' --exclude='.next' --exclude='.env' --exclude='.env.local' -e "ssh -i /path/to/your-key.pem -o StrictHostKeyChecking=no" ./client/ ubuntu@52.66.144.127:~/client/
```

*(Note: Replace `/path/to/your-key.pem` with the actual path to the AWS private key)*

---

## 3. Backend (API) Deployment Steps
Once the code is pushed, SSH into the server:
`ssh -i /path/to/your-key.pem ubuntu@52.66.144.127`

Run the following commands to build and restart the API:
```bash
# 1. Navigate to the server directory
cd ~/server

# 2. Install any new dependencies
npm install

# 3. Update the Database Client & run migrations
npx prisma generate
npx prisma migrate deploy

# 4. Compile TypeScript to JavaScript
npx tsc

# 5. Restart the PM2 process
pm2 restart api
```

### ⚠️ Troubleshooting the API
If the API fails to start, it is almost always an environment variable issue. Our `envValidator.ts` will crash the server on purpose if critical keys (like `RAZORPAY_WEBHOOK_SECRET` or `JWT_SECRET`) are missing.
- Check logs: `pm2 logs api --lines 50`
- Edit env: `nano ~/server/.env`

### CORS Configuration
Production CORS must use an explicit allowlist. Set this in `~/server/.env`:

```bash
CORS_ALLOWED_ORIGINS=https://docnow.in,https://www.docnow.in
```

For local development, include `http://localhost:3000`. Do not use `*` because the API uses cookies and credentialed requests.

---

## 4. Frontend (Client) Deployment Steps
While still connected to the server via SSH:

```bash
# 1. Navigate to the client directory
cd ~/client

# 2. Install any new dependencies
npm install

# 3. Build the Next.js application (This takes ~1-2 minutes)
npm run build

# 4. Restart the PM2 process
pm2 restart client
```

### ⚠️ Troubleshooting the Client
If the client fails to build, check that `NEXT_PUBLIC_API_URL` is correctly set in `~/client/.env.production` (it should point to `https://api.docnow.in/api`).

---

## 5. Infrastructure Notes (Nginx & PM2)
You generally do not need to touch these configurations during a standard deployment, but you should know how they work:

- **PM2 (Process Manager):** Keeps our Node apps alive. 
  - To view all apps: `pm2 status`
  - To view logs: `pm2 logs`
- **Nginx (Reverse Proxy):** Routes web traffic to our PM2 apps.
  - `docnow.in` routes to the Client on `localhost:3000`
  - `api.docnow.in` routes to the Server on `localhost:5000`
  - Configs are located at `/etc/nginx/sites-enabled/`
- **SSL / HTTPS:** Certificates are managed entirely automatically via Let's Encrypt (`certbot`). No manual renewal is required.

---

## 6. Docker Note

The repository includes Dockerfiles and `docker-compose.yml` for local development. These do **not** replace the current production deployment yet.

Continue using this EC2 + PM2 + Nginx deployment SOP for production until a Docker-based production rollout has been tested, documented, and given a rollback plan.
