/**
 * 查看 SQL 文件开头和结构
 */

const fs = require('fs');
const path = require('path');

const SQL_FILE = path.join(__dirname, '../data/comments_data.sql');

const content = fs.readFileSync(SQL_FILE, 'utf8');

console.log('文件大小:', (content.length / 1024 / 1024).toFixed(2), 'MB');
console.log('');

// 显示前 2000 个字符
console.log('=== 文件开头 (前2000字符) ===');
console.log(content.substring(0, 2000));
console.log('\n=== 结束 ===');

// 查找所有包含 INSERT 的行
console.log('\n=== 包含 INSERT 的行 ===');
const lines = content.split('\n');
let insertCount = 0;
for (let i = 0; i < lines.length && insertCount < 5; i++) {
  if (lines[i].includes('INSERT')) {
    console.log(`行 ${i + 1}:`, lines[i].substring(0, 200));
    insertCount++;
  }
}
