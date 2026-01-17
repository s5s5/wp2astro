/**
 * 分析 comments_data.sql 文件的结构
 */

const fs = require('fs');
const path = require('path');

const SQL_FILE = path.join(__dirname, '../data/comments_data.sql');

const content = fs.readFileSync(SQL_FILE, 'utf8');

console.log('文件大小:', (content.length / 1024 / 1024).toFixed(2), 'MB');
console.log('');

// 找出所有 INSERT INTO 语句
const insertMatches = content.matchAll(/INSERT INTO\s+[`']?(\w+)[`']?\s*\(([^)]+)\)/gi);
const inserts = [];

for (const match of insertMatches) {
  const tableName = match[1];
  const columns = match[2].split(',').map(c => c.trim().replace(/`/g, ''));
  inserts.push({
    table: tableName,
    columns: columns,
    position: match.index
  });
}

console.log('找到', inserts.length, '个 INSERT 语句:');
console.log('');

for (const insert of inserts) {
  console.log('表名:', insert.table);
  console.log('列名:', insert.columns.join(', '));
  console.log('位置:', insert.position);
  console.log('---');
}

// 找到 wp_comments 或 s5s5_comments 表
const commentsInsert = inserts.find(i => i.table.includes('comments') && !i.table.includes('meta'));
if (commentsInsert) {
  console.log('\n评论表信息:');
  console.log('表名:', commentsInsert.table);
  console.log('列名:', commentsInsert.columns);

  const idIndex = commentsInsert.columns.findIndex(c => c.toLowerCase() === 'comment_id');
  const agentIndex = commentsInsert.columns.findIndex(c => c.toLowerCase() === 'comment_agent');

  console.log('comment_id 索引:', idIndex);
  console.log('comment_agent 索引:', agentIndex);
}
