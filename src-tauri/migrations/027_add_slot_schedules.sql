-- 槽位分时段规则 (JSON, 形如 {"opus":[{"days":[1,2],"start":"22:00","end":"08:00","model":"x"}]}), '{}' = 没有规则
ALTER TABLE subscriptions ADD COLUMN slot_schedules TEXT NOT NULL DEFAULT '{}';
