import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson, tradeMasterHome, writeJson } from './storage.js';
function configPath() {
    return join(tradeMasterHome(), 'notifications.json');
}
function statePath() {
    return join(tradeMasterHome(), 'notifications', 'state.json');
}
function auditPath() {
    return join(tradeMasterHome(), 'notifications', 'audit.json');
}
export function loadNotificationConfig() {
    if (!existsSync(configPath()))
        throw new Error('缺少 notifications.json，请先运行 notify configure-feishu');
    return readJson(configPath());
}
export function configureFeishu(options) {
    const config = {
        schema_version: 1,
        enabled: true,
        channel: 'feishu',
        receiver: { type: options.receiverType ?? 'user_id', id: options.receiverId },
        identity: options.identity ?? 'bot',
        cli_path: options.cliPath ?? 'lark-cli',
        duplicate_window_minutes: Math.max(1, options.duplicateWindowMinutes ?? 60),
        maximum_audit_entries: 500,
        read_only: true,
    };
    writeJson(configPath(), config);
    return config;
}
function icon(severity) {
    if (severity === 'critical')
        return '🔴';
    if (severity === 'warning')
        return '🟠';
    if (severity === 'opportunity')
        return '🟡';
    return '🔵';
}
export function renderFeishuMarkdown(payload) {
    const lines = [
        `#### ${icon(payload.severity)} Trade Master｜${payload.title}`,
        '',
        `**当前动作：${payload.action ?? '继续观察'}**`,
        '',
        payload.summary.trim(),
    ];
    if (payload.detail?.trim())
        lines.push('', payload.detail.trim());
    if (payload.blockers?.length)
        lines.push('', '**阻断闸门**', ...payload.blockers.map((item) => `- ${item}`));
    if (payload.data_time)
        lines.push('', `- 数据截止：${payload.data_time}`);
    if (payload.next_check)
        lines.push(`- 下一检查点：${payload.next_check}`);
    lines.push('', '> 仅供学习研究和观察参考，不构成任何证券投资咨询服务或买卖建议；不保证盈利，不连接或操作券商账户。投资有风险，决策需谨慎。');
    return lines.join('\n');
}
export function notificationFingerprint(payload) {
    const material = payload.fingerprint ?? JSON.stringify({
        mode: payload.mode,
        severity: payload.severity,
        title: payload.title,
        summary: payload.summary,
        action: payload.action ?? '',
        blockers: payload.blockers ?? [],
        next_check: payload.next_check ?? '',
    });
    return createHash('sha256').update(material).digest('hex');
}
function loadState() {
    return existsSync(statePath())
        ? readJson(statePath())
        : { schema_version: 1, updated_at: new Date().toISOString(), sent: {} };
}
function appendAudit(config, event) {
    const audit = existsSync(auditPath())
        ? readJson(auditPath())
        : { schema_version: 1, events: [] };
    audit.events.push(event);
    audit.events = audit.events.slice(-config.maximum_audit_entries);
    writeJson(auditPath(), audit);
}
function maskedReceiver(config) {
    const value = config.receiver.id;
    return value.length <= 10 ? '***' : `${value.slice(0, 5)}***${value.slice(-4)}`;
}
export function notificationStatus() {
    const config = loadNotificationConfig();
    const state = loadState();
    return {
        enabled: config.enabled,
        channel: config.channel,
        receiver: { type: config.receiver.type, id: maskedReceiver(config) },
        identity: config.identity,
        duplicate_window_minutes: config.duplicate_window_minutes,
        read_only: config.read_only,
        sent_fingerprints: Object.keys(state.sent).length,
        updated_at: state.updated_at,
    };
}
export function sendFeishuNotification(payload, dryRun = false) {
    if (!payload.summary.trim() || payload.summary.trim() === 'NO_REPLY') {
        return { sent: false, suppressed: true, reason: 'empty_or_no_reply' };
    }
    const config = loadNotificationConfig();
    if (!config.enabled)
        return { sent: false, suppressed: true, reason: 'channel_disabled' };
    if (!config.receiver.id)
        throw new Error('飞书接收人未配置');
    const fingerprint = notificationFingerprint(payload);
    const state = loadState();
    const previous = state.sent[fingerprint];
    const duplicateWindowMs = config.duplicate_window_minutes * 60_000;
    if (previous && Date.now() - Date.parse(previous.sent_at) < duplicateWindowMs) {
        return { sent: false, duplicate: true, fingerprint, previous_sent_at: previous.sent_at };
    }
    const markdown = renderFeishuMarkdown(payload);
    if (dryRun)
        return { sent: false, dry_run: true, fingerprint, markdown, receiver: maskedReceiver(config) };
    const receiverFlag = config.receiver.type === 'user_id' ? '--user-id' : '--chat-id';
    const idempotencyKey = `trade-master-${fingerprint.slice(0, 32)}`;
    const command = [
        'im', '+messages-send', receiverFlag, config.receiver.id,
        '--markdown', markdown,
        '--as', config.identity,
        '--idempotency-key', idempotencyKey,
    ];
    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const result = spawnSync(config.cli_path, command, {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
                LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
                LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
            },
        });
        try {
            const response = JSON.parse(result.stdout || result.stderr);
            if (result.status === 0 && response.ok === true) {
                const sentAt = new Date().toISOString();
                state.sent[fingerprint] = { sent_at: sentAt, message_id: response.data?.message_id ?? null };
                const cutoff = Date.now() - 7 * 86_400_000;
                state.sent = Object.fromEntries(Object.entries(state.sent).filter(([, item]) => Date.parse(item.sent_at) >= cutoff));
                state.updated_at = sentAt;
                writeJson(statePath(), state);
                appendAudit(config, { sent_at: sentAt, fingerprint, mode: payload.mode, severity: payload.severity, title: payload.title, ...response.data });
                return { sent: true, fingerprint, ...response.data };
            }
            lastError = response.error?.message ?? result.stderr ?? `exit ${result.status}`;
        }
        catch {
            lastError = result.stderr || result.stdout || `exit ${result.status}`;
        }
    }
    throw new Error(`飞书通知发送失败：${lastError.trim()}`);
}
