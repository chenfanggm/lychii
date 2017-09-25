require('./libs/normalize')
const fs = require('fs')
const path = require('path')
const util = require('util')
const mongoose = require('mongoose')
const LychiiSlackAdapter = require('lychii-slack')
const config = require('./config')
const debug = require('debug')('app:bot')


// ----------------------------------
// Lychii Bot
// ----------------------------------
class LychiiBot {

  constructor(options) {
    this.client = null
    this.self = null
    this.team = null
    this.users = null
    this.channels = {}
    this.defaultChannel = null
    this.plugins = []
    this.config = Object.assign({}, config, options)
    this._onAuthenticated = this._onAuthenticated.bind(this)
    this._onConnected = this._onConnected.bind(this)
    this._onIncomingMessage = this._onIncomingMessage.bind(this)
    this._onReactionAdded = this._onReactionAdded.bind(this)
    this._onDisconnected = this._onDisconnected.bind(this)
    this.registerPlugin = this.registerPlugin.bind(this)
  }

  init() {
    // init storage: [mongodb]
    if (this.config.storage && this.config.storage.mongo.enable) {
      debug('init mongoose...')
      mongoose.Promise = Promise
      mongoose.connect(this.config.storage.mongo.uri, {
        useMongoClient: true,
        keepAlive: 1
      })
      mongoose.connection.on('error', () => {
        throw new Error('Failed to connect to database:' + this.config.storage.mongo.uri)
      })
      mongoose.connection.once('open', () => {
        debug('mongodb connected')
      })
      if (this.config.env === 'development') {
        mongoose.set('debug', (collectionName, method, query, doc) => {
          debug(collectionName + '.' + method, util.inspect(query, false, 20), doc)
        })
      }
    }

    // init client adapter
    this.client = new LychiiSlackAdapter({
      token: this.config.token
    })

    // init event handler
    const LychiiEvent = LychiiSlackAdapter.EVENTS
    this.client.on(LychiiEvent.AUTHENTICATED, this._onAuthenticated)
    this.client.on(LychiiEvent.CONNECTED, this._onConnected)
    this.client.on(LychiiEvent.MESSAGE, this._onIncomingMessage)
    this.client.on(LychiiEvent.REACTION_ADDED, this._onReactionAdded)
    this.client.on(LychiiEvent.DISCONNECTED, this._onDisconnected)

    // load default plugins
    this.loadPlugins(path.resolve(__dirname, './plugins'))
    // load user defined plugins
    if (this.config.pluginDirPath)
      this.loadPlugins(this.config.pluginDirPath)
    // init plugins
    this._initPlugins()

    // go!
    this.client.start()
  }

  loadPlugins(pluginDirPath) {
    const plugins = require(pluginDirPath)
    // load plugin from defined module.exports, if defined
    // if not, load from dir in plugins path
    if (plugins) {
      plugins.map((plugin) => {
        this.registerPlugin(plugin)
      })
    } else {
      fs.readdir(pluginDirPath, (err, files) => {
        if (err) throw err
        if (files) {
          files.map((file) => {
            const pluginFilePath = path.resolve(pluginDirPath, file)
            if (fs.lstatSync(pluginFilePath).isDirectory()) {
              const plugin = require(pluginFilePath)
              if (plugin) {
                this.registerPlugin(plugin)
              }
            }
          })
        }
      })
    }
  }

  registerPlugin(plugin) {
    debug(`register plugin: ${plugin.name}`)

    const pluginInstance = new plugin(this)
    this.plugins.push(pluginInstance)
  }

  _initPlugins() {
    if (this.plugins)
      this.plugins.map((plugin) => {
        if (plugin.init && typeof plugin.init === 'function') {
          plugin.init()
        }
      })
  }

  _onAuthenticated(identity) {
    this.self = identity.self
    this.team = identity.team
    this.users = identity.users
    identity.channels && identity.channels.map((channel) => {
      if (channel.name)
        this.channels[channel.name] = channel
    })

    // get bot_id
    for (let i = 0; i < this.users.length; i++) {
      if (this.users[i].id === this.self.id) {
        this.self.botId = this.users[i].profile.bot_id
      }
    }

    // default channel for post bot status
    for (const group of identity.groups) {
      if (group.name === this.config.defaultChannel) {
        this.defaultChannel = group
      }
    }

    debug(`login to team ${this.team.name} as ${this.self.name}`)
    debug(`default channel: ${this.defaultChannel.name}`)
  }

  _onConnected() {
    const user = this.client.rtm.dataStore
      .getUserById(this.client.rtm.activeUserId)
    const team = this.client.rtm.dataStore
      .getTeamById(this.client.rtm.activeTeamId)
    debug(`connected to team ${team.name} as ${user.name}`)

    this.client.send(`Hello! I'm ${this.self.name}`, this.defaultChannel)
  }

  _onDisconnected() {
    if (this.config.autoReconnect) {
      //TODO: add reconnect handler
      debug('disconnected, waiting for reconnect')
    } else {
      debug('disconnected, terminating bot...')
      this.client.disconnect()
      process.exit(1)
    }
  }

  _onIncomingMessage(metaMsg) {
    // filter accepted message
    const selfRecognizeRegex = new RegExp(`^(@?${this.self.name}\\s)`, 'i')
    if(!this._isAcceptable(metaMsg, selfRecognizeRegex)) return
    this._trimMessage(metaMsg, selfRecognizeRegex)

    let { text, user, bot, channel, subtype, topic } = metaMsg

    // optimize meta
    user = user || bot || {}
    subtype = subtype || 'message'

    // process message
    switch (subtype) {
      case 'channel_join':
      case 'group_join':
        debug(`${user.name} has joined ${channel.name}`)
        break
      case 'channel_leave':
      case 'group_leave':
        debug(`${user.name} has left ${channel.name}`)
        break
      case 'channel_topic':
      case 'group_topic':
        debug(`${user.name} set the topic in ${channel.name} to ${topic}`)
        break
      case 'message':
      case 'bot_message':
      default:
        debug(`received from ${user.name} in channel ${channel.name}: ${text}`)
        this._processMessage(metaMsg)
        break
    }
  }

  _isAcceptable(metaMsg, selfRecognizeRegex) {
    let { text, user, bot } = metaMsg
    // ignore that sent from self
    if (user && user.id === this.self.id) return false
    if (bot && bot.id === this.self.botId) return false

    // accept direct message
    if (metaMsg.isDM) {
      return true
    }
    // ignore that not mention self
    return selfRecognizeRegex.test(text);

  }

  _trimMessage(metaMsg, selfRecognizeRegex) {
    metaMsg.text = metaMsg.text.trim()
    // clean self annotation
    metaMsg.text = metaMsg.text.replace(selfRecognizeRegex, '')
  }

  _processMessage(metaMsg) {
    debug(`processing: ${metaMsg.text}`)
    this.plugins.map((plugin) => {
      plugin.processMessage(metaMsg)
    })
  }

  _onReactionAdded(reaction) {
    debug('reaction added: ', reaction)
  }

}

module.exports = LychiiBot

// expose API
module.exports.Plugin = require('./libs/Plugin')
module.exports.MessageUtils = require('lychii-slack').MessageUtils
