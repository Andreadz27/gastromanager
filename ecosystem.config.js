module.exports = {
  apps: [{
    name: 'morfi',
    script: 'server.js',
    cwd: __dirname, // la carpeta donde esté instalado
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
      // SECRET_KEY: si no se define, el servidor genera una propia en data/.secret_key
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    merge_logs: true
  }]
};
