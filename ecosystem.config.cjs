module.exports = {
  apps: [
    {
      name: 'lodgify-price-updater',
      script: 'npm',
      args: 'start',
      cwd: '/home/jay/lodgify-price-updater-web',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      // Exponential backoff restart strategy
      exp_backoff_restart_delay: 100,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      // Environment
      env: {
        NODE_ENV: 'production',
      },
      // Logging
      error_file: '/home/jay/.pm2/logs/lodgify-price-updater-error.log',
      out_file: '/home/jay/.pm2/logs/lodgify-price-updater-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Kill timeout
      kill_timeout: 5000,
    },
  ],
};
