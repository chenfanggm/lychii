class Plugin {
  constructor(bot) {
    this.bot = bot
    this.client = bot.client
    this.processors = []
  }

  register(regex, handler) {
    if (typeof handler === 'function') {
      this.processors.push({
        regex,
        handler
      })
    } else if (handler.handler) {
      const processor = Object.assign({}, { regex }, handler)
      this.processors.push(processor)
    }
  }

  processMessage(metaMsg) {
    const message = metaMsg.text
    const rawMessage = metaMsg.rawText

    this.processors.map((processor) => {
      const matches = processor.useRaw ? rawMessage.match(processor.regex) : message.match(processor.regex)
      if (matches) {
        const splits =  message.split(' ')
        if (processor.pre && typeof processor.pre === 'function') {
          processor.pre(metaMsg, matches, splits)
        }

        processor.handler(metaMsg, matches, splits)
      }
    })
  }
}

module.exports = Plugin