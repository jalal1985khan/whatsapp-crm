#!/usr/bin/env bash
set -euo pipefail

# Deployment script for DigitalOcean Droplet
# Run this from the project root (/var/www/whatsapp-crm)

echo "========================================"
echo " Starting WhatsApp CRM Droplet Deployment"
echo "========================================"

# Check if .env.production or .env.local exists
if [ ! -f .env.production ] && [ ! -f .env.local ] && [ ! -f .env ]; then
  echo "Error: No environment file (.env.production, .env.local, or .env) found!"
  echo "Please create .env.production with your production settings before deploying."
  exit 1
fi

echo "--> Pulling latest changes from git..."
git pull origin main

echo "--> Installing dependencies..."
npm ci --prefer-offline

echo "--> Running database migrations..."
npm run db:migrate

echo "--> Building Next.js production build..."
npm run build

echo "--> Reloading application with PM2..."
if pm2 list | grep -q "whatsapp-crm"; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi

pm2 save

echo "========================================"
echo " Deployment completed successfully!"
echo " Status: pm2 status"
echo " Logs:   pm2 logs whatsapp-crm"
echo "========================================"
