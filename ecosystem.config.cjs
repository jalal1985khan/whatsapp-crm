const fs = require("fs");
const path = require("path");

const root = "/var/www/html/crm/whatsapp-crm";
for (const file of [".env.production", ".env.local", ".env"]) {
  const p = path.join(root, file);
  if (fs.existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch (e) {}
  }
}

module.exports = {
  apps: [
    {
      name: "whatsapp-crm",
      cwd: root,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 4000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
        DATABASE_URL: process.env.DATABASE_URL,
        SESSION_SECRET: process.env.SESSION_SECRET,
        OWNER_SETUP_SECRET: process.env.OWNER_SETUP_SECRET,
        APP_BASE_URL: process.env.APP_BASE_URL || "https://crm.storeshop.biz",
        CRM_WORKSPACE_ID: process.env.CRM_WORKSPACE_ID || "default-workspace",
        CRM_WORKSPACE_NAME: process.env.CRM_WORKSPACE_NAME || "WhatsApp CRM",
      },
    },
  ],
};
