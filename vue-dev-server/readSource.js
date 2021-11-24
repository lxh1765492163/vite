const path = require('path')
const fs = require('fs')
// 将 fs.readFile() 转换为一个接受相同参数但返回 Promise 的函数
const readFile = require('util').promisify(fs.readFile)
// fs.stat 检查文件是否存在, 存在返回文件信息
const stat = require('util').promisify(fs.stat)
const parseUrl = require('parseurl')
const root = process.cwd()

async function readSource(req) {
  const { pathname } = parseUrl(req)
  const filepath = path.resolve(root, pathname.replace(/^\//, ''))
  return {
    filepath,
    source: await readFile(filepath, 'utf-8'),
    updateTime: (await stat(filepath)).mtime.getTime()
  }
}

exports.readSource = readSource
