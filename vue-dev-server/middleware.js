//  转换单文件组件，最终返回浏览器能够识别的文件
const vueCompiler = require('@vue/component-compiler')
const fs = require('fs')
// fs.stat 检查文件是否存在, 存在返回文件信息
const stat = require('util').promisify(fs.stat)
const root = process.cwd()
const path = require('path')
const parseUrl = require('parseurl')

// 将对应文件下的三方依赖路径修改（路径前添加/__modules）也就是针对 npm 包转换。
const { transformModuleImports } = require('./transformModuleImports')

// 加载包（这里只支持Vue文件）
const { loadPkg } = require('./loadPkg');

// 这个函数主要作用：根据请求获取文件资源。返回文件路径 filepath、资源 source、和更新时间 updateTime
const { readSource } = require('./readSource')

const defaultOptions = {
  cache: true
}

const vueMiddleware = (options = defaultOptions) => {
  let cache
  let time = {}
  if (options.cache) {
    const LRU = require('lru-cache')

    cache = new LRU({
      max: 500,
      length: function (n, key) { return n * 2 + key.length }
    })
  }

  // 将vue文件 转换成浏览器支持的文件
  const compiler = vueCompiler.createDefaultCompiler()

  function send(res, source, mime) {
    res.setHeader('Content-Type', mime)
    res.end(source)
  }

  function injectSourceMapToBlock(block, lang) {
    const map = Base64.toBase64(
      JSON.stringify(block.map)
    )
    let mapInject

    switch (lang) {
      case 'js': mapInject = `//# sourceMappingURL=data:application/json;base64,${map}\n`; break;
      case 'css': mapInject = `/*# sourceMappingURL=data:application/json;base64,${map}*/\n`; break;
      default: break;
    }

    return {
      ...block,
      code: mapInject + block.code
    }
  }

  function injectSourceMapToScript(script) {
    return injectSourceMapToBlock(script, 'js')
  }

  function injectSourceMapsToStyles(styles) {
    return styles.map(style => injectSourceMapToBlock(style, 'css'))
  }

  // 尝试从缓存中获取文件
  async function tryCache(key, checkUpdateTime = true) {
    const data = cache.get(key)

    if (checkUpdateTime) {
      const cacheUpdateTime = time[key]
      const fileUpdateTime = (await stat(path.resolve(root, key.replace(/^\//, '')))).mtime.getTime()
      if (cacheUpdateTime < fileUpdateTime) return null
    }

    return data
  }

  function cacheData(key, data, updateTime) {
    const old = cache.peek(key)

    if (old != data) {
      cache.set(key, data)
      if (updateTime) time[key] = updateTime
      return true
    } else return false
  }

  async function bundleSFC(req) {
    const { filepath, source, updateTime } = await readSource(req)
    const descriptorResult = compiler.compileToDescriptor(filepath, source)
    const assembledResult = vueCompiler.assemble(compiler, filepath, {
      ...descriptorResult,
      script: injectSourceMapToScript(descriptorResult.script),
      styles: injectSourceMapsToStyles(descriptorResult.styles)
    })
    return { ...assembledResult, updateTime }
  }

  return async (req, res, next) => {
    if (req.path.endsWith('.vue')) {
      const key = parseUrl(req).pathname
      let out = await tryCache(key)

      if (!out) {
        // Bundle Single-File Component
        const result = await bundleSFC(req)
        out = result
        cacheData(key, out, result.updateTime)
      }

      send(res, out.code, 'application/javascript')
    } else if (req.path.endsWith('.js')) {
      const key = parseUrl(req).pathname
      let out = await tryCache(key)

      if (!out) {

        // 根据请求的文件 ， 加载对应的文件
        // transform import statements
        const result = await readSource(req)

        // 将对应文件下的三方依赖路径修改（路径前添加/__modules）
        out = transformModuleImports(result.source)

        // 
        cacheData(key, out, result.updateTime)
      }

      send(res, out, 'application/javascript')
    } else if (req.path.startsWith('/__modules/')) {
      const key = parseUrl(req).pathname
      const pkg = req.path.replace(/^\/__modules\//, '')

      let out = await tryCache(key, false) // Do not outdate modules
      if (!out) {
        out = (await loadPkg(pkg)).toString()
        cacheData(key, out, false) // Do not outdate modules
      }

      send(res, out, 'application/javascript')
    } else {
      next()
    }
  }
}

exports.vueMiddleware = vueMiddleware
