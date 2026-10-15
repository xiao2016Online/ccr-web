-- 管理界面登录账号 (用户名 + Argon2id 密码哈希)。
-- Web UI 登录从「访问令牌」升级为「用户名 + 密码」; 代理数据面 /v1 的访问令牌
-- (settings.auth_token) 不受影响, 两者是相互独立的凭证。
CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
