module.exports = {
  apps: [
    {
      name: "whatsapp-crm",
      cwd: "/var/www/html/crm/whatsapp-crm",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1, // Change to 'max' or a specific number if on a multi-core droplet with >2GB RAM
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};

