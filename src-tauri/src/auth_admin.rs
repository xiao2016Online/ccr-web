//! 管理界面登录账号 (`admin_users` 表)。
//!
//! Web UI 的登录从「访问代理令牌」升级为「用户名 + 密码」: 密码用 Argon2id
//! 哈希落库, 首次启动由环境变量或随机生成播种 (`server.rs`)。注意这是管理界面
//! (/ui) 的凭证, 与代理数据面 (/v1/*) 的访问令牌 `settings.auth_token` 相互独立。

use argon2::password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::Argon2;
use chrono::Utc;
use once_cell::sync::Lazy;
use sqlx::SqlitePool;
use tracing::info;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// 环境变量未指定用户名时播种的缺省账号名。
pub const DEFAULT_ADMIN_USERNAME: &str = "admin";

/// 登录密码的最小长度 (播种与修改时共同约束)。
pub const MIN_PASSWORD_LEN: usize = 8;

/// Argon2id 哈希 (PHC 字符串格式)。
/// password-hash 0.6: 随机盐由 `hash_password` 内部生成 (argon2 默认 getrandom feature)。
pub fn hash_password(password: &str) -> AppResult<String> {
    let hash = Argon2::default()
        .hash_password(password.as_bytes())
        .map_err(|e| AppError::internal(format!("密码哈希失败: {e}")))?;
    Ok(hash.to_string())
}

/// 校验密码 vs 哈希。哈希格式非法视为不匹配 (不 panic)。
pub fn verify_password(hash: &str, password: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// 用户不存在时执行一次假校验, 抹平「存在/不存在」响应时间差 (防用户名枚举)。
static TIMING_EQUALIZER: Lazy<String> = Lazy::new(|| {
    hash_password("cc-router-timing-equalizer").unwrap_or_default()
});

/// 播种 / 重置一个管理员账号 (按 username upsert, 密码以传入值为准)。
pub async fn ensure_admin_user(pool: &SqlitePool, username: &str, password: &str) -> AppResult<()> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(AppError::BadRequest(format!(
            "管理密码至少需要 {MIN_PASSWORD_LEN} 个字符"
        )));
    }
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let hash = hash_password(password)?;
    sqlx::query(
        "INSERT INTO admin_users (id, username, password_hash, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(username) DO UPDATE SET \
           password_hash = excluded.password_hash, updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(username)
    .bind(&hash)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    info!(username, "admin user seeded/updated");
    Ok(())
}

/// 管理员账号数 (首启判断用: 0 = 需要播种)。
pub async fn count_admins(pool: &SqlitePool) -> AppResult<i64> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_users")
        .fetch_one(pool)
        .await?;
    Ok(n)
}

/// 登录校验。任何失败统一返回 false, 不区分「用户不存在」与「密码错误」。
pub async fn verify_login(pool: &SqlitePool, username: &str, password: &str) -> AppResult<bool> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT password_hash FROM admin_users WHERE username = ?")
            .bind(username)
            .fetch_optional(pool)
            .await?;
    Ok(match row {
        Some((hash,)) => verify_password(&hash, password),
        None => {
            let _ = verify_password(&TIMING_EQUALIZER, password);
            false
        }
    })
}

/// 修改密码: 先验证当前密码, 通过后更新哈希。用户名不存在同样报「用户名或当前密码不正确」。
pub async fn change_password(
    pool: &SqlitePool,
    username: &str,
    old_password: &str,
    new_password: &str,
) -> AppResult<()> {
    if !verify_login(pool, username, old_password).await? {
        return Err(AppError::BadRequest("用户名或当前密码不正确".into()));
    }
    if new_password.chars().count() < MIN_PASSWORD_LEN {
        return Err(AppError::BadRequest(format!(
            "新密码至少需要 {MIN_PASSWORD_LEN} 个字符"
        )));
    }
    let hash = hash_password(new_password)?;
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query("UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE username = ?")
        .bind(&hash)
        .bind(&now)
        .bind(username)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::BadRequest("用户名或当前密码不正确".into()));
    }
    info!(username, "admin password changed");
    Ok(())
}

/// 生成人类可读的随机密码: 20 字符, 去掉易混淆的 0/O/1/l/I。
pub fn generate_password() -> String {
    const ALPHABET: &[u8] = b"23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
    let mut out = String::with_capacity(20);
    while out.len() < 20 {
        let b = *ALPHABET
            .get(usize::from(uuid::Uuid::new_v4().as_u128() as usize % ALPHABET.len()))
            .unwrap();
        out.push(b as char);
        // 每次 128 bit 太浪费, 但简单正确; 取模偏差在 94 % 62 ≈ 可忽略量级, 登录口令场景足够。
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_roundtrip() {
        let hash = hash_password("s3cret-passw0rd").unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password(&hash, "s3cret-passw0rd"));
        assert!(!verify_password(&hash, "wrong"));
        assert!(!verify_password("not-a-hash", "wrong"));
    }

    #[test]
    fn generated_password_shape() {
        for _ in 0..8 {
            let p = generate_password();
            assert_eq!(p.len(), 20);
            assert!(!p.contains('0') && !p.contains('O') && !p.contains('l'));
        }
    }

    #[tokio::test]
    async fn admin_crud_flow() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("t.db")).await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();

        assert_eq!(count_admins(&pool).await.unwrap(), 0);
        ensure_admin_user(&pool, "admin", "first-pass-123").await.unwrap();
        assert_eq!(count_admins(&pool).await.unwrap(), 1);
        assert!(verify_login(&pool, "admin", "first-pass-123").await.unwrap());
        assert!(!verify_login(&pool, "admin", "wrong").await.unwrap());
        assert!(!verify_login(&pool, "nobody", "wrong").await.unwrap());

        change_password(&pool, "admin", "first-pass-123", "second-pass-456")
            .await
            .unwrap();
        assert!(!verify_login(&pool, "admin", "first-pass-123").await.unwrap());
        assert!(verify_login(&pool, "admin", "second-pass-456").await.unwrap());

        // 旧密码错 / 用户不存在 / 新密码过短
        assert!(change_password(&pool, "admin", "nope", "second-pass-456").await.is_err());
        assert!(change_password(&pool, "ghost", "x", "long-enough-pw").await.is_err());
        assert!(change_password(&pool, "admin", "second-pass-456", "short").await.is_err());

        // upsert: 同用户名重复播种不炸表
        ensure_admin_user(&pool, "admin", "third-pass-789").await.unwrap();
        assert_eq!(count_admins(&pool).await.unwrap(), 1);
        assert!(verify_login(&pool, "admin", "third-pass-789").await.unwrap());
    }
}
