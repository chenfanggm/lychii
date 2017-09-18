module.exports = {
  env : process.env.NODE_ENV || 'development',
  token: process.env.SLACK_BOT_TOKEN || '',
  defaultChannel: 'private-integration',
  autoReconnect: true,
  storage: {
    mongo: {
      enable: false,
      uri: process.env.MONGO_URI || 'mongodb://localhost/lychii'
    }
  }
}