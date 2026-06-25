module.exports = {
  apps: [{
    name: 'farmer-assistant',
    script: './dist/boot.js',
    cwd: '/var/www/farmer-assistant',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    // Load env from .env file via dotenv
    // The cwd is set so dotenv/config finds the .env file
    node_args: '-r dotenv/config',
  }],
};
