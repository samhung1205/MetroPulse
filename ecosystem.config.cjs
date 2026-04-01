// PM2 設定檔 — MRT Rank 台北捷運推薦系統
module.exports = {
  apps: [
    {
      name: 'mrt-rank',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=mrt-rank-db --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
