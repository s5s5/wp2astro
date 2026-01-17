#!/bin/bash
# 从 WordPress SQL 备份中提取评论 ID 和 User Agent
# 使用 grep + sed/awk 处理

SQL_FILE="/Users/xiaochao.liu/Code/wp2astro/wordpress/db/s5s5_me_2026-01-12_03-30-02_mysql_data.sql"
OUTPUT_DIR="/Users/xiaochao.liu/Code/wp2astro/scripts/data"

echo "=== WordPress 评论 User Agent 提取工具 ==="
echo "输入文件: $SQL_FILE"
echo ""

# 检查文件是否存在
if [ ! -f "$SQL_FILE" ]; then
    echo "错误: 文件不存在: $SQL_FILE"
    exit 1
fi

echo "文件大小: $(du -h "$SQL_FILE" | cut -f1)"
echo ""

# 查找包含 comments 表的 INSERT 语句
echo "正在搜索 wp_comments 表的 INSERT 语句..."
grep -n "INSERT INTO.*comments" "$SQL_FILE" | head -5 > "$OUTPUT_DIR/comments_inserts_preview.txt"

echo "预览已保存到: $OUTPUT_DIR/comments_inserts_preview.txt"

# 提取完整的 comments INSERT 语句到临时文件
echo "正在提取 comments 表数据..."
grep "INSERT INTO.*comments" "$SQL_FILE" > "$OUTPUT_DIR/comments_data.sql"

echo "评论数据已保存到: $OUTPUT_DIR/comments_data.sql"
echo ""
echo "完成! 请查看输出文件。"
