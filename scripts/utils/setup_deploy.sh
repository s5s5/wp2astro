#!/bin/bash

# 检查 rsync
echo "检查并安装必要组件..."
if ! command -v rsync &> /dev/null; then
    echo "正在安装 rsync..."
    apt update && apt install rsync -y
fi

# --- 1. 探测环境 ---
echo "探测环境..."
SSH_PORT=$(ss -tlnp | grep sshd | head -1 | awk '{print $4}' | awk -F':' '{print $NF}')
[ -z "$SSH_PORT" ] && SSH_PORT=22
SERVER_IP=$(curl -s https://ifconfig.me || curl -s ip.sb)
WWW_USER=$(stat -c '%U' /www/wwwroot 2>/dev/null || echo "www")

# --- 2. 配置 SSH 权限 ---
echo "配置 SSH 权限..."
USER_HOME=$(eval echo "~$WWW_USER")
if ! id "$WWW_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$WWW_USER"
    USER_HOME="/home/$WWW_USER"
fi

usermod -s /bin/bash "$WWW_USER"
mkdir -p "$USER_HOME/.ssh"

# 仅在私钥不存在时生成
if [ ! -f "$USER_HOME/.ssh/id_rsa" ]; then
    ssh-keygen -t rsa -b 4096 -f "$USER_HOME/.ssh/id_rsa" -N ""
fi

# --- 核心改进：防止重复写入公钥 ---
PUB_KEY=$(cat "$USER_HOME/.ssh/id_rsa.pub")
if ! grep -qF "$PUB_KEY" "$USER_HOME/.ssh/authorized_keys" 2>/dev/null; then
    echo "$PUB_KEY" >> "$USER_HOME/.ssh/authorized_keys"
fi

chmod 700 "$USER_HOME/.ssh"
chmod 600 "$USER_HOME/.ssh/authorized_keys"
chown -R "$WWW_USER:$WWW_USER" "$USER_HOME/.ssh"

# --- 3. 输出结果 ---
echo "================================================================"
echo "      🚀 GitHub Actions 配置信息 (2026版) 🚀"
echo "================================================================"
echo "HOST: $SERVER_IP"
echo "PORT: $SSH_PORT"
echo "USERNAME: $WWW_USER"
echo "TARGET_DIR: /www/wwwroot/【填入你的项目目录名】"
echo "----------------------------------------------------------------"
echo "SSH_PRIVATE_KEY (请完整复制下方内容):"
cat "$USER_HOME/.ssh/id_rsa"
echo "================================================================"

