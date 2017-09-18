class Plugin {
  constructor(bot) {
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
      this.processors.push({
        regex,
        ...handler
      })
    }
  }

  processMessage(metaMsg) {
    const message = metaMsg.text
    const rawMessage = metaMsg.rawText

    this.processors.map((processor) => {
      const matches = processor.useRaw ? rawMessage.match(processor.regex) : message.match(processor.regex)
      if (matches) {
        if (processor.pre && typeof processor.pre === 'function') {
          processor.pre(metaMsg, matches)
        }

        processor.handler(metaMsg, matches)
      }
    })
  }
}

module.exports = Plugin