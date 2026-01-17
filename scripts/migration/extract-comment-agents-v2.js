/**
 * 从 WordPress 数据库 SQL 导出文件中提取评论 ID 和 User Agent
 *
 * WordPress wp_comments 表结构 (标准顺序):
 * comment_ID, comment_post_ID, comment_author, comment_author_email,
 * comment_author_url, comment_author_IP, comment_date, comment_date_gmt,
 * comment_content, comment_karma, comment_approved, comment_agent,
 * comment_type, comment_parent, user_id
 *
 * 使用方法: node scripts/migration/extract-comment-agents-v2.js
 */

const fs = require('fs');
const path = require('path');

const COMMENTS_SQL = path.join(__dirname, '../data/comments_data.sql');
const OUTPUT_JSON = path.join(__dirname, '../data/comment-agents-result.json');
const OUTPUT_CSV = path.join(__dirname, '../data/comment-agents-result.csv');
const OUTPUT_SQL = path.join(__dirname, '../data/comment-agents-update.sql');

// 读取文件内容
console.log('📖 读取文件:', COMMENTS_SQL);
const content = fs.readFileSync(COMMENTS_SQL, 'utf8');
console.log('📊 文件大小:', (content.length / 1024 / 1024).toFixed(2), 'MB');

// 查看文件开头结构
console.log('\n📋 文件开头预览 (前 500 字符):');
console.log(content.substring(0, 500));
console.log('\n...\n');

// 尝试找到列名定义
const columnsMatch = content.match(/INSERT INTO[^(]+\(([^)]+)\)/i);
let columns = null;
if (columnsMatch) {
  columns = columnsMatch[1].split(',').map(c => c.trim().replace(/`/g, '').toLowerCase());
  console.log('📑 检测到的列名:', columns.join(', '));

  const idIndex = columns.indexOf('comment_id');
  const agentIndex = columns.indexOf('comment_agent');
  console.log(`   comment_id 位置: ${idIndex}, comment_agent 位置: ${agentIndex}`);
}

// 使用正则提取所有值组
// 每个 VALUES 中的记录格式: (val1, val2, ..., valN)
console.log('\n🔍 开始解析数据...');

const results = [];

// 方法1: 如果是标准格式，尝试使用正则
// 匹配 (数字, ...) 格式的记录
const recordRegex = /\((\d+),\s*'?(\d+)'?,\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'((?:[^'\\]|\\'|''|\\.)*)'/g;

// 更简单的方法：逐个解析
function parseCommentsInsert(sql) {
  const results = [];

  // 找到 VALUES 部分
  const valuesStart = sql.indexOf('VALUES');
  if (valuesStart === -1) {
    console.log('❌ 未找到 VALUES 关键字');
    return results;
  }

  const valuesStr = sql.substring(valuesStart + 6);

  // 状态机解析
  let pos = 0;
  let recordCount = 0;

  while (pos < valuesStr.length) {
    // 找下一个 (
    while (pos < valuesStr.length && valuesStr[pos] !== '(') pos++;
    if (pos >= valuesStr.length) break;

    pos++; // 跳过 (

    // 解析这条记录的所有字段
    const fields = [];
    let currentField = '';
    let inString = false;
    let depth = 0;

    while (pos < valuesStr.length) {
      const char = valuesStr[pos];
      const nextChar = pos + 1 < valuesStr.length ? valuesStr[pos + 1] : '';

      if (!inString) {
        if (char === "'") {
          inString = true;
          pos++;
          continue;
        } else if (char === ',' && depth === 0) {
          fields.push(currentField.trim());
          currentField = '';
          pos++;
          continue;
        } else if (char === ')' && depth === 0) {
          fields.push(currentField.trim());
          pos++;
          break;
        } else if (char === '(') {
          depth++;
        } else if (char === ')') {
          depth--;
        }
        currentField += char;
      } else {
        // 在字符串内
        if (char === '\\' && nextChar) {
          currentField += nextChar;
          pos += 2;
          continue;
        } else if (char === "'" && nextChar === "'") {
          currentField += "'";
          pos += 2;
          continue;
        } else if (char === "'") {
          inString = false;
          pos++;
          continue;
        }
        currentField += char;
      }
      pos++;
    }

    recordCount++;

    // 提取 comment_id 和 comment_agent
    // 默认位置: comment_id = 0, comment_agent = 11
    let idIndex = 0;
    let agentIndex = 11;

    if (columns) {
      const foundIdIndex = columns.indexOf('comment_id');
      const foundAgentIndex = columns.indexOf('comment_agent');
      if (foundIdIndex !== -1) idIndex = foundIdIndex;
      if (foundAgentIndex !== -1) agentIndex = foundAgentIndex;
    }

    if (fields.length > Math.max(idIndex, agentIndex)) {
      const commentId = fields[idIndex].replace(/^'|'$/g, '');
      const commentAgent = fields[agentIndex];

      results.push({
        comment_id: parseInt(commentId, 10),
        comment_agent: commentAgent === 'NULL' ? null : commentAgent
      });
    }
  }

  console.log(`📊 解析了 ${recordCount} 条记录`);
  return results;
}

const extracted = parseCommentsInsert(content);
console.log(`✅ 成功提取 ${extracted.length} 条评论的 User Agent 信息`);

// 保存结果
if (extracted.length > 0) {
  // JSON 格式
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(extracted, null, 2), 'utf8');
  console.log(`💾 已保存 JSON: ${OUTPUT_JSON}`);

  // CSV 格式
  const csv = 'comment_id,comment_agent\n' +
    extracted.map(r => `${r.comment_id},"${(r.comment_agent || '').replace(/"/g, '""')}"`).join('\n');
  fs.writeFileSync(OUTPUT_CSV, csv, 'utf8');
  console.log(`💾 已保存 CSV: ${OUTPUT_CSV}`);

  // 生成 UPDATE SQL 语句（用于导入到其他数据库）
  const updateSqls = extracted
    .filter(r => r.comment_agent)
    .map(r => `UPDATE comments SET user_agent = '${r.comment_agent.replace(/'/g, "''")}' WHERE legacy_id = ${r.comment_id};`)
    .join('\n');
  fs.writeFileSync(OUTPUT_SQL, updateSqls, 'utf8');
  console.log(`💾 已保存 SQL: ${OUTPUT_SQL}`);

  // 预览
  console.log('\n📋 前 10 条记录预览:');
  extracted.slice(0, 10).forEach(r => {
    const agent = r.comment_agent || '(空)';
    console.log(`  ID: ${r.comment_id}, Agent: ${agent.length > 60 ? agent.substring(0, 60) + '...' : agent}`);
  });

  // 统计
  const withAgent = extracted.filter(r => r.comment_agent && r.comment_agent !== 'NULL').length;
  const withoutAgent = extracted.length - withAgent;
  console.log(`\n📊 统计:`);
  console.log(`   有 User Agent: ${withAgent} 条`);
  console.log(`   无 User Agent: ${withoutAgent} 条`);
}
