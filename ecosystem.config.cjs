module.exports = {
  apps: [
    {
      name: "mmwear-erp",
      script: "artifacts/api-server/dist/index.mjs",
      cwd: "/home/mmwearerp/htdocs/erp.mmwear.in",
      node_args: "--enable-source-maps",
      env_file: "/home/mmwearerp/htdocs/erp.mmwear.in/.env",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
