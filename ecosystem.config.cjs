module.exports = {
  apps: [
    {
      name: "mmwear-erp",
      script: "/home/mmwearerp/htdocs/erp.mmwear.in/start-prod.sh",
      interpreter: "bash",
      cwd: "/home/mmwearerp/htdocs/erp.mmwear.in",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
