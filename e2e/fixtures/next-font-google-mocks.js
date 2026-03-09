module.exports = new Proxy(
  {},
  {
    get(_target, url) {
      if (typeof url !== 'string') return undefined
      return [
        '@font-face {',
        "  font-family: 'Noto Sans SC';",
        '  font-style: normal;',
        '  font-weight: 400;',
        "  src: url('https://fonts.gstatic.com/s/notosanssc/v1/mock.woff2') format('woff2');",
        '}',
      ].join('\n')
    },
  },
)
