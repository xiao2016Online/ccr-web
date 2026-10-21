-- 自定义 Anthropic 兼容订阅的图标修正: custom -> claude。
-- 创建订阅时写入的 provider_icon 快照此前取的是通用 "custom" (渲染成叠层盒子图标),
-- 与创建表单里该选项展示的 Claude 图标不一致。只改 Anthropic 自定义来源标记,
-- 自定义 System One 仍保留 "custom"。
UPDATE subscriptions
SET provider_icon = 'claude'
WHERE provider_id = 'custom' AND provider_icon = 'custom';
